//! Web tools: `web_fetch` (HTTP GET + minimal HTML→text cleanup) and
//! `web_search` (delegates to a `hive_search::SearchProvider` the runtime
//! supplies via the `ToolContext` when the tool is constructed).

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use hive_search::{SearchProvider, SearchQuery};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

const DEFAULT_FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_MAX_BODY: usize = 256 * 1024;

// ── web_fetch ────────────────────────────────────────────────────────────

pub struct WebFetchTool {
    http: reqwest::Client,
}

impl WebFetchTool {
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }

    pub fn with_default_client() -> Self {
        let http = reqwest::Client::builder()
            .timeout(DEFAULT_FETCH_TIMEOUT)
            .user_agent("hive-agent/1.0 (+https://github.com/fibo3090-code/fresh-start)")
            .build()
            .expect("reqwest client builds");
        Self::new(http)
    }
}

impl Default for WebFetchTool {
    fn default() -> Self {
        Self::with_default_client()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebFetchArgs {
    url: String,
    #[serde(default)]
    max_bytes: Option<usize>,
}

#[async_trait]
impl Tool for WebFetchTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "web_fetch".into(),
            description: "Fetch a web page and return its text content. \
                HTML is roughly stripped to plain text; large pages are \
                truncated (default 256 KiB)."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Absolute http(s) URL to fetch.",
                    },
                    "maxBytes": {
                        "type": "integer",
                        "description": "Maximum bytes of body text to keep (default 262144).",
                    },
                },
                "required": ["url"],
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolResult<Value> {
        let args: WebFetchArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        if !(args.url.starts_with("http://") || args.url.starts_with("https://")) {
            return Err(ToolError::InvalidArgs(
                "url must be absolute http(s)".into(),
            ));
        }
        let response = self
            .http
            .get(&args.url)
            .send()
            .await
            .map_err(|e| ToolError::Other(format!("request: {e}")))?;
        let status = response.status();
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let raw = response
            .text()
            .await
            .map_err(|e| ToolError::Other(format!("body: {e}")))?;

        let limit = args.max_bytes.unwrap_or(DEFAULT_MAX_BODY);
        let cleaned = if content_type.contains("text/html") {
            strip_html(&raw)
        } else {
            raw
        };
        let total_chars = cleaned.chars().count();
        let truncated_text: String = cleaned.chars().take(limit).collect();

        Ok(json!({
            "url": args.url,
            "status": status.as_u16(),
            "contentType": content_type,
            "text": truncated_text,
            "chars": total_chars,
            "truncated": total_chars > limit,
        }))
    }
}

/// Minimal HTML → text cleanup. Good enough for an LLM to extract the
/// topic of the page; NOT a full readability pass. Cheap: no extra deps.
pub(crate) fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len() / 2);
    let mut in_tag = false;
    let mut in_script_or_style = false;
    let mut tag_name = String::new();
    let mut tag_close = false;

    for ch in html.chars() {
        match (in_tag, ch) {
            (false, '<') => {
                in_tag = true;
                tag_name.clear();
                tag_close = false;
            }
            (true, '>') => {
                in_tag = false;
                let lower = tag_name.to_ascii_lowercase();
                if matches!(lower.as_str(), "script" | "style") {
                    in_script_or_style = !tag_close;
                }
                // Treat block-ish tags as paragraph breaks for readability.
                if matches!(
                    lower.as_str(),
                    "p" | "br" | "div" | "li" | "tr" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
                ) {
                    out.push('\n');
                }
            }
            (true, '/') if tag_name.is_empty() => tag_close = true,
            (true, c) if c.is_alphanumeric() || c == '-' || c == '_' => tag_name.push(c),
            (true, _) => {}
            (false, c) if !in_script_or_style => out.push(c),
            (false, _) => {}
        }
    }

    // Collapse runs of whitespace.
    let mut collapsed = String::with_capacity(out.len());
    let mut last_was_space = false;
    for c in out.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                collapsed.push(' ');
                last_was_space = true;
            }
        } else {
            collapsed.push(c);
            last_was_space = false;
        }
    }
    collapsed.trim().to_string()
}

// ── web_search ───────────────────────────────────────────────────────────

/// Thin wrapper over a `hive_search::SearchProvider`. The runtime owns
/// the provider — typically one instance per project, reconfigured when
/// the user switches Tavily ↔ SearxNG in Settings.
pub struct WebSearchTool {
    provider: Arc<dyn SearchProvider>,
}

impl WebSearchTool {
    pub fn new(provider: Arc<dyn SearchProvider>) -> Self {
        Self { provider }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebSearchArgs {
    query: String,
    #[serde(default)]
    max_results: Option<u32>,
}

#[async_trait]
impl Tool for WebSearchTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "web_search".into(),
            description: "Search the public web and return the top \
                matching URLs with titles and snippets. Use this for \
                fact-finding, then `web_fetch` on a specific URL for the \
                full text."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language search query.",
                    },
                    "maxResults": {
                        "type": "integer",
                        "description": "Cap on results. Providers may cap further.",
                    },
                },
                "required": ["query"],
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolResult<Value> {
        let args: WebSearchArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        let q = SearchQuery {
            query: args.query.clone(),
            max_results: args.max_results,
        };
        let results = self
            .provider
            .search(q)
            .await
            .map_err(|e| ToolError::Other(format!("search: {e}")))?;
        Ok(json!({
            "query": args.query,
            "provider": format!("{:?}", self.provider.kind()).to_lowercase(),
            "results": results,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_html_drops_script_and_style() {
        let html = r#"<html><head><style>body{}</style><script>alert(1)</script></head>
            <body><h1>Title</h1><p>Hello <b>world</b>.</p></body></html>"#;
        let text = strip_html(html);
        assert!(text.contains("Title"));
        assert!(text.contains("Hello world."));
        assert!(!text.contains("alert(1)"));
        assert!(!text.contains("body{}"));
    }

    #[test]
    fn strip_html_collapses_whitespace() {
        let text = strip_html("<p>a \n \n b</p>");
        assert_eq!(text, "a b");
    }

    #[test]
    fn strip_html_preserves_paragraph_breaks_as_spaces() {
        let t = strip_html("<p>A</p><p>B</p>");
        assert_eq!(t, "A B");
    }
}
