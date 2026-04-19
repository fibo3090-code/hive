//! LLM provider abstraction + clients.
//!
//! Sprint 0 scope: provider registry, `list_models` and `test_connection`.
//! Streaming chat completions land in Sprint 1.

pub mod providers;

use std::{fmt, str::FromStr};

use async_trait::async_trait;
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
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::Openai => "openai",
            Self::Gemini => "gemini",
            Self::Ollama => "ollama",
        }
    }

    pub fn display_label(self) -> &'static str {
        match self {
            Self::Anthropic => "Anthropic",
            Self::Openai => "OpenAI",
            Self::Gemini => "Google Gemini",
            Self::Ollama => "Ollama (local)",
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
            other => Err(LlmError::Unsupported(other.to_owned())),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub label: String,
    pub context_window: Option<u32>,
    pub supports_tools: bool,
    pub supports_streaming: bool,
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
}

/// Build a boxed client for the given config.
pub fn client_for(config: ProviderConfig) -> Box<dyn LlmProvider> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("reqwest client builds");
    match config.kind {
        ProviderKind::Anthropic => {
            Box::new(providers::anthropic::AnthropicProvider::new(http, config))
        }
        ProviderKind::Openai => Box::new(providers::openai::OpenAiProvider::new(http, config)),
        ProviderKind::Gemini => Box::new(providers::gemini::GeminiProvider::new(http, config)),
        ProviderKind::Ollama => Box::new(providers::ollama::OllamaProvider::new(http, config)),
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
        ] {
            assert_eq!(ProviderKind::from_str(k.as_str()).unwrap(), k);
        }
    }

    #[test]
    fn ollama_needs_no_key() {
        assert!(!ProviderKind::Ollama.requires_key());
        assert!(ProviderKind::Anthropic.requires_key());
    }
}
