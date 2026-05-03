use std::{
    collections::HashMap,
    fs,
    net::SocketAddr,
    path::{Path as StdPath, PathBuf},
    str::FromStr,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive},
        IntoResponse, Response, Sse,
    },
    routing::{get, patch, post},
    Json, Router,
};
use clap::{Parser, Subcommand};
use hive_crypto::{mask_key, Crypto};
use hive_db::{
    repos::{
        agent_messages, agents, alerts, audit, chat_messages, chat_threads, cost_events,
        llm_providers, notes, notifications, project_workspaces, projects, sessions, settings,
        sprints, synthesis_jobs, tasks, tech_debt,
    },
    seed::seed_demo,
    Db,
};
use hive_git::{
    CreatePullRequest, GitDiff, GitError, GitFile, GitHubClient, GitRepo, GitTreeEntry,
};
use hive_llm::{client_for, ModelInfo, ProviderConfig, ProviderKind};
use hive_runtime::{EventBus, RuntimeEvent, TurnDriver, TurnDriverError, TurnRequest};
use hive_sandbox::LocalFsSandbox;
use hive_search::{SearxNgProvider, TavilyProvider};
use hive_tools::{
    default_names as default_tool_names, register_defaults, register_web_search, ToolContext,
    ToolRegistry,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    sync::{broadcast, Mutex, RwLock},
    task::AbortHandle,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::{info, warn};

#[derive(Parser)]
#[command(author, version, about)]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    Serve,
    Migrate,
    Seed,
}

#[derive(Clone)]
struct AppState {
    inner: Arc<RwLock<RuntimeState>>,
    events: broadcast::Sender<RuntimeEvent>,
    workspace_root: PathBuf,
    crypto: Crypto,
    #[allow(dead_code)]
    http: reqwest::Client,
    model_cache: ModelCache,
    chat_jobs: ChatJobRegistry,
    executors: Arc<hive_runtime::ExecutorRegistry>,
}

type ModelCache = Arc<RwLock<HashMap<String, (Instant, Vec<ModelInfo>)>>>;

/// In-flight chat turns keyed by `assistant_message_id`. Holds both the
/// cooperative cancel flag (checked inside the runner loop) and the task's
/// `AbortHandle` so the API can force-interrupt the task if the runner is
/// blocked inside `stream.next().await` and isn't polling the flag.
#[derive(Clone, Default)]
struct ChatJobRegistry {
    inner: Arc<RwLock<HashMap<String, ChatJob>>>,
}

struct ChatJob {
    cancel: Arc<Mutex<bool>>,
    /// Filled in once the spawned task's `AbortHandle` is available.
    abort: Option<AbortHandle>,
}

impl ChatJobRegistry {
    /// Register the cancellation flag for a new message. Must be called
    /// BEFORE spawning the runner task so that a fast-exiting task cannot
    /// race ahead of its registry entry.
    async fn register(&self, msg_id: &str, cancel: Arc<Mutex<bool>>) {
        self.inner.write().await.insert(
            msg_id.to_owned(),
            ChatJob {
                cancel,
                abort: None,
            },
        );
    }

    /// Attach the spawned task's `AbortHandle` so cancellation can interrupt
    /// the stream if the runner isn't polling the cooperative flag.
    async fn attach_abort(&self, msg_id: &str, abort: AbortHandle) {
        if let Some(job) = self.inner.write().await.get_mut(msg_id) {
            job.abort = Some(abort);
        }
    }

    async fn cancel(&self, msg_id: &str) -> bool {
        let mut map = self.inner.write().await;
        let Some(job) = map.get(msg_id) else {
            return false;
        };
        *job.cancel.lock().await = true;
        if let Some(handle) = &job.abort {
            handle.abort();
        }
        map.remove(msg_id);
        true
    }

    async fn remove(&self, msg_id: &str) {
        self.inner.write().await.remove(msg_id);
    }
}

#[derive(Clone)]
struct RuntimeState {
    db: Db,
    database_url: String,
    engine: String,
    data_dir: PathBuf,
    needs_setup: bool,
}

// DomainEvent was renamed to hive_runtime::RuntimeEvent so the runtime
// crate can push to the same broadcast bus without depending on hive-api.

#[derive(Debug)]
enum AppError {
    NotFound(String),
    BadRequest(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        match self {
            Self::NotFound(message) => (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": message, "code": "not_found" })),
            )
                .into_response(),
            Self::BadRequest(message) => (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": message, "code": "bad_request" })),
            )
                .into_response(),
            Self::Internal(detail) => {
                // Mint a correlation id, log the real reason behind it, and
                // return a body that does not leak implementation details.
                let request_id = ulid::Ulid::new().to_string();
                tracing::error!(request_id = %request_id, %detail, "internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(axum::http::header::HeaderName::from_static("x-request-id"), request_id.clone())],
                    Json(json!({
                        "error": "internal error",
                        "code": "internal",
                        "requestId": request_id,
                    })),
                )
                    .into_response()
            }
        }
    }
}

impl From<sea_orm::DbErr> for AppError {
    fn from(value: sea_orm::DbErr) -> Self {
        Self::Internal(value.to_string())
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotFound(m) | Self::BadRequest(m) | Self::Internal(m) => f.write_str(m),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupStatus {
    needs_setup: bool,
    engine: String,
    data_dir: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetupDatabaseBody {
    engine: String,
    url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateProjectBody {
    name: String,
    description: Option<String>,
    sovereignty_tier: String,
    budget_total_cents: i64,
    status: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProjectBody {
    name: Option<String>,
    description: Option<Option<String>>,
    sovereignty_tier: Option<String>,
    budget_total_cents: Option<i64>,
    status: Option<String>,
    health_score: Option<i32>,
    spec_completion: Option<i32>,
    test_coverage: Option<i32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAgentBody {
    slug: Option<String>,
    name: String,
    role: String,
    model: String,
    status: Option<String>,
    #[serde(default)]
    parent_agent_id: Option<String>,
    #[serde(default)]
    spawned_by_message_id: Option<String>,
    #[serde(default)]
    enabled_tools: Option<Vec<String>>,
    #[serde(default)]
    system_prompt: Option<String>,
    #[serde(default)]
    model_provider_id: Option<String>,
    #[serde(default)]
    model_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatusBody {
    status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateNoteBody {
    category: String,
    title: String,
    content: String,
    auto: Option<bool>,
    author: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveTechDebtBody {
    severity: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReorderSprintsBody {
    from_id: String,
    to_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtendBudgetBody {
    new_total_cents: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPatchBody {
    settings: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EntityAuditQuery {
    entity_type: Option<String>,
    entity_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    project_id: String,
    sandbox_kind: String,
    status: String,
    root_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateGitBranchBody {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CheckoutGitBranchBody {
    name: String,
    #[serde(default)]
    create: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitGitBody {
    message: String,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    paths: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RestoreGitBody {
    #[serde(default)]
    paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitLogQuery {
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitTreeQuery {
    #[serde(rename = "ref")]
    reference: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitFileQuery {
    #[serde(rename = "ref")]
    reference: Option<String>,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectGitHubBody {
    token: String,
    owner: String,
    repo: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreatePullRequestBody {
    title: String,
    #[serde(default)]
    body: Option<String>,
    head: String,
    base: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SynthesizeModuleBody {
    description: String,
    #[serde(default)]
    tier: Option<String>,
    #[serde(default)]
    model: Option<ModelRef>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    init_tracing();

    let cli = Cli::parse();
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;

    match cli.command.unwrap_or(Command::Serve) {
        Command::Serve => serve(workspace_root).await,
        Command::Migrate => {
            let _ = bootstrap_runtime(&workspace_root).await?;
            Ok(())
        }
        Command::Seed => {
            let runtime = bootstrap_runtime(&workspace_root).await?;
            seed_demo(runtime.db.conn()).await?;
            Ok(())
        }
    }
}

async fn serve(workspace_root: PathBuf) -> anyhow::Result<()> {
    let runtime = bootstrap_runtime(&workspace_root).await?;
    let (events, _) = broadcast::channel(256);
    let crypto = Crypto::load_or_init()?;
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()?;

    // Probe local Ollama for a seamless zero-config experience.
    probe_ollama(&runtime.db, &http).await;

    let executors = Arc::new(hive_runtime::ExecutorRegistry::new(
        runtime.db.clone(),
        EventBus::new(events.clone()),
    ));
    let _ = executors.rehydrate_from_db().await;

    let state = AppState {
        inner: Arc::new(RwLock::new(runtime)),
        events,
        workspace_root,
        crypto,
        http,
        model_cache: Arc::new(RwLock::new(HashMap::new())),
        chat_jobs: ChatJobRegistry::default(),
        executors: executors.clone(),
    };

    // Install the per-agent turn driver now that AppState exists. Every
    // future inbox item will run a real LLM turn via this driver.
    executors
        .set_driver(Arc::new(ApiTurnDriver::new(state.clone())))
        .await;

    let app = Router::new()
        .route("/v1/healthz", get(healthz))
        .route("/v1/readyz", get(readyz))
        .route("/v1/setup/status", get(setup_status))
        .route("/v1/setup/database", post(setup_database))
        .route("/v1/setup/seed", post(seed_database))
        .route("/v1/events", get(events_stream))
        .route("/v1/openapi.json", get(openapi_json))
        .route("/v1/projects", get(list_projects).post(create_project))
        .route("/v1/projects/active", get(get_active_project))
        .route(
            "/v1/projects/:project_id",
            get(get_project)
                .patch(update_project)
                .delete(delete_project),
        )
        .route("/v1/projects/:project_id/activate", post(activate_project))
        .route(
            "/v1/projects/:project_id/agents",
            get(list_agents).post(create_agent),
        )
        .route("/v1/agents/:agent_id/set-status", post(set_agent_status))
        .route("/v1/agents/:agent_id/messages", get(get_agent_messages))
        .route("/v1/tools", get(list_tool_manifests))
        .route("/v1/agents/:agent_id/lineage", get(get_agent_lineage))
        .route("/v1/agents/:agent_id/dispatch", post(dispatch_to_agent))
        .route("/v1/agents/:agent_id/pause", post(pause_agent))
        .route("/v1/agents/:agent_id/resume", post(resume_agent))
        .route("/v1/agents/:agent_id/terminate", post(terminate_agent))
        .route(
            "/v1/projects/:project_id/coordinator/ensure",
            post(ensure_coordinator),
        )
        .route("/v1/projects/:project_id/tasks", get(list_tasks))
        .route("/v1/tasks/:task_id/set-status", post(set_task_status))
        .route("/v1/projects/:project_id/alerts", get(list_alerts))
        .route("/v1/alerts/:alert_id/dismiss", post(dismiss_alert))
        .route("/v1/notifications", get(list_notifications))
        .route(
            "/v1/notifications/:notification_id/read",
            post(mark_notification_read),
        )
        .route(
            "/v1/notifications/read-all",
            post(mark_all_notifications_read),
        )
        .route(
            "/v1/notifications/:notification_id/dismiss",
            post(dismiss_notification),
        )
        .route(
            "/v1/projects/:project_id/notes",
            get(list_notes).post(create_note),
        )
        .route("/v1/projects/:project_id/tech-debt", get(list_tech_debt))
        .route("/v1/tech-debt/:item_id/move", post(move_tech_debt_item))
        .route("/v1/projects/:project_id/sprints", get(list_sprints))
        .route(
            "/v1/projects/:project_id/sprints/reorder",
            post(reorder_sprints),
        )
        .route("/v1/projects/:project_id/session", get(get_project_session))
        .route(
            "/v1/projects/:project_id/session/toggle",
            post(toggle_project_session),
        )
        .route(
            "/v1/projects/:project_id/budget/extend",
            post(extend_project_budget),
        )
        .route(
            "/v1/projects/:project_id/activity",
            get(get_project_activity),
        )
        .route(
            "/v1/projects/:project_id/sessions/history",
            get(get_project_session_history),
        )
        .route(
            "/v1/projects/:project_id/requirements",
            get(get_project_requirements),
        )
        .route(
            "/v1/projects/:project_id/user-stories",
            get(get_project_user_stories),
        )
        .route(
            "/v1/projects/:project_id/insights/quality-over-time",
            get(get_project_quality_over_time),
        )
        .route(
            "/v1/projects/:project_id/insights/spend",
            get(get_project_spend),
        )
        .route(
            "/v1/projects/:project_id/insights/task-throughput",
            get(get_project_task_throughput),
        )
        .route(
            "/v1/projects/:project_id/insights/cost-timeline",
            get(get_project_cost_timeline),
        )
        .route(
            "/v1/projects/:project_id/insights/agent-token-usage",
            get(get_project_agent_token_usage),
        )
        .route(
            "/v1/projects/:project_id/insights/task-distribution",
            get(get_project_task_distribution),
        )
        .route(
            "/v1/projects/genesis/preview",
            post(post_project_genesis_preview),
        )
        .route("/v1/projects/:project_id/modules", get(list_modules))
        .route("/v1/modules/:module_id", get(get_module))
        .route(
            "/v1/projects/:project_id/modules/:module_id/install",
            post(install_module),
        )
        .route("/v1/agent-blueprints", get(get_agent_blueprints))
        .route("/v1/settings", get(get_settings).patch(update_settings))
        .route("/v1/audit-log", get(get_audit_log))
        .route("/v1/llm-providers", get(list_llm_providers))
        .route("/v1/llm-providers/:id", patch(update_llm_provider))
        .route("/v1/llm-providers/:id/test", post(test_llm_provider))
        .route(
            "/v1/llm-providers/:id/models",
            get(list_llm_provider_models),
        )
        .route(
            "/v1/llm-providers/:id/refresh-models",
            post(refresh_llm_provider_models),
        )
        .route(
            "/v1/projects/:project_id/chat-threads",
            get(list_chat_threads),
        )
        .route(
            "/v1/projects/:project_id/workspace/info",
            get(get_workspace_info),
        )
        .route(
            "/v1/projects/:project_id/workspace/init",
            post(init_workspace),
        )
        .route("/v1/projects/:project_id/git/init", post(init_git_repo))
        .route("/v1/projects/:project_id/git/status", get(get_git_status))
        .route("/v1/projects/:project_id/git/branches", get(list_git_branches).post(create_git_branch))
        .route("/v1/projects/:project_id/git/checkout", post(checkout_git_branch))
        .route("/v1/projects/:project_id/git/log", get(get_git_log))
        .route("/v1/projects/:project_id/git/tree", get(get_git_tree))
        .route("/v1/projects/:project_id/git/file", get(get_git_file))
        .route("/v1/projects/:project_id/git/diff/:reference", get(get_git_diff))
        .route("/v1/projects/:project_id/git/commit", post(commit_git_changes))
        .route("/v1/projects/:project_id/git/restore", post(restore_git_changes))
        .route("/v1/projects/:project_id/github/connect", post(connect_github))
        .route("/v1/projects/:project_id/github/status", get(get_github_status))
        .route("/v1/projects/:project_id/github/pulls", get(list_github_pulls).post(create_github_pull))
        .route("/v1/chat-threads", post(create_chat_thread))
        .route("/v1/chat-threads/:thread_id", get(get_chat_thread))
        .route(
            "/v1/chat-threads/:thread_id/messages",
            get(list_chat_messages).post(send_chat_message),
        )
        .route(
            "/v1/chat-messages/:message_id/cancel",
            post(cancel_chat_message),
        )
        .route("/v1/projects/:project_id/modules/synthesize", post(start_module_synthesis))
        .route(
            "/v1/projects/:project_id/synthesis-jobs",
            get(list_synthesis_jobs_for_project),
        )
        .route("/v1/synthesis-jobs/:job_id", get(get_synthesis_job))
        .route(
            "/v1/synthesis-jobs/:job_id/publish",
            post(publish_synthesis_job),
        )
        .route(
            "/v1/synthesis-jobs/:job_id/unpublish",
            post(unpublish_synthesis_job),
        )
        .route("/v1/modules/published", get(list_published_modules))
        .with_state(state)
        .layer(cors_layer())
        .layer(TraceLayer::new_for_http());

    let addr = SocketAddr::from(([127, 0, 0, 1], 8787));
    info!("listening on http://{}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

/// Initialise tracing. Filter from `HIVE_LOG` (same syntax as `RUST_LOG`,
/// e.g. `info,hive_runtime=debug`); falls back to `info` if unset. JSON
/// formatting kicks in when `HIVE_LOG_JSON` is any non-empty value, so
/// production deployments can pipe straight into a log aggregator while
/// the dev console keeps the human-readable form.
fn init_tracing() {
    use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

    let env_filter = std::env::var("HIVE_LOG")
        .ok()
        .and_then(|raw| EnvFilter::try_new(raw).ok())
        .unwrap_or_else(|| EnvFilter::new("info"));

    let registry = tracing_subscriber::registry().with(env_filter);
    if std::env::var("HIVE_LOG_JSON").is_ok_and(|v| !v.is_empty()) {
        registry.with(fmt::layer().json()).init();
    } else {
        registry.with(fmt::layer().compact().with_target(false)).init();
    }
}

/// Restrict cross-origin access to the dev origins served by Vite. The API is
/// bound to 127.0.0.1 so this is defence in depth — it stops a malicious page
/// open in the same browser from exfiltrating provider keys via the API.
fn cors_layer() -> CorsLayer {
    use axum::http::HeaderValue;
    let dev_origins = [
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ];
    CorsLayer::new()
        .allow_origin(
            dev_origins
                .iter()
                .filter_map(|o| HeaderValue::from_str(o).ok())
                .collect::<Vec<_>>(),
        )
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers([axum::http::header::HeaderName::from_static("x-request-id")])
}

async fn bootstrap_runtime(workspace_root: &StdPath) -> anyhow::Result<RuntimeState> {
    let config_path = workspace_root.join("config").join("local.toml");
    let data_dir = workspace_root.join("data");
    fs::create_dir_all(&data_dir)?;

    let (database_url, engine, needs_setup) = if config_path.exists() {
        let raw = fs::read_to_string(&config_path)?;
        let value: toml::Value = toml::from_str(&raw)?;
        let url = value
            .get("database")
            .and_then(|db| db.get("url"))
            .and_then(toml::Value::as_str)
            .unwrap_or("")
            .to_owned();
        let engine = if url.starts_with("postgres") {
            "postgres"
        } else {
            "sqlite"
        }
        .to_owned();
        (url, engine, false)
    } else {
        (
            sqlite_url(data_dir.join("hive.db")),
            "sqlite".to_owned(),
            true,
        )
    };

    let db = Db::connect(&database_url, true).await?;
    // Only seed demo data on an empty DB. Avoids re-adding global notifications
    // and clobbering manual edits on every process restart. Use the `Seed` CLI
    // command or `POST /v1/setup/seed` to force a reseed.
    if projects::list(db.conn()).await?.is_empty() {
        seed_demo(db.conn()).await?;
    }

    Ok(RuntimeState {
        db,
        database_url,
        engine,
        data_dir,
        needs_setup,
    })
}

async fn db(state: &AppState) -> Db {
    state.inner.read().await.db.clone()
}

async fn emit(state: &AppState, event: &str, data: Value) {
    let _ = state.events.send(RuntimeEvent {
        event: event.to_owned(),
        data,
    });
}

async fn active_project_id(state: &AppState) -> Result<Option<String>, AppError> {
    let database = db(state).await;
    if let Some(value) = settings::get_value(database.conn(), "global", "activeProjectId").await? {
        if let Some(id) = value.as_str() {
            return Ok(Some(id.to_owned()));
        }
    }

    Ok(projects::list(database.conn())
        .await?
        .into_iter()
        .next()
        .map(|project| project.id))
}

async fn read_setting_json(
    state: &AppState,
    scope: &str,
    key: &str,
    fallback: Value,
) -> Result<Value, AppError> {
    let database = db(state).await;
    Ok(settings::get_value(database.conn(), scope, key)
        .await?
        .unwrap_or(fallback))
}

fn workspace_dir(data_dir: &StdPath, project_id: &str) -> PathBuf {
    data_dir.join("workspaces").join(project_id)
}

fn project_scope(project_id: &str) -> String {
    format!("project:{project_id}")
}

fn ensure_object(value: &mut Value) -> Result<&mut serde_json::Map<String, Value>, AppError> {
    if !value.is_object() {
        *value = json!({});
    }
    value
        .as_object_mut()
        .ok_or_else(|| AppError::BadRequest("settings must be a JSON object".into()))
}

async fn stored_default_model(state: &AppState) -> Result<Value, AppError> {
    read_setting_json(state, "global", "defaultModel", Value::Null).await
}

async fn read_tavily_ciphertext(state: &AppState) -> Result<Option<Vec<u8>>, AppError> {
    let database = db(state).await;
    let Some(raw) =
        settings::get_value(database.conn(), "global", "search.tavilyKeyCiphertext").await?
    else {
        return Ok(None);
    };
    Ok(serde_json::from_value::<Vec<u8>>(raw).ok())
}

async fn current_tools_sandbox_settings(state: &AppState) -> Result<Value, AppError> {
    let stored = read_setting_json(state, "global", "settingsState", json!({})).await?;
    let stored_tools = stored
        .get("toolsSandbox")
        .cloned()
        .unwrap_or_else(|| json!({}));

    // Prefer the dedicated `search.*` settings rows (seeded by
    // m20260518_search_config) over the JSON blob. The blob path stays
    // as a legacy fallback so a user who flipped the toggle before this
    // commit doesn't get reset.
    let database = db(state).await;
    let provider_row = settings::get_value(database.conn(), "search", "provider")
        .await?
        .and_then(|v| v.as_str().map(str::to_owned));
    let searxng_row = settings::get_value(database.conn(), "search", "searxng_url")
        .await?
        .and_then(|v| v.as_str().map(str::to_owned));

    let mut search_provider = provider_row
        .or_else(|| {
            stored_tools
                .get("searchProvider")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "searxng".into());
    if search_provider != "tavily" && search_provider != "searxng" {
        search_provider = "searxng".into();
    }

    let searxng_url = searxng_row
        .or_else(|| {
            stored_tools
                .get("searxngUrl")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| "http://localhost:8888".into());
    let enabled_tools = stored_tools
        .get("enabledTools")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty())
        .unwrap_or_else(|| {
            let mut defaults = default_tool_names();
            defaults.insert(0, "web_search".into());
            defaults
        });

    let masked_key = if let Some(ciphertext) = read_tavily_ciphertext(state).await? {
        let opened = state
            .crypto
            .open(&ciphertext)
            .map_err(|e| AppError::Internal(format!("decrypt tavily key: {e}")))?;
        let key = String::from_utf8(opened).map_err(|e| AppError::Internal(e.to_string()))?;
        Some(mask_key(&key))
    } else {
        None
    };

    Ok(json!({
        "searchProvider": search_provider,
        "searxngUrl": searxng_url,
        "tavilyApiKey": "",
        "tavilyMaskedKey": masked_key,
        "enabledTools": enabled_tools,
    }))
}

async fn github_status_for_project(
    state: &AppState,
    project_id: &str,
) -> Result<Option<(GitHubClient, Option<String>)>, AppError> {
    let database = db(state).await;
    let scope = project_scope(project_id);
    let owner = settings::get_value(database.conn(), &scope, "github.owner")
        .await?
        .and_then(|value| value.as_str().map(ToOwned::to_owned));
    let repo = settings::get_value(database.conn(), &scope, "github.repo")
        .await?
        .and_then(|value| value.as_str().map(ToOwned::to_owned));
    let ciphertext = settings::get_value(database.conn(), &scope, "github.tokenCiphertext")
        .await?;
    let masked = settings::get_value(database.conn(), &scope, "github.maskedToken")
        .await?
        .and_then(|value| value.as_str().map(ToOwned::to_owned));
    let Some(owner) = owner else {
        return Ok(None);
    };
    let Some(repo) = repo else {
        return Ok(None);
    };
    let Some(ciphertext) = ciphertext else {
        return Ok(None);
    };
    let sealed = serde_json::from_value::<Vec<u8>>(ciphertext)
        .map_err(|e| AppError::Internal(format!("parse github token: {e}")))?;
    let token = String::from_utf8(
        state
            .crypto
            .open(&sealed)
            .map_err(|e| AppError::Internal(format!("decrypt github token: {e}")))?,
    )
    .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Some((GitHubClient::new(owner, repo, token), masked)))
}

async fn enabled_tools_for_turn(state: &AppState) -> Result<Vec<String>, AppError> {
    let settings = current_tools_sandbox_settings(state).await?;
    Ok(settings
        .get("enabledTools")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default())
}

async fn build_tooling(
    state: &AppState,
    project_id: &str,
    agent_id: Option<String>,
    message_id: &str,
    thread_id: &str,
) -> Result<Option<(ToolRegistry, ToolContext)>, AppError> {
    let global_enabled = enabled_tools_for_turn(state).await?;
    if global_enabled.is_empty() {
        return Ok(None);
    }

    // Intersect global allow-list with the agent's per-row `enabled_tools`
    // when an agent is bound to the thread. An empty agent list means
    // "unconfigured" (fall back to globals); a non-empty list narrows.
    let enabled_tools = if let Some(agent_id_ref) = agent_id.as_ref() {
        let database = db(state).await;
        let agent_row = agents::get(database.conn(), agent_id_ref).await?;
        if let Some(agent_row) = agent_row {
            let per_agent = agents::parse_enabled_tools(&agent_row.enabled_tools);
            if per_agent.is_empty() {
                global_enabled.clone()
            } else {
                global_enabled
                    .iter()
                    .filter(|name| per_agent.iter().any(|n| n == *name))
                    .cloned()
                    .collect::<Vec<_>>()
            }
        } else {
            global_enabled.clone()
        }
    } else {
        global_enabled.clone()
    };

    if enabled_tools.is_empty() {
        return Ok(None);
    }

    let data_dir = state.inner.read().await.data_dir.clone();
    let workspace_root = workspace_dir(&data_dir, project_id);
    let sandbox = Arc::new(
        LocalFsSandbox::new(&workspace_root)
            .map_err(|e| AppError::Internal(format!("init workspace sandbox: {e}")))?,
    );

    let mut registry = ToolRegistry::new();
    register_defaults(&mut registry);

    let search_settings = current_tools_sandbox_settings(state).await?;
    let provider = search_settings
        .get("searchProvider")
        .and_then(Value::as_str)
        .unwrap_or("searxng");
    let searxng_url = search_settings
        .get("searxngUrl")
        .and_then(Value::as_str)
        .unwrap_or("http://localhost:8888")
        .to_owned();
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| AppError::Internal(format!("build search client: {e}")))?;

    let search_provider: Arc<dyn hive_search::SearchProvider> = if provider == "tavily" {
        if let Some(ciphertext) = read_tavily_ciphertext(state).await? {
            let key = String::from_utf8(
                state
                    .crypto
                    .open(&ciphertext)
                    .map_err(|e| AppError::Internal(format!("decrypt tavily key: {e}")))?,
            )
            .map_err(|e| AppError::Internal(e.to_string()))?;
            Arc::new(TavilyProvider::new(http.clone(), key))
        } else {
            Arc::new(SearxNgProvider::new(http.clone(), searxng_url))
        }
    } else {
        Arc::new(SearxNgProvider::new(http.clone(), searxng_url))
    };
    register_web_search(&mut registry, search_provider);
    hive_runtime::register_agent_tools(
        &mut registry,
        db(state).await.clone(),
        state.executors.clone(),
        EventBus::new(state.events.clone()),
    );
    let registry = registry.filtered(&enabled_tools);

    let mut context = ToolContext::new(project_id.to_owned(), sandbox);
    if let Some(agent_id) = agent_id {
        context = context.with_agent(agent_id);
    }
    context = context
        .with_thread(thread_id.to_owned())
        .with_message(message_id.to_owned());

    Ok(Some((registry, context)))
}

fn cents_to_dollars(cents: i64) -> i64 {
    cents / 100
}

fn sqlite_url(path: PathBuf) -> String {
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    if let Some(stripped) = normalized.strip_prefix("//?/") {
        normalized = stripped.to_owned();
    }

    let prefix = if normalized.as_bytes().get(1) == Some(&b':') {
        "sqlite:///"
    } else {
        "sqlite://"
    };

    format!("{prefix}{normalized}?mode=rwc")
}

fn relative_time(timestamp: &str) -> String {
    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(timestamp) else {
        return "just now".to_owned();
    };
    let parsed = parsed.with_timezone(&chrono::Utc);
    let diff = chrono::Utc::now().signed_duration_since(parsed);
    if diff.num_seconds() < 60 {
        "just now".to_owned()
    } else if diff.num_minutes() < 60 {
        format!("{} min ago", diff.num_minutes())
    } else if diff.num_hours() < 24 {
        format!("{} hr ago", diff.num_hours())
    } else {
        format!("{} days ago", diff.num_days())
    }
}

fn format_elapsed(started_at: &str, ended_at: Option<&str>) -> String {
    let Ok(start) = chrono::DateTime::parse_from_rfc3339(started_at) else {
        return "00:00:00".to_owned();
    };
    let end = ended_at
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .unwrap_or_else(|| chrono::Utc::now().into());
    let diff = end.signed_duration_since(start);
    let total_seconds = diff.num_seconds().max(0);
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

async fn project_payload(
    database: &Db,
    project: hive_db::entities::project::Model,
) -> Result<Value, AppError> {
    let agent_count = agents::count_by_project(database.conn(), &project.id).await?;
    let used_cents =
        cost_events::total_cost_cents_for_project(database.conn(), &project.id).await?;
    Ok(json!({
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "healthScore": project.health_score,
        "specCompletion": project.spec_completion,
        "testCoverage": project.test_coverage,
        "sovereigntyTier": project.sovereignty_tier,
        "status": project.status,
        "agentCount": agent_count,
        "lastActivity": relative_time(project.last_activity_at.as_deref().unwrap_or(&project.updated_at)),
        "lastActivityAt": project.last_activity_at,
        "budget": {
            "used": cents_to_dollars(used_cents),
            "total": cents_to_dollars(i64::from(project.budget_total_cents))
        },
        "createdAt": project.created_at,
        "updatedAt": project.updated_at
    }))
}

async fn session_payload(database: &Db, project_id: &str) -> Result<Value, AppError> {
    let project = projects::get(database.conn(), project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    let active = sessions::get_active_by_project(database.conn(), project_id).await?;
    let latest = if active.is_some() {
        active
    } else {
        sessions::list_by_project(database.conn(), project_id)
            .await?
            .into_iter()
            .next()
    };

    let agent_count = agents::count_by_project(database.conn(), project_id).await?;
    if let Some(session) = latest {
        let budget_cents =
            cost_events::total_cost_cents_for_session(database.conn(), &session.id).await?;
        let tokens_used =
            cost_events::total_tokens_for_session(database.conn(), &session.id).await?;
        Ok(json!({
            "id": session.id,
            "isActive": session.is_active,
            "startedAt": session.started_at,
            "endedAt": session.ended_at,
            "elapsed": format_elapsed(&session.started_at, session.ended_at.as_deref()),
            "tokensUsed": tokens_used,
            "budgetUsed": cents_to_dollars(budget_cents),
            "budgetTotal": cents_to_dollars(i64::from(project.budget_total_cents)),
            "agentCount": agent_count
        }))
    } else {
        Ok(json!({
            "id": null,
            "isActive": false,
            "startedAt": null,
            "endedAt": null,
            "elapsed": "00:00:00",
            "tokensUsed": 0,
            "budgetUsed": 0,
            "budgetTotal": cents_to_dollars(i64::from(project.budget_total_cents)),
            "agentCount": agent_count
        }))
    }
}

/// Liveness — process is up. Always 200. Used by orchestrators to decide
/// "is this container alive at all" — distinct from readiness which gates
/// "should I send traffic to it yet".
async fn healthz(State(state): State<AppState>) -> Json<Value> {
    let current = state.inner.read().await;
    Json(json!({ "ok": true, "db": current.engine }))
}

/// Readiness — process is alive AND able to serve. 200 only when:
/// - the configured database accepts a trivial query
/// - `needs_setup == false` (the first-run flow has completed)
///
/// Returns 503 + a structured reason otherwise so a load balancer
/// drops traffic during database hiccups instead of returning failures
/// to users.
async fn readyz(State(state): State<AppState>) -> Response {
    use sea_orm::ConnectionTrait;
    let snapshot = state.inner.read().await;
    if snapshot.needs_setup {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "ok": false, "reason": "needs_setup" })),
        )
            .into_response();
    }
    let engine = snapshot.engine.clone();
    drop(snapshot);

    let database = db(&state).await;
    let backend = database.conn().get_database_backend();
    let probe = sea_orm::Statement::from_string(backend, "SELECT 1".to_owned());
    match database.conn().execute(probe).await {
        Ok(_) => Json(json!({ "ok": true, "db": engine })).into_response(),
        Err(err) => {
            tracing::warn!(error = %err, "readyz: db probe failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({ "ok": false, "reason": "db_probe_failed" })),
            )
                .into_response()
        }
    }
}

async fn setup_status(State(state): State<AppState>) -> Json<SetupStatus> {
    let current = state.inner.read().await;
    Json(SetupStatus {
        needs_setup: current.needs_setup,
        engine: current.engine.clone(),
        data_dir: current.data_dir.display().to_string(),
    })
}

async fn setup_database(
    State(state): State<AppState>,
    Json(body): Json<SetupDatabaseBody>,
) -> Result<Json<SetupStatus>, AppError> {
    let config_path = state.workspace_root.join("config").join("local.toml");
    let data_dir = state.workspace_root.join("data");
    fs::create_dir_all(&data_dir).map_err(|err| AppError::Internal(err.to_string()))?;

    let database_url = if body.engine == "postgres" {
        body.url
            .clone()
            .ok_or_else(|| AppError::BadRequest("postgres url is required".into()))?
    } else {
        body.url
            .clone()
            .unwrap_or_else(|| sqlite_url(data_dir.join("hive.db")))
    };

    let db = Db::connect(&database_url, true).await?;
    // Only seed demo data on an empty database. `seed_demo` is mostly idempotent
    // via its `ensure_*` helpers, but re-running it on an already-populated DB
    // re-adds global notifications and clobbers manual project edits. The explicit
    // `POST /v1/setup/seed` handler remains for operators who want to force a reseed.
    if projects::list(db.conn()).await?.is_empty() {
        seed_demo(db.conn()).await?;
    }

    let config_toml = format!(
        "[database]\nurl = \"{}\"\n",
        database_url.replace('\\', "\\\\")
    );
    fs::write(&config_path, config_toml).map_err(|err| AppError::Internal(err.to_string()))?;

    {
        let mut current = state.inner.write().await;
        current.db = db;
        current.database_url = database_url;
        current.engine = body.engine.clone();
        current.needs_setup = false;
    }

    Ok(Json(SetupStatus {
        needs_setup: false,
        engine: body.engine,
        data_dir: data_dir.display().to_string(),
    }))
}

async fn seed_database(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    seed_demo(database.conn()).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn events_stream(
    State(state): State<AppState>,
) -> Sse<impl futures_core::Stream<Item = Result<Event, axum::Error>>> {
    let mut receiver = state.events.subscribe();
    let stream = async_stream::stream! {
        loop {
            match receiver.recv().await {
                Ok(message) => match Event::default().event(&message.event).json_data(&message.data) {
                    Ok(event) => yield Ok(event),
                    Err(err) => {
                        tracing::warn!(
                            event = %message.event,
                            error = %err,
                            "skipping malformed sse event"
                        );
                        continue;
                    }
                },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::warn!(skipped, "sse subscriber lagged");
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}

async fn openapi_json(
    State(_state): State<AppState>,
) -> Result<
    (
        StatusCode,
        [(axum::http::HeaderName, &'static str); 1],
        String,
    ),
    AppError,
> {
    // The OpenAPI document is not yet generated from the real route handlers.
    // BACKEND_PLAN.md calls for utoipa-driven generation; that work is tracked
    // in HANDOFF_ISSUES.md §1.3. Until then, we must NOT serve the stub
    // `openapi/openapi.json` as if it described the API — clients that trust
    // it would get 404/422s on every route. Return 501 with a structured body
    // so callers fail loudly instead of silently.
    let body = json!({
        "error": {
            "code": "openapi_not_generated",
            "message": "OpenAPI document is not yet generated. See HANDOFF_ISSUES.md §1.3.",
        }
    })
    .to_string();
    Ok((
        StatusCode::NOT_IMPLEMENTED,
        [(axum::http::header::CONTENT_TYPE, "application/json")],
        body,
    ))
}

async fn list_projects(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let mut payload = Vec::new();
    for project in projects::list(database.conn()).await? {
        payload.push(project_payload(&database, project).await?);
    }
    Ok(Json(json!(payload)))
}

async fn get_active_project(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let Some(project_id) = active_project_id(&state).await? else {
        return Ok(Json(Value::Null));
    };
    let database = db(&state).await;
    let project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    Ok(Json(project_payload(&database, project).await?))
}

async fn get_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    Ok(Json(project_payload(&database, project).await?))
}

async fn create_project(
    State(state): State<AppState>,
    Json(body): Json<CreateProjectBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let project = projects::create(
        database.conn(),
        projects::CreateProject {
            name: body.name,
            description: body.description,
            sovereignty_tier: body.sovereignty_tier,
            budget_total_cents: body.budget_total_cents,
            status: body.status.unwrap_or_else(|| "active".to_owned()),
        },
    )
    .await?;
    audit::append(
        database.conn(),
        "local_operator",
        "project.create",
        "project",
        &project.id,
        None,
        Some(serde_json::to_value(&project).unwrap_or(Value::Null)),
    )
    .await?;
    if active_project_id(&state).await?.is_none() {
        projects::activate(database.conn(), &project.id).await?;
    }
    let payload = project_payload(&database, project).await?;
    emit(&state, "project.updated", payload.clone()).await;
    Ok(Json(payload))
}

async fn update_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<UpdateProjectBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let before = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    let updated = projects::update(
        database.conn(),
        &project_id,
        projects::UpdateProject {
            name: body.name,
            description: body.description,
            sovereignty_tier: body.sovereignty_tier,
            budget_total_cents: body.budget_total_cents,
            status: body.status,
            health_score: body.health_score,
            spec_completion: body.spec_completion,
            test_coverage: body.test_coverage,
        },
    )
    .await?;
    audit::append(
        database.conn(),
        "local_operator",
        "project.update",
        "project",
        &project_id,
        Some(serde_json::to_value(&before).unwrap_or(Value::Null)),
        Some(serde_json::to_value(&updated).unwrap_or(Value::Null)),
    )
    .await?;
    let payload = project_payload(&database, updated).await?;
    emit(&state, "project.updated", payload.clone()).await;
    Ok(Json(payload))
}

async fn delete_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;

    projects::delete(database.conn(), &project_id).await?;

    audit::append(
        database.conn(),
        "local_operator",
        "project.delete",
        "project",
        &project_id,
        Some(serde_json::to_value(&project).unwrap_or(Value::Null)),
        None,
    )
    .await?;

    // If we deleted the active project, clear it
    if active_project_id(&state).await? == Some(project_id.clone()) {
        settings::put_value(database.conn(), "global", "activeProjectId", Value::Null).await?;
    }

    emit(&state, "project.deleted", json!({ "id": project_id })).await;
    Ok(Json(json!({ "ok": true })))
}

async fn activate_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    projects::activate(database.conn(), &project_id).await?;
    emit(&state, "project.updated", json!({ "id": project_id })).await;
    Ok(Json(json!({ "ok": true })))
}

async fn list_agents(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    Ok(Json(json!(
        agents::list_by_project(database.conn(), &project_id).await?
    )))
}

async fn create_agent(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateAgentBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let slug = body.slug.unwrap_or_else(|| {
        format!(
            "{}-{}",
            body.role.to_lowercase().chars().take(2).collect::<String>(),
            chrono::Utc::now().timestamp() % 1000
        )
    });
    let agent = agents::create(
        database.conn(),
        agents::CreateAgent {
            project_id,
            slug,
            name: body.name,
            role: body.role,
            model: body.model,
            status: body.status.unwrap_or_else(|| "idle".to_owned()),
            parent_agent_id: body.parent_agent_id,
            spawned_by_message_id: body.spawned_by_message_id,
            enabled_tools: body.enabled_tools,
            system_prompt: body.system_prompt,
            model_provider_id: body.model_provider_id,
            model_id: body.model_id,
        },
    )
    .await?;
    audit::append(
        database.conn(),
        "local_operator",
        "agent.create",
        "agent",
        &agent.id,
        None,
        Some(serde_json::to_value(&agent).unwrap_or(Value::Null)),
    )
    .await?;
    emit(
        &state,
        "agent.status",
        json!({ "id": agent.id, "status": agent.status }),
    )
    .await;
    Ok(Json(json!(agent)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DispatchAgentBody {
    content: String,
    #[serde(default)]
    from_agent_id: Option<String>,
    #[serde(default)]
    thread_id: Option<String>,
}

async fn get_agent_lineage(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let parents = agents::ancestors(database.conn(), &agent_id).await?;
    let children = agents::descendants(database.conn(), &agent_id).await?;
    Ok(Json(json!({ "parents": parents, "children": children })))
}

async fn dispatch_to_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(body): Json<DispatchAgentBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let agent = agents::get(database.conn(), &agent_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent {agent_id} not found")))?;
    let msg = agent_messages::enqueue(
        database.conn(),
        agent_messages::EnqueueAgentMessage {
            project_id: agent.project_id.clone(),
            to_agent_id: agent.id.clone(),
            from_agent_id: body.from_agent_id,
            content: body.content,
            thread_id: body.thread_id,
            reply_to_message_id: None,
        },
    )
    .await?;
    let _ = state.executors.ensure(&agent.id, &agent.project_id).await;
    state
        .executors
        .dispatch(
            &agent.id,
            hive_runtime::InboxItem {
                message_id: msg.id.clone(),
                content: msg.content.clone(),
                thread_id: msg.thread_id.clone(),
                from_agent_id: msg.from_agent_id.clone(),
            },
        )
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(Json(json!({ "messageId": msg.id })))
}

async fn pause_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let agent = agents::get(database.conn(), &agent_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent {agent_id} not found")))?;
    let _ = state.executors.ensure(&agent.id, &agent.project_id).await;
    state
        .executors
        .pause(&agent_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let _ = agents::set_status(database.conn(), &agent_id, "paused").await?;
    emit(
        &state,
        "agent.status",
        json!({ "id": agent_id, "status": "paused" }),
    )
    .await;
    Ok(Json(json!({ "id": agent_id, "status": "paused" })))
}

async fn resume_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let agent = agents::get(database.conn(), &agent_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent {agent_id} not found")))?;
    let _ = state.executors.ensure(&agent.id, &agent.project_id).await;
    state
        .executors
        .resume(&agent_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let _ = agents::set_status(database.conn(), &agent_id, "working").await?;
    emit(
        &state,
        "agent.status",
        json!({ "id": agent_id, "status": "working" }),
    )
    .await;
    Ok(Json(json!({ "id": agent_id, "status": "working" })))
}

async fn terminate_agent(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let _ = state
        .executors
        .terminate(&agent_id)
        .await
        .map_err(|e| AppError::Internal(e.to_string()));
    let _ = agents::set_status(database.conn(), &agent_id, "deprecated").await;
    emit(
        &state,
        "agent.status",
        json!({ "id": agent_id, "status": "deprecated" }),
    )
    .await;
    Ok(Json(json!({ "id": agent_id, "status": "deprecated" })))
}

async fn ensure_coordinator(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let existing = agents::list_by_project(database.conn(), &project_id).await?;
    if let Some(coord) = existing.into_iter().find(|a| a.role == "Coordinator") {
        let _ = state.executors.ensure(&coord.id, &project_id).await;
        return Ok(Json(json!(coord)));
    }
    let created = agents::create(
        database.conn(),
        agents::CreateAgent {
            project_id: project_id.clone(),
            slug: "coordinator".into(),
            name: "Coordinator".into(),
            role: "Coordinator".into(),
            model: "auto".into(),
            status: "idle".into(),
            parent_agent_id: None,
            spawned_by_message_id: None,
            enabled_tools: Some(vec![
                "fs_read".into(),
                "fs_list".into(),
                "fs_write".into(),
                "shell_exec".into(),
                "web_fetch".into(),
                "web_search".into(),
                "spawn_agent".into(),
                "message_agent".into(),
            ]),
            system_prompt: Some(
                "You are the Coordinator. Plan tasks, then spawn specialist agents to execute them."
                    .into(),
            ),
            model_provider_id: None,
            model_id: None,
        },
    )
    .await?;
    let _ = state.executors.ensure(&created.id, &project_id).await;
    Ok(Json(json!(created)))
}

async fn list_tool_manifests(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    // Build a registry containing every tool the runtime knows about, then
    // surface their manifests so the UI can let users pick allow-lists.
    let mut registry = ToolRegistry::new();
    register_defaults(&mut registry);
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| AppError::Internal(format!("build search client: {e}")))?;
    let placeholder: Arc<dyn hive_search::SearchProvider> =
        Arc::new(SearxNgProvider::new(http, "http://localhost:8888".to_string()));
    register_web_search(&mut registry, placeholder);

    let global = enabled_tools_for_turn(&state).await.unwrap_or_default();
    let manifests = registry.manifests();
    let payload: Vec<Value> = manifests
        .into_iter()
        .map(|m| {
            json!({
                "name": m.name,
                "description": m.description,
                "sideEffects": m.side_effects,
                "defaultEnabled": global.iter().any(|n| n == &m.name),
            })
        })
        .collect();
    Ok(Json(json!(payload)))
}

async fn set_agent_status(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
    Json(body): Json<StatusBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let before = agents::get(database.conn(), &agent_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("agent {agent_id} not found")))?;
    let updated = agents::set_status(database.conn(), &agent_id, &body.status).await?;
    audit::append(
        database.conn(),
        "local_operator",
        "agent.set_status",
        "agent",
        &agent_id,
        Some(serde_json::to_value(&before).unwrap_or(Value::Null)),
        Some(serde_json::to_value(&updated).unwrap_or(Value::Null)),
    )
    .await?;
    emit(
        &state,
        "agent.status",
        json!({ "id": updated.id, "status": updated.status }),
    )
    .await;
    Ok(Json(json!(updated)))
}

async fn get_agent_messages(
    State(state): State<AppState>,
    Path(agent_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let rows = agent_messages::list_by_agent(database.conn(), &agent_id, 50).await?;
    Ok(Json(json!(
        rows.into_iter()
            .map(|row| {
                json!({
                    "id": row.id,
                    "projectId": row.project_id,
                    "fromAgentId": row.from_agent_id,
                    "toAgentId": row.to_agent_id,
                    "threadId": row.thread_id,
                    "replyToMessageId": row.reply_to_message_id,
                    "content": row.content,
                    "toolCalls": row.tool_calls,
                    "status": row.status,
                    "createdAt": row.created_at,
                    "completedAt": row.completed_at,
                })
            })
            .collect::<Vec<_>>()
    )))
}

async fn list_tasks(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    Ok(Json(json!(
        tasks::list_by_project(database.conn(), &project_id).await?
    )))
}

async fn set_task_status(
    State(state): State<AppState>,
    Path(task_id): Path<String>,
    Json(body): Json<StatusBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let before = tasks::get(database.conn(), &task_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("task {task_id} not found")))?;
    let updated = tasks::set_status(database.conn(), &task_id, &body.status).await?;
    audit::append(
        database.conn(),
        "local_operator",
        "task.set_status",
        "task",
        &task_id,
        Some(serde_json::to_value(&before).unwrap_or(Value::Null)),
        Some(serde_json::to_value(&updated).unwrap_or(Value::Null)),
    )
    .await?;
    emit(
        &state,
        "task.status",
        json!({ "id": updated.id, "status": updated.status }),
    )
    .await;
    Ok(Json(json!(updated)))
}

async fn list_alerts(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let payload: Vec<Value> = alerts::list_by_project(database.conn(), &project_id)
        .await?
        .into_iter()
        .map(|alert| {
            json!({
                "id": alert.id,
                "projectId": alert.project_id,
                "severity": alert.severity,
                "title": alert.title,
                "message": alert.message,
                "source": alert.source,
                "actionLabel": alert.action_label,
                "actionKind": alert.action_kind,
                "timestamp": relative_time(&alert.created_at),
                "createdAt": alert.created_at
            })
        })
        .collect();
    Ok(Json(json!(payload)))
}

async fn dismiss_alert(
    State(state): State<AppState>,
    Path(alert_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    alerts::dismiss(database.conn(), &alert_id).await?;
    emit(&state, "alert.dismissed", json!({ "id": alert_id })).await;
    Ok(Json(json!({ "ok": true })))
}

async fn list_notifications(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let payload: Vec<Value> = notifications::list_all(database.conn())
        .await?
        .into_iter()
        .map(|notification| {
            json!({
                "id": notification.id,
                "projectId": notification.project_id,
                "type": notification.r#type,
                "title": notification.title,
                "message": notification.message,
                "actionable": notification.actionable,
                "actionLabel": notification.action_label,
                "read": notification.read_at.is_some(),
                "readAt": notification.read_at,
                "dismissedAt": notification.dismissed_at,
                "time": relative_time(&notification.created_at),
                "createdAt": notification.created_at
            })
        })
        .collect();
    Ok(Json(json!(payload)))
}

async fn mark_notification_read(
    State(state): State<AppState>,
    Path(notification_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    notifications::mark_read(database.conn(), &notification_id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn mark_all_notifications_read(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    notifications::mark_all_read(database.conn()).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn dismiss_notification(
    State(state): State<AppState>,
    Path(notification_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    notifications::dismiss(database.conn(), &notification_id).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn list_notes(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let payload: Vec<Value> = notes::list_by_project(database.conn(), &project_id)
        .await?
        .into_iter()
        .map(|note| {
            json!({
                "id": note.id,
                "projectId": note.project_id,
                "category": note.category,
                "title": note.title,
                "content": note.content,
                "auto": note.auto,
                "author": note.author,
                "time": relative_time(&note.created_at),
                "createdAt": note.created_at,
                "updatedAt": note.updated_at
            })
        })
        .collect();
    Ok(Json(json!(payload)))
}

async fn create_note(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateNoteBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let note = notes::create(
        database.conn(),
        notes::CreateNote {
            project_id,
            category: body.category,
            title: body.title,
            content: body.content,
            auto: body.auto.unwrap_or(false),
            author: body.author.unwrap_or_else(|| "Operator".to_owned()),
        },
    )
    .await?;
    Ok(Json(json!(note)))
}

async fn list_tech_debt(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    Ok(Json(json!(
        tech_debt::list_by_project(database.conn(), &project_id).await?
    )))
}

async fn move_tech_debt_item(
    State(state): State<AppState>,
    Path(item_id): Path<String>,
    Json(body): Json<MoveTechDebtBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let updated = tech_debt::move_item(database.conn(), &item_id, &body.severity).await?;
    Ok(Json(json!(updated)))
}

async fn list_sprints(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    Ok(Json(json!(
        sprints::list_by_project(database.conn(), &project_id).await?
    )))
}

async fn reorder_sprints(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<ReorderSprintsBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let reordered =
        sprints::reorder(database.conn(), &project_id, &body.from_id, &body.to_id).await?;
    Ok(Json(json!(reordered)))
}

async fn get_project_session(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    Ok(Json(session_payload(&database, &project_id).await?))
}

async fn toggle_project_session(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let toggled = sessions::toggle_for_project(database.conn(), &project_id).await?;
    let agent_list = agents::list_by_project(database.conn(), &project_id).await?;
    for agent in agent_list {
        let next_status = if toggled.is_active {
            if agent.status == "paused" {
                Some("working")
            } else {
                None
            }
        } else if agent.status == "working" {
            Some("paused")
        } else {
            None
        };

        if let Some(status) = next_status {
            let _ = agents::set_status(database.conn(), &agent.id, status).await?;
        }
    }

    let payload = session_payload(&database, &project_id).await?;
    emit(
        &state,
        "session.toggled",
        json!({ "projectId": project_id, "isActive": toggled.is_active }),
    )
    .await;
    if !toggled.is_active {
        emit(
            &state,
            "session.closed",
            json!({ "projectId": toggled.project_id, "sessionId": toggled.id }),
        )
        .await;
    }
    Ok(Json(payload))
}

async fn extend_project_budget(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<ExtendBudgetBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let updated = projects::update(
        database.conn(),
        &project_id,
        projects::UpdateProject {
            name: None,
            description: None,
            sovereignty_tier: None,
            budget_total_cents: Some(body.new_total_cents),
            status: None,
            health_score: None,
            spec_completion: None,
            test_coverage: None,
        },
    )
    .await?;
    emit(
        &state,
        "project.updated",
        json!({ "id": updated.id, "changedFields": ["budget"] }),
    )
    .await;
    Ok(Json(project_payload(&database, updated).await?))
}

async fn get_project_activity(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "activityFeed", json!([])).await?,
    ))
}

async fn get_project_session_history(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "sessionHistory", json!([])).await?,
    ))
}

async fn get_project_requirements(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "requirements", json!([])).await?,
    ))
}

async fn get_project_user_stories(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "userStories", json!([])).await?,
    ))
}

async fn get_project_quality_over_time(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "insights.qualityOverTime", json!([])).await?,
    ))
}

async fn get_project_spend(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "insights.spend", json!([])).await?,
    ))
}

async fn get_project_task_throughput(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let scope = format!("project:{project_id}");
    Ok(Json(
        read_setting_json(&state, &scope, "insights.taskThroughput", json!([])).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InsightsRangeQuery {
    /// Range duration like `24h`, `2h`, `7d`. Default `24h`.
    #[serde(default)]
    range: Option<String>,
    /// Bucket width for the timeline endpoint, like `5m`, `1h`. Default `1h`.
    #[serde(default)]
    bucket: Option<String>,
}

fn parse_duration_or(input: Option<&str>, fallback_secs: i64) -> i64 {
    let Some(s) = input else { return fallback_secs };
    let s = s.trim();
    let (n, unit) = s.split_at(s.len() - 1);
    let value: i64 = n.parse().unwrap_or(0);
    match unit {
        "s" => value,
        "m" => value * 60,
        "h" => value * 3_600,
        "d" => value * 86_400,
        _ => fallback_secs,
    }
}

/// Cost over time, bucketed.
///
/// Reads `cost_events` for the project within `range` and aggregates into
/// fixed-width time buckets. Returned as `[{ time: ISO8601, cents, tokens }]`.
async fn get_project_cost_timeline(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<InsightsRangeQuery>,
) -> Result<Json<Value>, AppError> {
    use chrono::{DateTime, Duration, Utc};

    let database = db(&state).await;
    let _project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;

    let range_secs = parse_duration_or(query.range.as_deref(), 86_400);
    let bucket_secs = parse_duration_or(query.bucket.as_deref(), 3_600).max(60);

    let cutoff = Utc::now() - Duration::seconds(range_secs);
    let events = cost_events::list_by_project(database.conn(), &project_id).await?;

    // In-memory bucketing avoids per-backend SQL (SQLite has no date_trunc).
    // For dashboards on small datasets this is fine; if the table grows past
    // ~100k rows we'll push the aggregation to SQL.
    let mut buckets: std::collections::BTreeMap<i64, (i64, i64)> = std::collections::BTreeMap::new();
    for event in &events {
        let Ok(ts) = DateTime::parse_from_rfc3339(&event.created_at) else {
            continue;
        };
        let ts_utc = ts.with_timezone(&Utc);
        if ts_utc < cutoff {
            continue;
        }
        let bucket_key = ts_utc.timestamp() / bucket_secs * bucket_secs;
        let entry = buckets.entry(bucket_key).or_insert((0, 0));
        entry.0 += event.cost_cents;
        entry.1 += i64::from(event.tokens_in) + i64::from(event.tokens_out);
    }

    let series: Vec<Value> = buckets
        .into_iter()
        .map(|(ts, (cents, tokens))| {
            let dt = DateTime::<Utc>::from_timestamp(ts, 0).unwrap_or_else(Utc::now);
            json!({
                "time": dt.to_rfc3339(),
                "cents": cents,
                "tokens": tokens,
            })
        })
        .collect();

    Ok(Json(json!(series)))
}

/// Sum of input + output tokens per agent over the range.
async fn get_project_agent_token_usage(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<InsightsRangeQuery>,
) -> Result<Json<Value>, AppError> {
    use chrono::{DateTime, Duration, Utc};

    let database = db(&state).await;
    let _project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;

    let range_secs = parse_duration_or(query.range.as_deref(), 86_400);
    let cutoff = Utc::now() - Duration::seconds(range_secs);

    let events = cost_events::list_by_project(database.conn(), &project_id).await?;
    let mut by_agent: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for event in events {
        let Ok(ts) = DateTime::parse_from_rfc3339(&event.created_at) else {
            continue;
        };
        if ts.with_timezone(&Utc) < cutoff {
            continue;
        }
        let key = event.agent_id.unwrap_or_else(|| "unattributed".into());
        let total = i64::from(event.tokens_in) + i64::from(event.tokens_out);
        *by_agent.entry(key).or_default() += total;
    }

    let mut series: Vec<Value> = by_agent
        .into_iter()
        .map(|(agent_id, tokens)| json!({ "agentId": agent_id, "tokens": tokens }))
        .collect();
    series.sort_by(|a, b| {
        b["tokens"]
            .as_i64()
            .unwrap_or(0)
            .cmp(&a["tokens"].as_i64().unwrap_or(0))
    });

    Ok(Json(json!(series)))
}

/// Count of tasks grouped by status for the project.
async fn get_project_task_distribution(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let _project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;

    let task_rows = tasks::list_by_project(database.conn(), &project_id).await?;
    let mut by_status: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for task in task_rows {
        *by_status.entry(task.status.clone()).or_default() += 1;
    }

    let series: Vec<Value> = by_status
        .into_iter()
        .map(|(status, count)| json!({ "status": status, "count": count }))
        .collect();

    Ok(Json(json!(series)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenesisPreviewBody {
    description: String,
    /// Optional spec text imported from a markdown/text file. When present
    /// the preview is grounded in this text rather than the description.
    #[serde(default)]
    spec_text: Option<String>,
    #[serde(default)]
    agent_count: Option<u32>,
}

/// Generate a project plan preview from a free-text description.
///
/// Today this is deterministic and grounded in the input — the LLM-driven
/// path described in the original plan (call the configured provider with a
/// structured-output prompt) lands in a follow-up. The deterministic output
/// is shaped exactly like the LLM output will be, so the frontend doesn't
/// need to change when the upgrade ships.
async fn post_project_genesis_preview(
    State(_state): State<AppState>,
    Json(body): Json<GenesisPreviewBody>,
) -> Result<Json<Value>, AppError> {
    if body.description.trim().is_empty() && body.spec_text.is_none() {
        return Err(AppError::BadRequest(
            "description or specText required".into(),
        ));
    }

    let source_text = body
        .spec_text
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&body.description);
    let agent_count = body.agent_count.unwrap_or(3).clamp(1, 12) as usize;

    // Lift the first few interesting words out of the input so the
    // preview reads as grounded rather than generic.
    let lead_words: Vec<&str> = source_text
        .split_whitespace()
        .filter(|w| w.len() > 3 && w.chars().next().is_some_and(|c| c.is_alphabetic()))
        .take(3)
        .collect();
    let lead = if lead_words.is_empty() {
        "the system".to_owned()
    } else {
        lead_words.join(" ")
    };

    let phases = json!([
        {
            "phase": "Phase 1 · Foundations",
            "tasks": [
                format!("Set up project structure for {lead}"),
                "Configure routing and shell".to_string(),
                "Initialise workspace and git repository".to_string(),
            ],
        },
        {
            "phase": "Phase 2 · Core surface",
            "tasks": [
                format!("Wire interactive controls for {lead}"),
                "Connect cross-page state".to_string(),
                "Add persisted preferences".to_string(),
            ],
        },
        {
            "phase": "Phase 3 · Polish & ship",
            "tasks": [
                "Verify interactions end-to-end".to_string(),
                "Polish activity flows and accessibility".to_string(),
                "Prepare launch report".to_string(),
            ],
        },
    ]);

    let requirements = json!([
        { "title": format!("MVP user surface for {lead}"), "priority": "must" },
        { "title": "Persisted user preferences across sessions", "priority": "should" },
        { "title": "Observable cost and usage metrics", "priority": "should" },
    ]);

    let roles: &[&str] = &[
        "Coordinator",
        "Frontend",
        "Backend",
        "QA",
        "DevOps",
        "Security",
        "Docs",
        "Designer",
        "Data",
        "Researcher",
        "Reviewer",
        "Release",
    ];
    let roster: Vec<Value> = roles
        .iter()
        .take(agent_count)
        .map(|role| json!({ "role": role }))
        .collect();

    Ok(Json(json!({
        "phases": phases,
        "requirements": requirements,
        "roster": roster,
        "estimatedDurationDays": (agent_count as u32) * 3,
        "sourceCharacters": source_text.chars().count(),
    })))
}

async fn list_modules(
    State(state): State<AppState>,
    Path(_project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    Ok(Json(
        read_setting_json(&state, "global", "moduleCatalog", json!([])).await?,
    ))
}

async fn get_module(
    State(state): State<AppState>,
    Path(module_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let modules = read_setting_json(&state, "global", "moduleCatalog", json!([])).await?;
    let Some(module) = modules
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(module_id.as_str()))
        })
        .cloned()
    else {
        return Err(AppError::NotFound(format!("module {module_id} not found")));
    };
    Ok(Json(module))
}

async fn install_module(
    State(state): State<AppState>,
    Path((_project_id, module_id)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let mut modules = settings::get_value(database.conn(), "global", "moduleCatalog")
        .await?
        .unwrap_or_else(|| json!([]));
    let mut installed = None;
    if let Some(items) = modules.as_array_mut() {
        for item in items {
            if item.get("id").and_then(Value::as_str) == Some(module_id.as_str()) {
                item["status"] = json!("installed");
                installed = Some(item.clone());
            }
        }
    }
    settings::put_value(database.conn(), "global", "moduleCatalog", modules).await?;
    let result =
        installed.ok_or_else(|| AppError::NotFound(format!("module {module_id} not found")))?;
    emit(&state, "module.installed", result.clone()).await;
    Ok(Json(result))
}

async fn get_agent_blueprints(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    Ok(Json(
        read_setting_json(&state, "global", "agentBlueprints", json!([])).await?,
    ))
}

async fn get_workspace_info(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let _project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;

    // Prefer the persisted row from `project_workspaces` (Phase 3.1
    // schema). Fall back to filesystem inspection only when no row
    // exists yet (the project was created before workspace init).
    if let Some(row) = project_workspaces::get_by_project(database.conn(), &project_id).await? {
        return Ok(Json(json!(WorkspaceInfo {
            project_id,
            sandbox_kind: row.sandbox_kind,
            status: row.status,
            root_path: row.root_path,
        })));
    }

    let data_dir = state.inner.read().await.data_dir.clone();
    let root = workspace_dir(&data_dir, &project_id);
    // No DB row yet — surface `uninitialised` honestly so the UI shows
    // the Init button. Don't claim `ready` just because the directory
    // happens to exist on disk; the row is the source of truth.
    let status = if root.exists() { "uninitialised" } else { "missing" };
    Ok(Json(json!(WorkspaceInfo {
        project_id,
        sandbox_kind: "local".into(),
        status: status.into(),
        root_path: root.to_string_lossy().into_owned(),
    })))
}

async fn init_workspace(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let _project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    let data_dir = state.inner.read().await.data_dir.clone();
    let root = workspace_dir(&data_dir, &project_id);
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(|e| AppError::Internal(format!("create workspace: {e}")))?;
    GitRepo::new(root.clone())
        .init()
        .map_err(|e| AppError::Internal(format!("init git repo: {e}")))?;

    // Persist the workspace row so the choice (sandbox kind, root path)
    // survives across restarts and so subsequent /workspace/info calls
    // return the same answer.
    let upsert = project_workspaces::UpsertWorkspace {
        project_id: project_id.clone(),
        sandbox_kind: project_workspaces::SandboxKind::Local,
        root_path: root.to_string_lossy().into_owned(),
        container_id: None,
        status: project_workspaces::WorkspaceStatus::Ready,
        last_error: None,
    };
    let row = project_workspaces::upsert(database.conn(), upsert).await?;
    let _ = project_workspaces::mark_started(database.conn(), &project_id).await;

    emit(
        &state,
        "workspace.updated",
        json!({ "projectId": project_id, "status": row.status }),
    )
    .await;
    Ok(Json(json!(WorkspaceInfo {
        project_id,
        sandbox_kind: row.sandbox_kind,
        status: row.status,
        root_path: row.root_path,
    })))
}

fn git_error(err: GitError) -> AppError {
    AppError::BadRequest(err.to_string())
}

async fn git_repo_for_project(state: &AppState, project_id: &str) -> Result<GitRepo, AppError> {
    let data_dir = state.inner.read().await.data_dir.clone();
    Ok(GitRepo::new(workspace_dir(&data_dir, project_id)))
}

fn synthesis_job_json(job: &hive_db::entities::synthesis_job::Model) -> Value {
    json!({
        "id": job.id,
        "projectId": job.project_id,
        "status": job.status,
        "description": job.description,
        "tier": job.tier,
        "providerId": job.provider_id,
        "modelId": job.model_id,
        "manifestJson": job.manifest_json,
        "generatedFilesJson": job.generated_files_json,
        "error": job.error,
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
        "completedAt": job.completed_at,
        "publishedAt": job.published_at,
        "publishedVisibility": job.published_visibility,
        "publishedSummary": job.published_summary,
    })
}

async fn init_git_repo(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let _ = init_workspace(State(state.clone()), Path(project_id.clone())).await?;
    let repo = git_repo_for_project(&state, &project_id).await?;
    repo.init().map_err(git_error)?;
    emit(&state, "git.changed", json!({ "projectId": project_id })).await;
    Ok(Json(json!({ "ok": true })))
}

async fn get_git_status(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    Ok(Json(json!(repo.status().map_err(git_error)?)))
}

async fn list_git_branches(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    Ok(Json(json!(repo.branches().map_err(git_error)?)))
}

async fn create_git_branch(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreateGitBranchBody>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    repo.create_branch(&body.name).map_err(git_error)?;
    emit(&state, "git.changed", json!({ "projectId": project_id })).await;
    Ok(Json(json!({ "ok": true, "name": body.name })))
}

async fn checkout_git_branch(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CheckoutGitBranchBody>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    repo.checkout(&body.name, body.create).map_err(git_error)?;
    emit(&state, "git.changed", json!({ "projectId": project_id })).await;
    Ok(Json(json!({ "ok": true, "name": body.name })))
}

async fn get_git_log(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<GitLogQuery>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    Ok(Json(json!(
        repo.log(query.limit.unwrap_or(30).min(200))
            .map_err(git_error)?
    )))
}

async fn get_git_tree(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<GitTreeQuery>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    let entries: Vec<GitTreeEntry> = repo.tree(query.reference.as_deref()).map_err(git_error)?;
    Ok(Json(json!(entries)))
}

async fn get_git_file(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    axum::extract::Query(query): axum::extract::Query<GitFileQuery>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    let file: GitFile = repo.file(query.reference.as_deref(), &query.path).map_err(git_error)?;
    Ok(Json(json!(file)))
}

async fn get_git_diff(
    State(state): State<AppState>,
    Path((project_id, reference)): Path<(String, String)>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    let diff: GitDiff = repo.diff(Some(&reference)).map_err(git_error)?;
    Ok(Json(json!(diff)))
}

async fn commit_git_changes(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CommitGitBody>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    let commit = repo
        .commit(
            &body.message,
            body.author.as_deref().unwrap_or("HIVE"),
            body.email.as_deref().unwrap_or("hive@local.invalid"),
            body.paths.as_deref(),
        )
        .map_err(git_error)?;
    emit(&state, "git.changed", json!({ "projectId": project_id })).await;
    Ok(Json(json!(commit)))
}

async fn restore_git_changes(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<RestoreGitBody>,
) -> Result<Json<Value>, AppError> {
    let repo = git_repo_for_project(&state, &project_id).await?;
    repo.restore(&body.paths).map_err(git_error)?;
    emit(&state, "git.changed", json!({ "projectId": project_id })).await;
    Ok(Json(json!({ "ok": true })))
}

async fn connect_github(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<ConnectGitHubBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let scope = project_scope(&project_id);
    let sealed = state
        .crypto
        .seal(body.token.as_bytes())
        .map_err(|e| AppError::Internal(format!("seal github token: {e}")))?;
    settings::put_value(database.conn(), &scope, "github.owner", json!(body.owner)).await?;
    settings::put_value(database.conn(), &scope, "github.repo", json!(body.repo)).await?;
    settings::put_value(
        database.conn(),
        &scope,
        "github.maskedToken",
        json!(mask_key(&body.token)),
    )
    .await?;
    settings::put_value(
        database.conn(),
        &scope,
        "github.tokenCiphertext",
        serde_json::to_value(sealed).map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .await?;

    let client = GitHubClient::new(
        body.owner.clone(),
        body.repo.clone(),
        body.token.clone(),
    );
    let status = client
        .status(Some(mask_key(&body.token)))
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    if let Some(default_branch) = status.default_branch.clone() {
        settings::put_value(
            database.conn(),
            &scope,
            "github.defaultBranch",
            json!(default_branch),
        )
        .await?;
    }
    Ok(Json(json!(status)))
}

async fn get_github_status(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let scope = project_scope(&project_id);
    if let Some((client, masked)) = github_status_for_project(&state, &project_id).await? {
        let status = client.status(masked).await.map_err(git_error)?;
        if let Some(default_branch) = status.default_branch.clone() {
            settings::put_value(
                database.conn(),
                &scope,
                "github.defaultBranch",
                json!(default_branch),
            )
            .await?;
        }
        return Ok(Json(json!(status)));
    }
    Ok(Json(json!({
        "connected": false,
        "owner": Value::Null,
        "repo": Value::Null,
        "defaultBranch": Value::Null,
        "maskedToken": Value::Null,
    })))
}

async fn list_github_pulls(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let Some((client, _)) = github_status_for_project(&state, &project_id).await? else {
        return Ok(Json(json!([])));
    };
    Ok(Json(json!(client.list_pulls().await.map_err(git_error)?)))
}

async fn create_github_pull(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<CreatePullRequestBody>,
) -> Result<Json<Value>, AppError> {
    let Some((client, _)) = github_status_for_project(&state, &project_id).await? else {
        return Err(AppError::BadRequest("github is not connected for this project".into()));
    };
    let pr = client
        .create_pull(CreatePullRequest {
            title: body.title,
            body: body.body,
            head: body.head,
            base: body.base,
        })
        .await
        .map_err(git_error)?;
    Ok(Json(json!(pr)))
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in input.to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').chars().take(48).collect()
}

async fn start_module_synthesis(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(body): Json<SynthesizeModuleBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let job = synthesis_jobs::create(
        database.conn(),
        synthesis_jobs::CreateSynthesisJob {
            project_id: project_id.clone(),
            description: body.description.clone(),
            tier: body.tier.clone(),
            provider_id: body.model.as_ref().map(|model| model.provider_id.clone()),
            model_id: body.model.as_ref().map(|model| model.model_id.clone()),
        },
    )
    .await?;

    let state_clone = state.clone();
    let job_id = job.id.clone();
    tokio::spawn(async move {
        let result = run_synthesis_job(
            state_clone.clone(),
            project_id.clone(),
            job_id.clone(),
            body.description.clone(),
            body.tier.clone(),
        )
        .await;
        if let Err(err) = result {
            if let Ok(database) = async { Ok::<_, AppError>(db(&state_clone).await) }.await {
                let _ = synthesis_jobs::set_status(
                    database.conn(),
                    &job_id,
                    "error",
                    json!({}),
                    json!([]),
                    Some(err.to_string()),
                    true,
                )
                .await;
                emit(
                    &state_clone,
                    &format!("synthesis.{job_id}.error"),
                    json!({ "jobId": job_id, "error": err.to_string() }),
                )
                .await;
                emit(
                    &state_clone,
                    "synthesis.error",
                    json!({ "jobId": job_id, "projectId": project_id, "error": err.to_string() }),
                )
                .await;
            }
        }
    });

    Ok(Json(json!({ "jobId": job.id })))
}

async fn get_synthesis_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let job = synthesis_jobs::get(database.conn(), &job_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("synthesis job {job_id} not found")))?;
    Ok(Json(synthesis_job_json(&job)))
}

async fn list_synthesis_jobs_for_project(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let _project = projects::get(database.conn(), &project_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("project {project_id} not found")))?;
    let rows = synthesis_jobs::list_for_project(database.conn(), &project_id).await?;
    let items: Vec<Value> = rows.iter().map(synthesis_job_json).collect();
    Ok(Json(json!(items)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishModuleBody {
    /// `'project'` (visible only to projects in the same tier) or
    /// `'public'` (visible to every project).
    visibility: String,
    /// Optional publisher-supplied summary; defaults to the synthesis
    /// description.
    #[serde(default)]
    summary: Option<String>,
}

async fn publish_synthesis_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
    Json(body): Json<PublishModuleBody>,
) -> Result<Json<Value>, AppError> {
    if body.visibility != "project" && body.visibility != "public" {
        return Err(AppError::BadRequest(
            "visibility must be 'project' or 'public'".into(),
        ));
    }
    let database = db(&state).await;
    let job = synthesis_jobs::get(database.conn(), &job_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("synthesis job {job_id} not found")))?;
    if job.status != "complete" && job.status != "completed" && job.status != "succeeded" {
        return Err(AppError::BadRequest(
            "only completed synthesis jobs can be published".into(),
        ));
    }
    let summary = body
        .summary
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned);
    let updated = synthesis_jobs::publish(database.conn(), &job_id, &body.visibility, summary)
        .await?;
    emit(
        &state,
        "module.published",
        json!({
            "jobId": updated.id,
            "projectId": updated.project_id,
            "visibility": updated.published_visibility,
        }),
    )
    .await;
    Ok(Json(synthesis_job_json(&updated)))
}

async fn unpublish_synthesis_job(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let updated = synthesis_jobs::unpublish(database.conn(), &job_id).await?;
    emit(
        &state,
        "module.unpublished",
        json!({ "jobId": updated.id, "projectId": updated.project_id }),
    )
    .await;
    Ok(Json(synthesis_job_json(&updated)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishedFilter {
    #[serde(default)]
    visibility: Option<String>,
}

async fn list_published_modules(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<PublishedFilter>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let visibility = query.visibility.as_deref();
    let rows = synthesis_jobs::list_published(database.conn(), visibility).await?;
    let items: Vec<Value> = rows.iter().map(synthesis_job_json).collect();
    Ok(Json(json!(items)))
}

async fn run_synthesis_job(
    state: AppState,
    project_id: String,
    job_id: String,
    description: String,
    tier: Option<String>,
) -> Result<(), AppError> {
    let database = db(&state).await;
    let _ = init_workspace(State(state.clone()), Path(project_id.clone())).await?;
    let repo = git_repo_for_project(&state, &project_id).await?;
    repo.init().map_err(git_error)?;

    let slug = {
        let candidate = slugify(&description);
        if candidate.is_empty() {
            format!("module-{}", &job_id[..8.min(job_id.len())])
        } else {
            candidate
        }
    };
    let module_root = repo.root().join(".hive").join("modules").join(&slug);
    let src_dir = module_root.join("src");
    tokio::fs::create_dir_all(&src_dir)
        .await
        .map_err(|e| AppError::Internal(format!("create module dirs: {e}")))?;

    let steps = [
        "Analyzing request",
        "Writing manifest",
        "Scaffolding module files",
        "Committing generated module",
    ];
    for (index, step) in steps.iter().enumerate() {
        emit(
            &state,
            &format!("synthesis.{job_id}.progress"),
            json!({
                "jobId": job_id,
                "projectId": project_id,
                "step": index + 1,
                "total": steps.len(),
                "logLine": step,
            }),
        )
        .await;
        emit(
            &state,
            "synthesis.progress",
            json!({
                "jobId": job_id,
                "projectId": project_id,
                "step": index + 1,
                "total": steps.len(),
                "logLine": step,
            }),
        )
        .await;
    }

    let manifest = json!({
        "id": slug,
        "name": description,
        "version": "0.1.0",
        "category": "Project",
        "status": "available",
        "description": description,
        "author": "HIVE Synthesizer",
        "layers": ["interface", "logic", "integration"],
        "tier": tier,
    });
    let readme = format!(
        "# {name}\n\nGenerated by HIVE.\n\n## Intent\n\n{description}\n",
        name = description,
        description = description
    );
    let code = format!(
        "export const moduleManifest = {} as const;\n\nexport function describeModule() {{\n  return moduleManifest.description;\n}}\n",
        serde_json::to_string_pretty(&manifest)
            .map_err(|e| AppError::Internal(e.to_string()))?
    );

    let manifest_path = module_root.join("manifest.json");
    let readme_path = module_root.join("README.md");
    let code_path = src_dir.join("index.ts");
    tokio::fs::write(
        &manifest_path,
        serde_json::to_vec_pretty(&manifest).map_err(|e| AppError::Internal(e.to_string()))?,
    )
    .await
    .map_err(|e| AppError::Internal(format!("write manifest: {e}")))?;
    tokio::fs::write(&readme_path, readme)
        .await
        .map_err(|e| AppError::Internal(format!("write readme: {e}")))?;
    tokio::fs::write(&code_path, code)
        .await
        .map_err(|e| AppError::Internal(format!("write code: {e}")))?;

    let rel_manifest = format!(".hive/modules/{slug}/manifest.json");
    let rel_readme = format!(".hive/modules/{slug}/README.md");
    let rel_code = format!(".hive/modules/{slug}/src/index.ts");
    let generated_files = vec![rel_manifest.clone(), rel_readme.clone(), rel_code.clone()];
    let _ = repo
        .commit(
            &format!("feat(module): synthesize {slug}"),
            "HIVE Synthesizer",
            "hive@local.invalid",
            Some(&generated_files),
        )
        .map_err(git_error)?;

    let mut catalog = settings::get_value(database.conn(), "global", "moduleCatalog")
        .await?
        .unwrap_or_else(|| json!([]));
    if let Some(items) = catalog.as_array_mut() {
        items.retain(|item| item.get("id").and_then(Value::as_str) != Some(slug.as_str()));
        items.push(json!({
            "id": slug,
            "name": description,
            "version": "0.1.0",
            "status": "installed",
            "category": "Project",
            "description": description,
            "longDescription": format!("Synthesized from: {description}"),
            "stars": 0,
            "downloads": "0",
            "layers": ["interface", "logic", "integration"],
            "author": "HIVE Synthesizer",
            "updated": "just now",
        }));
    }
    settings::put_value(database.conn(), "global", "moduleCatalog", catalog).await?;

    let updated = synthesis_jobs::set_status(
        database.conn(),
        &job_id,
        "completed",
        manifest.clone(),
        json!(generated_files),
        None,
        true,
    )
    .await?;
    emit(
        &state,
        &format!("synthesis.{job_id}.complete"),
        json!({
            "jobId": job_id,
            "projectId": project_id,
            "moduleId": slug,
            "generatedFiles": updated.generated_files_json,
        }),
    )
    .await;
    emit(
        &state,
        "synthesis.complete",
        json!({
            "jobId": job_id,
            "projectId": project_id,
            "moduleId": slug,
        }),
    )
    .await;
    emit(&state, "module.installed", json!({ "id": slug })).await;
    emit(&state, "git.changed", json!({ "projectId": project_id })).await;
    Ok(())
}

async fn get_settings(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let mut settings_state = settings::get_value(database.conn(), "global", "settingsState")
        .await?
        .unwrap_or_else(|| json!({}));
    let default_model = stored_default_model(&state).await?;
    let tools_sandbox = current_tools_sandbox_settings(&state).await?;
    {
        let settings_object = ensure_object(&mut settings_state)?;
        settings_object.insert("defaultModel".to_owned(), default_model);
        settings_object.insert("toolsSandbox".to_owned(), tools_sandbox);
    }

    if let Some(project_id) = active_project_id(&state).await? {
        if let Some(project) = projects::get(database.conn(), &project_id).await? {
            let settings_object = ensure_object(&mut settings_state)?;
            let general = settings_object
                .entry("general".to_owned())
                .or_insert_with(|| json!({}));
            if let Some(general) = general.as_object_mut() {
                general.insert("projectName".to_owned(), Value::String(project.name));
                general.insert(
                    "sovereigntyTier".to_owned(),
                    Value::String(project.sovereignty_tier),
                );
            }
        }
    }

    Ok(Json(settings_state))
}

async fn update_settings(
    State(state): State<AppState>,
    Json(body): Json<SettingsPatchBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let mut next_settings = body.settings;
    let default_model = next_settings
        .get("defaultModel")
        .cloned()
        .unwrap_or(Value::Null);
    let existing_tools = current_tools_sandbox_settings(&state).await?;
    let mut pending_tavily_key = None::<String>;
    {
        let settings_object = ensure_object(&mut next_settings)?;
        if let Some(tools) = settings_object
            .get_mut("toolsSandbox")
            .and_then(Value::as_object_mut)
        {
            pending_tavily_key = tools
                .get("tavilyApiKey")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned);
            tools.insert("tavilyApiKey".to_owned(), Value::String(String::new()));
            tools.insert(
                "tavilyMaskedKey".to_owned(),
                existing_tools
                    .get("tavilyMaskedKey")
                    .cloned()
                    .unwrap_or(Value::Null),
            );
        }
    }

    settings::put_value(database.conn(), "global", "defaultModel", default_model).await?;

    // Persist the search provider + URL into the dedicated `search.*`
    // settings rows so the read path (`current_tools_sandbox_settings`)
    // stays consistent across restarts and the JSON-blob fallback isn't
    // needed.
    if let Some(tools) = next_settings.get("toolsSandbox") {
        if let Some(provider) = tools.get("searchProvider").and_then(Value::as_str) {
            if provider == "tavily" || provider == "searxng" {
                settings::put_value(
                    database.conn(),
                    "search",
                    "provider",
                    Value::String(provider.to_owned()),
                )
                .await?;
            }
        }
        if let Some(url) = tools.get("searxngUrl").and_then(Value::as_str) {
            if !url.trim().is_empty() {
                settings::put_value(
                    database.conn(),
                    "search",
                    "searxng_url",
                    Value::String(url.to_owned()),
                )
                .await?;
            }
        }
    }

    if let Some(api_key) = pending_tavily_key {
        let sealed = state
            .crypto
            .seal(api_key.as_bytes())
            .map_err(|e| AppError::Internal(format!("seal tavily key: {e}")))?;
        settings::put_value(
            database.conn(),
            "global",
            "search.tavilyKeyCiphertext",
            serde_json::to_value(sealed).map_err(|e| AppError::Internal(e.to_string()))?,
        )
        .await?;
        if let Some(tools) = next_settings
            .get_mut("toolsSandbox")
            .and_then(Value::as_object_mut)
        {
            tools.insert(
                "tavilyMaskedKey".to_owned(),
                Value::String(mask_key(&api_key)),
            );
        }
    }

    if let Some(project_id) = active_project_id(&state).await? {
        let project_name = next_settings
            .get("general")
            .and_then(|v| v.get("projectName"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let sovereignty_tier = next_settings
            .get("general")
            .and_then(|v| v.get("sovereigntyTier"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        if project_name.is_some() || sovereignty_tier.is_some() {
            let _ = projects::update(
                database.conn(),
                &project_id,
                projects::UpdateProject {
                    name: project_name.clone(),
                    description: None,
                    sovereignty_tier: sovereignty_tier.clone(),
                    budget_total_cents: None,
                    status: None,
                    health_score: None,
                    spec_completion: None,
                    test_coverage: None,
                },
            )
            .await?;
        }

        if let Some(project) = projects::get(database.conn(), &project_id).await? {
            let settings_object = ensure_object(&mut next_settings)?;
            let general = settings_object
                .entry("general".to_owned())
                .or_insert_with(|| json!({}));
            if let Some(general) = general.as_object_mut() {
                general.insert("projectName".to_owned(), Value::String(project.name));
                general.insert(
                    "sovereigntyTier".to_owned(),
                    Value::String(project.sovereignty_tier),
                );
            }
        }
    }

    settings::put_value(
        database.conn(),
        "global",
        "settingsState",
        next_settings.clone(),
    )
    .await?;
    emit(&state, "project.updated", json!({ "kind": "settings" })).await;
    Ok(Json(next_settings))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateLlmProviderBody {
    api_key: Option<String>,
    base_url: Option<String>,
}

fn provider_to_json(p: &hive_db::entities::llm_provider::Model) -> Value {
    json!({
        "id": p.id,
        "name": p.name,
        "kind": p.kind,
        "connected": p.connected,
        "baseUrl": p.base_url,
        "maskedKey": p.masked_key,
        "hasKey": p.api_key_ciphertext.is_some(),
        "createdAt": p.created_at,
        "updatedAt": p.updated_at,
    })
}

fn provider_kind(p: &hive_db::entities::llm_provider::Model) -> Result<ProviderKind, AppError> {
    ProviderKind::from_str(&p.kind)
        .map_err(|e| AppError::BadRequest(format!("unknown provider kind '{}': {e}", p.kind)))
}

async fn build_provider_config(
    state: &AppState,
    p: &hive_db::entities::llm_provider::Model,
) -> Result<ProviderConfig, AppError> {
    let kind = provider_kind(p)?;
    let api_key = match &p.api_key_ciphertext {
        Some(ct) => {
            let bytes = state
                .crypto
                .open(ct)
                .map_err(|e| AppError::Internal(format!("decrypt key: {e}")))?;
            Some(String::from_utf8(bytes).map_err(|e| AppError::Internal(e.to_string()))?)
        }
        None => None,
    };
    let base_url = p
        .base_url
        .clone()
        .unwrap_or_else(|| kind.default_base_url().to_owned());
    Ok(ProviderConfig::new(kind, api_key, Some(base_url)))
}

async fn list_llm_providers(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let items: Vec<Value> = llm_providers::list(database.conn())
        .await?
        .iter()
        .map(provider_to_json)
        .collect();
    Ok(Json(json!(items)))
}

async fn update_llm_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(body): Json<UpdateLlmProviderBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let existing = llm_providers::get(database.conn(), &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("llm provider {id} not found")))?;

    let (ciphertext, masked) = if let Some(key) = body.api_key.as_ref() {
        let trimmed = key.trim();
        if trimmed.is_empty() {
            (Some(Vec::new()), Some(String::new()))
        } else {
            let sealed = state
                .crypto
                .seal(trimmed.as_bytes())
                .map_err(|e| AppError::Internal(format!("seal key: {e}")))?;
            (Some(sealed), Some(mask_key(trimmed)))
        }
    } else {
        (None, None)
    };

    let patch = llm_providers::UpdateKey {
        api_key_ciphertext: ciphertext,
        masked_key: masked,
        base_url: body.base_url,
        connected: None,
    };
    let updated = llm_providers::update_key(database.conn(), &id, patch).await?;

    // Invalidate cache entry
    state.model_cache.write().await.remove(&id);

    audit::append(
        database.conn(),
        "local_operator",
        "llm_provider.update",
        "llm_provider",
        &id,
        Some(serde_json::to_value(&existing).unwrap_or(Value::Null)),
        Some(provider_to_json(&updated)),
    )
    .await?;

    emit(&state, "llm_provider.updated", provider_to_json(&updated)).await;
    Ok(Json(provider_to_json(&updated)))
}

async fn test_llm_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let provider = llm_providers::get(database.conn(), &id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("llm provider {id} not found")))?;
    let config = build_provider_config(&state, &provider).await?;
    let client = client_for(config);
    let outcome = client.test_connection().await;
    let _ = llm_providers::set_connected(database.conn(), &id, outcome.ok).await?;
    if outcome.ok {
        state.model_cache.write().await.remove(&id);
    }
    emit(
        &state,
        "llm_provider.tested",
        json!({ "id": id, "ok": outcome.ok }),
    )
    .await;
    Ok(Json(serde_json::to_value(&outcome).unwrap_or(Value::Null)))
}

/// In-memory model-list cache TTL. `GET /v1/llm-providers/:id/models` hits
/// the cache while it's fresh; saves a few hundred ms per page load and
/// avoids hammering provider list endpoints with their rate limits.
/// Mutating endpoints (key change, test success) invalidate explicitly.
const MODEL_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

async fn list_llm_provider_models(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    {
        let cache = state.model_cache.read().await;
        if let Some((at, models)) = cache.get(&id) {
            if at.elapsed() < MODEL_CACHE_TTL {
                return Ok(Json(json!(models)));
            }
        }
    }
    fetch_and_cache_models(&state, &id).await
}

/// Force a fresh fetch (ignoring the in-memory cache). Wired to the
/// `Refresh Models` button in Settings — useful right after the user
/// adds a new model on their provider account or rotates a key.
async fn refresh_llm_provider_models(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, AppError> {
    state.model_cache.write().await.remove(&id);
    fetch_and_cache_models(&state, &id).await
}

async fn fetch_and_cache_models(
    state: &AppState,
    id: &str,
) -> Result<Json<Value>, AppError> {
    let database = db(state).await;
    let provider = llm_providers::get(database.conn(), id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("llm provider {id} not found")))?;
    let config = build_provider_config(state, &provider).await?;
    let client = client_for(config);
    let models = client
        .list_models()
        .await
        .map_err(|e| AppError::BadRequest(format!("list models: {e}")))?;

    state
        .model_cache
        .write()
        .await
        .insert(id.to_owned(), (Instant::now(), models.clone()));

    let _ = llm_providers::set_connected(database.conn(), id, true).await?;

    Ok(Json(json!(models)))
}

async fn probe_ollama(db: &Db, http: &reqwest::Client) {
    let url = "http://localhost:11434/api/tags";
    let req = http.get(url).timeout(Duration::from_secs(1)).send().await;
    match req {
        Ok(r) if r.status().is_success() => {
            info!("Ollama: detected at {url}");
            let _ = llm_providers::set_connected(db.conn(), "ollama", true).await;
        }
        Ok(r) => {
            warn!(status = %r.status(), "Ollama probe returned non-2xx");
        }
        Err(err) => {
            // Surface the connect failure at info level so operators can
            // see *why* Ollama isn't appearing as connected. Common causes:
            // not running, listening on a non-default port, firewall.
            info!(error = %err, "Ollama: not detected (skip)");
        }
    }
}

async fn get_audit_log(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<EntityAuditQuery>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let payload = if let (Some(entity_type), Some(entity_id)) = (query.entity_type, query.entity_id)
    {
        json!(audit::list_for_entity(database.conn(), &entity_type, &entity_id).await?)
    } else {
        json!([])
    };
    Ok(Json(payload))
}

// ── Chat (Sprint 1) ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateChatThreadBody {
    project_id: String,
    agent_id: Option<String>,
    title: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRef {
    provider_id: String,
    model_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendChatMessageBody {
    content: String,
    model: Option<ModelRef>,
    system_prompt: Option<String>,
}

fn chat_thread_json(t: &hive_db::entities::chat_thread::Model) -> Value {
    json!({
        "id": t.id,
        "projectId": t.project_id,
        "agentId": t.agent_id,
        "title": t.title,
        "createdAt": t.created_at,
        "updatedAt": t.updated_at,
    })
}

fn chat_message_json(m: &hive_db::entities::chat_message::Model) -> Value {
    json!({
        "id": m.id,
        "threadId": m.thread_id,
        "role": m.role,
        "content": m.content,
        "toolCalls": m.tool_calls,
        "model": m.model,
        "providerId": m.provider_id,
        "tokensIn": m.tokens_in,
        "tokensOut": m.tokens_out,
        "costCents": m.cost_cents,
        "parentMessageId": m.parent_message_id,
        "status": m.status,
        "createdAt": m.created_at,
        "updatedAt": m.updated_at,
    })
}

async fn list_chat_threads(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let rows = chat_threads::list_by_project(database.conn(), &project_id).await?;
    // Seed a Coordinator thread if none exist yet so the UI always has somewhere
    // to send the first message.
    let rows = if rows.is_empty() {
        let seeded = chat_threads::get_or_create_for_agent(
            database.conn(),
            &project_id,
            None,
            "Coordinator",
        )
        .await?;
        vec![seeded]
    } else {
        rows
    };
    let payload: Vec<Value> = rows.iter().map(chat_thread_json).collect();
    Ok(Json(json!(payload)))
}

async fn create_chat_thread(
    State(state): State<AppState>,
    Json(body): Json<CreateChatThreadBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let thread = chat_threads::create(
        database.conn(),
        chat_threads::CreateThread {
            project_id: body.project_id,
            agent_id: body.agent_id,
            title: body.title.unwrap_or_else(|| "Untitled thread".to_owned()),
        },
    )
    .await?;
    emit(&state, "chat.thread.created", chat_thread_json(&thread)).await;
    Ok(Json(chat_thread_json(&thread)))
}

async fn get_chat_thread(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let thread = chat_threads::get(database.conn(), &thread_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("chat thread {thread_id} not found")))?;
    Ok(Json(chat_thread_json(&thread)))
}

async fn list_chat_messages(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let rows = chat_messages::list_by_thread(database.conn(), &thread_id).await?;
    let payload: Vec<Value> = rows.iter().map(chat_message_json).collect();
    Ok(Json(json!(payload)))
}

async fn send_chat_message(
    State(state): State<AppState>,
    Path(thread_id): Path<String>,
    Json(body): Json<SendChatMessageBody>,
) -> Result<Json<Value>, AppError> {
    let database = db(&state).await;
    let thread = chat_threads::get(database.conn(), &thread_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("chat thread {thread_id} not found")))?;

    // Resolve the provider + model. If the caller didn't specify, fall back to
    // the project-wide default in settings and then to the first connected
    // provider with a listable model.
    let (provider_id, model_id) = resolve_chat_target(&state, body.model.as_ref()).await?;
    let provider_row = llm_providers::get(database.conn(), &provider_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("llm provider {provider_id} not found")))?;
    let config = build_provider_config(&state, &provider_row).await?;
    let kind = config.kind;
    let provider = Arc::from(client_for(config));

    // Persist the user turn.
    let user_msg = chat_messages::insert(
        database.conn(),
        chat_messages::NewMessage {
            thread_id: thread.id.clone(),
            role: "user".into(),
            content: body.content.clone(),
            tool_calls: json!([]),
            model: None,
            provider_id: None,
            tokens_in: 0,
            tokens_out: 0,
            cost_cents: 0,
            parent_message_id: None,
            status: "done".into(),
        },
    )
    .await?;
    emit(
        &state,
        &format!("chat.{thread_id}.message"),
        chat_message_json(&user_msg),
    )
    .await;

    // Insert the pending assistant row so the frontend can render a placeholder.
    let assistant_row = chat_messages::insert(
        database.conn(),
        chat_messages::NewMessage {
            thread_id: thread.id.clone(),
            role: "assistant".into(),
            content: String::new(),
            tool_calls: json!([]),
            model: Some(model_id.clone()),
            provider_id: Some(provider_id.clone()),
            tokens_in: 0,
            tokens_out: 0,
            cost_cents: 0,
            parent_message_id: Some(user_msg.id.clone()),
            status: "pending".into(),
        },
    )
    .await?;
    emit(
        &state,
        &format!("chat.{thread_id}.message"),
        chat_message_json(&assistant_row),
    )
    .await;

    // Kick off the streaming task.
    let cancel_flag = Arc::new(Mutex::new(false));
    let bus = EventBus::new(state.events.clone());
    let db_clone = database.clone();
    let assistant_id = assistant_row.id.clone();

    // Register the cancel flag BEFORE spawning so a fast-failing task can't
    // race past its own registry entry (see PR review).
    state
        .chat_jobs
        .register(&assistant_id, cancel_flag.clone())
        .await;

    let params = hive_runtime::chat::RunTurn {
        db: db_clone,
        bus,
        provider,
        provider_kind: kind,
        provider_id: provider_id.clone(),
        model: model_id.clone(),
        project_id: thread.project_id.clone(),
        thread_id: thread_id.clone(),
        assistant_message_id: assistant_id.clone(),
        system_prompt: body.system_prompt,
        history_limit: 40,
        agent_id: thread.agent_id.clone(),
        tool_registry: None,
        tool_context: None,
        cancel: cancel_flag,
    };
    let mut params = params;
    if let Some((registry, context)) = build_tooling(
        &state,
        &thread.project_id,
        thread.agent_id.clone(),
        &assistant_id,
        &thread_id,
    )
    .await?
    {
        params.tool_registry = Some(registry);
        params.tool_context = Some(context);
    }

    let handle = tokio::spawn(async move {
        if let Err(err) = hive_runtime::chat::run_turn(params).await {
            tracing::warn!(error = %err, "chat turn failed");
        }
    });
    state
        .chat_jobs
        .attach_abort(&assistant_id, handle.abort_handle())
        .await;

    // Best-effort reaper: once the task finishes, drop its registry entry so
    // the map doesn't grow without bound. Cancellation itself already removes
    // the entry, so the happy path is the only one that needs this.
    {
        let registry = state.chat_jobs.clone();
        let assistant_for_cleanup = assistant_id.clone();
        tokio::spawn(async move {
            let _ = handle.await;
            registry.remove(&assistant_for_cleanup).await;
        });
    }

    Ok(Json(json!({
        "userMessage": chat_message_json(&user_msg),
        "assistantMessage": chat_message_json(&assistant_row),
        "providerId": provider_id,
        "model": model_id,
    })))
}

async fn cancel_chat_message(
    State(state): State<AppState>,
    Path(message_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let cancelled = state.chat_jobs.cancel(&message_id).await;
    Ok(Json(json!({ "ok": cancelled })))
}

async fn resolve_chat_target(
    state: &AppState,
    explicit: Option<&ModelRef>,
) -> Result<(String, String), AppError> {
    if let Some(r) = explicit {
        return Ok((r.provider_id.clone(), r.model_id.clone()));
    }

    // Try settings["global"]["defaultModel"] = { providerId, modelId }
    let setting = read_setting_json(state, "global", "defaultModel", Value::Null).await?;
    if let (Some(pid), Some(mid)) = (
        setting.get("providerId").and_then(|v| v.as_str()),
        setting.get("modelId").and_then(|v| v.as_str()),
    ) {
        return Ok((pid.to_owned(), mid.to_owned()));
    }

    // Pick the first connected provider and its first model.
    let database = db(state).await;
    let providers = llm_providers::list(database.conn()).await?;
    for p in providers.iter().filter(|p| p.connected) {
        let config = build_provider_config(state, p).await?;
        let client = client_for(config);
        if let Ok(models) = client.list_models().await {
            if let Some(first) = models.first() {
                return Ok((p.id.clone(), first.id.clone()));
            }
        }
    }

    Err(AppError::BadRequest(
        "no connected provider — configure one in Settings → LLM, or start Ollama".into(),
    ))
}

// ── Agent turn driver (Sprint 3.1) ──────────────────────────────────────────
//
// The executor in `hive-runtime` is provider-agnostic: when an inbox item
// arrives, it asks the registered `TurnDriver` to run the LLM turn. This
// implementation lives here in `hive-api` because turning an inbox item into
// a real LLM round-trip needs all the provider-config, tooling, and
// chat-message persistence machinery.

#[derive(Clone)]
struct ApiTurnDriver {
    state: AppState,
}

impl ApiTurnDriver {
    fn new(state: AppState) -> Self {
        Self { state }
    }

    async fn run(&self, req: TurnRequest) -> Result<(), AppError> {
        let TurnRequest {
            agent_id,
            project_id,
            item,
        } = req;
        let database = db(&self.state).await;

        // Look up the agent so we can honor its model + system prompt.
        let agent = agents::get(database.conn(), &agent_id)
            .await?
            .ok_or_else(|| AppError::NotFound(format!("agent {agent_id} not found")))?;

        // Resolve provider + model: agent override → global default → first
        // connected provider/model.
        let explicit_model = match (agent.model_provider_id.as_deref(), agent.model_id.as_deref()) {
            (Some(pid), Some(mid)) => Some(ModelRef {
                provider_id: pid.to_owned(),
                model_id: mid.to_owned(),
            }),
            _ => None,
        };
        let (provider_id, model_id) =
            resolve_chat_target(&self.state, explicit_model.as_ref()).await?;
        let provider_row = llm_providers::get(database.conn(), &provider_id)
            .await?
            .ok_or_else(|| {
                AppError::NotFound(format!("llm provider {provider_id} not found"))
            })?;
        let config = build_provider_config(&self.state, &provider_row).await?;
        let kind = config.kind;
        let provider = Arc::from(client_for(config));

        // Ensure a chat thread for this agent exists (one per agent within
        // its project). The thread carries the agent's history so multi-turn
        // tool loops have context.
        let thread_title = format!("{} inbox", agent.role);
        let thread = chat_threads::get_or_create_for_agent(
            database.conn(),
            &project_id,
            Some(&agent_id),
            &thread_title,
        )
        .await?;

        // Persist the inbox content as a `user`-role message in the thread.
        let user_msg = chat_messages::insert(
            database.conn(),
            chat_messages::NewMessage {
                thread_id: thread.id.clone(),
                role: "user".into(),
                content: item.content.clone(),
                tool_calls: json!([]),
                model: None,
                provider_id: None,
                tokens_in: 0,
                tokens_out: 0,
                cost_cents: 0,
                parent_message_id: None,
                status: "done".into(),
            },
        )
        .await?;
        emit(
            &self.state,
            &format!("chat.{}.message", thread.id),
            chat_message_json(&user_msg),
        )
        .await;

        // Pending assistant placeholder — `chat::run_turn` streams into this
        // row and finalizes it.
        let assistant_row = chat_messages::insert(
            database.conn(),
            chat_messages::NewMessage {
                thread_id: thread.id.clone(),
                role: "assistant".into(),
                content: String::new(),
                tool_calls: json!([]),
                model: Some(model_id.clone()),
                provider_id: Some(provider_id.clone()),
                tokens_in: 0,
                tokens_out: 0,
                cost_cents: 0,
                parent_message_id: Some(user_msg.id.clone()),
                status: "pending".into(),
            },
        )
        .await?;
        emit(
            &self.state,
            &format!("chat.{}.message", thread.id),
            chat_message_json(&assistant_row),
        )
        .await;

        // Mark the agent_message as running and notify subscribers.
        let _ = agent_messages::mark_running(database.conn(), &item.message_id).await;
        emit(
            &self.state,
            &format!("agent.{agent_id}.inbox"),
            json!({
                "agentId": agent_id,
                "projectId": project_id,
                "messageId": item.message_id,
                "fromAgentId": item.from_agent_id,
                "threadId": thread.id,
                "assistantMessageId": assistant_row.id,
                "status": "running",
            }),
        )
        .await;

        // Build per-turn tooling (intersected with global + agent allow-list).
        let cancel_flag = Arc::new(Mutex::new(false));
        let mut params = hive_runtime::chat::RunTurn {
            db: database.clone(),
            bus: EventBus::new(self.state.events.clone()),
            provider,
            provider_kind: kind,
            provider_id: provider_id.clone(),
            model: model_id.clone(),
            project_id: project_id.clone(),
            thread_id: thread.id.clone(),
            assistant_message_id: assistant_row.id.clone(),
            system_prompt: agent_system_prompt(&agent),
            history_limit: 40,
            agent_id: Some(agent_id.clone()),
            tool_registry: None,
            tool_context: None,
            cancel: cancel_flag,
        };
        if let Some((registry, context)) = build_tooling(
            &self.state,
            &project_id,
            Some(agent_id.clone()),
            &assistant_row.id,
            &thread.id,
        )
        .await?
        {
            params.tool_registry = Some(registry);
            params.tool_context = Some(context);
        }

        // Drive the turn synchronously within the executor task. Errors
        // propagate up so the wrapper marks the agent_message `error`.
        if let Err(err) = hive_runtime::chat::run_turn(params).await {
            return Err(AppError::Internal(format!("agent turn failed: {err}")));
        }

        // Re-read the assistant row to pick up the final answer + status.
        let final_row = chat_messages::get(database.conn(), &assistant_row.id)
            .await?
            .unwrap_or(assistant_row);

        let _ = agent_messages::mark_done(database.conn(), &item.message_id).await;
        emit(
            &self.state,
            &format!("agent.{agent_id}.inbox"),
            json!({
                "agentId": agent_id,
                "projectId": project_id,
                "messageId": item.message_id,
                "fromAgentId": item.from_agent_id,
                "threadId": thread.id,
                "assistantMessageId": final_row.id,
                "status": "done",
                "content": final_row.content,
            }),
        )
        .await;

        Ok(())
    }
}

#[async_trait::async_trait]
impl TurnDriver for ApiTurnDriver {
    async fn drive(&self, req: TurnRequest) -> Result<(), TurnDriverError> {
        self.run(req)
            .await
            .map_err(|e| TurnDriverError::Other(e.to_string()))
    }
}

fn agent_system_prompt(agent: &hive_db::entities::agent::Model) -> Option<String> {
    if let Some(custom) = agent.system_prompt.as_ref() {
        if !custom.trim().is_empty() {
            return Some(custom.clone());
        }
    }
    Some(format!(
        "You are the {role} agent ({name}) in HIVE, a multi-agent orchestration platform.\n\
Respond with focused, actionable output. When you need help from another specialist, \
use the `spawn_agent` tool to recruit one; use `message_agent` to coordinate with peers.",
        role = agent.role,
        name = agent.name,
    ))
}
