//! Web tools: `web_fetch` (HTTP GET + minimal HTML→text cleanup) and
//! `web_search` (delegates to a `hive_search::SearchProvider` the runtime
//! supplies via the `ToolContext` when the tool is constructed).

use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use futures_util::StreamExt;
use hive_search::{SearchProvider, SearchQuery};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

const DEFAULT_FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const DEFAULT_MAX_BODY: usize = 256 * 1024;
/// Hard ceiling on bytes read from the wire, regardless of the LLM-supplied
/// `maxBytes`. Protects against multi-GB downloads.
const FETCH_HARD_CAP_BYTES: usize = 5 * 1024 * 1024;

/// Reject any IP a remote-fetching tool shouldn't touch: loopback, RFC1918
/// private, link-local (incl. 169.254.169.254 — AWS/GCP metadata),
/// unspecified, broadcast, multicast, and (IPv6) unique-local + link-local.
/// Defends against SSRF / DNS-rebinding / self-recursion into the local API
/// (which has no auth).
fn is_private_or_internal(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                || *v4 == Ipv4Addr::new(255, 255, 255, 255)
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // Unique-local (fc00::/7)
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // Link-local (fe80::/10)
                || (v6.segments()[0] & 0xffc0) == 0xfe80
                // IPv4-mapped — re-classify the mapped v4
                || v6
                    .to_ipv4_mapped()
                    .map(|m| is_private_or_internal(&IpAddr::V4(m)))
                    .unwrap_or(false)
        }
    }
}

/// Resolve the URL's host (literal IP or hostname) to IPs and reject if any
/// resolved IP is private/internal. Returns the resolved IPs on success so the
/// caller could pin them (we don't yet — `reqwest` re-resolves — but if a DNS
/// rebinder flips the answer between this resolve and reqwest's, the second
/// answer would also need to win a race, which is rare in practice).
async fn validate_url_destination(url: &reqwest::Url) -> ToolResult<()> {
    let Some(host) = url.host_str() else {
        return Err(ToolError::InvalidArgs("url has no host".into()));
    };
    let port = url.port_or_known_default().unwrap_or(80);

    // IP literal? Validate directly without DNS.
    if let Ok(ip) = host.parse::<IpAddr>() {
        if is_private_or_internal(&ip) {
            return Err(ToolError::Other(format!(
                "refusing to fetch private/internal address {ip}"
            )));
        }
        return Ok(());
    }

    // Hostname → resolve and check every answer.
    let target = format!("{host}:{port}");
    let mut any_resolved = false;
    let addrs = tokio::net::lookup_host(&target)
        .await
        .map_err(|e| ToolError::Other(format!("dns lookup for {host}: {e}")))?;
    for sock in addrs {
        any_resolved = true;
        if is_private_or_internal(&sock.ip()) {
            return Err(ToolError::Other(format!(
                "refusing to fetch {host} — resolves to a private/internal address ({})",
                sock.ip()
            )));
        }
    }
    if !any_resolved {
        return Err(ToolError::Other(format!("could not resolve {host}")));
    }
    Ok(())
}

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
        let url = reqwest::Url::parse(&args.url)
            .map_err(|e| ToolError::InvalidArgs(format!("invalid url: {e}")))?;
        match url.scheme() {
            "http" | "https" => {}
            _ => return Err(ToolError::InvalidArgs("url must be http or https".into())),
        }

        // SSRF / metadata / self-recursion guard: refuse private IPs, loopback,
        // link-local (incl. cloud metadata endpoints), unique-local IPv6, etc.
        validate_url_destination(&url).await?;

        let response = self
            .http
            .get(url.clone())
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

        // Stream the body and stop as soon as we cross the hard cap, so a
        // malicious server can't push a multi-GB body before we react.
        let mut buf: Vec<u8> = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| ToolError::Other(format!("body chunk: {e}")))?;
            let take = chunk
                .len()
                .min(FETCH_HARD_CAP_BYTES.saturating_sub(buf.len()));
            buf.extend_from_slice(&chunk[..take]);
            if buf.len() >= FETCH_HARD_CAP_BYTES {
                break;
            }
        }
        let raw = String::from_utf8_lossy(&buf).into_owned();

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
            "bytesRead": buf.len(),
            "hardCapped": buf.len() >= FETCH_HARD_CAP_BYTES,
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
