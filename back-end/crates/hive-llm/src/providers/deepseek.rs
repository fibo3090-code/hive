//! DeepSeek provider.
//!
//! DeepSeek serves an OpenAI-compatible Chat Completions API at
//! `https://api.deepseek.com/v1`. Same request shape, same SSE event format,
//! same `tool_calls` streaming taxonomy. So the wire-level work is already
//! done by [`super::openai::OpenAiProvider`] — this file is a thin newtype
//! that forwards every trait method to an inner `OpenAiProvider` constructed
//! against the DeepSeek base URL.
//!
//! What's different from upstream OpenAI:
//! - **Model catalog**: returned from `/v1/models` but we additionally filter
//!   to the `deepseek-*` family so other models leaking into the listing
//!   (none today, but defence in depth) don't pollute the picker.
//! - **`/v1/models` is reachable without a key on the public endpoint**, but
//!   we still require a key for any `chat`/`chat_stream` so users hit a
//!   clean `LlmError::MissingKey` instead of a 401 from the API.
//! - **Pricing + context window** live in `pricing.rs` / `model_metadata.rs`
//!   keyed on `ProviderKind::DeepSeek`.
//!
//! `deepseek-reasoner` (the R1-style chain-of-thought model) does NOT support
//! tool calls when reasoning is active; `supports_tools` returns false for
//! that model id so the runtime won't waste rounds asking it to use tools.

use async_trait::async_trait;

use crate::chat::{ChatRequest, ChatResponse};
use crate::providers::openai::OpenAiProvider;
use crate::{
    ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind, TestOutcome,
};

pub struct DeepSeekProvider {
    inner: OpenAiProvider,
}

impl DeepSeekProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        // Reuse the OpenAI wire format. `config.base_url` already points at
        // `https://api.deepseek.com` thanks to
        // `ProviderKind::DeepSeek::default_base_url()`.
        Self {
            inner: OpenAiProvider::new(http, config),
        }
    }
}

#[async_trait]
impl LlmProvider for DeepSeekProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::DeepSeek
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let mut models = self.inner.list_models().await?;
        // Keep only DeepSeek-branded ids. Without this filter, an upstream
        // proxy that fronts both OpenAI and DeepSeek (rare, but some do)
        // would leak unrelated models into the picker.
        models.retain(|m| m.id.starts_with("deepseek"));
        Ok(models)
    }

    async fn test_connection(&self) -> TestOutcome {
        match self.list_models().await {
            Ok(models) => TestOutcome {
                ok: true,
                error: None,
                sample_models: models.into_iter().take(5).map(|m| m.id).collect(),
            },
            Err(err) => TestOutcome {
                ok: false,
                error: Some(err.to_string()),
                sample_models: vec![],
            },
        }
    }

    async fn chat_stream(&self, request: ChatRequest) -> Result<ChatStream, LlmError> {
        self.inner.chat_stream(request).await
    }

    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, LlmError> {
        self.inner.chat(request).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deepseek_base_url_is_correct() {
        assert_eq!(
            ProviderKind::DeepSeek.default_base_url(),
            "https://api.deepseek.com"
        );
    }

    #[test]
    fn deepseek_requires_a_key() {
        assert!(ProviderKind::DeepSeek.requires_key());
    }
}
