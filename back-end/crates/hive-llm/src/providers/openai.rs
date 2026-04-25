use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::chat::{ChatRequest, ChatResponse, StreamChunk, StreamEvent, ToolCall};
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

fn request_messages(request: &ChatRequest) -> Vec<Value> {
    request
        .messages
        .iter()
        .map(|m| match m.role {
            crate::chat::ChatRole::Assistant if !m.tool_calls.is_empty() => json!({
                "role": m.role.as_str(),
                "content": if m.content.is_empty() { Value::Null } else { Value::String(m.content.clone()) },
                "tool_calls": m.tool_calls.iter().map(|call| json!({
                    "id": call.id.clone().unwrap_or_else(|| format!("call_{}", call.name)),
                    "type": "function",
                    "function": {
                        "name": call.name,
                        "arguments": serde_json::to_string(&call.arguments).unwrap_or_else(|_| "{}".into()),
                    },
                })).collect::<Vec<_>>(),
            }),
            crate::chat::ChatRole::Tool => json!({
                "role": "tool",
                "tool_call_id": m.tool_call_id.clone().unwrap_or_else(|| "tool_call".into()),
                "content": m.content,
            }),
            _ => json!({
                "role": m.role.as_str(),
                "content": m.content,
            }),
        })
        .collect()
}

fn request_body(request: &ChatRequest, stream: bool) -> Value {
    let mut body = json!({
        "model": request.model,
        "messages": request_messages(request),
        "stream": stream,
    });
    if stream {
        body["stream_options"] = json!({ "include_usage": true });
    }
    if let Some(t) = request.temperature {
        body["temperature"] = json!(t);
    }
    if let Some(m) = request.max_tokens {
        body["max_tokens"] = json!(m);
    }
    if !request.tools.is_empty() {
        body["tools"] = Value::Array(
            request
                .tools
                .iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "function": {
                            "name": tool.name,
                            "description": tool.description,
                            "parameters": tool.input_schema,
                        }
                    })
                })
                .collect(),
        );
        body["tool_choice"] = json!("auto");
    }
    body
}

fn parse_tool_calls(value: &Value) -> Result<Vec<ToolCall>, LlmError> {
    let mut tool_calls = Vec::new();
    let Some(items) = value
        .get("choices")
        .and_then(|choices| choices.get(0))
        .and_then(|choice| choice.get("message"))
        .and_then(|message| message.get("tool_calls"))
        .and_then(Value::as_array)
    else {
        return Ok(tool_calls);
    };

    for item in items {
        let function = item
            .get("function")
            .ok_or_else(|| LlmError::Parse("missing openai tool function".into()))?;
        let name = function
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| LlmError::Parse("missing openai tool name".into()))?;
        let arguments = function
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or("{}");
        tool_calls.push(ToolCall {
            id: item.get("id").and_then(Value::as_str).map(ToOwned::to_owned),
            name: name.to_owned(),
            arguments: serde_json::from_str(arguments)
                .map_err(|e| LlmError::Parse(format!("openai tool args: {e}")))?,
        });
    }

    Ok(tool_calls)
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
        let body = request_body(&request, true);

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

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!(
            "{}/v1/chat/completions",
            self.config.base_url.trim_end_matches('/')
        );
        let response = self
            .http
            .post(url)
            .bearer_auth(key)
            .header("content-type", "application/json")
            .json(&request_body(&request, false))
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
        let text = value
            .get("choices")
            .and_then(|choices| choices.get(0))
            .and_then(|choice| choice.get("message"))
            .and_then(|message| message.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned();
        let usage = value.get("usage").cloned().unwrap_or(Value::Null);

        Ok(ChatResponse {
            text,
            tool_calls: parse_tool_calls(&value)?,
            tokens_in: usage
                .get("prompt_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            tokens_out: usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            finish_reason: value
                .get("choices")
                .and_then(|choices| choices.get(0))
                .and_then(|choice| choice.get("finish_reason"))
                .and_then(Value::as_str)
                .map(ToOwned::to_owned),
        })
    }
}

fn parse_event(msg: &crate::sse::SseMessage) -> Option<StreamEvent> {
    if msg.data.is_empty() || msg.data == "[DONE]" {
        return None;
    }
    let value: Value = serde_json::from_str(&msg.data).ok()?;

    if let Some(usage) = value.get("usage") {
        if usage.is_object() {
            let tokens_in = usage
                .get("prompt_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let tokens_out = usage
                .get("completion_tokens")
                .and_then(Value::as_u64)
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
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    let delta = choice
        .get("delta")
        .and_then(|d| d.get("content"))
        .and_then(Value::as_str)
        .unwrap_or("");

    if !delta.is_empty() {
        return Some(StreamEvent::Delta(StreamChunk {
            delta: delta.to_owned(),
        }));
    }
    if finish.is_some() {
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

    #[test]
    fn parses_native_tool_calls() {
        let value = json!({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "call_1",
                        "function": {
                            "name": "web_search",
                            "arguments": "{\"query\":\"rust\"}"
                        }
                    }]
                }
            }]
        });
        let calls = parse_tool_calls(&value).unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id.as_deref(), Some("call_1"));
        assert_eq!(calls[0].name, "web_search");
        assert_eq!(calls[0].arguments["query"], "rust");
    }
}
