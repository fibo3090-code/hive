use async_trait::async_trait;
use serde::Deserialize;

use crate::{LlmError, LlmProvider, ModelInfo, ProviderConfig, ProviderKind};

pub struct OllamaProvider {
    http: reqwest::Client,
    config: ProviderConfig,
}

impl OllamaProvider {
    pub fn new(http: reqwest::Client, config: ProviderConfig) -> Self {
        Self { http, config }
    }
}

#[derive(Deserialize)]
struct TagsResponse {
    #[serde(default)]
    models: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    name: String,
    #[serde(default)]
    details: Option<Details>,
}

#[derive(Deserialize)]
struct Details {
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    parameter_size: Option<String>,
}

#[async_trait]
impl LlmProvider for OllamaProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Ollama
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
        let url = format!("{}/api/tags", self.config.base_url.trim_end_matches('/'));
        let response = self.http.get(url).send().await?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(LlmError::ProviderStatus { status: status.as_u16(), body });
        }
        let parsed: TagsResponse = response.json().await?;
        Ok(parsed
            .models
            .into_iter()
            .map(|e| {
                let suffix = e.details.as_ref().and_then(|d| {
                    match (d.family.as_deref(), d.parameter_size.as_deref()) {
                        (Some(fam), Some(size)) => Some(format!(" ({fam} · {size})")),
                        (Some(fam), None) => Some(format!(" ({fam})")),
                        (None, Some(size)) => Some(format!(" ({size})")),
                        _ => None,
                    }
                });
                let label = match suffix {
                    Some(s) => format!("{}{s}", e.name),
                    None => e.name.clone(),
                };
                let name_lower = e.name.to_ascii_lowercase();
                let supports_tools = name_lower.contains("llama3.1")
                    || name_lower.contains("llama3.2")
                    || name_lower.contains("qwen2.5")
                    || name_lower.contains("mistral-nemo")
                    || name_lower.contains("command-r");
                ModelInfo {
                    id: e.name,
                    label,
                    context_window: None,
                    supports_tools,
                    supports_streaming: true,
                }
            })
            .collect())
    }
}
