use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;

use crate::chat::{ChatRequest, ChatRole, StreamChunk, StreamEvent};
use crate::sse::sse_stream;
use crate::{ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct AnthropicProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl AnthropicProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        Self { http, config }
    }
}

#[derive(Deserialize)]
struct ListResponse {
    data: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: ListResponse =
        serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .data
        .into_iter()
        .map(|e| ModelInfo {
            label: e.display_name.clone().unwrap_or_else(|| e.id.clone()),
            id: e.id,
            context_window: None,
            supports_tools: true,
            supports_streaming: true,
        })
        .collect())
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/models", self.config.base_url.trim_end_matches('/'));
        let response = self
            .http
            .get(url)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await?;

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
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/messages", self.config.base_url.trim_end_matches('/'));

        let mut system: Option<String> = None;
        let mut turns: Vec<serde_json::Value> = Vec::new();
        for msg in &request.messages {
            match msg.role {
                ChatRole::System => {
                    system = Some(match system.take() {
                        Some(prev) => format!("{prev}\n{}", msg.content),
                        None => msg.content.clone(),
                    });
                }
                ChatRole::User | ChatRole::Assistant => {
                    turns.push(serde_json::json!({
                        "role": msg.role.as_str(),
                        "content": msg.content,
                    }));
                }
                // Tool messages are folded into the preceding user turn for
                // the sprint-1 tool-less flow — we don't send them raw.
                ChatRole::Tool => {
                    turns.push(serde_json::json!({
                        "role": "user",
                        "content": msg.content,
                    }));
                }
            }
        }

        let mut body = serde_json::json!({
            "model": request.model,
            "stream": true,
            "max_tokens": request.max_tokens.unwrap_or(4096),
            "messages": turns,
        });
        if let Some(s) = system {
            body["system"] = serde_json::Value::String(s);
        }
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }

        let response = self
            .http
            .post(url)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
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
        let sse = sse_stream(byte_stream);
        let mapped = sse.filter_map(|item| async move {
            match item {
                Err(e) => Some(Err(LlmError::Http(e))),
                Ok(msg) => parse_event(&msg).map(Ok),
            }
        });
        Ok(Box::pin(mapped))
    }
}

fn parse_event(msg: &crate::sse::SseMessage) -> Option<StreamEvent> {
    if msg.data.is_empty() {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&msg.data).ok()?;
    let kind = value.get("type").and_then(|t| t.as_str())?;
    match kind {
        "content_block_delta" => {
            let text = value
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(|t| t.as_str())?;
            Some(StreamEvent::Delta(StreamChunk {
                delta: text.to_owned(),
            }))
        }
        "message_delta" => {
            let usage = value.get("usage")?;
            let tokens_out = usage
                .get("output_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let tokens_in = usage
                .get("input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let finish = value
                .get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(|r| r.as_str())
                .map(str::to_owned);
            Some(StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason: finish,
            })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_display_name_when_present_falls_back_to_id() {
        let body = r#"{"data":[
            {"id":"claude-sonnet-4-6","display_name":"Claude Sonnet 4.6"},
            {"id":"claude-opus-4-7"}
        ]}"#;
        let models = parse_models(body).unwrap();
        assert_eq!(models[0].id, "claude-sonnet-4-6");
        assert_eq!(models[0].label, "Claude Sonnet 4.6");
        assert_eq!(models[1].id, "claude-opus-4-7");
        assert_eq!(models[1].label, "claude-opus-4-7");
    }

    #[test]
    fn empty_data_ok() {
        assert!(parse_models(r#"{"data":[]}"#).unwrap().is_empty());
    }

    #[test]
    fn invalid_json_is_parse_error() {
        assert!(matches!(parse_models("{"), Err(LlmError::Parse(_))));
    }
}
