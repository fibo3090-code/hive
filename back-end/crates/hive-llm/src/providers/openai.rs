use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::chat::{ChatRequest, ChatResponse, StreamChunk, StreamEvent, ToolCall};
use crate::model_metadata::{context_window_for, supports_tools};
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
                || id.starts_with("o4")
                || id.starts_with("chatgpt")
        })
        .filter_map(|e| {
            let id = e.id;
            let label = id.clone();
            let context = Some(context_window_for(ProviderKind::Openai, &id));
            let tools = supports_tools(ProviderKind::Openai, &id);
            ModelInfo::build(id, label, context, tools, true)
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
        // Malformed JSON in `arguments` is a model error, not a transport
        // error — fail soft so the downstream schema validator can return a
        // structured tool-error to the LLM and let it self-correct on the
        // next turn. Logging a warn keeps it visible to operators.
        let parsed_args: Value = match serde_json::from_str(arguments) {
            Ok(value) => value,
            Err(err) => {
                tracing::warn!(
                    tool = name,
                    raw = arguments,
                    error = %err,
                    "openai: malformed tool arguments — passing empty object so the tool layer can return a structured error"
                );
                Value::Object(serde_json::Map::new())
            }
        };
        tool_calls.push(ToolCall {
            // Native id when OpenAI supplies one; ULID fallback so parallel
            // tool calls remain distinguishable in our persisted records.
            id: Some(
                item.get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("call_{}", ulid::Ulid::new())),
            ),
            name: name.to_owned(),
            arguments: parsed_args,
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
        // OpenAI's stream emits `finish_reason` on one chunk and `usage` on
        // a separate chunk (when `stream_options.include_usage: true` is
        // set, which we always do). Without state, the runtime would see
        // two Complete events and only the last one's tokens would survive.
        // Track the pending finish_reason so we emit a single, merged
        // Complete on whichever event fires last.
        let state = Arc::new(Mutex::new(StreamState::default()));
        let mapped = sse.filter_map(move |item| {
            let state = state.clone();
            async move {
                match item {
                    Err(e) => Some(Err(LlmError::Http(e))),
                    Ok(msg) => parse_event(&msg, &state).map(Ok),
                }
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

/// Per-stream parser state. Caches the `finish_reason` so we can include
/// it in the (later) usage-chunk Complete event without losing it.
#[derive(Default)]
struct StreamState {
    finish_reason: Option<String>,
}

fn parse_event(msg: &crate::sse::SseMessage, state: &Mutex<StreamState>) -> Option<StreamEvent> {
    if msg.data.is_empty() || msg.data == "[DONE]" {
        return None;
    }
    let value: Value = match serde_json::from_str(&msg.data) {
        Ok(v) => v,
        Err(err) => {
            tracing::trace!(error = %err, raw = %msg.data, "openai: malformed sse frame");
            return None;
        }
    };

    // Usage chunk arrives last (when `stream_options.include_usage` is on).
    // Emit Complete with both the real tokens AND the cached finish_reason.
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
            let finish = state
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .finish_reason
                .clone();
            return Some(StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason: finish,
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

    if let Some(reason) = finish {
        // Cache and pre-emit a Complete with tokens=0; if usage arrives
        // after this (the common path), it overrides with real tokens
        // and copies the cached finish_reason. If usage never arrives
        // (older API or `include_usage:false`), the runtime keeps this
        // event's finish_reason and only loses the token counts.
        state.lock().unwrap_or_else(|e| e.into_inner()).finish_reason = Some(reason.clone());
        return Some(StreamEvent::Complete {
            tokens_in: 0,
            tokens_out: 0,
            finish_reason: Some(reason),
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

    #[test]
    fn malformed_tool_arguments_become_empty_object_not_parse_error() {
        // The model returned non-JSON in the arguments string. The provider
        // layer must not blow up the whole turn — the schema validator
        // downstream returns a structured error instead.
        let value = json!({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "id": "call_x",
                        "function": {
                            "name": "web_search",
                            "arguments": "{not json"
                        }
                    }]
                }
            }]
        });
        let calls = parse_tool_calls(&value).expect("provider must not fail the turn");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].arguments, json!({}));
    }

    fn frame(data: &str) -> crate::sse::SseMessage {
        crate::sse::SseMessage {
            event: None,
            data: data.to_owned(),
        }
    }

    #[test]
    fn finish_reason_chunk_caches_reason_for_usage_complete() {
        let state = Mutex::new(StreamState::default());

        // First, a finish_reason chunk arrives with no tokens.
        let finish = frame(
            r#"{"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}"#,
        );
        match parse_event(&finish, &state).expect("Complete pre-emit") {
            StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason,
            } => {
                assert_eq!(tokens_in, 0);
                assert_eq!(tokens_out, 0);
                assert_eq!(finish_reason.as_deref(), Some("stop"));
            }
            other => panic!("expected Complete, got {other:?}"),
        }

        // Then the usage chunk arrives — should re-emit Complete with the
        // cached finish_reason and the real token counts. The runtime then
        // takes the merged max-tokens with stable finish_reason.
        let usage = frame(
            r#"{"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":34,"total_tokens":46}}"#,
        );
        match parse_event(&usage, &state).expect("Complete from usage") {
            StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason,
            } => {
                assert_eq!(tokens_in, 12);
                assert_eq!(tokens_out, 34);
                assert_eq!(finish_reason.as_deref(), Some("stop"));
            }
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[test]
    fn done_marker_is_skipped() {
        let state = Mutex::new(StreamState::default());
        assert!(parse_event(&frame("[DONE]"), &state).is_none());
    }

    #[test]
    fn malformed_frames_do_not_panic() {
        let state = Mutex::new(StreamState::default());
        assert!(parse_event(&frame("{not"), &state).is_none());
    }

    #[test]
    fn missing_id_gets_ulid_fallback() {
        let value = json!({
            "choices": [{
                "message": {
                    "tool_calls": [{
                        "function": {
                            "name": "web_search",
                            "arguments": "{}"
                        }
                    }]
                }
            }]
        });
        let calls = parse_tool_calls(&value).unwrap();
        assert!(calls[0]
            .id
            .as_deref()
            .is_some_and(|id| id.starts_with("call_")));
    }
}
