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
    /// Mutable cancel flag — when set to true, the runner stops streaming and
    /// marks the message `cancelled`.
    pub cancel: Arc<Mutex<bool>>,
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
    if let Some(s) = system_prompt {
        if !s.trim().is_empty() {
            messages.push(ChatMessage::system(s));
        }
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
        format!("chat.{}.streaming", thread_id),
        json!({ "threadId": thread_id, "messageId": assistant_message_id }),
    );

    let request = ChatRequest::new(model.clone(), messages);
    let mut stream = match provider.chat_stream(request).await {
        Ok(s) => s,
        Err(err) => {
            let detail = err.to_string();
            let _ = chat_messages::finalize(
                db.conn(),
                &assistant_message_id,
                &format!("[error] {detail}"),
                0,
                0,
                0,
                "error",
            )
            .await;
            bus.emit(
                format!("chat.{}.error", thread_id),
                json!({
                    "threadId": thread_id,
                    "messageId": assistant_message_id,
                    "error": detail,
                }),
            );
            return Err(ChatError::Llm(err));
        }
    };

    let mut accumulated = String::new();
    let mut tokens_in: u32 = 0;
    let mut tokens_out: u32 = 0;
    let mut finish_reason: Option<String> = None;

    loop {
        // Cooperative cancellation check before awaiting the next chunk.
        if *cancel.lock().await {
            let _ = chat_messages::finalize(
                db.conn(),
                &assistant_message_id,
                &accumulated,
                tokens_in as i32,
                tokens_out as i32,
                cost_cents(provider_kind, &model, tokens_in, tokens_out),
                "cancelled",
            )
            .await?;
            bus.emit(
                format!("chat.{}.cancelled", thread_id),
                json!({ "threadId": thread_id, "messageId": assistant_message_id }),
            );
            return Ok(());
        }

        let Some(next) = stream.next().await else {
            break;
        };
        match next {
            Ok(StreamEvent::Delta(chunk)) => {
                accumulated.push_str(&chunk.delta);
                bus.emit(
                    format!("chat.{}.token", thread_id),
                    json!({
                        "threadId": thread_id,
                        "messageId": assistant_message_id,
                        "delta": chunk.delta,
                    }),
                );
            }
            Ok(StreamEvent::Complete {
                tokens_in: tin,
                tokens_out: tout,
                finish_reason: fin,
            }) => {
                tokens_in = tin;
                tokens_out = tout;
                finish_reason = fin;
            }
            Err(err) => {
                let detail = err.to_string();
                let _ = chat_messages::finalize(
                    db.conn(),
                    &assistant_message_id,
                    &format!("{accumulated}\n[stream error] {detail}"),
                    tokens_in as i32,
                    tokens_out as i32,
                    0,
                    "error",
                )
                .await?;
                bus.emit(
                    format!("chat.{}.error", thread_id),
                    json!({
                        "threadId": thread_id,
                        "messageId": assistant_message_id,
                        "error": detail,
                    }),
                );
                return Err(ChatError::Llm(err));
            }
        }
    }

    let cost = cost_cents(provider_kind, &model, tokens_in, tokens_out);

    let _ = chat_messages::finalize(
        db.conn(),
        &assistant_message_id,
        &accumulated,
        tokens_in as i32,
        tokens_out as i32,
        cost,
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
            tokens_in: tokens_in as i32,
            tokens_out: tokens_out as i32,
            cost_cents: cost,
            memo: Some(&memo),
        },
    )
    .await;

    bus.emit(
        format!("chat.{}.complete", thread_id),
        json!({
            "threadId": thread_id,
            "messageId": assistant_message_id,
            "tokensIn": tokens_in,
            "tokensOut": tokens_out,
            "costCents": cost,
            "finishReason": finish_reason,
            "model": model,
            "providerId": provider_id,
        }),
    );
    // Also emit `cost.ingested` so existing dashboard SSE invalidation picks
    // up the new cost event row without polling.
    bus.emit(
        "cost.ingested",
        json!({ "projectId": project_id, "costCents": cost }),
    );

    Ok(())
}
