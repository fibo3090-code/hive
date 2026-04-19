use async_trait::async_trait;
use serde::Deserialize;

use crate::{LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct OpenAiProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl OpenAiProvider {
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
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<ModelInfo>, LlmError> {
    let parsed: ListResponse =
        serde_json::from_str(body).map_err(|e| LlmError::Parse(e.to_string()))?;
    Ok(parsed
        .data
        .into_iter()
        .filter(|e| {
            let id = e.id.to_ascii_lowercase();
            id.starts_with("gpt-")
                || id.starts_with("o1")
                || id.starts_with("o3")
                || id.starts_with("chatgpt")
        })
        .map(|e| ModelInfo {
            label: e.id.clone(),
            id: e.id,
            context_window: None,
            supports_tools: true,
            supports_streaming: true,
        })
        .collect())
}

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Openai
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/models", self.config.base_url.trim_end_matches('/'));
        let response = self.http.get(url).bearer_auth(key).send().await?;
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
    fn filters_chat_models_and_drops_others() {
        let body = r#"{"data":[
            {"id":"gpt-4o"},
            {"id":"gpt-4o-mini"},
            {"id":"o1-preview"},
            {"id":"o3-mini"},
            {"id":"chatgpt-4o-latest"},
            {"id":"text-embedding-3-small"},
            {"id":"dall-e-3"},
            {"id":"whisper-1"}
        ]}"#;
        let models = parse_models(body).unwrap();
        let ids: Vec<_> = models.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![
                "gpt-4o",
                "gpt-4o-mini",
                "o1-preview",
                "o3-mini",
                "chatgpt-4o-latest"
            ]
        );
        assert!(models
            .iter()
            .all(|m| m.supports_tools && m.supports_streaming));
    }

    #[test]
    fn empty_data_yields_empty_list() {
        assert_eq!(parse_models(r#"{"data":[]}"#).unwrap().len(), 0);
    }

    #[test]
    fn invalid_json_returns_parse_error() {
        assert!(matches!(parse_models("not json"), Err(LlmError::Parse(_))));
    }
}
