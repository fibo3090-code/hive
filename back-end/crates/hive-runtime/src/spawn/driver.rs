//! State-machine driver for the auto-spawn pipeline.
//!
//! Walks an `agent_spawn_requests` row from `queued` to `completed` (or
//! `failed` / `cancelled`), persisting status transitions and emitting
//! SSE events as it goes. Each external dependency — LLM-driven planning,
//! web research, MCP synthesis — is wrapped behind a small trait
//! ([`PipelineDeps`]) so the driver can be unit-tested with deterministic
//! mocks before any LLM bills land.
//!
//! The matching stage (`Phase 4a`) is pure logic and runs inline; the
//! other stages call the dep trait. A `NoopDeps` impl covers the Phase
//! 4a-only path where matching short-circuits the rest of the pipeline,
//! and the test suite uses a `RecordingDeps` to assert on the exact
//! state transitions a given input produces.

use std::sync::Arc;

use async_trait::async_trait;
use sea_orm::DatabaseConnection;
use serde_json::{json, Value};

use hive_db::repos::{
    agent_mcp_bindings::{self, CreateBinding},
    agent_spawn_requests::{self, UpdateSpawnRequest},
    connectors, custom_mcp_servers, skills,
};

use super::matcher::{match_capabilities, Candidate, CandidateKind, MatchPlan, MatcherConfig};
use crate::events::EventBus;

// ─── Public driver ─────────────────────────────────────────────────────

/// External dependencies the driver injects per-environment. Production
/// wires these to LLM calls + sandboxed handler synthesis; tests inject
/// deterministic stubs.
#[async_trait]
pub trait PipelineDeps: Send + Sync {
    /// Stage 0: planning-needs. Decide whether the agent needs external
    /// capabilities at all (skip the rest of the pipeline if not), and
    /// what they are. Returning an empty vec is the explicit "no tools
    /// needed" signal.
    async fn plan_needs(&self, ctx: &PipelineContext) -> Result<Vec<String>, PipelineError>;

    /// Stage 2: researching-api. For each unmatched capability, find a
    /// public API that could supply it. Implementations may parallelise.
    async fn research_apis(
        &self,
        ctx: &PipelineContext,
        unmatched: &[String],
    ) -> Result<Vec<DiscoveredApi>, PipelineError>;

    /// Stage 3: synthesizing-mcp. Turn each discovered API into a custom
    /// MCP server: manifest + handler code. The driver persists the
    /// resulting rows; the dep just produces the bytes.
    async fn synthesize_mcp(
        &self,
        ctx: &PipelineContext,
        apis: &[DiscoveredApi],
    ) -> Result<Vec<SynthesizedMcp>, PipelineError>;

    /// Stage 4: composing-prompt. Produce the system prompt the new
    /// child agent will run with, citing every MCP it has access to
    /// (matched + synthesized).
    async fn compose_prompt(
        &self,
        ctx: &PipelineContext,
        bound_mcp_ids: &[String],
    ) -> Result<String, PipelineError>;

    /// Stage 6: materializing-agent. Actually create the child agent
    /// row, set its parent + system prompt + bound MCP servers. Returns
    /// the new agent id.
    ///
    /// Default impl is a no-op returning a stub id so callers that
    /// haven't wired the real `agents::create` plumbing yet don't have
    /// to implement it.
    async fn materialize_agent(
        &self,
        ctx: &PipelineContext,
        system_prompt: &str,
        bound_mcp_ids: &[String],
    ) -> Result<String, PipelineError>;
}

#[derive(Clone, Debug)]
pub struct PipelineContext {
    pub project_id: String,
    pub spawn_request_id: String,
    pub parent_agent_id: Option<String>,
    pub requested_role: String,
    pub requested_capabilities: Vec<String>,
    pub mcp_strategy: String,
}

#[derive(Clone, Debug)]
pub struct DiscoveredApi {
    /// Capability this API was discovered for.
    pub capability: String,
    pub url: String,
    pub spec: Value,
    /// True when the API host isn't on the safety whitelist; the driver
    /// will pause in `awaiting-approval` so the operator can confirm
    /// before MCP synthesis.
    pub requires_approval: bool,
}

#[derive(Clone, Debug)]
pub struct SynthesizedMcp {
    pub name: String,
    pub slug: String,
    pub source_api_url: Option<String>,
    pub source_api_spec: Option<Value>,
    pub generated_manifest: Value,
    pub generated_handler_code: String,
    pub capabilities: Vec<String>,
}

/// Pipeline-stage error. Driver maps these to `failed` status with the
/// detail string persisted so the UI can surface it.
#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    #[error("db: {0}")]
    Db(#[from] sea_orm::DbErr),
    #[error("pipeline aborted: {0}")]
    Aborted(String),
    #[error("dep: {0}")]
    Dep(String),
}

/// Complete result returned to the caller (the SSE stream gets the same
/// info incrementally). Matches what the frontend `useSpawnRequest` hook
/// expects so direct callers can use either path.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineOutcome {
    pub spawn_request_id: String,
    pub child_agent_id: Option<String>,
    pub matched_mcp_ids: Vec<String>,
    pub synthesized_mcp_ids: Vec<String>,
    pub system_prompt: Option<String>,
    pub status: String,
}

/// Walk the state machine. Persists status updates after every stage so
/// the UI sees real-time progress over SSE. On any error the row lands
/// in `failed` with the detail in `error`. The driver itself never
/// panics — every fallible boundary maps to `PipelineError`.
///
/// **B4c — Resumable from `approved`.** If the loaded row's status is
/// already `"approved"` (set atomically by `approve_spawn_request` after
/// the prior run paused in `awaiting-approval`), the driver skips
/// stages 0–2 and resumes at stage 3 using the previously persisted
/// `matched_existing_mcp_ids_json` and the discovered APIs (including
/// `spec`) from `discovered_api_json`. Without this branch the operator's
/// approval click re-runs planning + matching + research, double-billing
/// the LLM and the user-paid stages.
pub async fn run_pipeline(
    db: &DatabaseConnection,
    bus: &EventBus,
    deps: Arc<dyn PipelineDeps>,
    spawn_request_id: &str,
) -> Result<PipelineOutcome, PipelineError> {
    let request = agent_spawn_requests::get(db, spawn_request_id)
        .await?
        .ok_or_else(|| {
            PipelineError::Aborted(format!("spawn request {spawn_request_id} not found"))
        })?;

    let ctx = PipelineContext {
        project_id: request.project_id.clone(),
        spawn_request_id: request.id.clone(),
        parent_agent_id: request.parent_agent_id.clone(),
        requested_role: request.requested_role.clone(),
        requested_capabilities: serde_json::from_value(request.requested_capabilities_json.clone())
            .unwrap_or_default(),
        mcp_strategy: request.mcp_strategy.clone(),
    };

    // B4c: branch on the loaded row's status.
    if request.status == "approved" {
        if let Some(apis) = resumable_discovered_apis(&request) {
            let matched_mcp_ids: Vec<String> =
                serde_json::from_value(request.matched_existing_mcp_ids_json.clone())
                    .unwrap_or_default();
            return run_from_synthesis(db, bus, deps.as_ref(), &ctx, apis, matched_mcp_ids).await;
        }
        // Row is `approved` but the resume info isn't on the row — e.g.
        // an upgrade from a build that didn't persist `spec`. Fall
        // through to the full pipeline; the duplicate LLM cost is the
        // less-bad outcome of a one-time migration window.
        tracing::warn!(
            spawn_request_id,
            "B4c: approved row has no resumable discovered_api_json — re-running pipeline from stage 0"
        );
    }

    // ── Stage 0: planning-needs ────────────────────────────────────
    transition(db, bus, &ctx, "planning-needs", None).await?;
    let needs = deps.plan_needs(&ctx).await?;

    let mut bound_mcp_ids: Vec<String> = Vec::new();
    let mut matched_mcp_ids: Vec<String> = Vec::new();
    let mut synthesized_mcp_ids: Vec<String> = Vec::new();

    // ── Stage 1: matching-existing-mcp ─────────────────────────────
    let mut unmatched = needs.clone();
    if !needs.is_empty() {
        transition(db, bus, &ctx, "matching-existing-mcp", None).await?;
        let candidates = build_candidates(db, &ctx.project_id).await?;
        let plan: MatchPlan = match_capabilities(&needs, &candidates, MatcherConfig::default());
        for hit in &plan.matches {
            matched_mcp_ids.push(hit.candidate_id.clone());
            bound_mcp_ids.push(hit.candidate_id.clone());
        }
        unmatched = plan.unmatched;

        // `mcp_strategy="reuse-only"` and a missing capability → fail
        // cleanly so the parent learns it can't get what it asked for
        // without paying the synthesis cost.
        if !unmatched.is_empty() && ctx.mcp_strategy == "reuse-only" {
            let detail = format!("no existing MCP for capabilities: {}", unmatched.join(", "));
            mark_failed(db, bus, &ctx, &detail).await?;
            return Ok(PipelineOutcome {
                spawn_request_id: ctx.spawn_request_id.clone(),
                child_agent_id: None,
                matched_mcp_ids,
                synthesized_mcp_ids,
                system_prompt: None,
                status: "failed".to_owned(),
            });
        }
    }

    // ── Stages 2 + 3: research + synth (parallel-friendly per cap) ─
    if !unmatched.is_empty() && ctx.mcp_strategy != "none" {
        transition(db, bus, &ctx, "researching-api", None).await?;
        let apis = deps.research_apis(&ctx, &unmatched).await?;

        // Bail to awaiting-approval if any discovered API needs human
        // confirmation. The driver doesn't block here — it persists the
        // row in `awaiting-approval` and returns; a follow-up call to
        // `run_pipeline` resumes once the operator approves.
        if apis.iter().any(|a| a.requires_approval) {
            // B4c: persist the full `apis` (including `spec`) AND the
            // matched MCPs so the resume path can skip stages 0–2 and
            // jump straight to synthesis. Previously the persisted
            // shape dropped `spec` and `matched_existing_mcp_ids_json`
            // was only written at the final `completed` transition,
            // so the operator's approval click had no choice but to
            // re-run + re-bill the LLM stages.
            let _ = agent_spawn_requests::update(
                db,
                &ctx.spawn_request_id,
                UpdateSpawnRequest {
                    status: Some("awaiting-approval".to_owned()),
                    matched_existing_mcp_ids_json: Some(json!(matched_mcp_ids)),
                    discovered_api_json: Some(json!({
                        "discoveredApis": apis
                            .iter()
                            .map(|a| json!({
                                "capability": a.capability,
                                "url": a.url,
                                "spec": a.spec,
                                "requiresApproval": a.requires_approval,
                            }))
                            .collect::<Vec<_>>(),
                    })),
                    ..Default::default()
                },
            )
            .await?;
            bus.emit(
                format!("agent_spawn_request.{}", ctx.spawn_request_id),
                json!({
                    "id": ctx.spawn_request_id,
                    "status": "awaiting-approval",
                }),
            );
            return Ok(PipelineOutcome {
                spawn_request_id: ctx.spawn_request_id.clone(),
                child_agent_id: None,
                matched_mcp_ids,
                synthesized_mcp_ids,
                system_prompt: None,
                status: "awaiting-approval".to_owned(),
            });
        }

        if !apis.is_empty() {
            run_synthesis_stage(db, deps.as_ref(), &ctx, bus, &apis, &mut synthesized_mcp_ids, &mut bound_mcp_ids).await?;
        }
    }

    // ── Stage 4: composing-prompt ──────────────────────────────────
    transition(db, bus, &ctx, "composing-prompt", None).await?;
    let system_prompt = deps.compose_prompt(&ctx, &bound_mcp_ids).await?;

    // ── Stage 6: materializing-agent ───────────────────────────────
    transition(db, bus, &ctx, "materializing-agent", None).await?;
    let child_agent_id = deps
        .materialize_agent(&ctx, &system_prompt, &bound_mcp_ids)
        .await?;

    // Bind every (matched + synthesized) MCP onto the new agent.
    for id in &bound_mcp_ids {
        let kind = if matched_mcp_ids.contains(id) {
            // Could still be a custom MCP from a previous spawn — treat
            // anything in custom_mcp_servers as "custom" and only fall
            // back to "connector" when the row exists in connectors.
            classify_kind(db, id).await?
        } else {
            "custom".to_owned()
        };
        agent_mcp_bindings::create(
            db,
            CreateBinding {
                agent_id: child_agent_id.clone(),
                mcp_server_id: id.clone(),
                kind,
            },
        )
        .await?;
    }

    // Final persist: status=completed, write everything we learned.
    let _ = agent_spawn_requests::update(
        db,
        &ctx.spawn_request_id,
        UpdateSpawnRequest {
            status: Some("completed".to_owned()),
            child_agent_id: Some(child_agent_id.clone()),
            matched_existing_mcp_ids_json: Some(json!(matched_mcp_ids)),
            synthesized_mcp_ids_json: Some(json!(synthesized_mcp_ids)),
            generated_system_prompt: Some(system_prompt.clone()),
            completed: Some(true),
            ..Default::default()
        },
    )
    .await?;
    bus.emit(
        format!("agent_spawn_request.{}", ctx.spawn_request_id),
        json!({
            "id": ctx.spawn_request_id,
            "status": "completed",
            "childAgentId": child_agent_id,
        }),
    );

    Ok(PipelineOutcome {
        spawn_request_id: ctx.spawn_request_id,
        child_agent_id: Some(child_agent_id),
        matched_mcp_ids,
        synthesized_mcp_ids,
        system_prompt: Some(system_prompt),
        status: "completed".to_owned(),
    })
}

// ─── Resume path (B4c) ─────────────────────────────────────────────────

/// Deserialize the persisted `discoveredApis` blob back into
/// `Vec<DiscoveredApi>`. Returns `None` if the row predates the
/// spec-persisting awaiting-approval write (older rows dropped `spec`),
/// so the caller can fall back to the full pipeline.
fn resumable_discovered_apis(
    request: &hive_db::entities::agent_spawn_request::Model,
) -> Option<Vec<DiscoveredApi>> {
    let arr = request
        .discovered_api_json
        .as_ref()?
        .get("discoveredApis")?
        .as_array()?;
    let mut out = Vec::with_capacity(arr.len());
    for a in arr {
        let capability = a.get("capability")?.as_str()?.to_owned();
        let url = a.get("url")?.as_str()?.to_owned();
        let spec = a.get("spec").cloned()?;
        out.push(DiscoveredApi {
            capability,
            url,
            spec,
            // We're being called after the operator already approved;
            // requires_approval is meaningless here.
            requires_approval: false,
        });
    }
    Some(out)
}

/// Resume an `approved` pipeline at stage 3 (synthesis), reusing the
/// `matched_mcp_ids` that stage 1 already produced. Walks stages 3
/// (synthesize), 4 (compose-prompt), 6 (materialize-agent) the same
/// way `run_pipeline` does on a fresh run.
async fn run_from_synthesis(
    db: &DatabaseConnection,
    bus: &EventBus,
    deps: &dyn PipelineDeps,
    ctx: &PipelineContext,
    apis: Vec<DiscoveredApi>,
    matched_mcp_ids: Vec<String>,
) -> Result<PipelineOutcome, PipelineError> {
    let mut bound_mcp_ids = matched_mcp_ids.clone();
    let mut synthesized_mcp_ids: Vec<String> = Vec::new();

    if !apis.is_empty() {
        run_synthesis_stage(
            db,
            deps,
            ctx,
            bus,
            &apis,
            &mut synthesized_mcp_ids,
            &mut bound_mcp_ids,
        )
        .await?;
    }

    // ── Stage 4: composing-prompt ──────────────────────────────────
    transition(db, bus, ctx, "composing-prompt", None).await?;
    let system_prompt = deps.compose_prompt(ctx, &bound_mcp_ids).await?;

    // ── Stage 6: materializing-agent ───────────────────────────────
    transition(db, bus, ctx, "materializing-agent", None).await?;
    let child_agent_id = deps
        .materialize_agent(ctx, &system_prompt, &bound_mcp_ids)
        .await?;

    for id in &bound_mcp_ids {
        let kind = if matched_mcp_ids.contains(id) {
            classify_kind(db, id).await?
        } else {
            "custom".to_owned()
        };
        agent_mcp_bindings::create(
            db,
            CreateBinding {
                agent_id: child_agent_id.clone(),
                mcp_server_id: id.clone(),
                kind,
            },
        )
        .await?;
    }

    let _ = agent_spawn_requests::update(
        db,
        &ctx.spawn_request_id,
        UpdateSpawnRequest {
            status: Some("completed".to_owned()),
            child_agent_id: Some(child_agent_id.clone()),
            matched_existing_mcp_ids_json: Some(json!(matched_mcp_ids)),
            synthesized_mcp_ids_json: Some(json!(synthesized_mcp_ids)),
            generated_system_prompt: Some(system_prompt.clone()),
            completed: Some(true),
            ..Default::default()
        },
    )
    .await?;
    bus.emit(
        format!("agent_spawn_request.{}", ctx.spawn_request_id),
        json!({
            "id": ctx.spawn_request_id,
            "status": "completed",
            "childAgentId": child_agent_id,
        }),
    );

    Ok(PipelineOutcome {
        spawn_request_id: ctx.spawn_request_id.clone(),
        child_agent_id: Some(child_agent_id),
        matched_mcp_ids,
        synthesized_mcp_ids,
        system_prompt: Some(system_prompt),
        status: "completed".to_owned(),
    })
}

/// Stage 3 body, factored out so the fresh-run and approved-resume
/// paths both use the exact same persistence + binding logic.
async fn run_synthesis_stage(
    db: &DatabaseConnection,
    deps: &dyn PipelineDeps,
    ctx: &PipelineContext,
    bus: &EventBus,
    apis: &[DiscoveredApi],
    synthesized_mcp_ids: &mut Vec<String>,
    bound_mcp_ids: &mut Vec<String>,
) -> Result<(), PipelineError> {
    transition(db, bus, ctx, "synthesizing-mcp", None).await?;
    let synthesized = deps.synthesize_mcp(ctx, apis).await?;
    for mcp in synthesized {
        let row = custom_mcp_servers::create(
            db,
            custom_mcp_servers::CreateCustomMcpServer {
                project_id: ctx.project_id.clone(),
                owner_agent_id: ctx.parent_agent_id.clone(),
                name: mcp.name,
                slug: mcp.slug,
                source_api_url: mcp.source_api_url,
                source_api_spec_json: mcp.source_api_spec,
                generated_manifest_json: mcp.generated_manifest,
                generated_handler_code: mcp.generated_handler_code,
                transport: "http".to_owned(),
                encrypted_credentials: None,
                reusable: true,
                capabilities_json: json!(mcp.capabilities),
                embedding_json: None,
            },
        )
        .await?;
        custom_mcp_servers::set_status(db, &row.id, "active").await?;
        synthesized_mcp_ids.push(row.id.clone());
        bound_mcp_ids.push(row.id);
    }
    Ok(())
}

// ─── Helpers ───────────────────────────────────────────────────────────

async fn transition(
    db: &DatabaseConnection,
    bus: &EventBus,
    ctx: &PipelineContext,
    status: &str,
    extra: Option<Value>,
) -> Result<(), PipelineError> {
    let _ = agent_spawn_requests::update(
        db,
        &ctx.spawn_request_id,
        UpdateSpawnRequest {
            status: Some(status.to_owned()),
            discovered_api_json: extra.clone(),
            ..Default::default()
        },
    )
    .await?;
    bus.emit(
        format!("agent_spawn_request.{}", ctx.spawn_request_id),
        json!({
            "id": ctx.spawn_request_id,
            "status": status,
            "extra": extra,
        }),
    );
    Ok(())
}

async fn mark_failed(
    db: &DatabaseConnection,
    bus: &EventBus,
    ctx: &PipelineContext,
    detail: &str,
) -> Result<(), PipelineError> {
    let _ = agent_spawn_requests::update(
        db,
        &ctx.spawn_request_id,
        UpdateSpawnRequest {
            status: Some("failed".to_owned()),
            error: Some(detail.to_owned()),
            completed: Some(true),
            ..Default::default()
        },
    )
    .await?;
    bus.emit(
        format!("agent_spawn_request.{}", ctx.spawn_request_id),
        json!({
            "id": ctx.spawn_request_id,
            "status": "failed",
            "error": detail,
        }),
    );
    Ok(())
}

/// Build the matcher candidate pool for a project: skills, MCP
/// connectors, and reusable custom MCP servers.
async fn build_candidates(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Candidate>, PipelineError> {
    let mut out = Vec::new();
    for skill in skills::list_for_project(db, project_id).await? {
        out.push(Candidate {
            id: skill.id,
            kind: CandidateKind::Skill,
            name: skill.name,
            capabilities: serde_json::from_value(skill.capabilities_json).unwrap_or_default(),
        });
    }
    for connector in connectors::list_mcp_for_project(db, project_id).await? {
        out.push(Candidate {
            id: connector.id,
            kind: CandidateKind::Connector,
            name: connector.name,
            capabilities: connector
                .config_json
                .get("capabilities")
                .and_then(Value::as_array)
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    for custom in custom_mcp_servers::list_reusable_for_project(db, project_id).await? {
        out.push(Candidate {
            id: custom.id,
            kind: CandidateKind::CustomMcp,
            name: custom.name,
            capabilities: serde_json::from_value(custom.capabilities_json).unwrap_or_default(),
        });
    }
    Ok(out)
}

/// Decide whether an mcp_server_id refers to a custom server or a
/// connector row, for the binding kind discriminator.
async fn classify_kind(
    db: &DatabaseConnection,
    mcp_server_id: &str,
) -> Result<String, PipelineError> {
    if custom_mcp_servers::get(db, mcp_server_id).await?.is_some() {
        Ok("custom".to_owned())
    } else {
        Ok("connector".to_owned())
    }
}

// ─── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use crate::RuntimeEvent;
    use hive_db::{entities::project, repos::agent_spawn_requests::CreateSpawnRequest, Db};
    use sea_orm::{ActiveModelTrait, Set};
    use tokio::sync::broadcast;

    /// Recording PipelineDeps that returns scripted outputs and
    /// captures every call. Used to assert on driver behaviour
    /// without LLMs.
    struct ScriptedDeps {
        plan: Vec<String>,
        apis: Vec<DiscoveredApi>,
        synth: Vec<SynthesizedMcp>,
        prompt: String,
        agent_id: String,
        plan_calls: AtomicUsize,
        synth_calls: AtomicUsize,
        materialize_calls: Mutex<Vec<Vec<String>>>,
    }

    impl ScriptedDeps {
        fn new(
            plan: Vec<String>,
            apis: Vec<DiscoveredApi>,
            synth: Vec<SynthesizedMcp>,
            prompt: &str,
            agent_id: &str,
        ) -> Self {
            Self {
                plan,
                apis,
                synth,
                prompt: prompt.to_owned(),
                agent_id: agent_id.to_owned(),
                plan_calls: AtomicUsize::new(0),
                synth_calls: AtomicUsize::new(0),
                materialize_calls: Mutex::new(Vec::new()),
            }
        }
    }

    #[async_trait]
    impl PipelineDeps for ScriptedDeps {
        async fn plan_needs(&self, _ctx: &PipelineContext) -> Result<Vec<String>, PipelineError> {
            self.plan_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.plan.clone())
        }
        async fn research_apis(
            &self,
            _ctx: &PipelineContext,
            _u: &[String],
        ) -> Result<Vec<DiscoveredApi>, PipelineError> {
            Ok(self.apis.clone())
        }
        async fn synthesize_mcp(
            &self,
            _ctx: &PipelineContext,
            _apis: &[DiscoveredApi],
        ) -> Result<Vec<SynthesizedMcp>, PipelineError> {
            self.synth_calls.fetch_add(1, Ordering::SeqCst);
            Ok(self.synth.clone())
        }
        async fn compose_prompt(
            &self,
            _ctx: &PipelineContext,
            _ids: &[String],
        ) -> Result<String, PipelineError> {
            Ok(self.prompt.clone())
        }
        async fn materialize_agent(
            &self,
            _ctx: &PipelineContext,
            _prompt: &str,
            ids: &[String],
        ) -> Result<String, PipelineError> {
            self.materialize_calls.lock().unwrap().push(ids.to_vec());
            Ok(self.agent_id.clone())
        }
    }

    async fn fresh_db_with_project() -> (Db, String, EventBus) {
        let db = Db::connect("sqlite::memory:", true)
            .await
            .expect("connect+migrate");
        let project_id = ulid::Ulid::new().to_string().to_lowercase();
        let now = chrono::Utc::now().to_rfc3339();
        project::ActiveModel {
            id: Set(project_id.clone()),
            name: Set("test".into()),
            description: Set(None),
            health_score: Set(100),
            spec_completion: Set(0),
            test_coverage: Set(0),
            sovereignty_tier: Set("standard".into()),
            status: Set("active".into()),
            budget_total_cents: Set(0),
            last_activity_at: Set(None),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            deleted_at: Set(None),
        }
        .insert(db.conn())
        .await
        .unwrap();
        let (tx, _rx) = broadcast::channel::<RuntimeEvent>(64);
        let bus = EventBus::new(tx);
        (db, project_id, bus)
    }

    /// Insert a placeholder agent row so the FK from
    /// `agent_mcp_bindings.agent_id` resolves. The driver's
    /// `materialize_agent` dep is allowed to be a stub that returns an
    /// arbitrary id; tests using bindings have to pre-seed the agent or
    /// implement the dep to create one. This helper keeps each test
    /// concise.
    async fn seed_agent(db: &Db, id: &str, project_id: &str) {
        use hive_db::entities::agent;
        let now = chrono::Utc::now().to_rfc3339();
        agent::ActiveModel {
            id: Set(id.to_owned()),
            project_id: Set(project_id.to_owned()),
            slug: Set(format!("a-{id}")),
            name: Set("Test".into()),
            role: Set("worker".into()),
            model: Set("gpt-5".into()),
            status: Set("idle".into()),
            current_task: Set(None),
            quality_score: Set(None),
            tokens_used: Set(0),
            eval_scores: Set(serde_json::json!({})),
            parent_agent_id: Set(None),
            spawned_by_message_id: Set(None),
            enabled_tools: Set(serde_json::json!([])),
            system_prompt: Set(None),
            model_provider_id: Set(None),
            model_id: Set(None),
            created_at: Set(now.clone()),
            updated_at: Set(now),
            deleted_at: Set(None),
        }
        .insert(db.conn())
        .await
        .unwrap();
    }

    async fn make_request(db: &Db, project_id: &str, mcp_strategy: &str) -> String {
        agent_spawn_requests::create(
            db.conn(),
            CreateSpawnRequest {
                project_id: project_id.to_owned(),
                parent_agent_id: None,
                requested_role: "weather-fetcher".to_owned(),
                requested_capabilities_json: serde_json::json!(["weather"]),
                context_json: serde_json::json!({}),
                mcp_strategy: mcp_strategy.to_owned(),
            },
        )
        .await
        .unwrap()
        .id
    }

    #[tokio::test]
    async fn happy_path_synthesises_when_no_match_exists() {
        let (db, project_id, bus) = fresh_db_with_project().await;
        seed_agent(&db, "child-agent-1", &project_id).await;
        let req_id = make_request(&db, &project_id, "reuse-or-synth").await;

        let deps = Arc::new(ScriptedDeps::new(
            vec!["weather".to_owned()],
            vec![DiscoveredApi {
                capability: "weather".to_owned(),
                url: "https://api.example.com".to_owned(),
                spec: json!({}),
                requires_approval: false,
            }],
            vec![SynthesizedMcp {
                name: "Weather MCP".to_owned(),
                slug: "weather-mcp".to_owned(),
                source_api_url: Some("https://api.example.com".to_owned()),
                source_api_spec: Some(json!({})),
                generated_manifest: json!({"tools": ["forecast"]}),
                generated_handler_code: "// generated".to_owned(),
                capabilities: vec!["weather".to_owned()],
            }],
            "You are a weather fetcher.",
            "child-agent-1",
        ));

        let outcome = run_pipeline(db.conn(), &bus, deps.clone(), &req_id)
            .await
            .unwrap();
        assert_eq!(outcome.status, "completed");
        assert_eq!(outcome.child_agent_id.as_deref(), Some("child-agent-1"));
        assert_eq!(outcome.matched_mcp_ids.len(), 0);
        assert_eq!(outcome.synthesized_mcp_ids.len(), 1);
        assert_eq!(deps.plan_calls.load(Ordering::SeqCst), 1);
        assert_eq!(deps.synth_calls.load(Ordering::SeqCst), 1);
        {
            let materialize_args = deps.materialize_calls.lock().unwrap();
            assert_eq!(materialize_args.len(), 1);
            assert_eq!(materialize_args[0].len(), 1, "synthesised mcp bound");
        }

        // The persisted row reflects the final state.
        let row = agent_spawn_requests::get(db.conn(), &req_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.status, "completed");
        assert_eq!(row.child_agent_id.as_deref(), Some("child-agent-1"));
        assert!(row.completed_at.is_some());
        assert!(row.generated_system_prompt.is_some());

        // The MCP server was persisted as `active` and `reusable` so a
        // future spawn can match it.
        let custom_servers = custom_mcp_servers::list_for_project(db.conn(), &project_id)
            .await
            .unwrap();
        assert_eq!(custom_servers.len(), 1);
        assert_eq!(custom_servers[0].status, "active");
        assert!(custom_servers[0].reusable);

        // Bound on the child agent.
        let bindings = agent_mcp_bindings::list_for_agent(db.conn(), "child-agent-1")
            .await
            .unwrap();
        assert_eq!(bindings.len(), 1);
        assert_eq!(bindings[0].kind, "custom");
    }

    #[tokio::test]
    async fn no_needs_skips_research_and_synth_entirely() {
        let (db, project_id, bus) = fresh_db_with_project().await;
        seed_agent(&db, "solo-agent", &project_id).await;
        let req_id = make_request(&db, &project_id, "reuse-or-synth").await;

        let deps = Arc::new(ScriptedDeps::new(
            vec![], // no capabilities needed
            vec![],
            vec![],
            "Solo prompt.",
            "solo-agent",
        ));
        let outcome = run_pipeline(db.conn(), &bus, deps.clone(), &req_id)
            .await
            .unwrap();
        assert_eq!(outcome.status, "completed");
        assert_eq!(outcome.matched_mcp_ids.len(), 0);
        assert_eq!(outcome.synthesized_mcp_ids.len(), 0);
        assert_eq!(deps.synth_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn awaiting_approval_pauses_before_synthesis() {
        let (db, project_id, bus) = fresh_db_with_project().await;
        let req_id = make_request(&db, &project_id, "reuse-or-synth").await;

        let deps = Arc::new(ScriptedDeps::new(
            vec!["weather".to_owned()],
            vec![DiscoveredApi {
                capability: "weather".to_owned(),
                url: "https://sketchy.example.com".to_owned(),
                spec: json!({}),
                requires_approval: true,
            }],
            vec![],
            "",
            "",
        ));

        let outcome = run_pipeline(db.conn(), &bus, deps.clone(), &req_id)
            .await
            .unwrap();
        assert_eq!(outcome.status, "awaiting-approval");
        assert!(outcome.child_agent_id.is_none());
        // Crucially: we did NOT pay the synthesis cost.
        assert_eq!(deps.synth_calls.load(Ordering::SeqCst), 0);

        let row = agent_spawn_requests::get(db.conn(), &req_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.status, "awaiting-approval");
        assert!(row.discovered_api_json.is_some());
    }

    #[tokio::test]
    async fn reuse_only_strategy_fails_cleanly_when_no_match_exists() {
        let (db, project_id, bus) = fresh_db_with_project().await;
        let req_id = make_request(&db, &project_id, "reuse-only").await;

        let deps = Arc::new(ScriptedDeps::new(
            vec!["weather".to_owned()],
            vec![],
            vec![],
            "",
            "",
        ));
        let outcome = run_pipeline(db.conn(), &bus, deps.clone(), &req_id)
            .await
            .unwrap();
        assert_eq!(outcome.status, "failed");

        let row = agent_spawn_requests::get(db.conn(), &req_id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(row.status, "failed");
        assert!(row.error.as_deref().unwrap_or("").contains("weather"));
        // We did not call any of the heavy stages.
        assert_eq!(deps.synth_calls.load(Ordering::SeqCst), 0);
        let materialize_args = deps.materialize_calls.lock().unwrap();
        assert!(materialize_args.is_empty());
    }

    #[tokio::test]
    async fn matched_skill_short_circuits_synth() {
        let (db, project_id, bus) = fresh_db_with_project().await;
        seed_agent(&db, "child-1", &project_id).await;

        // Pre-seed a skill that covers the requested capability.
        let _ = skills::create(
            db.conn(),
            skills::CreateSkill {
                project_id: Some(project_id.clone()),
                slug: "weather-skill".into(),
                name: "Weather".into(),
                description: "".into(),
                system_prompt_fragment: "".into(),
                allowed_tools_json: json!([]),
                allowed_paths_json: json!([]),
                requires_connector_ids_json: json!([]),
                capabilities_json: json!(["weather"]),
                markdown_body: String::new(),
            },
        )
        .await
        .unwrap();
        let req_id = make_request(&db, &project_id, "reuse-or-synth").await;

        let deps = Arc::new(ScriptedDeps::new(
            vec!["weather".to_owned()],
            vec![],
            vec![],
            "Bound to existing skill.",
            "child-1",
        ));
        let outcome = run_pipeline(db.conn(), &bus, deps.clone(), &req_id)
            .await
            .unwrap();

        assert_eq!(outcome.status, "completed");
        assert_eq!(outcome.matched_mcp_ids.len(), 1);
        assert_eq!(outcome.synthesized_mcp_ids.len(), 0);
        assert_eq!(deps.synth_calls.load(Ordering::SeqCst), 0);
    }
}
