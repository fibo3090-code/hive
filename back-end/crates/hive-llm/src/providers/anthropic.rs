use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::chat::{ChatRequest, ChatResponse, ChatRole, StreamChunk, StreamEvent, ToolCall};
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

fn render_content_blocks(message: &crate::chat::ChatMessage) -> Vec<Value> {
    match message.role {
        ChatRole::Tool => {
            let parsed: Result<Value, _> = serde_json::from_str(&message.content);
            vec![json!({
                "type": "tool_result",
                "tool_use_id": message.tool_call_id.clone().unwrap_or_else(|| "tool_call".into()),
                "content": parsed.unwrap_or_else(|_| Value::String(message.content.clone())),
            })]
        }
        ChatRole::Assistant if !message.tool_calls.is_empty() => {
            let mut parts = Vec::new();
            if !message.content.trim().is_empty() {
                parts.push(json!({
                    "type": "text",
                    "text": message.content,
                }));
            }
            parts.extend(message.tool_calls.iter().map(|call| {
                json!({
                    "type": "tool_use",
                    "id": call.id.clone().unwrap_or_else(|| format!("call_{}", call.name)),
                    "name": call.name,
                    "input": call.arguments,
                })
            }));
            parts
        }
        _ => vec![json!({
            "type": "text",
            "text": message.content,
        })],
    }
}

fn request_body(request: &ChatRequest) -> Value {
    let mut system = Vec::new();
    let mut turns = Vec::new();

    for message in &request.messages {
        match message.role {
            ChatRole::System => system.push(message.content.clone()),
            ChatRole::User => turns.push(json!({
                "role": "user",
                "content": render_content_blocks(message),
            })),
            ChatRole::Assistant => turns.push(json!({
                "role": "assistant",
                "content": render_content_blocks(message),
            })),
            ChatRole::Tool => turns.push(json!({
                "role": "user",
                "content": render_content_blocks(message),
            })),
        }
    }

    let mut body = json!({
        "model": request.model,
        "max_tokens": request.max_tokens.unwrap_or(4096),
        "messages": turns,
    });
    if !system.is_empty() {
        body["system"] = Value::String(system.join("\n"));
    }
    if let Some(t) = request.temperature {
        body["temperature"] = json!(t);
    }
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "input_schema": tool.input_schema,
                    })
                })
                .collect(),
        );
    }
    body
}

fn parse_response(value: &Value) -> Result<ChatResponse, LlmError> {
    let mut text = String::new();
    let mut tool_calls = Vec::new();

    if let Some(items) = value.get("content").and_then(Value::as_array) {
        for item in items {
            match item.get("type").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(chunk) = item.get("text").and_then(Value::as_str) {
                        text.push_str(chunk);
                    }
                }
                Some("tool_use") => {
                    let name = item
                        .get("name")
                        .and_then(Value::as_str)
                        .ok_or_else(|| LlmError::Parse("missing anthropic tool name".into()))?;
                    tool_calls.push(ToolCall {
                        id: item.get("id").and_then(Value::as_str).map(ToOwned::to_owned),
                        name: name.to_owned(),
                        arguments: item.get("input").cloned().unwrap_or_else(|| json!({})),
                    });
                }
                _ => {}
            }
        }
    }

    let usage = value.get("usage").cloned().unwrap_or(Value::Null);
    Ok(ChatResponse {
        text,
        tool_calls,
        tokens_in: usage
            .get("input_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        tokens_out: usage
            .get("output_tokens")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        finish_reason: value
            .get("stop_reason")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
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

        let mut body = request_body(&request);
        body["stream"] = json!(true);

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

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/messages", self.config.base_url.trim_end_matches('/'));
        let response = self
            .http
            .post(url)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&request_body(&request))
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(LlmError::ProviderStatus {
                status: status.as_u16(),
                body,
            });
        }

        let value: Value =
            serde_json::from_str(&body).map_err(|e| LlmError::Parse(e.to_string()))?;
        parse_response(&value)
    }
}

fn parse_event(msg: &crate::sse::SseMessage) -> Option<StreamEvent> {
    if msg.data.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(&msg.data).ok()?;
    let kind = value.get("type").and_then(Value::as_str)?;
    match kind {
        "content_block_delta" => {
            let text = value
                .get("delta")
                .and_then(|d| d.get("text"))
                .and_then(Value::as_str)?;
            Some(StreamEvent::Delta(StreamChunk {
                delta: text.to_owned(),
            }))
        }
        "message_delta" => {
            let usage = value.get("usage")?;
            let tokens_out = usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let tokens_in = usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let finish = value
                .get("delta")
                .and_then(|d| d.get("stop_reason"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
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

    #[test]
    fn parses_text_and_tool_use_blocks() {
        let response = json!({
            "content": [
                {"type": "text", "text": "Looking that up."},
                {"type": "tool_use", "id": "toolu_1", "name": "web_search", "input": {"query": "rust"}}
            ],
            "usage": {"input_tokens": 10, "output_tokens": 4},
            "stop_reason": "tool_use"
        });
        let parsed = parse_response(&response).unwrap();
        assert_eq!(parsed.text, "Looking that up.");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "web_search");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "rust");
    }
}
