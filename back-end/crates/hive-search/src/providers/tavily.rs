//! Tavily provider (BYOK). Calls https://api.tavily.com/search with the
//! user-supplied API key. Free tier is ~1 000 queries/month; we keep the
//! request payload minimal so we don't burn quota on paid features.

use async_trait::async_trait;
use serde::Deserialize;

use crate::{SearchError, SearchProvider, SearchProviderKind, SearchQuery, SearchResult};

pub struct TavilyProvider {
    http: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl TavilyProvider {
    pub fn new(http: reqwest::Client, api_key: impl Into<String>) -> Self {
        Self {
            http,
            api_key: api_key.into(),
            base_url: "https://api.tavily.com".into(),
        }
    }

    pub fn with_base_url(mut self, url: impl Into<String>) -> Self {
        self.base_url = url.into();
        self
    }
}

#[derive(Deserialize)]
struct TavilyResponse {
    #[serde(default)]
    results: Vec<TavilyResult>,
}

#[derive(Deserialize)]
struct TavilyResult {
    title: String,
    url: String,
    #[serde(default)]
    content: String,
    #[serde(default)]
    score: Option<f32>,
}

pub(crate) fn parse(body: &str) -> Result<Vec<SearchResult>, SearchError> {
    let parsed: TavilyResponse =
        serde_json::from_str(body).map_err(|e| SearchError::Parse(e.to_string()))?;
    Ok(parsed
        .results
        .into_iter()
        .map(|r| SearchResult {
            title: r.title,
            url: r.url,
            snippet: r.content,
            score: r.score,
        })
        .collect())
}

#[async_trait]
impl SearchProvider for TavilyProvider {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::Tavily
    }

    async fn search(&self, request: SearchQuery) -> Result<Vec<SearchResult>, SearchError> {
        if self.api_key.trim().is_empty() {
            return Err(SearchError::MissingKey);
        }
        let url = format!("{}/search", self.base_url.trim_end_matches('/'));
        let max_results = request.max_results.unwrap_or(5).min(20);
        let body = serde_json::json!({
            "api_key": self.api_key,
            "query": request.query,
            "max_results": max_results,
            "search_depth": "basic",
        });
        let response = self
            .http
            .post(url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(SearchError::ProviderStatus {
                status: status.as_u16(),
                body,
            });
        }
        let body = response.text().await?;
        parse(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_normal_response() {
        let body = r#"{"results":[
            {"title":"HIVE docs","url":"https://example.com/docs","content":"Agent platform","score":0.91},
            {"title":"Bees","url":"https://example.com/bees","content":"Insects","score":0.32}
        ]}"#;
        let results = parse(body).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "HIVE docs");
        assert_eq!(results[0].url, "https://example.com/docs");
        assert_eq!(results[0].snippet, "Agent platform");
        assert_eq!(results[0].score, Some(0.91));
    }

    #[test]
    fn parses_missing_results_as_empty() {
        assert!(parse(r#"{}"#).unwrap().is_empty());
    }

    #[test]
    fn parse_error_on_invalid_json() {
        assert!(matches!(parse("garbage"), Err(SearchError::Parse(_))));
    }
}
