//! Web search abstraction with pluggable providers.
//!
//! Sprint 2 plan: one BYOK provider (Tavily) and one zero-key self-hosted
//! provider (SearxNG). Either can be configured per project; if a Tavily
//! key isn't available, the backend falls back to SearxNG so HIVE stays
//! usable without any paid service.

pub mod providers;

pub use providers::duckduckgo::DuckDuckGoProvider;
pub use providers::searxng::SearxNgProvider;
pub use providers::tavily::TavilyProvider;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SearchError {
    #[error("http error: {0}")]
    Http(#[from] reqwest::Error),

    #[error("provider returned {status}: {body}")]
    ProviderStatus { status: u16, body: String },

    #[error("missing api key")]
    MissingKey,

    #[error("configuration error: {0}")]
    Config(String),

    #[error("parse error: {0}")]
    Parse(String),
}

#[derive(Copy, Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SearchProviderKind {
    Tavily,
    Searxng,
    /// Zero-config fallback — DuckDuckGo HTML scraper. No key, no Docker,
    /// always available. Quality is lower than Tavily but the bar is "the
    /// search tool exists" rather than "perfect results".
    DuckDuckGo,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    /// Some providers (Tavily) score the result. Left None for SearxNG.
    pub score: Option<f32>,
}

#[derive(Clone, Debug, Default)]
pub struct SearchQuery {
    pub query: String,
    /// Hard cap from the tool layer; providers apply their own caps too.
    pub max_results: Option<u32>,
}

impl SearchQuery {
    pub fn new(q: impl Into<String>) -> Self {
        Self {
            query: q.into(),
            max_results: None,
        }
    }
}

#[async_trait]
pub trait SearchProvider: Send + Sync {
    fn kind(&self) -> SearchProviderKind;
    async fn search(&self, request: SearchQuery) -> Result<Vec<SearchResult>, SearchError>;
}
