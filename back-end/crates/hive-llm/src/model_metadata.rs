//! Family-keyed metadata for models that providers don't expose (or expose
//! inconsistently) on their `/models` endpoints.
//!
//! Most prominently: Anthropic's `/v1/models` returns no context window, and
//! OpenAI's only does for some model families. Rather than emit `None` and
//! force the frontend to guess, we keep a small lookup table here and
//! resolve by case-insensitive substring on the model id. New families fall
//! back to a conservative default per provider.
//!
//! Keep this terse — adding a row here is far cheaper than letting a 0 or
//! `None` reach the UI.

use crate::ProviderKind;

/// Conservative default for any model id not matched by a family rule.
const ANTHROPIC_DEFAULT_CTX: u64 = 100_000;
const OPENAI_DEFAULT_CTX: u64 = 128_000;
const GEMINI_DEFAULT_CTX: u64 = 1_000_000;
const OLLAMA_DEFAULT_CTX: u64 = 8_192;

/// Best-effort context window for `(provider, model)`. Returns the family
/// default if no specific match is found.
pub fn context_window_for(kind: ProviderKind, model: &str) -> u64 {
    let m = model.to_ascii_lowercase();
    match kind {
        ProviderKind::Anthropic => {
            // Claude 4.x line ships 200k across opus/sonnet/haiku.
            if m.contains("claude-4")
                || m.contains("opus-4")
                || m.contains("sonnet-4")
                || m.contains("haiku-4")
                || m.contains("opus-3")
                || m.contains("sonnet-3")
            {
                200_000
            } else {
                ANTHROPIC_DEFAULT_CTX
            }
        }
        ProviderKind::Openai => {
            if m.starts_with("gpt-5") {
                400_000
            } else if m.contains("gpt-4.1") {
                1_000_000
            } else if m.contains("gpt-4o") || m.contains("chatgpt-4o") {
                128_000
            } else if m.starts_with("o3") || m.starts_with("o4") {
                200_000
            } else if m.starts_with("o1") {
                200_000
            } else {
                OPENAI_DEFAULT_CTX
            }
        }
        ProviderKind::Gemini => {
            if m.contains("2.5-pro") || m.contains("2.0-pro") {
                2_000_000
            } else if m.contains("flash-lite") {
                1_000_000
            } else if m.contains("flash") {
                1_000_000
            } else {
                GEMINI_DEFAULT_CTX
            }
        }
        ProviderKind::Ollama => {
            // Most local Ollama models default to 8k unless the user
            // overrides via Modelfile. We can't introspect that without
            // pulling extra metadata; ship the conservative number.
            if m.contains(":1m") || m.contains("128k") {
                128_000
            } else if m.contains("32k") {
                32_768
            } else {
                OLLAMA_DEFAULT_CTX
            }
        }
    }
}

/// Whether a given model is expected to support tool/function calling.
///
/// Provider APIs let *every* request opt into tools, but for some models
/// (older Ollama checkpoints, old-gen OpenAI like `gpt-3.5`) the model will
/// silently ignore them. The frontend uses this to grey out tool toggles
/// when the picked model can't honour them.
pub fn supports_tools(kind: ProviderKind, model: &str) -> bool {
    let m = model.to_ascii_lowercase();
    match kind {
        ProviderKind::Anthropic => true,
        ProviderKind::Openai => !m.starts_with("gpt-3.5") && !m.contains("instruct"),
        ProviderKind::Gemini => true,
        ProviderKind::Ollama => {
            // Ollama tool support is per-model; this list mirrors the
            // families that have tool tags upstream. Refine over time.
            m.starts_with("llama3.1")
                || m.starts_with("llama3.2")
                || m.starts_with("llama3.3")
                || m.starts_with("llama4")
                || m.starts_with("qwen2.5")
                || m.starts_with("qwen3")
                || m.starts_with("mistral-nemo")
                || m.starts_with("mistral-small")
                || m.starts_with("command-r")
                || m.starts_with("firefunction")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anthropic_4x_family_is_200k() {
        assert_eq!(
            context_window_for(ProviderKind::Anthropic, "claude-opus-4-7"),
            200_000
        );
        assert_eq!(
            context_window_for(ProviderKind::Anthropic, "claude-sonnet-4-6"),
            200_000
        );
        assert_eq!(
            context_window_for(ProviderKind::Anthropic, "claude-haiku-4-5-20251001"),
            200_000
        );
    }

    #[test]
    fn unknown_anthropic_falls_back_to_default() {
        assert_eq!(
            context_window_for(ProviderKind::Anthropic, "claude-future-7"),
            ANTHROPIC_DEFAULT_CTX
        );
    }

    #[test]
    fn openai_gpt5_400k() {
        assert_eq!(context_window_for(ProviderKind::Openai, "gpt-5"), 400_000);
        assert_eq!(
            context_window_for(ProviderKind::Openai, "gpt-5-mini"),
            400_000
        );
    }

    #[test]
    fn gemini_pro_is_2m_window() {
        assert_eq!(
            context_window_for(ProviderKind::Gemini, "gemini-2.5-pro"),
            2_000_000
        );
    }

    #[test]
    fn gpt35_does_not_support_tools() {
        assert!(!supports_tools(ProviderKind::Openai, "gpt-3.5-turbo"));
        assert!(supports_tools(ProviderKind::Openai, "gpt-4.1"));
        assert!(supports_tools(ProviderKind::Openai, "gpt-5"));
    }

    #[test]
    fn ollama_tool_detection_matches_known_families() {
        assert!(supports_tools(ProviderKind::Ollama, "llama3.1:8b"));
        assert!(supports_tools(ProviderKind::Ollama, "qwen2.5:14b"));
        assert!(!supports_tools(ProviderKind::Ollama, "llama2:7b"));
    }
}
