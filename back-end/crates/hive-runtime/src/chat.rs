//! Streaming chat turn runner. Given a thread and a user message, drives the
//! LLM, streams tokens to the event bus, persists each delta, and records a
//! `cost_events` row when done.

use std::{collections::HashMap, sync::Arc};

use futures_util::StreamExt;
use hive_db::{
    repos::{chat_messages, chat_threads, cost_events},
    Db,
};
use hive_llm::{
    chat::{ChatMessage, ChatRequest, ChatRole, StreamEvent, ToolCall, ToolDefinition},
    model_metadata::context_window_for,
    pricing::cost_cents,
    token_budget::trim_to_fit,
    LlmProvider, ProviderKind,
};
use hive_tools::{ToolContext, ToolRegistry};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::sync::Mutex;

use crate::events::EventBus;

#[derive(Debug, Error)]
pub enum ChatError {
    #[error("db error: {0}")]
    Db(#[from] sea_orm::DbErr),
    #[error("llm error: {0}")]
    Llm(#[from] hive_llm::LlmError),
    #[error("thread not found: {0}")]
    NotFound(String),
}

/// Parameters for running a single assistant turn.
pub struct RunTurn {
    pub db: Db,
    pub bus: EventBus,
    pub provider: Arc<dyn LlmProvider>,
    pub provider_kind: ProviderKind,
    pub provider_id: String,
    pub model: String,
    pub project_id: String,
    pub thread_id: String,
    pub assistant_message_id: String,
    pub system_prompt: Option<String>,
    pub history_limit: usize,
    pub agent_id: Option<String>,
    pub tool_registry: Option<ToolRegistry>,
    pub tool_context: Option<ToolContext>,
    /// Mutable cancel flag — when set to true, the runner stops streaming and
    /// marks the message `cancelled`.
    pub cancel: Arc<Mutex<bool>>,
    /// Where chat attachments live on disk:
    /// `{data_dir}/attachments/{project_id}/{filename}`. The runtime reads
    /// text attachments to inline them into the user message; image and
    /// binary attachments are referenced by name.
    pub data_dir: std::path::PathBuf,
}

#[derive(Clone, Debug)]
struct ToolInvocation {
    id: Option<String>,
    tool: String,
    arguments: Value,
    raw: Value,
}

fn tool_protocol_prompt(registry: &ToolRegistry) -> String {
    let manifests = registry.manifests();
    format!(
        "Fallback compatibility mode only: if native tool calling is unavailable, respond with ONLY one XML block and no surrounding prose:\n\
<tool_call>{{\"tool\":\"tool_name\",\"arguments\":{{...}}}}</tool_call>\n\
or for multiple sequential tool calls:\n\
<tool_calls>[{{\"tool\":\"tool_name\",\"arguments\":{{...}}}}]</tool_calls>\n\
Do not use this format when native tool calling works.\n\
Tool catalog:\n{}",
        serde_json::to_string_pretty(&manifests).unwrap_or_else(|_| "[]".into())
    )
}

fn parse_tool_invocations(content: &str) -> Option<Vec<ToolInvocation>> {
    fn extract_block<'a>(content: &'a str, start: &str, end: &str) -> Option<&'a str> {
        let trimmed = content.trim();
        if trimmed.starts_with(start) && trimmed.ends_with(end) {
            Some(trimmed[start.len()..trimmed.len() - end.len()].trim())
        } else {
            None
        }
    }

    let raw = extract_block(content, "<tool_call>", "</tool_call>")
        .or_else(|| extract_block(content, "<tool_calls>", "</tool_calls>"))?;
    let value: Value = serde_json::from_str(raw).ok()?;
    let items = if let Some(array) = value.as_array() {
        array.clone()
    } else {
        vec![value]
    };

    let mut out = Vec::new();
    for item in items {
        let tool = item.get("tool")?.as_str()?.to_owned();
        let arguments = item.get("arguments").cloned().unwrap_or_else(|| json!({}));
        // XML-fallback invocations have no native id. Mint a ULID so
        // parallel calls remain distinguishable in persisted records and
        // SSE tool_call events.
        out.push(ToolInvocation {
            id: Some(format!("call_{}", ulid::Ulid::new())),
            tool,
            arguments,
            raw: item,
        });
    }
    Some(out)
}

/// Outcome of `collect_response` — either the stream finished cleanly,
/// or the cancel flag flipped mid-stream and we tore down early.
struct CollectOutcome {
    accumulated: String,
    tokens_in: u32,
    tokens_out: u32,
    finish_reason: Option<String>,
    cancelled: bool,
}

async fn collect_response(
    provider: &Arc<dyn LlmProvider>,
    request: ChatRequest,
    cancel: &Arc<Mutex<bool>>,
) -> Result<CollectOutcome, ChatError> {
    let mut stream = provider.chat_stream(request).await?;
    let mut accumulated = String::new();
    let mut tokens_in = 0;
    let mut tokens_out = 0;
    let mut finish_reason = None;
    // Poll the cancel flag every 50ms so a flip during a long stream
    // tears the request down within ~50ms instead of after the full
    // response. The interval cost is negligible vs network latency.
    let mut cancel_poll = tokio::time::interval(std::time::Duration::from_millis(50));
    cancel_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            biased;
            _ = cancel_poll.tick() => {
                if *cancel.lock().await {
                    // Drop the stream. reqwest cancels the underlying
                    // request when the response future is dropped, so
                    // the network is reclaimed promptly.
                    drop(stream);
                    return Ok(CollectOutcome {
                        accumulated,
                        tokens_in,
                        tokens_out,
                        finish_reason,
                        cancelled: true,
                    });
                }
            }
            next = stream.next() => {
                let Some(next) = next else { break };
                match next {
                    Ok(StreamEvent::Delta(chunk)) => accumulated.push_str(&chunk.delta),
                    Ok(StreamEvent::Start { input_tokens: tin }) => {
                        // Capture early — providers that emit Start (Anthropic)
                        // give us input tokens before the final Complete arrives.
                        if tin > tokens_in {
                            tokens_in = tin;
                        }
                    }
                    Ok(StreamEvent::Complete {
                        tokens_in: tin,
                        tokens_out: tout,
                        finish_reason: fin,
                    }) => {
                        // Some providers emit multiple Complete events (OpenAI's
                        // pre-emit on finish_reason chunk, then usage chunk;
                        // Gemini's repeated `usageMetadata`). All providers report
                        // cumulative tokens, so `max` is the safe merge. Preserve
                        // any previously-seen finish_reason if the new event omits
                        // one.
                        if tin > tokens_in {
                            tokens_in = tin;
                        }
                        if tout > tokens_out {
                            tokens_out = tout;
                        }
                        if fin.is_some() {
                            finish_reason = fin;
                        }
                    }
                    // Tool-call boundary events: today, tool calls are materialised
                    // from the non-streaming `chat()` round-trip. These variants
                    // exist for forward compatibility; routing them to SSE
                    // `tool_call` events is a follow-up.
                    Ok(StreamEvent::ToolCallStart { .. })
                    | Ok(StreamEvent::ToolCallDelta { .. })
                    | Ok(StreamEvent::ToolCallEnd { .. }) => {}
                    Err(err) => return Err(ChatError::Llm(err)),
                }
            }
        }
    }

    Ok(CollectOutcome {
        accumulated,
        tokens_in,
        tokens_out,
        finish_reason,
        cancelled: false,
    })
}

fn tool_definitions(registry: &ToolRegistry) -> Vec<ToolDefinition> {
    registry
        .manifests()
        .into_iter()
        .map(|manifest| ToolDefinition {
            name: manifest.name,
            description: manifest.description,
            input_schema: manifest.input_schema,
        })
        .collect()
}

fn tool_invocations_from_response(text: &str, tool_calls: &[ToolCall]) -> Option<Vec<ToolInvocation>> {
    if !tool_calls.is_empty() {
        return Some(
            tool_calls
                .iter()
                .map(|call| ToolInvocation {
                    id: call.id.clone(),
                    tool: call.name.clone(),
                    arguments: call.arguments.clone(),
                    raw: json!({
                        "id": call.id,
                        "tool": call.name,
                        "arguments": call.arguments,
                    }),
                })
                .collect(),
        );
    }
    parse_tool_invocations(text)
}

fn tool_fingerprint(invocation: &ToolInvocation) -> String {
    format!(
        "{}:{}",
        invocation.tool,
        serde_json::to_string(&invocation.arguments).unwrap_or_else(|_| "null".into())
    )
}

fn matches_schema_type(args: &Value, expected: &str) -> bool {
    match expected {
        "object" => args.is_object(),
        "array" => args.is_array(),
        "string" => args.is_string(),
        "boolean" => args.is_boolean(),
        "integer" => args.as_i64().is_some() || args.as_u64().is_some(),
        "number" => args.is_number(),
        "null" => args.is_null(),
        _ => true,
    }
}

/// Validate `args` against a JSON Schema-shaped subset.
///
/// We don't pull in the full `jsonschema` crate (extra dependency) but we
/// cover the constraints that matter for tool dispatch: `type`, `required`,
/// nested `properties`, `enum`, and array `items`. Unsupported keywords are
/// silently ignored — better to let a permissive schema through than block
/// a legitimate tool call on a constraint we don't model yet.
fn validate_against_schema(args: &Value, schema: &Value) -> Result<(), String> {
    if let Some(kind) = schema.get("type").and_then(Value::as_str) {
        if !matches_schema_type(args, kind) {
            return Err(format!("expected {kind} arguments"));
        }
    }

    // `enum`: value must be one of the listed candidates (deep equality).
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.iter().any(|candidate| candidate == args) {
            let rendered: Vec<String> = allowed
                .iter()
                .map(|v| serde_json::to_string(v).unwrap_or_else(|_| "?".into()))
                .collect();
            return Err(format!(
                "value must be one of [{}]",
                rendered.join(", ")
            ));
        }
    }

    if let Some(required) = schema.get("required").and_then(Value::as_array) {
        let Some(object) = args.as_object() else {
            return Err("expected object arguments".into());
        };
        for key in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(key) {
                return Err(format!("missing required field `{key}`"));
            }
        }
    }

    if let (Some(object), Some(properties)) = (args.as_object(), schema.get("properties").and_then(Value::as_object)) {
        for (key, value) in object {
            if let Some(property_schema) = properties.get(key) {
                validate_against_schema(value, property_schema)
                    .map_err(|e| format!("`{key}`: {e}"))?;
            }
        }
    }

    // Array items: every element must satisfy the items schema.
    if let (Some(array), Some(items_schema)) = (args.as_array(), schema.get("items")) {
        for (idx, item) in array.iter().enumerate() {
            validate_against_schema(item, items_schema)
                .map_err(|e| format!("[{idx}]: {e}"))?;
        }
    }

    Ok(())
}

fn validate_tool_invocation(registry: &ToolRegistry, invocation: &ToolInvocation) -> Result<(), String> {
    let Some(tool) = registry.get(&invocation.tool) else {
        return Err(format!("tool `{}` is not registered", invocation.tool));
    };
    let manifest = tool.manifest();
    validate_against_schema(&invocation.arguments, &manifest.input_schema)
}

fn tool_result_json(tool: &str, error: impl Into<String>) -> Value {
    json!({
        "ok": false,
        "tool": tool,
        "error": error.into(),
    })
}

async fn finalize_cancelled(
    db: &Db,
    bus: &EventBus,
    thread_id: &str,
    assistant_message_id: &str,
    final_answer: &str,
    total_tokens_in: u32,
    total_tokens_out: u32,
    total_cost: i64,
    executed_calls: &[Value],
) -> Result<(), ChatError> {
    let _ = chat_messages::set_tool_calls(db.conn(), assistant_message_id, json!(executed_calls)).await?;
    let _ = chat_messages::finalize(
        db.conn(),
        assistant_message_id,
        final_answer,
        total_tokens_in as i32,
        total_tokens_out as i32,
        total_cost,
        "cancelled",
    )
    .await?;
    bus.emit(
        format!("chat.{thread_id}.cancelled"),
        json!({ "threadId": thread_id, "messageId": assistant_message_id }),
    );
    Ok(())
}

/// Hard wall-clock budget for a single assistant turn. When exceeded,
/// the cancel flag is flipped (so the inner `collect_response` loop
/// drops the upstream stream), the partial message is persisted with
/// `status='timeout'`, and a `chat.<thread>.error` event fires.
///
/// 180s is generous for chat with tools (one slow `web_fetch` can eat
/// 30s on its own). Future work: per-agent override via a column on
/// `agents`.
const DEFAULT_TURN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(180);

/// Load thread history, call the LLM, stream tokens to the bus, persist.
///
/// Wraps the inner work in a wall-clock timeout. On timeout we flip the
/// shared cancel flag so the streaming loop unwinds cleanly via the
/// existing cancel path, then surface a `timeout` status to the user.
pub async fn run_turn(params: RunTurn) -> Result<(), ChatError> {
    let cancel = params.cancel.clone();
    let bus = params.bus.clone();
    let db = params.db.clone();
    let thread_id = params.thread_id.clone();
    let assistant_message_id = params.assistant_message_id.clone();

    match tokio::time::timeout(DEFAULT_TURN_TIMEOUT, run_turn_inner(params)).await {
        Ok(result) => result,
        Err(_elapsed) => {
            tracing::warn!(
                thread_id = %thread_id,
                message_id = %assistant_message_id,
                budget_secs = DEFAULT_TURN_TIMEOUT.as_secs(),
                "chat turn exceeded wall-clock budget"
            );
            // Flip cancel so any still-running inner futures drop their
            // streams promptly on the next 50ms poll tick.
            *cancel.lock().await = true;
            let _ = chat_messages::set_status(db.conn(), &assistant_message_id, "timeout").await;
            bus.emit(
                format!("chat.{thread_id}.error"),
                serde_json::json!({
                    "threadId": thread_id,
                    "messageId": assistant_message_id,
                    "error": "turn exceeded wall-clock budget",
                    "reason": "turn_timeout",
                    "budgetSecs": DEFAULT_TURN_TIMEOUT.as_secs(),
                }),
            );
            Ok(())
        }
    }
}

async fn run_turn_inner(params: RunTurn) -> Result<(), ChatError> {
    let RunTurn {
        db,
        bus,
        provider,
        provider_kind,
        provider_id,
        model,
        project_id,
        thread_id,
        assistant_message_id,
        system_prompt,
        history_limit,
        agent_id,
        tool_registry,
        tool_context,
        cancel,
        data_dir,
    } = params;

    let _thread = chat_threads::get(db.conn(), &thread_id)
        .await?
        .ok_or_else(|| ChatError::NotFound(thread_id.clone()))?;

    let mut history = chat_messages::list_by_thread(db.conn(), &thread_id).await?;
    history.retain(|m| m.id != assistant_message_id && m.status != "cancelled" && m.status != "error");
    if history.len() > history_limit {
        let skip = history.len() - history_limit;
        history.drain(..skip);
    }

    let mut messages: Vec<ChatMessage> = Vec::new();
    let mut system_parts = Vec::new();
    if let Some(s) = system_prompt {
        if !s.trim().is_empty() {
            system_parts.push(s);
        }
    }
    if let Some(registry) = &tool_registry {
        if !registry.names().is_empty() {
            system_parts.push(
                "Use tools when they materially improve accuracy or execution. Call tools using the provider's native tool interface.".into(),
            );
            system_parts.push(tool_protocol_prompt(registry));
        }
    }
    if !system_parts.is_empty() {
        messages.push(ChatMessage::system(system_parts.join("\n\n")));
    }
    for row in history {
        let role = match row.role.as_str() {
            "user" => ChatRole::User,
            "assistant" => ChatRole::Assistant,
            "system" => ChatRole::System,
            "tool" => ChatRole::Tool,
            _ => continue,
        };
        // Inline any attachments the user posted with this message so
        // the LLM actually sees them. Text/JSON files get their content
        // appended (capped at 16 KB each so a giant log doesn't blow
        // the context budget). Images get a `[image: name (mime)]`
        // marker — provider-specific vision content blocks ship in a
        // follow-up; today the model at least knows the image was sent.
        let mut content = row.content;
        if matches!(role, ChatRole::User) {
            let attachments =
                hive_db::repos::chat_attachments::list_for_message(db.conn(), &row.id)
                    .await
                    .unwrap_or_default();
            for att in attachments {
                content.push_str(&format!(
                    "\n\n--- attachment: {} ({}, {} bytes) ---\n",
                    att.name, att.mime_type, att.bytes_size
                ));
                if att.kind == "text" {
                    let absolute_path = data_dir.join("attachments").join(&att.storage_path);
                    if let Ok(bytes) = tokio::fs::read(&absolute_path).await {
                        let limit = 16 * 1024;
                        let take = bytes.len().min(limit);
                        let text = String::from_utf8_lossy(&bytes[..take]);
                        content.push_str(&text);
                        if bytes.len() > limit {
                            content.push_str(&format!(
                                "\n[truncated {} bytes]\n",
                                bytes.len() - limit
                            ));
                        }
                    }
                } else if att.kind == "image" {
                    content.push_str("[binary image content omitted from text payload]");
                } else {
                    content.push_str(&format!(
                        "[binary file {} omitted from text payload]",
                        att.name
                    ));
                }
            }
        }
        messages.push(ChatMessage {
            role,
            content,
            tool_call_id: None,
            tool_name: None,
            tool_calls: Vec::new(),
        });
    }

    // Pre-flight context budgeting. Reserve room for the response and the
    // tool catalog (if tools are enabled), then trim oldest non-system
    // messages until we fit. Emit `context_trim` so the UI can show
    // "older messages omitted to fit context".
    let context_window = context_window_for(provider_kind, &model);
    // Reserve 4k tokens for the response, ~10% safety margin on the rest.
    const RESERVED_OUTPUT: u64 = 4_096;
    let safety_budget = context_window
        .saturating_sub(RESERVED_OUTPUT)
        .saturating_sub(context_window / 10);
    let projected_tools: Vec<ToolDefinition> = tool_registry
        .as_ref()
        .map(tool_definitions)
        .unwrap_or_default();
    let trim_outcome = trim_to_fit(&mut messages, &projected_tools, safety_budget);
    if trim_outcome.dropped > 0 {
        tracing::info!(
            thread_id = %thread_id,
            dropped = trim_outcome.dropped,
            estimated_tokens = trim_outcome.estimated_tokens_after,
            context_window,
            "trimmed oldest history to fit context budget"
        );
        bus.emit(
            format!("chat.{thread_id}.context_trim"),
            json!({
                "threadId": thread_id,
                "messageId": assistant_message_id,
                "dropped": trim_outcome.dropped,
                "estimatedTokens": trim_outcome.estimated_tokens_after,
                "contextWindow": context_window,
            }),
        );
    }

    let _ = chat_messages::set_status(db.conn(), &assistant_message_id, "streaming").await?;
    bus.emit(
        format!("chat.{thread_id}.streaming"),
        json!({ "threadId": thread_id, "messageId": assistant_message_id }),
    );

    let mut final_answer = String::new();
    let mut total_tokens_in: u32 = 0;
    let mut total_tokens_out: u32 = 0;
    let mut total_cost: i64 = 0;
    let mut finish_reason: Option<String> = None;
    let mut executed_calls = Vec::<Value>::new();
    let mut repeated_calls: HashMap<String, usize> = HashMap::new();
    /// Hard ceiling on the LLM⇄tool round-trip count per assistant turn.
    ///
    /// Matches the original plan's "max 30 tool rounds" budget. Most real
    /// tasks finish well under this; the cap is a safety net against
    /// pathological loops that the per-fingerprint repeat guard didn't
    /// catch (e.g. the model permuting args slightly each iteration).
    const MAX_TOOL_ROUNDS: usize = 30;
    /// Per-fingerprint repeat ceiling. A `(tool, args)` pair is allowed
    /// to fire this many times before the loop guard halts the turn.
    /// Kept tight (≤3) — legitimate retries with identical args after a
    /// transient error remain rare; loops are common.
    const MAX_REPEAT_CALLS_PER_SIGNATURE: usize = 3;
    /// Hard ceiling on total tool-call dispatches per turn, summed across
    /// all rounds and tools. Bounds runaway parallel-tool storms even when
    /// each individual call is unique (no fingerprint collision).
    const MAX_TOTAL_TOOL_CALLS: usize = 60;
    let mut total_tool_calls: usize = 0;

    let can_use_tools = tool_registry.as_ref().is_some_and(|registry| !registry.names().is_empty())
        && tool_context.is_some();

    for _ in 0..MAX_TOOL_ROUNDS {
        if *cancel.lock().await {
            finalize_cancelled(
                &db,
                &bus,
                &thread_id,
                &assistant_message_id,
                &final_answer,
                total_tokens_in,
                total_tokens_out,
                total_cost,
                &executed_calls,
            )
            .await?;
            return Ok(());
        }

        if !can_use_tools {
            let request = ChatRequest::new(model.clone(), messages.clone());
            let outcome =
                match collect_response(&provider, request, &cancel).await {
                    Ok(collected) => collected,
                    Err(ChatError::Llm(err)) => {
                        let detail = err.to_string();
                        let _ = chat_messages::set_tool_calls(
                            db.conn(),
                            &assistant_message_id,
                            json!(executed_calls),
                        )
                        .await;
                        let _ = chat_messages::finalize(
                            db.conn(),
                            &assistant_message_id,
                            &format!("[error] {detail}"),
                            total_tokens_in as i32,
                            total_tokens_out as i32,
                            total_cost,
                            "error",
                        )
                        .await;
                        bus.emit(
                            format!("chat.{thread_id}.error"),
                            json!({
                                "threadId": thread_id,
                                "messageId": assistant_message_id,
                                "error": detail,
                            }),
                        );
                        return Err(ChatError::Llm(err));
                    }
                    Err(other) => return Err(other),
                };

            total_tokens_in += outcome.tokens_in;
            total_tokens_out += outcome.tokens_out;
            total_cost +=
                cost_cents(provider_kind, &model, outcome.tokens_in, outcome.tokens_out);
            finish_reason = outcome.finish_reason;
            final_answer = outcome.accumulated;
            // If cancellation flipped during streaming, stop here. The
            // caller path below already emits cancelled / persists state
            // when it sees the cancel flag set; we just take that path.
            if outcome.cancelled {
                finalize_cancelled(
                    &db,
                    &bus,
                    &thread_id,
                    &assistant_message_id,
                    &final_answer,
                    total_tokens_in,
                    total_tokens_out,
                    total_cost,
                    &executed_calls,
                )
                .await?;
                return Ok(());
            }
            break;
        }

        let registry = tool_registry.as_ref().expect("checked above");
        let ctx = tool_context.as_ref().expect("checked above");
        let request = ChatRequest::new(model.clone(), messages.clone()).with_tools(tool_definitions(registry));
        let response = match provider.chat(request).await {
            Ok(response) => response,
            Err(err) => {
                let detail = err.to_string();
                let _ = chat_messages::set_tool_calls(
                    db.conn(),
                    &assistant_message_id,
                    json!(executed_calls),
                )
                .await;
                let _ = chat_messages::finalize(
                    db.conn(),
                    &assistant_message_id,
                    &format!("[error] {detail}"),
                    total_tokens_in as i32,
                    total_tokens_out as i32,
                    total_cost,
                    "error",
                )
                .await;
                bus.emit(
                    format!("chat.{thread_id}.error"),
                    json!({
                        "threadId": thread_id,
                        "messageId": assistant_message_id,
                        "error": detail,
                    }),
                );
                return Err(ChatError::Llm(err));
            }
        };

        total_tokens_in += response.tokens_in;
        total_tokens_out += response.tokens_out;
        total_cost += cost_cents(
            provider_kind,
            &model,
            response.tokens_in,
            response.tokens_out,
        );
        finish_reason = response.finish_reason.clone();

        let Some(invocations) = tool_invocations_from_response(&response.text, &response.tool_calls) else {
            final_answer = response.text;
            break;
        };
        if invocations.is_empty() {
            final_answer = response.text;
            break;
        }

        messages.push(ChatMessage::assistant_with_tool_calls(
            response.text.clone(),
            response.tool_calls.clone(),
        ));

        let mut halted_for_repeat = false;
        for invocation in invocations {
            if *cancel.lock().await {
                finalize_cancelled(
                    &db,
                    &bus,
                    &thread_id,
                    &assistant_message_id,
                    &final_answer,
                    total_tokens_in,
                    total_tokens_out,
                    total_cost,
                    &executed_calls,
                )
                .await?;
                return Ok(());
            }

            // Total-call cap: catches runaway parallel storms even when
            // each call has a unique fingerprint.
            total_tool_calls += 1;
            if total_tool_calls > MAX_TOTAL_TOOL_CALLS {
                final_answer = format!(
                    "I stopped after exceeding the per-turn tool-call budget ({MAX_TOTAL_TOOL_CALLS}). Refine the request or adjust the allowed tools."
                );
                finish_reason = Some("tool_call_budget_exceeded".into());
                halted_for_repeat = true;
                break;
            }

            let fingerprint = tool_fingerprint(&invocation);
            let seen = repeated_calls.entry(fingerprint).or_insert(0);
            *seen += 1;
            if *seen > MAX_REPEAT_CALLS_PER_SIGNATURE {
                final_answer = format!(
                    "I stopped because the same `{}` tool call was repeated {} times without making progress. Refine the request or adjust the allowed tools.",
                    invocation.tool, seen
                );
                finish_reason = Some("tool_loop_guard".into());
                halted_for_repeat = true;
                break;
            }

            bus.emit(
                format!("chat.{thread_id}.tool_call"),
                json!({
                    "threadId": thread_id,
                    "messageId": assistant_message_id,
                    "tool": invocation.tool,
                    "args": invocation.arguments,
                }),
            );

            // Per-tool wall-clock timeout. The default budget is generous
            // enough for `web_fetch` of a slow site or a `shell_exec`
            // build step; runaway tools surface as a structured error so
            // the model can self-correct on the next round rather than
            // hanging the whole turn.
            const PER_TOOL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);
            let result = match validate_tool_invocation(registry, &invocation) {
                Ok(()) => {
                    let invoke_fut = registry.invoke(&invocation.tool, invocation.arguments.clone(), ctx);
                    match tokio::time::timeout(PER_TOOL_TIMEOUT, invoke_fut).await {
                        Ok(Ok(value)) => value,
                        Ok(Err(err)) => err.to_result_json(),
                        Err(_elapsed) => {
                            tracing::warn!(
                                tool = %invocation.tool,
                                budget_secs = PER_TOOL_TIMEOUT.as_secs(),
                                "tool invocation exceeded per-tool budget"
                            );
                            json!({
                                "ok": false,
                                "tool": invocation.tool,
                                "error": "timeout",
                                "reason": "per_tool_timeout",
                                "budgetSecs": PER_TOOL_TIMEOUT.as_secs(),
                            })
                        }
                    }
                }
                Err(error) => tool_result_json(&invocation.tool, error),
            };

            executed_calls.push(json!({
                "tool": invocation.tool,
                "arguments": invocation.arguments,
                "result": result,
                "request": invocation.raw,
            }));

            bus.emit(
                format!("chat.{thread_id}.tool_result"),
                json!({
                    "threadId": thread_id,
                    "messageId": assistant_message_id,
                    "tool": invocation.tool,
                    "result": result,
                }),
            );

            // Pass plain strings through unwrapped so the model sees
            // `hello` not `"hello"`. Non-string values get JSON-encoded;
            // `serde_json::Value` is by construction serialisable so the
            // result is unwrap-safe (the previous `.unwrap_or_else` →
            // `Display` fallback produced non-JSON for nested structures
            // and corrupted the LLM's view of the tool result).
            let result_text = match &result {
                Value::String(s) => s.clone(),
                other => serde_json::to_string(other)
                    .expect("serde_json::Value always serialises to JSON"),
            };
            messages.push(ChatMessage::tool_result(
                invocation
                    .id
                    .clone()
                    .unwrap_or_else(|| format!("call_{}", ulid::Ulid::new())),
                invocation.tool.clone(),
                result_text,
            ));
        }

        if halted_for_repeat {
            break;
        }
    }

    if final_answer.is_empty() {
        final_answer =
            "I exhausted the available tool rounds without producing a final answer.".to_owned();
    }

    if !executed_calls.is_empty() {
        let _ =
            chat_messages::set_tool_calls(db.conn(), &assistant_message_id, json!(executed_calls))
                .await?;
    }

    for chunk in final_answer.as_bytes().chunks(48) {
        let delta = String::from_utf8_lossy(chunk).into_owned();
        let _ = chat_messages::append_content(db.conn(), &assistant_message_id, &delta).await?;
        bus.emit(
            format!("chat.{thread_id}.token"),
            json!({
                "threadId": thread_id,
                "messageId": assistant_message_id,
                "delta": delta,
            }),
        );
    }

    let _ = chat_messages::finalize(
        db.conn(),
        &assistant_message_id,
        &final_answer,
        total_tokens_in as i32,
        total_tokens_out as i32,
        total_cost,
        "done",
    )
    .await?;
    let _ = chat_threads::touch(db.conn(), &thread_id).await;

    let memo = format!("provider={provider_id} model={model}");
    let _ = cost_events::insert(
        db.conn(),
        cost_events::NewCostEvent {
            project_id: &project_id,
            session_id: None,
            agent_id: agent_id.as_deref(),
            kind: "chat.completion",
            tokens_in: total_tokens_in as i32,
            tokens_out: total_tokens_out as i32,
            cost_cents: total_cost,
            memo: Some(&memo),
        },
    )
    .await;

    bus.emit(
        format!("chat.{thread_id}.complete"),
        json!({
            "threadId": thread_id,
            "messageId": assistant_message_id,
            "tokensIn": total_tokens_in,
            "tokensOut": total_tokens_out,
            "costCents": total_cost,
            "finishReason": finish_reason,
            "model": model,
            "providerId": provider_id,
        }),
    );
    bus.emit(
        "cost.ingested",
        json!({ "projectId": project_id, "costCents": total_cost }),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_type_check() {
        let schema = json!({ "type": "object" });
        assert!(validate_against_schema(&json!({}), &schema).is_ok());
        assert!(validate_against_schema(&json!("foo"), &schema).is_err());
    }

    #[test]
    fn schema_required_field() {
        let schema = json!({ "type": "object", "required": ["query"] });
        assert!(validate_against_schema(&json!({"query": "rust"}), &schema).is_ok());
        let err = validate_against_schema(&json!({}), &schema).unwrap_err();
        assert!(err.contains("query"));
    }

    #[test]
    fn schema_nested_properties_with_path_prefix() {
        let schema = json!({
            "type": "object",
            "properties": {
                "filter": {
                    "type": "object",
                    "required": ["kind"],
                }
            }
        });
        let err =
            validate_against_schema(&json!({"filter": {}}), &schema).unwrap_err();
        assert!(err.contains("filter"), "{err}");
        assert!(err.contains("kind"), "{err}");
    }

    #[test]
    fn schema_enum_constraint() {
        let schema = json!({
            "type": "object",
            "properties": {
                "mode": { "enum": ["fast", "deep"] }
            }
        });
        assert!(
            validate_against_schema(&json!({"mode": "fast"}), &schema).is_ok()
        );
        assert!(
            validate_against_schema(&json!({"mode": "balanced"}), &schema).is_err()
        );
    }

    #[test]
    fn schema_array_items() {
        let schema = json!({
            "type": "object",
            "properties": {
                "tags": { "type": "array", "items": { "type": "string" } }
            }
        });
        assert!(validate_against_schema(
            &json!({"tags": ["a", "b"]}),
            &schema,
        )
        .is_ok());
        let err = validate_against_schema(&json!({"tags": [1]}), &schema).unwrap_err();
        assert!(err.contains("string"));
    }

    #[test]
    fn unknown_constraints_do_not_block() {
        // We don't model `pattern`/`minLength` etc.; they pass through.
        let schema = json!({
            "type": "string",
            "pattern": "^foo$",
            "minLength": 100
        });
        assert!(validate_against_schema(&json!("anything"), &schema).is_ok());
    }

    // --- tool-invocation parsing & fingerprinting ----------------------

    #[test]
    fn parse_tool_invocations_handles_single_xml_block() {
        let raw = "<tool_call>{\"tool\":\"web_search\",\"arguments\":{\"q\":\"rust\"}}</tool_call>";
        let invocations = parse_tool_invocations(raw).expect("parsed");
        assert_eq!(invocations.len(), 1);
        assert_eq!(invocations[0].tool, "web_search");
        assert_eq!(invocations[0].arguments["q"], "rust");
        // ULID fallback id always materialises.
        assert!(invocations[0]
            .id
            .as_deref()
            .is_some_and(|id| id.starts_with("call_")));
    }

    #[test]
    fn parse_tool_invocations_handles_array_of_calls() {
        let raw = "<tool_calls>[\
            {\"tool\":\"a\",\"arguments\":{}},\
            {\"tool\":\"b\",\"arguments\":{\"x\":1}}\
        ]</tool_calls>";
        let invocations = parse_tool_invocations(raw).expect("parsed");
        assert_eq!(invocations.len(), 2);
        assert_eq!(invocations[0].tool, "a");
        assert_eq!(invocations[1].tool, "b");
        // Distinct IDs even for adjacent calls.
        assert_ne!(invocations[0].id, invocations[1].id);
    }

    #[test]
    fn parse_tool_invocations_returns_none_when_not_an_xml_block() {
        assert!(parse_tool_invocations("nothing tool-shaped here").is_none());
        assert!(parse_tool_invocations("<tool_call>{not json</tool_call>").is_none());
        // A valid block but missing the `tool` key — partial parse fails.
        assert!(parse_tool_invocations("<tool_call>{\"arguments\":{}}</tool_call>").is_none());
    }

    #[test]
    fn tool_invocations_from_response_prefers_native_tool_calls() {
        let calls = vec![hive_llm::ToolCall {
            id: Some("native_id".into()),
            name: "fs_read".into(),
            arguments: json!({ "path": "x" }),
        }];
        let invocations =
            tool_invocations_from_response("ignored body text", &calls).expect("parsed");
        assert_eq!(invocations.len(), 1);
        assert_eq!(invocations[0].id.as_deref(), Some("native_id"));
        assert_eq!(invocations[0].tool, "fs_read");
    }

    #[test]
    fn tool_invocations_from_response_falls_back_to_xml_when_no_native_calls() {
        let invocations = tool_invocations_from_response(
            "<tool_call>{\"tool\":\"web_search\",\"arguments\":{}}</tool_call>",
            &[],
        );
        assert_eq!(invocations.expect("parsed").len(), 1);
    }

    #[test]
    fn tool_fingerprint_distinguishes_args_but_not_id() {
        let a = ToolInvocation {
            id: Some("aaa".into()),
            tool: "web_search".into(),
            arguments: json!({ "q": "rust" }),
            raw: json!({}),
        };
        let b = ToolInvocation {
            id: Some("bbb".into()),
            tool: "web_search".into(),
            arguments: json!({ "q": "rust" }),
            raw: json!({}),
        };
        let c = ToolInvocation {
            id: Some("ccc".into()),
            tool: "web_search".into(),
            arguments: json!({ "q": "go" }),
            raw: json!({}),
        };
        // Same tool + same args → same fingerprint, regardless of id.
        // The repeat guard relies on this so a model that retries with
        // identical args is detected.
        assert_eq!(tool_fingerprint(&a), tool_fingerprint(&b));
        assert_ne!(tool_fingerprint(&a), tool_fingerprint(&c));
    }

    #[test]
    fn matches_schema_type_covers_primitive_kinds() {
        assert!(matches_schema_type(&json!("hi"), "string"));
        assert!(!matches_schema_type(&json!(42), "string"));
        assert!(matches_schema_type(&json!(42), "integer"));
        assert!(matches_schema_type(&json!(42), "number"));
        assert!(matches_schema_type(&json!(3.14), "number"));
        assert!(!matches_schema_type(&json!(3.14), "integer"));
        assert!(matches_schema_type(&json!(true), "boolean"));
        assert!(matches_schema_type(&json!([]), "array"));
        assert!(matches_schema_type(&json!({}), "object"));
        assert!(matches_schema_type(&json!(null), "null"));
        // Unknown types are permissive (never block).
        assert!(matches_schema_type(&json!("hi"), "anything-goes"));
    }

    #[test]
    fn tool_result_json_shape_is_stable() {
        let payload = tool_result_json("web_search", "missing query");
        assert_eq!(payload["ok"], json!(false));
        assert_eq!(payload["tool"], json!("web_search"));
        assert_eq!(payload["error"], json!("missing query"));
    }
}
