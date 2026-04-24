//! Streaming chat turn runner. Given a thread and a user message, drives the
//! LLM, streams tokens to the event bus, persists each delta, and records a
//! `cost_events` row when done.

use std::sync::Arc;

use futures_util::StreamExt;
use hive_db::{
    repos::{chat_messages, chat_threads, cost_events},
    Db,
};
use hive_llm::{
    chat::{ChatMessage, ChatRequest, ChatRole, StreamEvent},
    pricing::cost_cents,
    LlmProvider, ProviderKind,
};
use hive_tools::{ToolContext, ToolRegistry};
use serde_json::json;
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
}

#[derive(Clone, Debug)]
struct ToolInvocation {
    tool: String,
    arguments: serde_json::Value,
    raw: serde_json::Value,
}

fn tool_protocol_prompt(registry: &ToolRegistry) -> String {
    let manifests = registry.manifests();
    format!(
        "You may use tools before answering. Available tools are described in JSON below.\n\
If you need a tool, respond with ONLY one XML block and no surrounding prose:\n\
<tool_call>{{\"tool\":\"tool_name\",\"arguments\":{{...}}}}</tool_call>\n\
or for multiple sequential tool calls:\n\
<tool_calls>[{{\"tool\":\"tool_name\",\"arguments\":{{...}}}}]</tool_calls>\n\
Do not include markdown fences. After tool results are returned, answer normally unless another tool is needed.\n\
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
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let items = if let Some(array) = value.as_array() {
        array.clone()
    } else {
        vec![value]
    };

    let mut out = Vec::new();
    for item in items {
        let tool = item.get("tool")?.as_str()?.to_owned();
        let arguments = item.get("arguments").cloned().unwrap_or_else(|| json!({}));
        out.push(ToolInvocation {
            tool,
            arguments,
            raw: item,
        });
    }
    Some(out)
}

async fn collect_response(
    provider: &Arc<dyn LlmProvider>,
    request: ChatRequest,
) -> Result<(String, u32, u32, Option<String>), ChatError> {
    let mut stream = provider.chat_stream(request).await?;
    let mut accumulated = String::new();
    let mut tokens_in = 0;
    let mut tokens_out = 0;
    let mut finish_reason = None;

    while let Some(next) = stream.next().await {
        match next {
            Ok(StreamEvent::Delta(chunk)) => accumulated.push_str(&chunk.delta),
            Ok(StreamEvent::Complete {
                tokens_in: tin,
                tokens_out: tout,
                finish_reason: fin,
            }) => {
                tokens_in = tin;
                tokens_out = tout;
                finish_reason = fin;
            }
            Err(err) => return Err(ChatError::Llm(err)),
        }
    }

    Ok((accumulated, tokens_in, tokens_out, finish_reason))
}

/// Load thread history, call the LLM, stream tokens to the bus, persist.
pub async fn run_turn(params: RunTurn) -> Result<(), ChatError> {
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
    } = params;

    // Verify thread exists.
    let _thread = chat_threads::get(db.conn(), &thread_id)
        .await?
        .ok_or_else(|| ChatError::NotFound(thread_id.clone()))?;

    // Build message history from DB, up to `history_limit` most recent
    // persisted messages (excluding the in-flight assistant placeholder and
    // any cancelled/error turns).
    let mut history = chat_messages::list_by_thread(db.conn(), &thread_id).await?;
    history
        .retain(|m| m.id != assistant_message_id && m.status != "cancelled" && m.status != "error");
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
        messages.push(ChatMessage {
            role,
            content: row.content,
        });
    }

    // Mark the assistant message as streaming.
    let _ = chat_messages::set_status(db.conn(), &assistant_message_id, "streaming").await?;
    bus.emit(
        format!("chat.{thread_id}.streaming"),
        json!({ "threadId": thread_id, "messageId": assistant_message_id }),
    );

    let mut final_answer = String::new();
    let mut total_tokens_in: u32 = 0;
    let mut total_tokens_out: u32 = 0;
    let mut total_cost = 0;
    let mut finish_reason: Option<String> = None;
    let mut executed_calls = Vec::<serde_json::Value>::new();
    const MAX_TOOL_ROUNDS: usize = 6;

    for _ in 0..MAX_TOOL_ROUNDS {
        if *cancel.lock().await {
            let _ = chat_messages::set_tool_calls(
                db.conn(),
                &assistant_message_id,
                json!(executed_calls),
            )
            .await?;
            let _ = chat_messages::finalize(
                db.conn(),
                &assistant_message_id,
                &final_answer,
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
            return Ok(());
        }

        let request = ChatRequest::new(model.clone(), messages.clone());
        let (response, tokens_in, tokens_out, finish) =
            match collect_response(&provider, request).await {
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

        total_tokens_in += tokens_in;
        total_tokens_out += tokens_out;
        total_cost += cost_cents(provider_kind, &model, tokens_in, tokens_out);
        finish_reason = finish;

        let Some(registry) = &tool_registry else {
            final_answer = response;
            break;
        };
        let Some(ctx) = &tool_context else {
            final_answer = response;
            break;
        };

        let Some(invocations) = parse_tool_invocations(&response) else {
            final_answer = response;
            break;
        };

        if invocations.is_empty() {
            final_answer = response;
            break;
        }

        messages.push(ChatMessage::assistant(response.clone()));
        for invocation in invocations {
            bus.emit(
                format!("chat.{thread_id}.tool_call"),
                json!({
                    "threadId": thread_id,
                    "messageId": assistant_message_id,
                    "tool": invocation.tool,
                    "args": invocation.arguments,
                }),
            );
            let result = match registry
                .invoke(&invocation.tool, invocation.arguments.clone(), ctx)
                .await
            {
                Ok(value) => value,
                Err(err) => err.to_result_json(),
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
            messages.push(ChatMessage {
                role: ChatRole::Tool,
                content: format!(
                    "Tool `{}` returned:\n{}",
                    invocation.tool,
                    serde_json::to_string_pretty(&result).unwrap_or_else(|_| result.to_string())
                ),
            });
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

    // Record the cost event. `kind = chat.completion` so Sprint 5 insights
    // can distinguish chat turns from tool calls.
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
    // Also emit `cost.ingested` so existing dashboard SSE invalidation picks
    // up the new cost event row without polling.
    bus.emit(
        "cost.ingested",
        json!({ "projectId": project_id, "costCents": total_cost }),
    );

    Ok(())
}
