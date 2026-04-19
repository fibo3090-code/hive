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

#[async_trait]
impl LlmProvider for OpenAiProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Openai
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let key = self.config.api_key.as_deref().ok_or(LlmError::MissingKey)?;
        let url = format!("{}/v1/models", self.config.base_url.trim_end_matches('/'));
        let response = self
            .http
            .get(url)
            .bearer_auth(key)
            .send()
            .await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus { status: status.as_u16(), body });
        }
        let parsed: ListResponse = response.json().await?;
        Ok(parsed
            .data
            .into_iter()
            .filter(|e| {
                let id = e.id.to_ascii_lowercase();
                id.starts_with("gpt-") || id.starts_with("o1") || id.starts_with("o3") || id.starts_with("chatgpt")
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
}
