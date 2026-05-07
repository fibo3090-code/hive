//! SearxNG provider — self-hosted, zero-key. Users run a local SearxNG
//! instance (Docker Compose snippet ships in a later chunk) and point
//! this provider at it. No API key, no per-query cost.

use async_trait::async_trait;
use serde::Deserialize;

use crate::{SearchError, SearchProvider, SearchProviderKind, SearchQuery, SearchResult};

pub struct SearxNgProvider {
    http: reqwest::Client,
    base_url: String,
}

impl SearxNgProvider {
    pub fn new(http: reqwest::Client, base_url: impl Into<String>) -> Self {
        Self {
            http,
            base_url: base_url.into(),
        }
    }
}

#[derive(Deserialize)]
struct SearxResponse {
    #[serde(default)]
    results: Vec<SearxResult>,
}

#[derive(Deserialize)]
struct SearxResult {
    #[serde(default)]
    title: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    content: String,
}

pub(crate) fn parse(body: &str) -> Result<Vec<SearchResult>, SearchError> {
    let parsed: SearxResponse =
        serde_json::from_str(body).map_err(|e| SearchError::Parse(e.to_string()))?;
    Ok(parsed
        .results
        .into_iter()
        .map(|r| SearchResult {
            title: r.title,
            url: r.url,
            snippet: r.content,
            score: None,
        })
        .collect())
}

#[async_trait]
impl SearchProvider for SearxNgProvider {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::Searxng
    }

    async fn search(&self, request: SearchQuery) -> Result<Vec<SearchResult>, SearchError> {
        if self.base_url.trim().is_empty() {
            return Err(SearchError::Config("searxng base_url not set".into()));
        }
        let base = self.base_url.trim_end_matches('/');
        let url = format!("{base}/search");
        let response = self
            .http
            .get(url)
            .query(&[
                ("q", request.query.as_str()),
                ("format", "json"),
                ("safesearch", "1"),
            ])
            .send()
            .await
            .map_err(|e| {
                if e.is_connect() {
                    SearchError::Config(format!(
                        "searxng is not reachable at {base}; start SearxNG or configure Tavily in Settings > Tools Sandbox"
                    ))
                } else {
                    SearchError::Http(e)
                }
            })?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(SearchError::ProviderStatus {
                status: status.as_u16(),
                body,
            });
        }
        let body = response.text().await?;
        let mut out = parse(&body)?;
        if let Some(max) = request.max_results {
            out.truncate(max as usize);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_response() {
        let body = r#"{"results":[
            {"title":"HIVE","url":"https://example.com","content":"blurb"},
            {"title":"T2","url":"https://example.com/2","content":"more"}
        ]}"#;
        let results = parse(body).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "HIVE");
        assert_eq!(results[0].url, "https://example.com");
        assert_eq!(results[0].score, None);
    }

    #[test]
    fn parses_missing_fields_gracefully() {
        // A result with no fields should become a SearchResult with empty
        // strings — callers can still display "unknown" in the UI.
        let body = r#"{"results":[{}]}"#;
        let r = parse(body).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].title, "");
        assert_eq!(r[0].url, "");
    }

    #[test]
    fn parse_error_on_invalid_json() {
        assert!(matches!(parse("not-json"), Err(SearchError::Parse(_))));
    }
}
