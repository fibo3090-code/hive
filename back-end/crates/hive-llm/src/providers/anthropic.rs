use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};

use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::chat::{ChatRequest, ChatResponse, ChatRole, StreamChunk, StreamEvent, ToolCall};
use crate::model_metadata::{
    context_window_for, default_max_tokens_for, supports_streaming_tools, supports_tools,
};
use crate::sse::sse_stream;
use crate::{ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

/// Anthropic Messages API version. `2023-06-01` is the durable, GA version
/// of the Messages API (not deprecated as of this writing). New capabilities
/// are added under this version header rather than via a new date.
const ANTHROPIC_VERSION: &str = "2023-06-01";

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
        .filter_map(|e| {
            let id = e.id;
            let label = e.display_name.unwrap_or_else(|| id.clone());
            let context = Some(context_window_for(ProviderKind::Anthropic, &id));
            let tools = supports_tools(ProviderKind::Anthropic, &id);
            let streaming_tools = supports_streaming_tools(ProviderKind::Anthropic, &id);
            ModelInfo::build(id, label, context, tools, true, streaming_tools)
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
                // Anthropic supplies `id` natively; fallback only fires when
                // we synthesise a call (XML/text path). A ULID guarantees
                // distinguishable IDs even when the same tool is called more
                // than once in the same turn.
                json!({
                    "type": "tool_use",
                    "id": call.id.clone().unwrap_or_else(|| format!("call_{}", ulid::Ulid::new())),
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

    // ZZ32: Anthropic requires `max_tokens` on every request. The old
    // hardcoded fallback of 4096 silently truncated long generations on
    // Claude 4.x (Opus/Sonnet support 16k+ output). Pick the family
    // default from `model_metadata` when the caller didn't override.
    let max_tokens = request
        .max_tokens
        .unwrap_or_else(|| default_max_tokens_for(ProviderKind::Anthropic, &request.model));
    let mut body = json!({
        "model": request.model,
        "max_tokens": max_tokens,
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
                        id: item
                            .get("id")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
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
            .header("anthropic-version", ANTHROPIC_VERSION)
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
            .header("anthropic-version", ANTHROPIC_VERSION)
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
        // Anthropic emits `input_tokens` on `message_start` (captured in
        // an atomic so it survives across SSE frames) and `output_tokens`
        // on `message_delta`. The parser emits a separate `Start` event
        // so the runtime can decouple input-token capture from the final
        // `Complete` event — useful when `message_delta` omits the
        // input field.
        //
        // `tool_blocks` tracks open `tool_use` content blocks by their
        // `index`, so `content_block_delta` (with `input_json_delta`) and
        // `content_block_stop` events can correlate back to the right id
        // and emit `ToolCallDelta` / `ToolCallEnd`.
        let input_tokens = Arc::new(AtomicU32::new(0));
        let tool_blocks: Arc<Mutex<HashMap<u64, AnthropicToolBlock>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let mapped = sse.filter_map(move |item| {
            let input_tokens = input_tokens.clone();
            let tool_blocks = tool_blocks.clone();
            async move {
                match item {
                    Err(e) => Some(Err(LlmError::Http(e))),
                    Ok(msg) => parse_event(&msg, &input_tokens, &tool_blocks).map(Ok),
                }
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
            .header("anthropic-version", ANTHROPIC_VERSION)
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

/// Parse one Anthropic SSE event into the provider-neutral `StreamEvent`.
///
/// Anthropic's event taxonomy:
/// - `message_start` — first event, carries `usage.input_tokens` on the
///   nested `message` object. We stash it for the eventual `Complete`.
/// - `content_block_start` / `content_block_stop` — boundary markers around
///   text or `tool_use` blocks. Phase 1 ignores them; later phases use them
///   to assemble multi-block output.
/// - `content_block_delta` — incremental text or `input_json_delta` for tool
///   arguments. Today only text is surfaced (tool args are reconstructed by
///   the non-streaming `parse_response`).
/// - `message_delta` — final usage with cumulative `output_tokens` and
///   `delta.stop_reason`. We merge in the cached input tokens here.
/// - `message_stop` — terminator. The HTTP stream ends right after.
/// - `ping` — keep-alive; ignore.

// Open `tool_use` content block — kept alive between `content_block_start`
// and `content_block_stop` so partial arg deltas can be correlated back to
// the block's `id` and emitted as `ToolCallDelta` events.
#[derive(Debug, Clone)]
struct AnthropicToolBlock {
    id: String,
}

fn parse_event(
    msg: &crate::sse::SseMessage,
    input_tokens: &AtomicU32,
    tool_blocks: &Mutex<HashMap<u64, AnthropicToolBlock>>,
) -> Option<StreamEvent> {
    if msg.data.is_empty() {
        return None;
    }
    let value: Value = match serde_json::from_str(&msg.data) {
        Ok(v) => v,
        Err(err) => {
            tracing::trace!(error = %err, raw = %msg.data, "anthropic: malformed sse frame, skipping");
            return None;
        }
    };
    let kind = value.get("type").and_then(Value::as_str)?;
    match kind {
        "message_start" => {
            if let Some(tokens) = value
                .get("message")
                .and_then(|m| m.get("usage"))
                .and_then(|u| u.get("input_tokens"))
                .and_then(Value::as_u64)
            {
                let tokens = tokens as u32;
                input_tokens.store(tokens, Ordering::Relaxed);
                // Emit a Start event so the runtime can capture input
                // tokens immediately, decoupled from the eventual Complete.
                return Some(StreamEvent::Start {
                    input_tokens: tokens,
                });
            }
            None
        }
        "content_block_start" => {
            // A new content block is opening. If it's a `tool_use` block,
            // record its `index → id` mapping so the matching
            // `content_block_delta` (input_json_delta) and `content_block_stop`
            // events can be correlated back, and emit `ToolCallStart` so
            // the runtime can begin assembling the call. Text blocks are
            // silent here — they surface via `content_block_delta` /
            // `text_delta`.
            let block = value.get("content_block")?;
            let block_kind = block.get("type").and_then(Value::as_str).unwrap_or("");
            if block_kind != "tool_use" {
                return None;
            }
            let index = value.get("index").and_then(Value::as_u64)?;
            let id = block.get("id").and_then(Value::as_str)?.to_owned();
            let name = block.get("name").and_then(Value::as_str)?.to_owned();
            tool_blocks
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(index, AnthropicToolBlock { id: id.clone() });
            Some(StreamEvent::ToolCallStart { id, name })
        }
        "content_block_delta" => {
            let delta = value.get("delta")?;
            let delta_kind = delta.get("type").and_then(Value::as_str).unwrap_or("");
            // text_delta carries assistant text; input_json_delta carries
            // partial tool-use arguments — emit as `ToolCallDelta` so the
            // runtime can accumulate them under the right tool-call id
            // (lookup by content_block `index`).
            if delta_kind == "text_delta" || delta_kind.is_empty() {
                let text = delta.get("text").and_then(Value::as_str)?;
                Some(StreamEvent::Delta(StreamChunk {
                    delta: text.to_owned(),
                }))
            } else if delta_kind == "input_json_delta" {
                let index = value.get("index").and_then(Value::as_u64)?;
                let chunk = delta.get("partial_json").and_then(Value::as_str)?;
                let id = tool_blocks
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&index)?
                    .id
                    .clone();
                Some(StreamEvent::ToolCallDelta {
                    id,
                    args_chunk: chunk.to_owned(),
                })
            } else {
                None
            }
        }
        "content_block_stop" => {
            // Close a content block. For tool_use blocks, emit `ToolCallEnd`
            // so the runtime can serialise the accumulated args and submit
            // the call. Text-block closes are silent.
            let index = value.get("index").and_then(Value::as_u64)?;
            let removed = tool_blocks
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .remove(&index)?;
            Some(StreamEvent::ToolCallEnd { id: removed.id })
        }
        "message_delta" => {
            let usage = value.get("usage")?;
            let tokens_out = usage
                .get("output_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            // Anthropic also occasionally echoes input_tokens here; prefer
            // the cached value from message_start if it's larger (cumulative).
            let echoed_in = usage
                .get("input_tokens")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32;
            let cached_in = input_tokens.load(Ordering::Relaxed);
            let tokens_in = cached_in.max(echoed_in);
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
        // Recognised-but-ignored events. Listing them explicitly stops the
        // generic `_ => None` arm from masking a new event we should handle.
        // (`content_block_start` / `content_block_stop` are handled above
        // for tool_use; text-block versions return None there.)
        "message_stop" | "ping" | "error" => None,
        other => {
            tracing::trace!(event = %other, "anthropic: unrecognised sse event, ignoring");
            None
        }
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

    fn frame(data: &str) -> crate::sse::SseMessage {
        crate::sse::SseMessage {
            event: None,
            data: data.to_owned(),
        }
    }

    fn fresh_state() -> (AtomicU32, Mutex<HashMap<u64, AnthropicToolBlock>>) {
        (AtomicU32::new(0), Mutex::new(HashMap::new()))
    }

    #[test]
    fn message_start_emits_start_event_and_caches_input_tokens() {
        let (cache, blocks) = fresh_state();
        let start = frame(
            r#"{"type":"message_start","message":{"usage":{"input_tokens":42,"output_tokens":0}}}"#,
        );
        match parse_event(&start, &cache, &blocks).expect("Start expected") {
            StreamEvent::Start { input_tokens } => assert_eq!(input_tokens, 42),
            other => panic!("expected Start, got {other:?}"),
        }
        assert_eq!(cache.load(Ordering::Relaxed), 42);

        let delta = frame(
            r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}"#,
        );
        match parse_event(&delta, &cache, &blocks).unwrap() {
            StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason,
            } => {
                assert_eq!(tokens_in, 42);
                assert_eq!(tokens_out, 7);
                assert_eq!(finish_reason.as_deref(), Some("end_turn"));
            }
            other => panic!("expected Complete, got {other:?}"),
        }
    }

    #[test]
    fn ping_and_boundary_events_are_ignored_for_non_tool_blocks() {
        let (cache, blocks) = fresh_state();
        for raw in [
            r#"{"type":"ping"}"#,
            // Text-block content_block_start has no tool_use payload → silent.
            r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
            // content_block_stop for a non-tracked index → silent.
            r#"{"type":"content_block_stop","index":99}"#,
            r#"{"type":"message_stop"}"#,
        ] {
            assert!(parse_event(&frame(raw), &cache, &blocks).is_none(), "{raw}");
        }
    }

    #[test]
    fn text_delta_is_extracted_only_for_text_blocks() {
        let (cache, blocks) = fresh_state();
        let text =
            frame(r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}"#);
        match parse_event(&text, &cache, &blocks).unwrap() {
            StreamEvent::Delta(chunk) => assert_eq!(chunk.delta, "hi"),
            other => panic!("expected Delta, got {other:?}"),
        }
    }

    #[test]
    fn tool_use_streams_start_delta_end_events() {
        // The streaming parser must surface tool-use content blocks. Before
        // this fix, content_block_start/delta(input_json_delta)/stop were
        // all dropped; the runtime then saw a stream with zero text and
        // zero tool_calls and rendered "model returned an empty response."
        let (cache, blocks) = fresh_state();

        let start = frame(
            r#"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_abc","name":"web_search","input":{}}}"#,
        );
        match parse_event(&start, &cache, &blocks).expect("ToolCallStart expected") {
            StreamEvent::ToolCallStart { id, name } => {
                assert_eq!(id, "toolu_abc");
                assert_eq!(name, "web_search");
            }
            other => panic!("expected ToolCallStart, got {other:?}"),
        }

        let arg1 = frame(
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"qu"}}"#,
        );
        match parse_event(&arg1, &cache, &blocks).expect("ToolCallDelta expected") {
            StreamEvent::ToolCallDelta { id, args_chunk } => {
                assert_eq!(id, "toolu_abc");
                assert_eq!(args_chunk, "{\"qu");
            }
            other => panic!("expected ToolCallDelta, got {other:?}"),
        }

        let arg2 = frame(
            r#"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"ery\":\"rust\"}"}}"#,
        );
        match parse_event(&arg2, &cache, &blocks).expect("ToolCallDelta expected") {
            StreamEvent::ToolCallDelta { id, args_chunk } => {
                assert_eq!(id, "toolu_abc");
                assert_eq!(args_chunk, "ery\":\"rust\"}");
            }
            other => panic!("expected ToolCallDelta, got {other:?}"),
        }

        let stop = frame(r#"{"type":"content_block_stop","index":1}"#);
        match parse_event(&stop, &cache, &blocks).expect("ToolCallEnd expected") {
            StreamEvent::ToolCallEnd { id } => assert_eq!(id, "toolu_abc"),
            other => panic!("expected ToolCallEnd, got {other:?}"),
        }

        // After stop, the block is forgotten — a second stop is silent.
        assert!(parse_event(&stop, &cache, &blocks).is_none());
    }

    #[test]
    fn malformed_frames_do_not_panic() {
        let (cache, blocks) = fresh_state();
        assert!(parse_event(&frame("{not json"), &cache, &blocks).is_none());
        assert!(parse_event(&frame(""), &cache, &blocks).is_none());
    }
}
