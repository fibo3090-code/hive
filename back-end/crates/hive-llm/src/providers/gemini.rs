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
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default, rename = "inputTokenLimit")]
    input_token_limit: Option<u32>,
    #[serde(default, rename = "supportedGenerationMethods")]
    supported_methods: Vec<String>,
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
            return Err(LlmError::ProviderStatus { status: status.as_u16(), body });
        }
        let parsed: ListResponse = response.json().await?;
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
}
