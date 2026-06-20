//! LLM provider abstraction + clients.
//!
//! Sprint 0 scope: provider registry, `list_models` and `test_connection`.
//! Sprint 1 adds streaming text completions via `chat_stream`.

pub mod chat;
pub mod model_metadata;
pub mod pricing;
pub mod providers;
pub mod sse;
pub mod token_budget;

pub use chat::{
    ChatMessage, ChatRequest, ChatResponse, ChatRole, StreamChunk, StreamEvent, ToolCall,
    ToolDefinition,
};

use std::{fmt, pin::Pin, str::FromStr};

use async_trait::async_trait;
use futures_core::Stream;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum LlmError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("provider returned {status}: {body}")]
    ProviderStatus { status: u16, body: String },
    #[error("missing api key")]
    MissingKey,
    #[error("unsupported provider: {0}")]
    Unsupported(String),
    #[error("parse error: {0}")]
    Parse(String),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderKind {
    Anthropic,
    Openai,
    Gemini,
    Ollama,
    DeepSeek,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Openai => "openai",
            Self::Gemini => "gemini",
            Self::Ollama => "ollama",
            Self::DeepSeek => "deepseek",
        }
    }

    pub fn display_label(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic",
            Self::Openai => "OpenAI",
            Self::Gemini => "Google Gemini",
            Self::Ollama => "Ollama (local)",
            Self::DeepSeek => "DeepSeek",
        }
    }

    pub fn requires_key(self) -> bool {
        !matches!(self, Self::Ollama)
    }

    pub fn default_base_url(self) -> &'static str {
        match self {
            Self::Anthropic => "https://api.anthropic.com",
            Self::Openai => "https://api.openai.com",
            Self::Gemini => "https://generativelanguage.googleapis.com",
            Self::Ollama => "http://localhost:11434",
            // DeepSeek serves an OpenAI-compatible API at this base; the
            // `DeepSeekProvider` reuses the OpenAI wire format almost
            // verbatim, just pointed at this URL.
            Self::DeepSeek => "https://api.deepseek.com",
        }
    }
}

impl fmt::Display for ProviderKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ProviderKind {
    type Err = LlmError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_lowercase().as_str() {
            "anthropic" => Ok(Self::Anthropic),
            "openai" => Ok(Self::Openai),
            "gemini" | "google" => Ok(Self::Gemini),
            "ollama" | "local" => Ok(Self::Ollama),
            "deepseek" => Ok(Self::DeepSeek),
            other => Err(LlmError::Unsupported(other.to_owned())),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    /// Maximum input context window in tokens. `u64` because next-gen
    /// frontier models exceed `u32::MAX` (Gemini's 10M+ tier).
    pub context_window: Option<u64>,
    pub supports_tools: bool,
    pub supports_streaming: bool,
    /// Whether the model can deliver tool calls **inside a streaming**
    /// response. When false, the runtime must fall back to the non-streaming
    /// `chat()` round-trip whenever tools are configured. Distinct from
    /// `supports_tools`: a model can support tools (via non-streaming) yet
    /// fail to surface them through the streaming path. Ollama is the
    /// motivating example — its `done:true` chunk historically wasn't parsed
    /// for `tool_calls`.
    #[serde(default)]
    pub supports_streaming_tools: bool,
}

impl ModelInfo {
    /// Construct a `ModelInfo` after validating the basics. Returns `None`
    /// (and logs a `warn`) if the row would mislead the frontend — empty
    /// id/label, or a zero context window where one was claimed.
    pub fn build(
        id: impl Into<String>,
        label: impl Into<String>,
        context_window: Option<u64>,
        supports_tools: bool,
        supports_streaming: bool,
        supports_streaming_tools: bool,
    ) -> Option<Self> {
        let id = id.into();
        let label = label.into();
        if id.trim().is_empty() {
            tracing::warn!("model row dropped: empty id");
            return None;
        }
        if label.trim().is_empty() {
            tracing::warn!(id = %id, "model row dropped: empty label");
            return None;
        }
        if context_window == Some(0) {
            tracing::warn!(id = %id, "model row dropped: zero context window");
            return None;
        }
        Some(Self {
            id,
            label,
            context_window,
            supports_tools,
            supports_streaming,
            supports_streaming_tools,
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestOutcome {
    pub ok: bool,
    pub error: Option<String>,
    pub sample_models: Vec<String>,
}

/// Config for instantiating a provider client.
#[derive(Clone, Debug)]
pub struct ProviderConfig {
    pub kind: ProviderKind,
    pub api_key: Option<String>,
    pub base_url: String,
}

impl ProviderConfig {
    pub fn new(kind: ProviderKind, api_key: Option<String>, base_url: Option<String>) -> Self {
        Self {
            kind,
            api_key,
            base_url: base_url.unwrap_or_else(|| kind.default_base_url().to_owned()),
        }
    }
}

pub type ChatStream = Pin<Box<dyn Stream<Item = Result<StreamEvent, LlmError>> + Send>>;

#[async_trait]
pub trait LlmProvider: Send + Sync {
    fn kind(&self) -> ProviderKind;
    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError>;
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

    /// Run a streaming chat completion. Default implementation returns an
    /// `Unsupported` error — providers that support streaming override this.
    async fn chat_stream(&self, _request: ChatRequest) -> Result<ChatStream, LlmError> {
        Err(LlmError::Unsupported(format!(
            "{} does not implement chat_stream",
            self.kind().as_str()
        )))
    }

    /// Run a single chat turn and return the fully accumulated response.
    /// Providers override this for native tool-calling support; the default
    /// implementation falls back to `chat_stream` and only returns text.
    async fn chat(&self, request: ChatRequest) -> Result<ChatResponse, LlmError> {
        let mut stream = self.chat_stream(request).await?;
        let mut text = String::new();
        let mut tokens_in = 0;
        let mut tokens_out = 0;
        let mut finish_reason = None;
        // ZZ26: accumulate streamed tool-call events. A provider that relies
        // on this default `chat` (instead of overriding it) used to silently
        // drop every native tool call — the bug would only surface once such
        // a provider was deployed. Track each call by id in first-seen order;
        // concatenate `args_chunk`s and parse them once when the stream ends.
        let mut pending: Vec<(String, String, String)> = Vec::new();
        fn slot<'a>(
            pending: &'a mut Vec<(String, String, String)>,
            id: &str,
        ) -> &'a mut (String, String, String) {
            let idx = match pending.iter().position(|(pid, _, _)| pid == id) {
                Some(i) => i,
                None => {
                    pending.push((id.to_owned(), String::new(), String::new()));
                    pending.len() - 1
                }
            };
            &mut pending[idx]
        }

        while let Some(item) = stream.next().await {
            match item? {
                StreamEvent::Delta(chunk) => text.push_str(&chunk.delta),
                StreamEvent::Start { input_tokens: tin } => {
                    if tin > tokens_in {
                        tokens_in = tin;
                    }
                }
                StreamEvent::Complete {
                    tokens_in: tin,
                    tokens_out: tout,
                    finish_reason: finish,
                } => {
                    if tin > tokens_in {
                        tokens_in = tin;
                    }
                    if tout > tokens_out {
                        tokens_out = tout;
                    }
                    if finish.is_some() {
                        finish_reason = finish;
                    }
                }
                StreamEvent::ToolCallStart { id, name } => {
                    slot(&mut pending, &id).1 = name;
                }
                StreamEvent::ToolCallDelta { id, args_chunk } => {
                    slot(&mut pending, &id).2.push_str(&args_chunk);
                }
                StreamEvent::ToolCallEnd { .. } => {}
            }
        }

        let tool_calls = pending
            .into_iter()
            .map(|(id, name, args)| {
                let arguments = serde_json::from_str(args.trim())
                    .unwrap_or_else(|_| serde_json::Value::Object(Default::default()));
                crate::chat::ToolCall {
                    id: Some(id),
                    name,
                    arguments,
                }
            })
            .collect();

        Ok(ChatResponse {
            text,
            tool_calls,
            tokens_in,
            tokens_out,
            finish_reason,
        })
    }
}

/// Build a boxed client for the given config.
///
/// Uses `connect_timeout` rather than the all-up `timeout`. The all-up
/// timeout aborts streaming responses too (so a 15s total kills any
/// slow-token model), which is the wrong default for an LLM client.
/// Stream consumers (`hive_runtime::chat::run_turn`) enforce their own
/// per-turn wall-clock budget.
pub fn client_for(config: ProviderConfig) -> Box<dyn LlmProvider> {
    let http = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .pool_idle_timeout(std::time::Duration::from_secs(60))
        .build()
        .expect("reqwest client builds");
    match config.kind {
        ProviderKind::Anthropic => {
            Box::new(providers::anthropic::AnthropicProvider::new(http, config))
        }
        ProviderKind::Openai => Box::new(providers::openai::OpenAiProvider::new(http, config)),
        ProviderKind::Gemini => Box::new(providers::gemini::GeminiProvider::new(http, config)),
        ProviderKind::Ollama => Box::new(providers::ollama::OllamaProvider::new(http, config)),
        ProviderKind::DeepSeek => {
            Box::new(providers::deepseek::DeepSeekProvider::new(http, config))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kind_roundtrip() {
        for k in [
            ProviderKind::Anthropic,
            ProviderKind::Openai,
            ProviderKind::Gemini,
            ProviderKind::Ollama,
            ProviderKind::DeepSeek,
        ] {
            assert_eq!(ProviderKind::from_str(k.as_str()).unwrap(), k);
        }
    }

    #[test]
    fn ollama_needs_no_key() {
        assert!(!ProviderKind::Ollama.requires_key());
        assert!(ProviderKind::Anthropic.requires_key());
    }

    #[tokio::test]
    async fn default_chat_accumulates_streamed_tool_calls() {
        // ZZ26: a provider that uses the default `chat` (rather than overriding
        // it) must still surface native tool calls from the stream. Args may
        // arrive split across multiple deltas — they're concatenated and parsed
        // once at the end.
        use crate::chat::{ChatRequest, StreamChunk, StreamEvent};

        struct ToolStreamProvider;

        #[async_trait]
        impl LlmProvider for ToolStreamProvider {
            fn kind(&self) -> ProviderKind {
                ProviderKind::Ollama
            }
            async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
                Ok(vec![])
            }
            async fn chat_stream(&self, _request: ChatRequest) -> Result<ChatStream, LlmError> {
                let events = vec![
                    Ok(StreamEvent::Delta(StreamChunk {
                        delta: "working".into(),
                    })),
                    Ok(StreamEvent::ToolCallStart {
                        id: "c1".into(),
                        name: "fs_read".into(),
                    }),
                    Ok(StreamEvent::ToolCallDelta {
                        id: "c1".into(),
                        args_chunk: "{\"path\":".into(),
                    }),
                    Ok(StreamEvent::ToolCallDelta {
                        id: "c1".into(),
                        args_chunk: "\"README.md\"}".into(),
                    }),
                    Ok(StreamEvent::ToolCallEnd { id: "c1".into() }),
                    Ok(StreamEvent::Complete {
                        tokens_in: 3,
                        tokens_out: 5,
                        finish_reason: Some("tool_calls".into()),
                    }),
                ];
                Ok(Box::pin(futures_util::stream::iter(events)))
            }
        }

        let resp = ToolStreamProvider
            .chat(ChatRequest::new("ollama-model", vec![]))
            .await
            .expect("default chat must not error");
        assert_eq!(resp.text, "working");
        assert_eq!(
            resp.tool_calls.len(),
            1,
            "default chat must surface the streamed tool call, not drop it"
        );
        assert_eq!(resp.tool_calls[0].name, "fs_read");
        assert_eq!(resp.tool_calls[0].id.as_deref(), Some("c1"));
        assert_eq!(resp.tool_calls[0].arguments["path"], "README.md");
        assert_eq!(resp.tokens_out, 5);
    }
}
