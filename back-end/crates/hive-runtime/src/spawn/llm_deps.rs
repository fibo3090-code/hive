//! LLM-driven implementation of the auto-spawn pipeline dependencies.
//!
//! Uses a real LLM provider to plan needs, discover APIs (via search),
//! synthesize MCP manifests/code, and compose system prompts.

use std::sync::Arc;

use async_trait::async_trait;
use hive_db::{
    repos::agents::{self, CreateAgent},
    Db,
};
use hive_llm::{
    chat::{ChatMessage, ChatRequest},
    LlmProvider,
};
use hive_search::{SearchProvider, SearchQuery};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    registry::ExecutorRegistry,
    spawn::driver::{DiscoveredApi, PipelineContext, PipelineDeps, PipelineError, SynthesizedMcp},
};

#[derive(Debug, Deserialize, Clone, Serialize)]
pub struct BlueprintEntry {
    pub id: String,
    pub name: String,
    pub role: String,
    pub model: String,
    pub description: String,
    pub traits: Vec<String>,
    pub icon: String,
}

pub struct LlmPipelineDeps {
    pub provider: Arc<dyn LlmProvider>,
    pub model: String,
    pub search: Option<Arc<dyn SearchProvider>>,
    pub executors: Arc<ExecutorRegistry>,
    pub blueprints: Vec<BlueprintEntry>,
    /// Domains like "api.github.com" that don't require manual approval.
    pub api_domain_whitelist: Vec<String>,
    pub db: Db,
}

#[async_trait]
impl PipelineDeps for LlmPipelineDeps {
    async fn plan_needs(&self, ctx: &PipelineContext) -> Result<Vec<String>, PipelineError> {
        let system = "You are the HIVE capability planner. \
Decide which external capabilities a new specialist agent needs based on its role and context. \
Capabilities should be high-level strings like 'weather', 'crypto-prices', 'github-issues'. \
Respond with ONLY a JSON object matching this shape: \
{\"capabilities\": [\"capability-name\", ...]}";

        let user = format!(
            "Role: {}\nCapabilities requested by parent: {:?}\nMCP strategy: {}\nProject ID: {}\nParent agent ID: {:?}\nSpawn request ID: {}",
            ctx.requested_role,
            ctx.requested_capabilities,
            ctx.mcp_strategy,
            ctx.project_id,
            ctx.parent_agent_id,
            ctx.spawn_request_id
        );

        let res: CapabilityResponse = self.chat_json(system, &user).await?;
        Ok(res.capabilities)
    }

    async fn research_apis(
        &self,
        _ctx: &PipelineContext,
        unmatched: &[String],
    ) -> Result<Vec<DiscoveredApi>, PipelineError> {
        let Some(ref search) = self.search else {
            return Ok(Vec::new());
        };

        let mut out = Vec::new();
        // For each capability, we search and then ask the LLM to pick the best API.
        for cap in unmatched {
            let query = format!("public api {cap} openapi");
            let results = search
                .search(SearchQuery {
                    query,
                    max_results: Some(3),
                })
                .await
                .map_err(|e| PipelineError::Dep(format!("search failed: {e}")))?;

            if results.is_empty() {
                continue;
            }

            let snippets: Vec<String> = results
                .iter()
                .map(|r| format!("Title: {}\nURL: {}\nSnippet: {}", r.title, r.url, r.snippet))
                .collect();

            let system = "You are an API discovery specialist. \
Given search results for a capability, propose ONE public API. \
Return ONLY a JSON object: { \"url\": \"...\", \"spec\": { \"info\": { \"title\": \"...\" }, \"paths\": { ... } } }. \
The spec should be a minimal OpenAPI-like fragment describing the core functionality.";

            let user = format!(
                "Capability: {}\nSearch results:\n{}",
                cap,
                snippets.join("\n\n")
            );

            let picked: DiscoveredApiResponse = self.chat_json(system, &user).await?;

            let requires_approval = !self
                .api_domain_whitelist
                .iter()
                .any(|d| picked.url.contains(d));

            out.push(DiscoveredApi {
                capability: cap.clone(),
                url: picked.url,
                spec: picked.spec,
                requires_approval,
            });
        }

        Ok(out)
    }

    async fn synthesize_mcp(
        &self,
        _ctx: &PipelineContext,
        apis: &[DiscoveredApi],
    ) -> Result<Vec<SynthesizedMcp>, PipelineError> {
        let mut out = Vec::new();
        for api in apis {
            let system = "You are an MCP synthesis specialist. \
Given a public API URL and spec fragment, produce an MCP server definition. \
The handlerCode should be Rust source for a minimal proxy that could call this API. \
Respond with ONLY a JSON object: \
{ \"name\": \"...\", \"slug\": \"...\", \"manifest\": { \"tools\": [...] }, \"handlerCode\": \"...\" }";

            let user = format!("URL: {}\nSpec: {:?}", api.url, api.spec);

            let res: SynthesizedMcpResponse = self.chat_json(system, &user).await?;

            out.push(SynthesizedMcp {
                name: res.name,
                slug: res.slug,
                source_api_url: Some(api.url.clone()),
                source_api_spec: Some(api.spec.clone()),
                generated_manifest: res.manifest,
                generated_handler_code: res.handler_code,
                capabilities: vec![api.capability.clone()],
            });
        }
        Ok(out)
    }

    async fn compose_prompt(
        &self,
        ctx: &PipelineContext,
        bound_mcp_ids: &[String],
    ) -> Result<String, PipelineError> {
        let system = "You are a specialist prompt architect. \
Compose a high-quality system prompt for a new AI agent based on its role and context. \
The prompt should define its identity, mission, operating loop, and the external capabilities it has actually been bound to. \
Do not mention tools or capabilities that are not listed in the context.";

        let user = format!(
            "Requested role: {}\nRequested capabilities: {:?}\nBound MCP server ids: {:?}\nMCP strategy: {}\nProject ID: {}\nParent agent ID: {:?}\nSpawn request ID: {}",
            ctx.requested_role,
            ctx.requested_capabilities,
            bound_mcp_ids,
            ctx.mcp_strategy,
            ctx.project_id,
            ctx.parent_agent_id,
            ctx.spawn_request_id
        );

        let req = ChatRequest::new(
            self.model.clone(),
            vec![
                ChatMessage::system(system.to_owned()),
                ChatMessage::user(user),
            ],
        );

        let res = self
            .provider
            .chat(req)
            .await
            .map_err(|e| PipelineError::Dep(e.to_string()))?;

        Ok(res.text)
    }

    async fn materialize_agent(
        &self,
        ctx: &PipelineContext,
        system_prompt: &str,
        _bound_mcp_ids: &[String],
    ) -> Result<String, PipelineError> {
        // Resolve blueprint based on role.
        let blueprint = self.resolve_blueprint(&ctx.requested_role);

        let agent = agents::create(
            self.db.conn(),
            CreateAgent {
                project_id: ctx.project_id.clone(),
                slug: format!(
                    "{}-{}",
                    ctx.requested_role.to_lowercase(),
                    ulid::Ulid::new().to_string().to_lowercase()
                ),
                name: format!("{} (Specialist)", ctx.requested_role),
                role: ctx.requested_role.clone(),
                model: blueprint.model.clone(),
                status: "active".to_owned(),
                parent_agent_id: ctx.parent_agent_id.clone(),
                spawned_by_message_id: None, // could be passed in context if needed
                enabled_tools: Some(vec![]), // Tools are handled via MCP bindings in the driver
                system_prompt: Some(system_prompt.to_owned()),
                model_provider_id: None,
                model_id: None,
            },
        )
        .await?;

        self.executors
            .ensure_with_parent(&agent.id, &ctx.project_id, ctx.parent_agent_id.as_deref())
            .await;

        Ok(agent.id)
    }
}

fn json_payload(text: &str) -> &str {
    let trimmed = text.trim();
    if let Some(inner) = trimmed
        .strip_prefix("```json")
        .and_then(|s| s.strip_suffix("```"))
    {
        return inner.trim();
    }
    if let Some(inner) = trimmed
        .strip_prefix("```")
        .and_then(|s| s.strip_suffix("```"))
    {
        return inner.trim();
    }
    trimmed
}

impl LlmPipelineDeps {
    async fn chat_json<T: for<'de> Deserialize<'de>>(
        &self,
        system: &str,
        user: &str,
    ) -> Result<T, PipelineError> {
        let req = ChatRequest::new(
            self.model.clone(),
            vec![
                ChatMessage::system(system.to_owned()),
                ChatMessage::user(user.to_owned()),
            ],
        );

        let res = self
            .provider
            .chat(req)
            .await
            .map_err(|e| PipelineError::Dep(e.to_string()))?;

        match serde_json::from_str::<T>(json_payload(&res.text)) {
            Ok(val) => Ok(val),
            Err(err) => {
                // Retry once
                let retry_user = format!(
                    "{}\n\nYour previous response failed to parse as JSON: {}. \
                     Please respond with ONLY the valid JSON object.",
                    user, err
                );
                let retry_req = ChatRequest::new(
                    self.model.clone(),
                    vec![
                        ChatMessage::system(system.to_owned()),
                        ChatMessage::user(retry_user),
                    ],
                );
                let retry_res = self
                    .provider
                    .chat(retry_req)
                    .await
                    .map_err(|e| PipelineError::Dep(e.to_string()))?;

                serde_json::from_str::<T>(json_payload(&retry_res.text)).map_err(|e| {
                    PipelineError::Dep(format!("JSON parse failed after retry: {}", e))
                })
            }
        }
    }

    fn resolve_blueprint(&self, role: &str) -> &BlueprintEntry {
        let normalized = role.to_lowercase();
        let target_id = if normalized.contains("research") {
            "bp-research"
        } else if normalized.contains("architect") {
            "bp-architect"
        } else if normalized.contains("product") {
            "bp-product"
        } else if normalized.contains("frontend") || normalized.contains("ui") {
            "bp-frontend"
        } else if normalized.contains("backend") || normalized.contains("api") {
            "bp-backend"
        } else if normalized.contains("qa") || normalized.contains("test") {
            "bp-qa"
        } else {
            "bp-backend" // fallback
        };

        self.blueprints
            .iter()
            .find(|b| b.id == target_id)
            .or_else(|| self.blueprints.first())
            .expect("at least one blueprint should exist")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::Stream;
    use hive_llm::{ChatResponse, LlmError, ModelInfo, ProviderKind, StreamEvent};
    use hive_search::{SearchError, SearchProviderKind, SearchResult};
    use std::pin::Pin;
    use std::sync::Mutex;

    struct MockLlm {
        responses: Mutex<Vec<String>>,
    }

    #[async_trait]
    impl LlmProvider for MockLlm {
        fn kind(&self) -> ProviderKind {
            ProviderKind::Openai
        }
        async fn chat(&self, _req: ChatRequest) -> Result<ChatResponse, LlmError> {
            let mut resps = self.responses.lock().unwrap();
            if resps.is_empty() {
                return Err(LlmError::Unsupported("no more responses".into()));
            }
            let text = resps.remove(0);
            Ok(ChatResponse {
                text,
                tool_calls: vec![],
                finish_reason: None,
                tokens_in: 0,
                tokens_out: 0,
            })
        }
        async fn chat_stream(
            &self,
            _req: ChatRequest,
        ) -> Result<Pin<Box<dyn Stream<Item = Result<StreamEvent, LlmError>> + Send>>, LlmError>
        {
            unimplemented!()
        }

        async fn list_models(&self) -> Result<Vec<ModelInfo>, LlmError> {
            Ok(vec![])
        }
    }

    struct MockSearch {
        results: Vec<SearchResult>,
    }

    #[async_trait]
    impl SearchProvider for MockSearch {
        fn kind(&self) -> SearchProviderKind {
            SearchProviderKind::Searxng
        }
        async fn search(&self, _req: SearchQuery) -> Result<Vec<SearchResult>, SearchError> {
            Ok(self.results.clone())
        }
    }

    async fn fresh_db() -> Db {
        Db::connect("sqlite::memory:", true)
            .await
            .expect("connect + migrate")
    }

    #[tokio::test]
    async fn test_plan_needs_success() {
        let db = fresh_db().await;
        let llm = Arc::new(MockLlm {
            responses: Mutex::new(vec![
                r#"{"capabilities": ["weather", "geocoding"]}"#.to_owned()
            ]),
        });
        let bus = crate::events::EventBus::new(tokio::sync::broadcast::channel(10).0);
        let deps = LlmPipelineDeps {
            provider: llm,
            model: "gpt-4".to_owned(),
            search: None,
            executors: Arc::new(ExecutorRegistry::new(db.clone(), bus)),
            blueprints: vec![],
            api_domain_whitelist: vec![],
            db,
        };
        let ctx = PipelineContext {
            project_id: "p1".into(),
            spawn_request_id: "sr1".into(),
            parent_agent_id: None,
            requested_role: "weather-bot".into(),
            requested_capabilities: vec![],
            mcp_strategy: "reuse-or-synth".into(),
        };

        let needs = deps.plan_needs(&ctx).await.unwrap();
        assert_eq!(needs, vec!["weather", "geocoding"]);
    }

    #[tokio::test]
    async fn test_plan_needs_retry_on_invalid_json() {
        let db = fresh_db().await;
        let llm = Arc::new(MockLlm {
            responses: Mutex::new(vec![
                "invalid json".to_owned(),
                r#"{"capabilities": ["weather"]}"#.to_owned(),
            ]),
        });
        let bus = crate::events::EventBus::new(tokio::sync::broadcast::channel(10).0);
        let deps = LlmPipelineDeps {
            provider: llm,
            model: "gpt-4".to_owned(),
            search: None,
            executors: Arc::new(ExecutorRegistry::new(db.clone(), bus)),
            blueprints: vec![],
            api_domain_whitelist: vec![],
            db,
        };
        let ctx = PipelineContext {
            project_id: "p1".into(),
            spawn_request_id: "sr1".into(),
            parent_agent_id: None,
            requested_role: "weather-bot".into(),
            requested_capabilities: vec![],
            mcp_strategy: "reuse-or-synth".into(),
        };

        let needs = deps.plan_needs(&ctx).await.unwrap();
        assert_eq!(needs, vec!["weather"]);
    }

    #[tokio::test]
    async fn test_research_apis_whitelist_logic() {
        let db = fresh_db().await;
        let llm = Arc::new(MockLlm {
            responses: Mutex::new(vec![
                r#"{"url": "https://api.github.com/repos", "spec": {}}"#.to_owned(),
                r#"{"url": "https://sketchy-api.com", "spec": {}}"#.to_owned(),
            ]),
        });
        let search = Arc::new(MockSearch {
            results: vec![SearchResult {
                title: "API".into(),
                url: "https://api.github.com".into(),
                snippet: "desc".into(),
                score: Some(1.0),
            }],
        });
        let bus = crate::events::EventBus::new(tokio::sync::broadcast::channel(10).0);
        let deps = LlmPipelineDeps {
            provider: llm,
            model: "gpt-4".to_owned(),
            search: Some(search),
            executors: Arc::new(ExecutorRegistry::new(db.clone(), bus)),
            blueprints: vec![],
            api_domain_whitelist: vec!["api.github.com".into()],
            db,
        };
        let ctx = PipelineContext {
            project_id: "p1".into(),
            spawn_request_id: "sr1".into(),
            parent_agent_id: None,
            requested_role: "bot".into(),
            requested_capabilities: vec![],
            mcp_strategy: "reuse-or-synth".into(),
        };

        let apis = deps
            .research_apis(&ctx, &["cap1".into(), "cap2".into()])
            .await
            .unwrap();
        assert_eq!(apis.len(), 2);
        assert_eq!(apis[0].url, "https://api.github.com/repos");
        assert!(!apis[0].requires_approval);
        assert_eq!(apis[1].url, "https://sketchy-api.com");
        assert!(apis[1].requires_approval);
    }

    #[tokio::test]
    async fn test_resolve_blueprint_heuristics() {
        let bp_backend = BlueprintEntry {
            id: "bp-backend".into(),
            name: "Backend".into(),
            role: "Backend".into(),
            model: "m1".into(),
            description: "".into(),
            traits: vec![],
            icon: "".into(),
        };
        let bp_frontend = BlueprintEntry {
            id: "bp-frontend".into(),
            name: "Frontend".into(),
            role: "Frontend".into(),
            model: "m2".into(),
            description: "".into(),
            traits: vec![],
            icon: "".into(),
        };
        let db = fresh_db().await;
        let bus = crate::events::EventBus::new(tokio::sync::broadcast::channel(10).0);
        let deps = LlmPipelineDeps {
            provider: Arc::new(MockLlm {
                responses: Mutex::new(vec![]),
            }),
            model: "gpt-4".to_owned(),
            search: None,
            executors: Arc::new(ExecutorRegistry::new(db.clone(), bus)),
            blueprints: vec![bp_backend.clone(), bp_frontend.clone()],
            api_domain_whitelist: vec![],
            db,
        };

        assert_eq!(deps.resolve_blueprint("API Developer").id, "bp-backend");
        assert_eq!(deps.resolve_blueprint("UI Specialist").id, "bp-frontend");
        assert_eq!(deps.resolve_blueprint("Unknown").id, "bp-backend");
    }
}

#[derive(Deserialize)]
struct CapabilityResponse {
    capabilities: Vec<String>,
}

#[derive(Deserialize)]
struct DiscoveredApiResponse {
    url: String,
    spec: Value,
}

#[derive(Deserialize)]
struct SynthesizedMcpResponse {
    name: String,
    slug: String,
    manifest: Value,
    #[serde(rename = "handlerCode")]
    handler_code: String,
}
