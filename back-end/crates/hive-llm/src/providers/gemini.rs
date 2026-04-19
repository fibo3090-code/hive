use async_trait::async_trait;
use serde::Deserialize;

use crate::{LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

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
