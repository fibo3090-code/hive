use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use crate::chat::{ChatRequest, ChatResponse, ChatRole, StreamChunk, StreamEvent, ToolCall};
use crate::model_metadata::{context_window_for, supports_streaming_tools, supports_tools};
use crate::sse::sse_stream;
use crate::{ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct GeminiProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl GeminiProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        Self { http, config }
    }
}

#[derive(Deserialize)]
struct ListResponse {
    #[serde(default)]
    models: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
    /// Input token limit. `u64` because next-gen Gemini exceeds u32.
    #[serde(default, rename = "inputTokenLimit")]
    input_token_limit: Option<u64>,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_methods: Vec<String>,
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: ListResponse =
        serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .models
        .into_iter()
        .filter(|e| e.supported_methods.iter().any(|m| m == "generateContent"))
        .filter_map(|e| {
            let id = e.name.strip_prefix("models/").unwrap_or(&e.name).to_owned();
            let label = e.display_name.unwrap_or_else(|| id.clone());
            // API value is authoritative; family lookup is the fallback.
            let context = e
                .input_token_limit
                .or_else(|| Some(context_window_for(ProviderKind::Gemini, &id)));
            let tools = supports_tools(ProviderKind::Gemini, &id);
            let streaming_tools = supports_streaming_tools(ProviderKind::Gemini, &id);
            ModelInfo::build(id, label, context, tools, true, streaming_tools)
        })
        .collect())
}

fn render_part(role: ChatRole, content: &str) -> Value {
    match role {
        ChatRole::User | ChatRole::Tool => json!({ "text": content }),
        ChatRole::Assistant | ChatRole::System => json!({ "text": content }),
    }
}

fn request_body(request: &ChatRequest, stream: bool) -> Value {
    let mut contents = Vec::new();
    let mut system_parts = Vec::new();

    for msg in &request.messages {
        match msg.role {
            ChatRole::System => {
                if !msg.content.trim().is_empty() {
                    system_parts.push(json!({ "text": msg.content }));
                }
            }
            ChatRole::User => contents.push(json!({
                "role": "user",
                "parts": vec![render_part(msg.role, &msg.content)],
            })),
            ChatRole::Assistant => {
                let mut parts = Vec::new();
                if !msg.content.trim().is_empty() {
                    parts.push(render_part(msg.role, &msg.content));
                }
                parts.extend(msg.tool_calls.iter().map(|call| {
                    json!({
                        "functionCall": {
                            "name": call.name,
                            "args": call.arguments,
                        }
                    })
                }));
                contents.push(json!({
                    "role": "model",
                    "parts": parts,
                }));
            }
            ChatRole::Tool => {
                let response = serde_json::from_str::<Value>(&msg.content)
                    .unwrap_or_else(|_| json!({ "content": msg.content }));
                contents.push(json!({
                    "role": "user",
                    "parts": [{
                        "functionResponse": {
                            "name": msg.tool_name.clone().unwrap_or_else(|| "tool".into()),
                            "response": response,
                        }
                    }],
                }));
            }
        }
    }

    let mut body = json!({ "contents": contents });
    if !system_parts.is_empty() {
        body["systemInstruction"] = json!({ "parts": system_parts });
    }

    let mut generation = Map::new();
    if let Some(t) = request.temperature {
        generation.insert("temperature".into(), json!(t));
    }
    if let Some(m) = request.max_tokens {
        generation.insert("maxOutputTokens".into(), json!(m));
    }
    if !generation.is_empty() {
        body["generationConfig"] = Value::Object(generation);
    }

    if !request.tools.is_empty() {
        body["tools"] = json!([{
            "functionDeclarations": request
                .tools
                .iter()
                .map(|tool| {
                    json!({
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    })
                })
                .collect::<Vec<_>>()
        }]);
    }

    if stream {
        body["generationConfig"]["candidateCount"] = json!(1);
    }

    body
}

fn parse_response(value: &Value) -> Result<ChatResponse, LlmError> {
    let mut text = String::new();
    let mut tool_calls = Vec::new();

    if let Some(parts) = value
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(Value::as_array)
    {
        for part in parts {
            if let Some(chunk) = part.get("text").and_then(Value::as_str) {
                text.push_str(chunk);
            }
            if let Some(function_call) = part.get("functionCall") {
                let name = function_call
                    .get("name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| LlmError::Parse("missing gemini function name".into()))?;
                // Gemini's `functionCall` has no native id; the round-trip
                // back to Gemini is keyed by `name`. Mint a ULID anyway so
                // every persisted call is uniquely addressable for SSE
                // tool_call events and the executed_calls list.
                tool_calls.push(ToolCall {
                    id: Some(format!("call_{}", ulid::Ulid::new())),
                    name: name.to_owned(),
                    arguments: function_call
                        .get("args")
                        .cloned()
                        .unwrap_or_else(|| json!({})),
                });
            }
        }
    }

    let usage = value.get("usageMetadata").cloned().unwrap_or(Value::Null);
    Ok(ChatResponse {
        text,
        tool_calls,
        tokens_in: usage
            .get("promptTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        tokens_out: usage
            .get("candidatesTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32,
        finish_reason: value
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("finishReason"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    })
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Gemini
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!(
            "{}/v1beta/models?key={}",
            self.config.base_url.trim_end_matches('/'),
            key,
        );
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
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            self.config.base_url.trim_end_matches('/'),
            request.model,
            key,
        );

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
        let sse = sse_stream(byte_stream);
        let mapped = sse.flat_map(|item| {
            let results: Vec<Result<StreamEvent, LlmError>> = match item {
                Err(e) => vec![Err(LlmError::Http(e))],
                Ok(msg) => parse_event(&msg).into_iter().map(Ok).collect(),
            };
            futures_util::stream::iter(results)
        });
        Ok(Box::pin(mapped))
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!(
            "{}/v1beta/models/{}:generateContent?key={}",
            self.config.base_url.trim_end_matches('/'),
            request.model,
            key,
        );
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
        parse_response(&value)
    }
}

fn parse_event(msg: &crate::sse::SseMessage) -> Vec<StreamEvent> {
    if msg.data.is_empty() {
        return vec![];
    }
    let Ok(value) = serde_json::from_str::<Value>(&msg.data) else {
        return vec![];
    };

    let mut out = Vec::new();

    // Walk every part in the first candidate's content. Gemini chunks can
    // mix `text` parts and `functionCall` parts in the same frame, and
    // unlike Anthropic/OpenAI, function-call args arrive complete in one
    // part (not as incremental deltas). Mint a stable id per call so the
    // runtime can correlate Start/Delta/End even though Gemini has no
    // native id field — the existing non-streaming parser does the same.
    if let Some(parts) = value
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(Value::as_array)
    {
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if !text.is_empty() {
                    out.push(StreamEvent::Delta(StreamChunk {
                        delta: text.to_owned(),
                    }));
                }
                continue;
            }
            if let Some(fc) = part.get("functionCall") {
                let Some(name) = fc.get("name").and_then(Value::as_str) else {
                    continue;
                };
                let args = fc.get("args").cloned().unwrap_or(Value::Null);
                let args_json =
                    serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_owned());
                // Before this fix the streaming parser dropped `functionCall`
                // parts entirely; the runtime saw zero tool_calls + zero text
                // and rendered "model returned an empty response."
                let id = format!("call_{}", ulid::Ulid::new());
                out.push(StreamEvent::ToolCallStart {
                    id: id.clone(),
                    name: name.to_owned(),
                });
                out.push(StreamEvent::ToolCallDelta {
                    id: id.clone(),
                    args_chunk: args_json,
                });
                out.push(StreamEvent::ToolCallEnd { id });
            }
        }
    }

    if let Some(usage) = value.get("usageMetadata") {
        let tokens_in = usage
            .get("promptTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let tokens_out = usage
            .get("candidatesTokenCount")
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        let finish = value
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("finishReason"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        if finish.is_some() || tokens_out > 0 {
            out.push(StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason: finish,
            });
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_by_generate_content_and_strips_prefix() {
        let body = r#"{"models":[
            {"name":"models/gemini-1.5-pro","displayName":"Gemini 1.5 Pro","inputTokenLimit":2000000,"supportedGenerationMethods":["generateContent","countTokens"]},
            {"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]},
            {"name":"models/gemini-1.5-flash","supportedGenerationMethods":["generateContent"]}
        ]}"#;
        let models = parse_models(body).unwrap();
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["gemini-1.5-pro", "gemini-1.5-flash"]);
        assert_eq!(models[0].context_window, Some(2_000_000));
        assert_eq!(models[0].label, "Gemini 1.5 Pro");
        assert_eq!(models[1].label, "gemini-1.5-flash");
    }

    #[test]
    fn missing_models_field_yields_empty() {
        assert!(parse_models(r#"{}"#).unwrap().is_empty());
    }

    #[test]
    fn streaming_function_call_emits_start_delta_end() {
        // Regression: Gemini streamGenerateContent emits a `functionCall`
        // part with complete args in one frame. The old parser dropped
        // them entirely (it only checked `parts[0].text`); the runtime
        // then surfaced "model returned an empty response."
        let frame = crate::sse::SseMessage {
            event: None,
            data: r#"{"candidates":[{"content":{"parts":[
                { "text": "Searching…" },
                { "functionCall": { "name": "web_search", "args": { "q": "rust" } } }
            ]}}]}"#
                .to_owned(),
        };
        let events = parse_event(&frame);
        // Expected order: Delta(text), Start, Delta(args), End.
        let has_text_delta = events.iter().any(|e| matches!(e, StreamEvent::Delta(c) if c.delta == "Searching…"));
        let has_tool_start = events
            .iter()
            .any(|e| matches!(e, StreamEvent::ToolCallStart { name, .. } if name == "web_search"));
        let has_tool_delta = events.iter().any(
            |e| matches!(e, StreamEvent::ToolCallDelta { args_chunk, .. } if args_chunk.contains("\"q\":\"rust\"")),
        );
        let has_tool_end = events
            .iter()
            .any(|e| matches!(e, StreamEvent::ToolCallEnd { .. }));
        assert!(has_text_delta, "expected text Delta, got {events:?}");
        assert!(has_tool_start, "expected ToolCallStart, got {events:?}");
        assert!(has_tool_delta, "expected ToolCallDelta, got {events:?}");
        assert!(has_tool_end, "expected ToolCallEnd, got {events:?}");
    }

    #[test]
    fn invalid_json_is_parse_error() {
        assert!(matches!(parse_models("nope"), Err(LlmError::Parse(_))));
    }

    #[test]
    fn parses_function_calls() {
        let response = json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "text": "Working on it." },
                        { "functionCall": { "name": "web_search", "args": { "query": "rust" } } }
                    ]
                },
                "finishReason": "STOP"
            }],
            "usageMetadata": { "promptTokenCount": 11, "candidatesTokenCount": 5 }
        });
        let parsed = parse_response(&response).unwrap();
        assert_eq!(parsed.text, "Working on it.");
        assert_eq!(parsed.tool_calls.len(), 1);
        assert_eq!(parsed.tool_calls[0].name, "web_search");
        assert_eq!(parsed.tool_calls[0].arguments["query"], "rust");
        // Each call gets a stable ULID for our own bookkeeping; Gemini
        // doesn't echo it but our SSE events and chat_messages need it.
        assert!(parsed.tool_calls[0]
            .id
            .as_deref()
            .is_some_and(|id| id.starts_with("call_")));
    }

    #[test]
    fn parallel_calls_have_distinct_ids() {
        let response = json!({
            "candidates": [{
                "content": {
                    "parts": [
                        { "functionCall": { "name": "web_search", "args": { "q": "a" } } },
                        { "functionCall": { "name": "web_search", "args": { "q": "b" } } }
                    ]
                }
            }]
        });
        let parsed = parse_response(&response).unwrap();
        assert_eq!(parsed.tool_calls.len(), 2);
        let ids: Vec<_> = parsed
            .tool_calls
            .iter()
            .filter_map(|c| c.id.as_deref())
            .collect();
        assert_eq!(ids.len(), 2);
        assert_ne!(ids[0], ids[1]);
    }
}
