//! Coarse token estimation used for pre-flight context budgeting.
//!
//! True tokenisation is provider- and model-specific (BPE for OpenAI/Claude,
//! SentencePiece for Gemini, etc.). Doing it accurately offline would mean
//! shipping the matching tokenizer per provider — heavyweight for what is
//! essentially a "is this likely to overflow?" check.
//!
//! Instead, we approximate. For English-dominant text the empirical ratio
//! is ~4 characters per token; non-Latin scripts trend lower (1-2 chars
//! per token), so the estimate is conservative for those cases on the
//! input side and aggressive on the output side. The numbers are used to
//! *trim* history before a request — being slightly off is fine; being
//! systematically wrong would cause unnecessary truncation, so we prefer
//! to overestimate.
//!
//! When better accuracy is needed, swap this for a real tokenizer behind
//! the same function signature.

use crate::chat::{ChatMessage, ToolCall, ToolDefinition};

/// Approximate token count for a single string.
///
/// Uses 4 characters per token as a safe default. We round up to never
/// underestimate — the caller is using this to check fit, and false
/// negatives (silent overflow at the provider) hurt more than false
/// positives (one too-aggressive trim).
pub fn estimate_string_tokens(s: &str) -> u64 {
    // chars(), not bytes(): a 4-byte emoji is ~1-2 tokens, not 4.
    let chars = s.chars().count() as u64;
    chars.div_ceil(4)
}

/// Approximate token count for a tool call (name + serialised JSON args).
pub fn estimate_tool_call_tokens(call: &ToolCall) -> u64 {
    let name = estimate_string_tokens(&call.name);
    let args = serde_json::to_string(&call.arguments)
        .map(|s| estimate_string_tokens(&s))
        .unwrap_or(0);
    // ~6 tokens of envelope overhead per call (id, name, args wrappers).
    name + args + 6
}

/// Approximate token count for a single chat message including envelope.
pub fn estimate_message_tokens(message: &ChatMessage) -> u64 {
    let content = estimate_string_tokens(&message.content);
    let tool_calls: u64 = message.tool_calls.iter().map(estimate_tool_call_tokens).sum();
    // ~4 tokens of envelope overhead per message (role + separators).
    content + tool_calls + 4
}

/// Approximate token count for a tool definition (the schema itself
/// counts toward the prompt — provider tool catalogs do).
pub fn estimate_tool_definition_tokens(def: &ToolDefinition) -> u64 {
    let name = estimate_string_tokens(&def.name);
    let desc = estimate_string_tokens(&def.description);
    let schema = serde_json::to_string(&def.input_schema)
        .map(|s| estimate_string_tokens(&s))
        .unwrap_or(0);
    name + desc + schema + 8
}

/// Approximate total prompt tokens for a `ChatRequest`-shaped payload.
pub fn estimate_request_tokens(messages: &[ChatMessage], tools: &[ToolDefinition]) -> u64 {
    let msg_tokens: u64 = messages.iter().map(estimate_message_tokens).sum();
    let tool_tokens: u64 = tools.iter().map(estimate_tool_definition_tokens).sum();
    msg_tokens + tool_tokens
}

/// Outcome of a context trim.
#[derive(Clone, Debug, PartialEq)]
pub struct TrimOutcome {
    /// How many messages were dropped from the front of the history.
    pub dropped: usize,
    /// Estimated tokens after the trim.
    pub estimated_tokens_after: u64,
}

/// Trim `messages` in place to fit within `budget` tokens, preserving the
/// system prompt(s) at the front and the most recent user turn at the back.
///
/// Drops oldest non-system messages between those two anchors until the
/// remaining estimate fits, or returns the cumulative dropped count if no
/// trim fully achieves the budget (the runtime caller still proceeds with
/// the partially-trimmed history; the LLM provider returns the precise
/// overflow error if any).
pub fn trim_to_fit(
    messages: &mut Vec<ChatMessage>,
    tools: &[ToolDefinition],
    budget: u64,
) -> TrimOutcome {
    use crate::chat::ChatRole;

    let mut dropped = 0;
    loop {
        let estimated = estimate_request_tokens(messages, tools);
        if estimated <= budget {
            return TrimOutcome {
                dropped,
                estimated_tokens_after: estimated,
            };
        }

        // Find the oldest non-system message that isn't the very last
        // (assumed-current) user turn.
        let last_idx = messages.len().saturating_sub(1);
        let drop_idx = messages.iter().enumerate().find_map(|(idx, msg)| {
            if idx == last_idx {
                return None;
            }
            if matches!(msg.role, ChatRole::System) {
                return None;
            }
            Some(idx)
        });

        match drop_idx {
            Some(idx) => {
                messages.remove(idx);
                dropped += 1;
            }
            None => {
                // Nothing left to drop — return what we have. The provider
                // may still error; that's fine, we've done our best.
                return TrimOutcome {
                    dropped,
                    estimated_tokens_after: estimated,
                };
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::ChatMessage;

    #[test]
    fn empty_request_estimates_to_zero() {
        assert_eq!(estimate_request_tokens(&[], &[]), 0);
    }

    #[test]
    fn estimate_grows_with_content() {
        let short = ChatMessage::user("hi");
        let long = ChatMessage::user("a".repeat(4000));
        assert!(estimate_message_tokens(&long) > estimate_message_tokens(&short));
    }

    #[test]
    fn trim_preserves_system_and_last_user_turn() {
        let mut msgs = vec![
            ChatMessage::system("you are helpful"),
            ChatMessage::user("first question"),
            ChatMessage::assistant("first answer"),
            ChatMessage::user("second question"),
            ChatMessage::assistant("second answer"),
            ChatMessage::user("current question"),
        ];
        // Tight budget that will force trimming.
        let outcome = trim_to_fit(&mut msgs, &[], 30);
        // System (idx 0) and last (current question) preserved.
        assert!(matches!(msgs.first().map(|m| m.role), Some(crate::chat::ChatRole::System)));
        assert_eq!(msgs.last().unwrap().content, "current question");
        assert!(outcome.dropped > 0);
    }

    #[test]
    fn trim_no_op_when_under_budget() {
        let mut msgs = vec![
            ChatMessage::system("sys"),
            ChatMessage::user("hi"),
        ];
        let outcome = trim_to_fit(&mut msgs, &[], 1_000);
        assert_eq!(outcome.dropped, 0);
        assert_eq!(msgs.len(), 2);
    }

    #[test]
    fn trim_with_tools_accounts_for_catalog() {
        let mut msgs = vec![
            ChatMessage::user("a".repeat(100)),
        ];
        let tool = ToolDefinition {
            name: "web_search".into(),
            description: "search the web".into(),
            input_schema: serde_json::json!({"type":"object"}),
        };
        let with_tool = estimate_request_tokens(&msgs, std::slice::from_ref(&tool));
        let without_tool = estimate_request_tokens(&msgs, &[]);
        assert!(with_tool > without_tool);
        let _ = trim_to_fit(&mut msgs, std::slice::from_ref(&tool), 10_000);
    }
}
