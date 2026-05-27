//! DuckDuckGo HTML provider — always-available zero-config fallback.
//!
//! Both Tavily (requires a paid API key) and SearXNG (requires a self-hosted
//! Docker instance) are easy to misconfigure. Most deployed HIVE instances
//! end up with `web_search` silently broken — a search bar that returns
//! "missing key" or "connection refused", which the LLM then learns to
//! avoid. The downstream effect is poor answer quality on any topic that
//! requires fresh information.
//!
//! DuckDuckGo's HTML endpoint (`https://html.duckduckgo.com/html/`) returns
//! plain-HTML search results suitable for screen-readers; it requires no
//! API key, no quota signup, and tolerates light scraping. We parse it with
//! a small `scraper`-based extractor.
//!
//! This is the **last-resort fallback**: hive-api prefers Tavily (best
//! quality, scored) → SearXNG (self-hosted, full control) → DuckDuckGo
//! (this) in that order, so `web_search` is universally available even
//! when nothing is configured.

use async_trait::async_trait;
use scraper::{Html, Selector};

use crate::{SearchError, SearchProvider, SearchProviderKind, SearchQuery, SearchResult};

pub struct DuckDuckGoProvider {
    http: reqwest::Client,
    base_url: String,
}

impl DuckDuckGoProvider {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            base_url: "https://html.duckduckgo.com".to_owned(),
        }
    }

    /// Override the base URL — used by tests to point at a local fixture
    /// server. In production, only the default is exercised.
    pub fn with_base_url(http: reqwest::Client, base_url: impl Into<String>) -> Self {
        Self {
            http,
            base_url: base_url.into(),
        }
    }
}

#[async_trait]
impl SearchProvider for DuckDuckGoProvider {
    fn kind(&self) -> SearchProviderKind {
        SearchProviderKind::DuckDuckGo
    }

    async fn search(&self, request: SearchQuery) -> Result<Vec<SearchResult>, SearchError> {
        let url = format!("{}/html/", self.base_url.trim_end_matches('/'));
        // DuckDuckGo's HTML endpoint accepts POST with form params. Using
        // POST avoids URL-length limits for long queries and matches the
        // form-submission path used by the actual webpage.
        let resp = self
            .http
            .post(&url)
            // DDG rejects empty/missing User-Agent with an "unsupported
            // browser" page; this matches what their own HTML form sends.
            .header(
                "user-agent",
                "Mozilla/5.0 (compatible; HiveBot/1.0; +https://hive.local)",
            )
            .form(&[("q", request.query.as_str())])
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await?;
        if !status.is_success() {
            return Err(SearchError::ProviderStatus {
                status: status.as_u16(),
                body,
            });
        }
        let max = request.max_results.unwrap_or(10) as usize;
        parse(&body, max)
    }
}

/// Parse a DuckDuckGo HTML results page into structured results.
///
/// The HTML endpoint returns a flat list of `.result` blocks. Each has:
/// - `.result__title > a` — the title text + `href` (which on the HTML
///   endpoint is a redirect URL of the form `//duckduckgo.com/l/?uddg=…`).
/// - `.result__snippet` — the description text.
///
/// We extract the *real* destination URL from the `uddg` query parameter
/// of the redirect href so the agent never sees DuckDuckGo's redirect
/// shim (which makes follow-up `web_fetch` calls hit DDG instead of the
/// real source).
pub(crate) fn parse(body: &str, max: usize) -> Result<Vec<SearchResult>, SearchError> {
    let doc = Html::parse_document(body);
    let result_sel = Selector::parse("div.result, div.web-result")
        .map_err(|e| SearchError::Parse(format!("bad result selector: {e:?}")))?;
    let title_sel = Selector::parse("a.result__a, h2 a")
        .map_err(|e| SearchError::Parse(format!("bad title selector: {e:?}")))?;
    let snippet_sel = Selector::parse("a.result__snippet, .result__snippet, .result__body")
        .map_err(|e| SearchError::Parse(format!("bad snippet selector: {e:?}")))?;

    let mut out = Vec::new();
    if max == 0 {
        return Ok(out);
    }
    for block in doc.select(&result_sel) {
        let Some(anchor) = block.select(&title_sel).next() else {
            continue;
        };
        let title = anchor.text().collect::<String>().trim().to_owned();
        let raw_href = anchor.value().attr("href").unwrap_or_default();
        let url = unwrap_ddg_redirect(raw_href);
        let snippet = block
            .select(&snippet_sel)
            .next()
            .map(|n| n.text().collect::<String>().trim().to_owned())
            .unwrap_or_default();
        if title.is_empty() || url.is_empty() {
            continue;
        }
        out.push(SearchResult {
            title,
            url,
            snippet,
            score: None,
        });
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}

/// DDG wraps result URLs in a redirect of the form
/// `//duckduckgo.com/l/?uddg=<encoded-target>&rut=...`. Unwrap to the real
/// target so downstream `web_fetch` hits the source, not DDG.
fn unwrap_ddg_redirect(href: &str) -> String {
    // Strip protocol-relative prefix.
    let trimmed = href.trim_start_matches("//").trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(qpos) = trimmed.find('?') {
        // Walk query params for `uddg=`.
        let query = &trimmed[qpos + 1..];
        for pair in query.split('&') {
            if let Some(rest) = pair.strip_prefix("uddg=") {
                return urlencoding::decode(rest)
                    .map(|c| c.into_owned())
                    .unwrap_or_else(|_| rest.to_owned());
            }
        }
    }
    // Not a redirect: return as-is, prefixing https: if protocol-relative.
    if href.starts_with("//") {
        format!("https:{href}")
    } else {
        href.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_basic_html_results() {
        let html = r#"
            <html><body>
              <div class="result">
                <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&rut=abc">Example Page</a></h2>
                <a class="result__snippet">Snippet text here.</a>
              </div>
              <div class="result">
                <h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fsecond.example%2Fp">Second</a></h2>
                <a class="result__snippet">Second snippet.</a>
              </div>
            </body></html>
        "#;
        let out = parse(html, 10).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].title, "Example Page");
        assert_eq!(out[0].url, "https://example.com/page");
        assert_eq!(out[0].snippet, "Snippet text here.");
        assert_eq!(out[1].url, "https://second.example/p");
    }

    #[test]
    fn respects_max_results() {
        let html = r#"
            <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.example">A</a></h2></div>
            <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fb.example">B</a></h2></div>
            <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fc.example">C</a></h2></div>
        "#;
        let out = parse(html, 2).unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].title, "A");
        assert_eq!(out[1].title, "B");
    }

    #[test]
    fn skips_results_with_empty_title_or_url() {
        let html = r#"
            <div class="result"><h2><a class="result__a" href=""></a></h2></div>
            <div class="result"><h2><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Freal.example">Real</a></h2></div>
        "#;
        let out = parse(html, 10).unwrap();
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].title, "Real");
    }

    #[test]
    fn unwraps_ddg_redirect() {
        assert_eq!(
            unwrap_ddg_redirect("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fp&rut=xx"),
            "https://example.com/p"
        );
    }

    #[test]
    fn passes_through_direct_urls() {
        assert_eq!(
            unwrap_ddg_redirect("https://example.com/direct"),
            "https://example.com/direct"
        );
    }
}
