use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;

use crate::chat::{ChatRequest, ChatRole, StreamChunk, StreamEvent};
use crate::sse::sse_stream;
use crate::{ChatStream, LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct GeminiProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl GeminiProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        Self { http, config }
    }
}

#[derive(Deserialize)]
struct ListResponse {
    #[serde(default)]
    models: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    #[serde(default, rename = "displayName")]
    display_name: Option<String>,
    #[serde(default, rename = "inputTokenLimit")]
    input_token_limit: Option<u32>,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_methods: Vec<String>,
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: ListResponse =
        serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .models
        .into_iter()
        .filter(|e| e.supported_methods.iter().any(|m| m == "generateContent"))
        .map(|e| {
            let id = e.name.strip_prefix("models/").unwrap_or(&e.name).to_owned();
            ModelInfo {
                label: e.display_name.unwrap_or_else(|| id.clone()),
                id,
                context_window: e.input_token_limit,
                supports_tools: true,
                supports_streaming: true,
            }
        })
        .collect())
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Gemini
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!(
            "{}/v1beta/models?key={}",
            self.config.base_url.trim_end_matches('/'),
            key,
        );
        let response = self.http.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus {
                status: status.as_u16(),
                body,
            });
        }
        let body = response.text().await?;
        parse_models(&body)
    }

    async fn chat_stream(&self, request: ChatRequest) -> Result<ChatStream, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse&key={}",
            self.config.base_url.trim_end_matches('/'),
            request.model,
            key,
        );

        let mut contents: Vec<serde_json::Value> = Vec::new();
        let mut system_parts: Vec<String> = Vec::new();
        for msg in &request.messages {
            match msg.role {
                ChatRole::System => system_parts.push(msg.content.clone()),
                ChatRole::User | ChatRole::Tool => contents.push(serde_json::json!({
                    "role": "user",
                    "parts": [{ "text": msg.content }],
                })),
                ChatRole::Assistant => contents.push(serde_json::json!({
                    "role": "model",
                    "parts": [{ "text": msg.content }],
                })),
            }
        }

        let mut body = serde_json::json!({ "contents": contents });
        if !system_parts.is_empty() {
            body["systemInstruction"] = serde_json::json!({
                "parts": [{ "text": system_parts.join("\n") }],
            });
        }
        let mut generation: serde_json::Map<String, serde_json::Value> = serde_json::Map::new();
        if let Some(t) = request.temperature {
            generation.insert("temperature".into(), serde_json::json!(t));
        }
        if let Some(m) = request.max_tokens {
            generation.insert("maxOutputTokens".into(), serde_json::json!(m));
        }
        if !generation.is_empty() {
            body["generationConfig"] = serde_json::Value::Object(generation);
        }

        let response = self
            .http
            .post(url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body_text = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus {
                status: status.as_u16(),
                body: body_text,
            });
        }

        let byte_stream = response.bytes_stream();
        let sse = sse_stream(byte_stream);
        let mapped = sse.flat_map(|item| {
            let results: Vec<Result<StreamEvent, LlmError>> = match item {
                Err(e) => vec![Err(LlmError::Http(e))],
                Ok(msg) => parse_event(&msg).into_iter().map(Ok).collect(),
            };
            futures_util::stream::iter(results)
        });
        Ok(Box::pin(mapped))
    }
}

fn parse_event(msg: &crate::sse::SseMessage) -> Vec<StreamEvent> {
    if msg.data.is_empty() {
        return vec![];
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&msg.data) else {
        return vec![];
    };

    let mut out = Vec::new();

    if let Some(text) = value
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
    {
        if !text.is_empty() {
            out.push(StreamEvent::Delta(StreamChunk {
                delta: text.to_owned(),
            }));
        }
    }

    if let Some(usage) = value.get("usageMetadata") {
        let tokens_in = usage
            .get("promptTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let tokens_out = usage
            .get("candidatesTokenCount")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let finish = value
            .get("candidates")
            .and_then(|c| c.get(0))
            .and_then(|c| c.get("finishReason"))
            .and_then(|r| r.as_str())
            .map(str::to_owned);
        if finish.is_some() || tokens_out > 0 {
            out.push(StreamEvent::Complete {
                tokens_in,
                tokens_out,
                finish_reason: finish,
            });
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_by_generate_content_and_strips_prefix() {
        let body = r#"{"models":[
            {"name":"models/gemini-1.5-pro","displayName":"Gemini 1.5 Pro","inputTokenLimit":2000000,"supportedGenerationMethods":["generateContent","countTokens"]},
            {"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]},
            {"name":"models/gemini-1.5-flash","supportedGenerationMethods":["generateContent"]}
        ]}"#;
        let models = parse_models(body).unwrap();
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, vec!["gemini-1.5-pro", "gemini-1.5-flash"]);
        assert_eq!(models[0].context_window, Some(2_000_000));
        assert_eq!(models[0].label, "Gemini 1.5 Pro");
        assert_eq!(models[1].label, "gemini-1.5-flash");
    }

    #[test]
    fn missing_models_field_yields_empty() {
        assert!(parse_models(r#"{}"#).unwrap().is_empty());
    }

    #[test]
    fn invalid_json_is_parse_error() {
        assert!(matches!(parse_models("nope"), Err(LlmError::Parse(_))));
    }
}
