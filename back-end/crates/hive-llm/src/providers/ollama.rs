use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::chat::{ChatRequest, ChatResponse, StreamChunk, StreamEvent, ToolCall};
use crate::model_metadata::{context_window_for, supports_streaming_tools, supports_tools};
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
        .filter_map(|e| {
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
            // Centralised tool-support and context-window lookup. New
            // families gain support by editing `model_metadata.rs`.
            let context = Some(context_window_for(ProviderKind::Ollama, &e.name));
            let tools = supports_tools(ProviderKind::Ollama, &e.name);
            let streaming_tools = supports_streaming_tools(ProviderKind::Ollama, &e.name);
            ModelInfo::build(e.name, label, context, tools, true, streaming_tools)
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
                "content": m.content,
                "tool_calls": m.tool_calls.iter().map(|call| json!({
                    "function": {
                        "name": call.name,
                        "arguments": call.arguments,
                    }
                })).collect::<Vec<_>>(),
            }),
            crate::chat::ChatRole::Tool => json!({
                "role": "tool",
                "content": m.content,
                "name": m.tool_name,
            }),
            _ => json!({
                "role": m.role.as_str(),
                "content": m.content,
            }),
        })
        .collect()
}

fn request_body(request: &ChatRequest, stream: bool) -> Value {
    let mut options = serde_json::Map::new();
    if let Some(t) = request.temperature {
        options.insert("temperature".into(), json!(t));
    }
    if let Some(m) = request.max_tokens {
        options.insert("num_predict".into(), json!(m));
    }

    let mut body = json!({
        "model": request.model,
        "messages": request_messages(request),
        "stream": stream,
    });
    if !options.is_empty() {
        body["options"] = Value::Object(options);
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
    }
    body
}

/// Coerce Ollama's `function.arguments` into a JSON object regardless of how
/// the model surfaced it. Small Ollama checkpoints frequently return a JSON
/// string ("{\"q\":\"rust\"}") instead of an object — and sometimes outright
/// malformed JSON. Mirror the OpenAI provider's policy: never blow up the
/// turn for a model formatting glitch; pass an empty object so the schema
/// validator returns a structured error the LLM can self-correct on.
fn coerce_tool_arguments(name: &str, raw: Option<&Value>) -> Value {
    let Some(raw) = raw else {
        return Value::Object(serde_json::Map::new());
    };
    if raw.is_object() {
        return raw.clone();
    }
    if let Some(s) = raw.as_str() {
        match serde_json::from_str::<Value>(s) {
            Ok(v) if v.is_object() => return v,
            Ok(_) => {
                tracing::warn!(
                    tool = name,
                    raw = s,
                    "ollama: tool arguments parsed as non-object — passing empty object"
                );
            }
            Err(err) => {
                tracing::warn!(
                    tool = name,
                    raw = s,
                    error = %err,
                    "ollama: malformed tool arguments — passing empty object so the tool layer can return a structured error"
                );
            }
        }
        return Value::Object(serde_json::Map::new());
    }
    tracing::warn!(
        tool = name,
        kind = ?raw,
        "ollama: tool arguments neither object nor string — passing empty object"
    );
    Value::Object(serde_json::Map::new())
}

fn parse_chat_response(value: &Value) -> Result<ChatResponse, LlmError> {
    let message = value.get("message").cloned().unwrap_or(Value::Null);
    let text = message
        .get("content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();

    let mut tool_calls = Vec::new();
    if let Some(items) = message.get("tool_calls").and_then(Value::as_array) {
        for item in items {
            let function = item
                .get("function")
                .ok_or_else(|| LlmError::Parse("missing ollama tool function".into()))?;
            let name = function
                .get("name")
                .and_then(Value::as_str)
                .ok_or_else(|| LlmError::Parse("missing ollama tool name".into()))?;
            tool_calls.push(ToolCall {
                // Ollama doesn't surface a tool-call id; mint one so the
                // runtime can disambiguate parallel calls in persisted
                // records (matches OpenAI's fallback behaviour).
                id: Some(format!("call_{}", ulid::Ulid::new())),
                name: name.to_owned(),
                arguments: coerce_tool_arguments(name, function.get("arguments")),
            });
        }
    }

    Ok(ChatResponse {
        text,
        tool_calls,
        tokens_in: value
            .get("prompt_eval_count")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        tokens_out: value.get("eval_count").and_then(Value::as_u64).unwrap_or(0) as u32,
        finish_reason: value
            .get("done_reason")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
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

        let response = self
            .http
            .post(url)
            .header("content-type", "application/json")
            .json(&request_body(&request, true))
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
                            for event in parse_line(&line) {
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

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, LlmError> {
        let url = format!("{}/api/chat", self.config.base_url.trim_end_matches('/'));
        let response = self
            .http
            .post(url)
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
        parse_chat_response(&value)
    }
}

/// Parse one NDJSON line of an Ollama `/api/chat` stream into zero or more
/// `StreamEvent`s. Ollama streams text deltas in intermediate frames and
/// surfaces `tool_calls` only in the terminal `done:true` frame; previously
/// the runtime ignored them, so any tool the model emitted via streaming
/// was silently dropped. We now lower the terminal frame to a sequence of
/// `ToolCallStart` / `ToolCallDelta` / `ToolCallEnd` events followed by the
/// `Complete` event so the runtime can either consume the tool calls
/// inline or fall through to the non-streaming round-trip.
fn parse_line(line: &str) -> Vec<StreamEvent> {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Vec::new();
    };
    let done = value.get("done").and_then(Value::as_bool).unwrap_or(false);

    if done {
        let mut events = Vec::new();
        if let Some(items) = value
            .get("message")
            .and_then(|m| m.get("tool_calls"))
            .and_then(Value::as_array)
        {
            for item in items {
                let Some(function) = item.get("function") else {
                    continue;
                };
                let Some(name) = function.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let id = format!("call_{}", ulid::Ulid::new());
                let args = coerce_tool_arguments(name, function.get("arguments"));
                let chunk = serde_json::to_string(&args).unwrap_or_else(|_| "{}".into());
                events.push(StreamEvent::ToolCallStart {
                    id: id.clone(),
                    name: name.to_owned(),
                });
                events.push(StreamEvent::ToolCallDelta {
                    id: id.clone(),
                    args_chunk: chunk,
                });
                events.push(StreamEvent::ToolCallEnd { id });
            }
        }
        let tokens_in = value
            .get("prompt_eval_count")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let tokens_out = value.get("eval_count").and_then(Value::as_u64).unwrap_or(0) as u32;
        let finish = value
            .get("done_reason")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        events.push(StreamEvent::Complete {
            tokens_in,
            tokens_out,
            finish_reason: finish,
        });
        return events;
    }

    let Some(text) = value
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(Value::as_str)
    else {
        return Vec::new();
    };
    if text.is_empty() {
        return Vec::new();
    }
    vec![StreamEvent::Delta(StreamChunk {
        delta: text.to_owned(),
    })]
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

    #[test]
    fn parse_chat_response_handles_object_arguments() {
        let value = json!({
            "message": {
                "content": "ok",
                "tool_calls": [{
                    "function": {
                        "name": "web_search",
                        "arguments": { "query": "rust" }
                    }
                }]
            },
            "prompt_eval_count": 12,
            "eval_count": 34,
            "done_reason": "stop"
        });
        let resp = parse_chat_response(&value).unwrap();
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.tool_calls[0].name, "web_search");
        assert_eq!(resp.tool_calls[0].arguments["query"], "rust");
        assert!(resp.tool_calls[0]
            .id
            .as_deref()
            .is_some_and(|id| id.starts_with("call_")));
    }

    #[test]
    fn parse_chat_response_coerces_string_arguments() {
        // Some Ollama checkpoints serialise `arguments` as a JSON string
        // instead of an object — coerce instead of failing the turn.
        let value = json!({
            "message": {
                "content": "",
                "tool_calls": [{
                    "function": {
                        "name": "web_search",
                        "arguments": "{\"query\":\"rust\"}"
                    }
                }]
            }
        });
        let resp = parse_chat_response(&value).unwrap();
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.tool_calls[0].arguments["query"], "rust");
    }

    #[test]
    fn parse_chat_response_recovers_from_malformed_arguments() {
        // Match the OpenAI provider policy: malformed JSON in tool
        // arguments must not blow up the turn — the schema validator
        // downstream returns a structured error instead.
        let value = json!({
            "message": {
                "content": "",
                "tool_calls": [{
                    "function": {
                        "name": "web_search",
                        "arguments": "{not json"
                    }
                }]
            }
        });
        let resp = parse_chat_response(&value).expect("provider must not fail the turn");
        assert_eq!(resp.tool_calls.len(), 1);
        assert_eq!(resp.tool_calls[0].arguments, json!({}));
    }

    #[test]
    fn parse_line_extracts_tool_calls_from_done_chunk() {
        // The motivating bug: Ollama emits `tool_calls` only in the final
        // `done:true` frame. The streaming parser used to drop them; now we
        // lower them to ToolCallStart / Delta / End before the Complete.
        let line = r#"{"done":true,"message":{"content":"","tool_calls":[{"function":{"name":"web_search","arguments":{"query":"rust"}}}]},"prompt_eval_count":5,"eval_count":7,"done_reason":"stop"}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 4, "ToolCallStart + Delta + End + Complete");
        match &events[0] {
            StreamEvent::ToolCallStart { name, .. } => assert_eq!(name, "web_search"),
            other => panic!("expected ToolCallStart, got {other:?}"),
        }
        match &events[1] {
            StreamEvent::ToolCallDelta { args_chunk, .. } => {
                assert!(args_chunk.contains("rust"))
            }
            other => panic!("expected ToolCallDelta, got {other:?}"),
        }
        assert!(matches!(events[2], StreamEvent::ToolCallEnd { .. }));
        match &events[3] {
            StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason,
            } => {
                assert_eq!(*tokens_in, 5);
                assert_eq!(*tokens_out, 7);
                assert_eq!(finish_reason.as_deref(), Some("stop"));
            }
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[test]
    fn parse_line_done_without_tool_calls_emits_only_complete() {
        let line = r#"{"done":true,"message":{"content":""},"eval_count":3}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        assert!(matches!(events[0], StreamEvent::Complete { .. }));
    }

    #[test]
    fn parse_line_text_delta_yields_single_event() {
        let line = r#"{"done":false,"message":{"content":"hi"}}"#;
        let events = parse_line(line);
        assert_eq!(events.len(), 1);
        match &events[0] {
            StreamEvent::Delta(chunk) => assert_eq!(chunk.delta, "hi"),
            other => panic!("expected Delta, got {other:?}"),
        }
    }

    #[test]
    fn parse_line_malformed_json_yields_no_events() {
        assert!(parse_line("not json").is_empty());
    }
}
