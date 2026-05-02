//! Minimal SSE line-framer used by provider streaming clients.
//!
//! Upstream HTTP bodies arrive as `Stream<Item = Result<Bytes, reqwest::Error>>`.
//! Providers (Anthropic, OpenAI, Gemini) encode their streams as Server-Sent
//! Events: lines separated by `\n`, events separated by blank lines, payload
//! lines prefixed with `data: `. We decode into `(event, data)` pairs.

use bytes::Bytes;
use futures_core::Stream;
use futures_util::StreamExt;

#[derive(Clone, Debug, Default)]
pub struct SseMessage {
    pub event: Option<String>,
    pub data: String,
}

/// Parse the accumulated buffer and return any complete SSE messages plus the
/// remaining (possibly partial) tail.
fn take_messages(buffer: &mut String) -> Vec<SseMessage> {
    let mut out = Vec::new();
    loop {
        let Some(end) = find_boundary(buffer) else {
            break;
        };
        let (frame, rest_start) = end;
        let frame_text = buffer[..frame].to_string();
        buffer.drain(..rest_start);
        if let Some(msg) = parse_frame(&frame_text) {
            out.push(msg);
        }
    }
    out
}

/// Return `(frame_end, rest_start)` — bytes `0..frame_end` contain the frame,
/// bytes `rest_start..` are what's left in the buffer.
fn find_boundary(buffer: &str) -> Option<(usize, usize)> {
    if let Some(idx) = buffer.find("\n\n") {
        return Some((idx, idx + 2));
    }
    if let Some(idx) = buffer.find("\r\n\r\n") {
        return Some((idx, idx + 4));
    }
    None
}

fn parse_frame(frame: &str) -> Option<SseMessage> {
    let mut msg = SseMessage::default();
    let mut data_lines: Vec<&str> = Vec::new();
    for line in frame.split('\n') {
        let line = line.trim_end_matches('\r');
        if line.is_empty() || line.starts_with(':') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("event:") {
            msg.event = Some(rest.trim().to_owned());
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
        }
    }
    if data_lines.is_empty() && msg.event.is_none() {
        // Likely a heartbeat-only frame (`: ping\n\n`) or a comment
        // line we trimmed. Surface at trace level so the operator can
        // see them when they care without polluting info logs.
        tracing::trace!(raw = %frame, "sse: skipping frame with no data or event");
        return None;
    }
    msg.data = data_lines.join("\n");
    Some(msg)
}

/// Adapt an upstream HTTP byte stream into a stream of parsed `SseMessage`.
pub fn sse_stream<S>(body: S) -> impl Stream<Item = Result<SseMessage, reqwest::Error>>
where
    S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
{
    async_stream::stream! {
        let mut buffer = String::new();
        let mut pending: std::collections::VecDeque<SseMessage> = std::collections::VecDeque::new();
        let mut body = Box::pin(body);
        loop {
            if let Some(msg) = pending.pop_front() {
                yield Ok(msg);
                continue;
            }
            match body.next().await {
                Some(Ok(chunk)) => {
                    if let Ok(text) = std::str::from_utf8(&chunk) {
                        buffer.push_str(text);
                    } else {
                        buffer.push_str(&String::from_utf8_lossy(&chunk));
                    }
                    for msg in take_messages(&mut buffer) {
                        pending.push_back(msg);
                    }
                }
                Some(Err(e)) => {
                    yield Err(e);
                    break;
                }
                None => break,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_single_frame() {
        let mut buf = "event: foo\ndata: hello\n\n".to_owned();
        let msgs = take_messages(&mut buf);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].event.as_deref(), Some("foo"));
        assert_eq!(msgs[0].data, "hello");
        assert!(buf.is_empty());
    }

    #[test]
    fn parses_multiline_data() {
        let mut buf = "data: a\ndata: b\n\n".to_owned();
        let msgs = take_messages(&mut buf);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].data, "a\nb");
    }

    #[test]
    fn keeps_partial_tail() {
        let mut buf = "data: full\n\ndata: part".to_owned();
        let msgs = take_messages(&mut buf);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].data, "full");
        assert_eq!(buf, "data: part");
    }

    #[test]
    fn ignores_comments_and_empty() {
        let mut buf = ": heartbeat\n\ndata: x\n\n".to_owned();
        let msgs = take_messages(&mut buf);
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0].data, "x");
    }
}
