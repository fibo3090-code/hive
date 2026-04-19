use async_trait::async_trait;
use serde::Deserialize;

use crate::{LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct AnthropicProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl AnthropicProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        Self { http, config }
    }
}

#[derive(Deserialize)]
struct ListResponse {
    data: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: ListResponse = serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .data
        .into_iter()
        .map(|e| ModelInfo {
            label: e.display_name.clone().unwrap_or_else(|| e.id.clone()),
            id: e.id,
            context_window: None,
            supports_tools: true,
            supports_streaming: true,
        })
        .collect())
}

#[async_trait]
impl LlmProvider for AnthropicProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/models", self.config.base_url.trim_end_matches('/'));
        let response = self
            .http
            .get(url)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus { status: status.as_u16(), body });
        }
        let body = response.text().await?;
        parse_models(&body)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_display_name_when_present_falls_back_to_id() {
        let body = r#"{"data":[
            {"id":"claude-sonnet-4-6","display_name":"Claude Sonnet 4.6"},
            {"id":"claude-opus-4-7"}
        ]}"#;
        let models = parse_models(body).unwrap();
        assert_eq!(models[0].id, "claude-sonnet-4-6");
        assert_eq!(models[0].label, "Claude Sonnet 4.6");
        assert_eq!(models[1].id, "claude-opus-4-7");
        assert_eq!(models[1].label, "claude-opus-4-7");
    }

    #[test]
    fn empty_data_ok() {
        assert!(parse_models(r#"{"data":[]}"#).unwrap().is_empty());
    }

    #[test]
    fn invalid_json_is_parse_error() {
        assert!(matches!(parse_models("{"), Err(LlmError::Parse(_))));
    }
}
