use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;

use crate::chat::{ChatRequest, StreamChunk, StreamEvent};
use crate::sse::sse_stream;
use crate::{ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct OpenAiProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl OpenAiProvider {
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
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: ListResponse =
        serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .data
        .into_iter()
        .filter(|e| {
            let id = e.id.to_ascii_lowercase();
            id.starts_with("gpt-")
                || id.starts_with("o1")
                || id.starts_with("o3")
                || id.starts_with("chatgpt")
        })
        .map(|e| ModelInfo {
            label: e.id.clone(),
            id: e.id,
            context_window: None,
            supports_tools: true,
            supports_streaming: true,
        })
        .collect())
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Openai
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/models", self.config.base_url.trim_end_matches('/'));
        let response = self.http.get(url).bearer_auth(key).send().await?;
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
        let url = format!(
            "{}/v1/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );

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

        let mut body = serde_json::json!({
            "model": request.model,
            "stream": true,
            "messages": messages,
            "stream_options": { "include_usage": true },
        });
        if let Some(t) = request.temperature {
            body["temperature"] = serde_json::json!(t);
        }
        if let Some(m) = request.max_tokens {
            body["max_tokens"] = serde_json::json!(m);
        }

        let response = self
            .http
            .post(url)
            .bearer_auth(key)
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
    if msg.data.is_empty() || msg.data == "[DONE]" {
        return None;
    }
    let value: serde_json::Value = serde_json::from_str(&msg.data).ok()?;

    // `choices` absent on the final usage frame sent when stream_options.include_usage=true
    if let Some(usage) = value.get("usage") {
        if usage.is_object() {
            let tokens_in = usage
                .get("prompt_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let tokens_out = usage
                .get("completion_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            return Some(StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason: None,
            });
        }
    }

    let choice = value.get("choices")?.get(0)?;
    let finish = choice
        .get("finish_reason")
        .and_then(|r| r.as_str())
        .map(str::to_owned);
    let delta = choice
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("");

    if !delta.is_empty() {
        return Some(StreamEvent::Delta(StreamChunk {
            delta: delta.to_owned(),
        }));
    }
    if finish.is_some() {
        // OpenAI without include_usage: synthesize a Complete with zero usage.
        return Some(StreamEvent::Complete {
            tokens_in: 0,
            tokens_out: 0,
            finish_reason: finish,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_chat_models_and_drops_others() {
        let body = r#"{"data":[
            {"id":"gpt-4o"},
            {"id":"gpt-4o-mini"},
            {"id":"o1-preview"},
            {"id":"o3-mini"},
            {"id":"chatgpt-4o-latest"},
            {"id":"text-embedding-3-small"},
            {"id":"dall-e-3"},
            {"id":"whisper-1"}
        ]}"#;
        let models = parse_models(body).unwrap();
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "gpt-4o",
                "gpt-4o-mini",
                "o1-preview",
                "o3-mini",
                "chatgpt-4o-latest"
            ]
        );
        assert!(models
            .iter()
            .all(|m| m.supports_tools && m.supports_streaming));
    }

    #[test]
    fn empty_data_yields_empty_list() {
        assert_eq!(parse_models(r#"{"data":[]}"#).unwrap().len(), 0);
    }

    #[test]
    fn invalid_json_returns_parse_error() {
        assert!(matches!(parse_models("not json"), Err(LlmError::Parse(_))));
    }
}
