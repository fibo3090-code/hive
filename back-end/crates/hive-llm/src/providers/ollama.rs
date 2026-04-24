use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;

use crate::chat::{ChatRequest, StreamChunk, StreamEvent};
use crate::{ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct OllamaProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl OllamaProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        Self { http, config }
    }
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    #[serde(default)]
    details: Option<Details>,
}

#[derive(Deserialize)]
struct Details {
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    parameter_size: Option<String>,
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: TagsResponse =
        serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .models
        .into_iter()
        .map(|e| {
            let suffix = e.details.as_ref().and_then(|d| {
                match (d.family.as_deref(), d.parameter_size.as_deref()) {
                    (Some(fam), Some(size)) => Some(format!(" ({fam} · {size})")),
                    (Some(fam), None) => Some(format!(" ({fam})")),
                    (None, Some(size)) => Some(format!(" ({size})")),
                    _ => None,
                }
            });
            let label = match suffix {
                Some(s) => format!("{}{s}", e.name),
                None => e.name.clone(),
            };
            let name_lower = e.name.to_ascii_lowercase();
            let supports_tools = name_lower.contains("llama3.1")
                || name_lower.contains("llama3.2")
                || name_lower.contains("qwen2.5")
                || name_lower.contains("mistral-nemo")
                || name_lower.contains("command-r");
            ModelInfo {
                id: e.name,
                label,
                context_window: None,
                supports_tools,
                supports_streaming: true,
            }
        })
        .collect())
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let url = format!("{}/api/tags", self.config.base_url.trim_end_matches('/'));
        let response = self.http.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus {
                status: status.as_u16(),
                body,
            });
        }
        let body = response.text().await?;
        parse_models(&body)
    }

    async fn chat_stream(&self, request: ChatRequest) -> Result<ChatStream, LlmError> {
        let url = format!("{}/api/chat", self.config.base_url.trim_end_matches('/'));

        let messages: Vec<serde_json::Value> = request
            .messages
            .iter()
            .map(|m| {
                serde_json::json!({
                    "role": m.role.as_str(),
                    "content": m.content,
                })
            })
            .collect();

        let mut options = serde_json::Map::new();
        if let Some(t) = request.temperature {
            options.insert("temperature".into(), serde_json::json!(t));
        }
        if let Some(m) = request.max_tokens {
            options.insert("num_predict".into(), serde_json::json!(m));
        }

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": messages,
            "stream": true,
        });
        if !options.is_empty() {
            body["options"] = serde_json::Value::Object(options);
        }

        let response = self
            .http
            .post(url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus {
                status: status.as_u16(),
                body: body_text,
            });
        }

        let byte_stream = response.bytes_stream();
        let mapped = async_stream::stream! {
            let mut buffer = String::new();
            let mut body = Box::pin(byte_stream);
            loop {
                match body.next().await {
                    Some(Ok(chunk)) => {
                        if let Ok(text) = std::str::from_utf8(&chunk) {
                            buffer.push_str(text);
                        } else {
                            buffer.push_str(&String::from_utf8_lossy(&chunk));
                        }
                        while let Some(idx) = buffer.find('\n') {
                            let line = buffer[..idx].trim().to_owned();
                            buffer.drain(..=idx);
                            if line.is_empty() {
                                continue;
                            }
                            if let Some(event) = parse_line(&line) {
                                yield Ok(event);
                            }
                        }
                    }
                    Some(Err(e)) => {
                        yield Err(LlmError::Http(e));
                        break;
                    }
                    None => break,
                }
            }
        };
        Ok(Box::pin(mapped))
    }
}

fn parse_line(line: &str) -> Option<StreamEvent> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let done = value.get("done").and_then(|d| d.as_bool()).unwrap_or(false);
    if done {
        let tokens_in = value
            .get("prompt_eval_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let tokens_out = value
            .get("eval_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let finish = value
            .get("done_reason")
            .and_then(|r| r.as_str())
            .map(str::to_owned);
        return Some(StreamEvent::Complete {
            tokens_in,
            tokens_out,
            finish_reason: finish,
        });
    }
    let text = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())?;
    if text.is_empty() {
        return None;
    }
    Some(StreamEvent::Delta(StreamChunk {
        delta: text.to_owned(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_label_from_details_and_flags_tool_support() {
        let body = r#"{"models":[
            {"name":"qwen2.5:14b","details":{"family":"qwen2","parameter_size":"14.8B"}},
            {"name":"mistral-nemo:latest","details":{"family":"llama","parameter_size":"12.2B"}},
            {"name":"gemma2:9b","details":{"family":"gemma2","parameter_size":"9B"}},
            {"name":"plain-model"}
        ]}"#;
        let models = parse_models(body).unwrap();
        assert_eq!(models[0].id, "qwen2.5:14b");
        assert_eq!(models[0].label, "qwen2.5:14b (qwen2 · 14.8B)");
        assert!(models[0].supports_tools, "qwen2.5 should support tools");
        assert!(
            models[1].supports_tools,
            "mistral-nemo should support tools"
        );
        assert!(!models[2].supports_tools, "gemma2 should not support tools");
        assert_eq!(models[3].label, "plain-model");
        assert!(!models[3].supports_tools);
    }

    #[test]
    fn missing_models_field_yields_empty() {
        assert!(parse_models(r#"{}"#).unwrap().is_empty());
    }

    #[test]
    fn partial_details_only_family() {
        let body = r#"{"models":[{"name":"x","details":{"family":"foo"}}]}"#;
        assert_eq!(parse_models(body).unwrap()[0].label, "x (foo)");
    }

    #[test]
    fn invalid_json_is_parse_error() {
        assert!(matches!(parse_models("bad"), Err(LlmError::Parse(_))));
    }
}
