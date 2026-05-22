use sea_orm::{DatabaseConnection, DbErr};
use serde_json::{json, Value};

use crate::repos::{
    agents::{self, CreateAgent, UpdateAgent},
    alerts, audit, cost_events, notes, notifications,
    projects::{self, CreateProject, UpdateProject},
    sessions, settings,
    sprints::{self, CreateSprint},
    tasks::{self, CreateTask},
    tech_debt,
};

fn json_value(raw: &str) -> Value {
    serde_json::from_str(raw).expect("valid seed json")
}

struct ProjectSpec<'a> {
    name: &'a str,
    description: &'a str,
    sovereignty_tier: &'a str,
    budget_total_cents: i64,
    health_score: i32,
    spec_completion: i32,
    test_coverage: i32,
}

async fn ensure_project(db: &DatabaseConnection, spec: &ProjectSpec<'_>) -> Result<String, DbErr> {
    if let Some(existing) = projects::list(db)
        .await?
        .into_iter()
        .find(|project| project.name == spec.name)
    {
        let updated = projects::update(
            db,
            &existing.id,
            UpdateProject {
                name: Some(spec.name.into()),
                description: Some(Some(spec.description.into())),
                sovereignty_tier: Some(spec.sovereignty_tier.into()),
                budget_total_cents: Some(spec.budget_total_cents),
                status: Some("active".into()),
                health_score: Some(spec.health_score),
                spec_completion: Some(spec.spec_completion),
                test_coverage: Some(spec.test_coverage),
            },
        )
        .await?;
        Ok(updated.id)
    } else {
        let created = projects::create(
            db,
            CreateProject {
                name: spec.name.into(),
                description: Some(spec.description.into()),
                sovereignty_tier: spec.sovereignty_tier.into(),
                budget_total_cents: spec.budget_total_cents,
                status: "active".into(),
            },
        )
        .await?;
        let updated = projects::update(
            db,
            &created.id,
            UpdateProject {
                name: None,
                description: None,
                sovereignty_tier: None,
                budget_total_cents: None,
                status: None,
                health_score: Some(spec.health_score),
                spec_completion: Some(spec.spec_completion),
                test_coverage: Some(spec.test_coverage),
            },
        )
        .await?;
        Ok(updated.id)
    }
}

async fn ensure_agents(
    db: &DatabaseConnection,
    project_id: &str,
    profile: usize,
) -> Result<(), DbErr> {
    if !agents::list_by_project(db, project_id).await?.is_empty() {
        return Ok(());
    }

    let agent_specs = match profile {
        0 => vec![
            (
                "pe-001",
                "Planning Engine",
                "Coordinator",
                "GPT-4o",
                "working",
                "Orchestrating sprint 3 tasks",
                94,
                125_000,
                r#"{"correctness":95,"style":90,"efficiency":88,"testQuality":92,"docQuality":91}"#,
            ),
            (
                "fe-001",
                "Frontend Architect",
                "Frontend",
                "Claude 3.5",
                "working",
                "Building dashboard components",
                91,
                98_000,
                r#"{"correctness":92,"style":95,"efficiency":85,"testQuality":88,"docQuality":87}"#,
            ),
            (
                "be-001",
                "Backend Engineer",
                "Backend",
                "GPT-4o",
                "idle",
                "Waiting for API spec review",
                89,
                112_000,
                r#"{"correctness":90,"style":85,"efficiency":92,"testQuality":90,"docQuality":86}"#,
            ),
            (
                "qa-001",
                "QA Sentinel",
                "Testing",
                "Claude 3.5",
                "working",
                "Running integration tests",
                93,
                45_000,
                r#"{"correctness":96,"style":88,"efficiency":90,"testQuality":98,"docQuality":85}"#,
            ),
            (
                "sec-001",
                "Security Auditor",
                "Security",
                "GPT-4o",
                "paused",
                "Paused - awaiting credentials",
                87,
                34_000,
                r#"{"correctness":94,"style":82,"efficiency":86,"testQuality":85,"docQuality":90}"#,
            ),
            (
                "doc-001",
                "Doc Writer",
                "Documentation",
                "Gemini Pro",
                "blocked",
                "Blocked on missing API types",
                85,
                28_000,
                r#"{"correctness":82,"style":92,"efficiency":80,"testQuality":78,"docQuality":96}"#,
            ),
        ],
        1 => vec![
            (
                "gw-001",
                "Gateway Planner",
                "Coordinator",
                "GPT-4o",
                "working",
                "Coordinating gateway extraction tasks",
                92,
                76_000,
                r#"{"correctness":93,"style":89,"efficiency":90,"testQuality":88,"docQuality":84}"#,
            ),
            (
                "svc-001",
                "Service Weaver",
                "Backend",
                "Claude 3.5",
                "working",
                "Splitting route handlers into services",
                88,
                64_000,
                r#"{"correctness":90,"style":84,"efficiency":86,"testQuality":85,"docQuality":80}"#,
            ),
            (
                "obs-001",
                "Telemetry Watch",
                "QA",
                "GPT-4o",
                "idle",
                "Watching deploy smoke tests",
                86,
                21_000,
                r#"{"correctness":88,"style":82,"efficiency":84,"testQuality":87,"docQuality":79}"#,
            ),
        ],
        _ => vec![
            (
                "ml-001",
                "Pipeline Planner",
                "Coordinator",
                "GPT-4o",
                "working",
                "Sequencing training and evaluation steps",
                90,
                83_000,
                r#"{"correctness":91,"style":86,"efficiency":88,"testQuality":84,"docQuality":82}"#,
            ),
            (
                "etl-001",
                "Data Wrangler",
                "Data",
                "Claude 3.5",
                "working",
                "Normalizing source datasets",
                87,
                59_000,
                r#"{"correctness":89,"style":83,"efficiency":85,"testQuality":81,"docQuality":80}"#,
            ),
            (
                "trn-001",
                "Model Trainer",
                "ML",
                "GPT-4o",
                "blocked",
                "Blocked on GPU quota",
                84,
                47_000,
                r#"{"correctness":86,"style":79,"efficiency":82,"testQuality":83,"docQuality":76}"#,
            ),
        ],
    };

    for (slug, name, role, model, status, current_task, quality_score, tokens_used, eval_scores) in
        agent_specs
    {
        let created = agents::create(
            db,
            CreateAgent {
                project_id: project_id.into(),
                slug: slug.into(),
                name: name.into(),
                role: role.into(),
                model: model.into(),
                status: status.into(),
                parent_agent_id: None,
                spawned_by_message_id: None,
                enabled_tools: None,
                system_prompt: None,
                model_provider_id: None,
                model_id: None,
            },
        )
        .await?;

        agents::update(
            db,
            project_id,
            &created.id,
            UpdateAgent {
                slug: None,
                name: None,
                role: None,
                model: None,
                status: None,
                current_task: Some(Some(current_task.into())),
                quality_score: Some(Some(quality_score)),
                tokens_used: Some(tokens_used),
                eval_scores: Some(json_value(eval_scores)),
                enabled_tools: None,
                system_prompt: None,
                model_provider_id: None,
                model_id: None,
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_tasks(
    db: &DatabaseConnection,
    project_id: &str,
    profile: usize,
) -> Result<(), DbErr> {
    if !tasks::list_by_project(db, project_id).await?.is_empty() {
        return Ok(());
    }

    let agent_models = agents::list_by_project(db, project_id).await?;
    let agent_id_for = |slug: &str| {
        agent_models
            .iter()
            .find(|model| model.slug == slug)
            .map(|model| model.id.clone())
    };

    let task_specs = match profile {
        0 => vec![
            (
                "Implement auth middleware",
                agent_id_for("be-001"),
                "in-progress",
                "Sprint 3",
                "high",
                15_000,
            ),
            (
                "Build dashboard summary tiles",
                agent_id_for("fe-001"),
                "in-progress",
                "Sprint 3",
                "high",
                12_000,
            ),
            (
                "Write API documentation",
                agent_id_for("doc-001"),
                "blocked",
                "Sprint 3",
                "medium",
                8_000,
            ),
            (
                "Security audit - endpoints",
                agent_id_for("sec-001"),
                "queued",
                "Sprint 3",
                "high",
                20_000,
            ),
            (
                "Integration test suite",
                agent_id_for("qa-001"),
                "in-progress",
                "Sprint 3",
                "medium",
                10_000,
            ),
            (
                "Optimize DB queries",
                agent_id_for("be-001"),
                "queued",
                "Sprint 4",
                "low",
                9_000,
            ),
        ],
        1 => vec![
            (
                "Extract auth gateway module",
                agent_id_for("svc-001"),
                "in-progress",
                "Gateway Split",
                "high",
                11_000,
            ),
            (
                "Write edge timeout safeguards",
                agent_id_for("gw-001"),
                "queued",
                "Gateway Split",
                "medium",
                7_000,
            ),
            (
                "Validate request tracing",
                agent_id_for("obs-001"),
                "completed",
                "Gateway Split",
                "medium",
                6_000,
            ),
        ],
        _ => vec![
            (
                "Normalize incoming dataset schema",
                agent_id_for("etl-001"),
                "in-progress",
                "Training Cycle",
                "high",
                14_000,
            ),
            (
                "Tune learning-rate sweep",
                agent_id_for("ml-001"),
                "queued",
                "Training Cycle",
                "medium",
                12_000,
            ),
            (
                "Acquire GPU workers",
                agent_id_for("trn-001"),
                "blocked",
                "Training Cycle",
                "high",
                18_000,
            ),
        ],
    };

    for (title, agent_id, status, phase, priority, estimated_tokens) in task_specs {
        tasks::create(
            db,
            CreateTask {
                project_id: project_id.into(),
                title: title.into(),
                status: status.into(),
                phase: Some(phase.into()),
                priority: priority.into(),
                estimated_tokens,
                agent_id,
                sprint_id: None,
                spec_section_id: None,
                due_at: None,
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_alerts(
    db: &DatabaseConnection,
    project_id: &str,
    profile: usize,
) -> Result<(), DbErr> {
    if !alerts::list_by_project(db, project_id).await?.is_empty() {
        return Ok(());
    }

    let alert_specs = match profile {
        0 => vec![
            (
                "critical",
                "Budget threshold reached",
                "Project budget at 89% - 3 agents throttled",
                "Budget Monitor",
                Some("Extend Budget"),
                Some("extend_budget"),
            ),
            (
                "high",
                "Agent loop detected",
                "Doc Writer repeated the same action 4 times",
                "Loop Detector",
                Some("Intervene"),
                Some("intervene"),
            ),
            (
                "medium",
                "Spec drift detected",
                "Implementation diverged from PRD section 4.2",
                "Spec Monitor",
                None,
                None,
            ),
            (
                "info",
                "New eval results",
                "QA Sentinel completed batch evaluation - 94% pass rate",
                "Eval Engine",
                None,
                None,
            ),
        ],
        1 => vec![
            (
                "high",
                "Gateway latency spike",
                "P95 latency crossed 420ms during route fan-out",
                "Telemetry Watch",
                Some("Review"),
                Some("review"),
            ),
            (
                "info",
                "Service split complete",
                "Request tracing survived the first extraction pass",
                "Deploy Monitor",
                None,
                None,
            ),
        ],
        _ => vec![
            (
                "high",
                "GPU quota exhausted",
                "Model Trainer is blocked waiting for extra capacity",
                "Training Monitor",
                Some("Intervene"),
                Some("intervene"),
            ),
            (
                "medium",
                "Dataset drift warning",
                "Incoming records no longer match last training schema",
                "Data Watch",
                Some("Review"),
                Some("review"),
            ),
        ],
    };

    for (severity, title, message, source, action_label, action_kind) in alert_specs {
        alerts::create(
            db,
            alerts::CreateAlert {
                project_id: project_id.into(),
                severity: severity.into(),
                title: title.into(),
                message: message.into(),
                source: source.into(),
                action_label: action_label.map(str::to_owned),
                action_kind: action_kind.map(str::to_owned),
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_notes(
    db: &DatabaseConnection,
    project_id: &str,
    project_name: &str,
) -> Result<(), DbErr> {
    if !notes::list_by_project(db, project_id).await?.is_empty() {
        return Ok(());
    }

    let note_specs = vec![
        ("Architecture", format!("{project_name} architecture map"), format!("{project_name} is currently organized around a coordinator plus specialist agents with project-scoped persistence."), false, "System".to_owned()),
        ("Decisions", format!("{project_name} implementation decisions"), "The backend is the source of truth; frontend state is derived from React Query and SSE.".to_owned(), false, "Planning Engine".to_owned()),
        ("Patterns", format!("{project_name} delivery pattern"), "Each feature flows through repo -> API -> generated types -> React Query hooks.".to_owned(), true, "System".to_owned()),
    ];

    for (category, title, content, auto, author) in note_specs {
        notes::create(
            db,
            notes::CreateNote {
                project_id: project_id.into(),
                category: category.into(),
                title,
                content,
                auto,
                author,
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_tech_debt(
    db: &DatabaseConnection,
    project_id: &str,
    profile: usize,
) -> Result<(), DbErr> {
    if !tech_debt::list_by_project(db, project_id).await?.is_empty() {
        return Ok(());
    }

    let debt_specs = match profile {
        0 => vec![
            (
                "Refactor auth module",
                "high",
                Some("src/lib/auth.ts"),
                Some("Monolithic auth file needs splitting into separate concerns"),
                450,
                Some("High coupling, hard to test"),
            ),
            (
                "Update deprecated APIs",
                "medium",
                Some("src/lib/api.ts"),
                Some("Using deprecated fetch patterns"),
                120,
                Some("Will break in next major version"),
            ),
            (
                "Add error boundaries",
                "medium",
                Some("src/App.tsx"),
                Some("No error boundaries in component tree"),
                0,
                Some("Uncaught errors crash entire app"),
            ),
        ],
        1 => vec![
            (
                "Reduce gateway middleware nesting",
                "medium",
                Some("src/gateway/router.ts"),
                Some("Too many nested guards in the route tree"),
                180,
                Some("Harder to reason about error flow"),
            ),
            (
                "Extract telemetry adapters",
                "low",
                Some("src/telemetry/index.ts"),
                Some("Observability code is coupled to the gateway package"),
                90,
                Some("Slower change velocity"),
            ),
        ],
        _ => vec![
            (
                "Cache feature columns",
                "medium",
                Some("pipelines/features.py"),
                Some("Feature extraction reruns on identical batches"),
                210,
                Some("Wasted compute spend"),
            ),
            (
                "Move trainer config to versioned files",
                "low",
                Some("training/config.py"),
                Some("Hard-coded config values make experiments brittle"),
                75,
                Some("Difficult reproducibility"),
            ),
        ],
    };

    for (index, (title, severity, file, description, lines, impact)) in
        debt_specs.into_iter().enumerate()
    {
        tech_debt::create(
            db,
            tech_debt::CreateTechDebt {
                project_id: project_id.into(),
                title: title.into(),
                description: description.map(str::to_owned),
                file: file.map(str::to_owned),
                impact: impact.map(str::to_owned),
                severity: severity.into(),
                lines,
                position: index as i32,
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_sprints(
    db: &DatabaseConnection,
    project_id: &str,
    profile: usize,
) -> Result<(), DbErr> {
    if !sprints::list_by_project(db, project_id).await?.is_empty() {
        return Ok(());
    }

    let sprint_specs = match profile {
        0 => vec![
            ("Sprint 3", "active", "Apr 1", "Apr 14", Some(34), 42, 0),
            ("Sprint 4", "planned", "Apr 15", "Apr 28", None, 31, 1),
            ("Sprint 2", "completed", "Mar 18", "Mar 31", Some(38), 38, 2),
        ],
        1 => vec![
            (
                "Gateway Split",
                "active",
                "Apr 8",
                "Apr 19",
                Some(21),
                24,
                0,
            ),
            ("Edge Follow-up", "planned", "Apr 20", "Apr 30", None, 18, 1),
        ],
        _ => vec![
            (
                "Training Cycle",
                "active",
                "Apr 10",
                "Apr 22",
                Some(19),
                27,
                0,
            ),
            ("Evaluation Pass", "planned", "Apr 23", "May 4", None, 16, 1),
        ],
    };

    for (name, status, start_date, end_date, velocity, points, position) in sprint_specs {
        sprints::create(
            db,
            CreateSprint {
                project_id: project_id.into(),
                name: name.into(),
                status: status.into(),
                start_date: start_date.into(),
                end_date: end_date.into(),
                velocity,
                points,
                position,
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_session_and_costs(
    db: &DatabaseConnection,
    project_id: &str,
    profile: usize,
) -> Result<(), DbErr> {
    let existing_sessions = sessions::list_by_project(db, project_id).await?;
    let session = if let Some(existing) = existing_sessions.into_iter().next() {
        existing
    } else {
        sessions::create_active(db, project_id).await?
    };

    if !cost_events::list_by_project(db, project_id)
        .await?
        .is_empty()
    {
        return Ok(());
    }

    let cost_specs = match profile {
        0 => vec![
            (28_000, 5_000, 1_200, "Planning Engine orchestration"),
            (35_000, 8_000, 1_900, "Frontend dashboard work"),
            (47_000, 12_000, 2_100, "Backend auth middleware"),
            (56_000, 10_000, 2_600, "QA integration tests"),
            (47_000, 20_000, 2_400, "Mixed background agent work"),
        ],
        1 => vec![
            (18_000, 4_000, 900, "Gateway planner review"),
            (22_000, 6_000, 1_200, "Service extraction"),
            (9_000, 2_000, 450, "Latency smoke tests"),
        ],
        _ => vec![
            (21_000, 5_000, 1_050, "Dataset normalization"),
            (19_000, 4_000, 880, "Training sweep orchestration"),
            (11_000, 3_000, 520, "Evaluation and blocking analysis"),
        ],
    };

    for (tokens_in, tokens_out, cost_cents, memo) in cost_specs {
        cost_events::insert(
            db,
            cost_events::NewCostEvent {
                project_id,
                session_id: Some(&session.id),
                agent_id: None,
                kind: "llm_call",
                tokens_in,
                tokens_out,
                cost_cents,
                memo: Some(memo),
            },
        )
        .await?;
    }

    Ok(())
}

async fn ensure_project_scope_settings(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<(), DbErr> {
    let scope = format!("project:{project_id}");
    settings::put_value(
        db,
        &scope,
        "requirements",
        json_value(include_str!("../../../seed/requirements.json")),
    )
    .await?;
    settings::put_value(
        db,
        &scope,
        "userStories",
        json_value(include_str!("../../../seed/user_stories.json")),
    )
    .await?;
    settings::put_value(
        db,
        &scope,
        "activityFeed",
        json_value(include_str!("../../../seed/activity_feed.json")),
    )
    .await?;
    settings::put_value(
        db,
        &scope,
        "sessionHistory",
        json_value(include_str!("../../../seed/session_history.json")),
    )
    .await?;
    settings::put_value(
        db,
        &scope,
        "insights.qualityOverTime",
        json_value(include_str!("../../../seed/quality_over_time.json")),
    )
    .await?;
    settings::put_value(
        db,
        &scope,
        "insights.spend",
        json_value(include_str!("../../../seed/spend.json")),
    )
    .await?;
    settings::put_value(
        db,
        &scope,
        "insights.taskThroughput",
        json_value(include_str!("../../../seed/task_throughput.json")),
    )
    .await?;
    settings::put_value(db, &scope, "agentMessages", json!({})).await?;
    Ok(())
}

/// Scope/key used as the "demo seed completed" sentinel. Stored in the
/// `settings` table because it already supports atomic upsert; cheap to read
/// at startup. Manual reseed: delete this row (or run the `seed` CLI which
/// sets the sentinel after each successful run).
const SEED_SENTINEL_SCOPE: &str = "system";
const SEED_SENTINEL_KEY: &str = "seed.demo.completed";

/// The exact `enabledTools` list early demo databases were seeded with —
/// only the six basic fs/web/shell tools. Databases carrying *exactly*
/// this set never saw the project-state / coordination / git tools, so
/// agents literally could not call them (the tool registry is allowlist-
/// filtered against this setting). [`heal_enabled_tools`] upgrades that
/// stale fingerprint to the current canonical default.
const STALE_ENABLED_TOOLS: &[&str] = &[
    "web_search",
    "web_fetch",
    "fs_read",
    "fs_write",
    "fs_list",
    "shell_exec",
];

/// One-time heal for databases seeded before `settings_state.json` grew
/// its full tool list. Runs on every boot, *outside* the seed sentinel
/// (the sentinel would otherwise skip it forever on an already-seeded
/// DB). Only acts when `enabledTools` is byte-identical to the known
/// stale six-tool set — if the operator customised the list at all, it
/// is left untouched.
async fn heal_enabled_tools(db: &DatabaseConnection) -> Result<(), DbErr> {
    let Some(mut state) = settings::get_value(db, "global", "settingsState").await? else {
        return Ok(());
    };
    let current: Vec<String> = state
        .get("toolsSandbox")
        .and_then(|t| t.get("enabledTools"))
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default();

    let is_stale = current.len() == STALE_ENABLED_TOOLS.len()
        && STALE_ENABLED_TOOLS
            .iter()
            .all(|t| current.iter().any(|c| c == t));
    if !is_stale {
        return Ok(());
    }

    // Pull the canonical list from the seed snapshot so this heal stays
    // in lockstep with whatever a fresh install ships.
    let canonical = json_value(include_str!("../../../seed/settings_state.json"));
    let Some(tools) = canonical
        .get("toolsSandbox")
        .and_then(|t| t.get("enabledTools"))
        .cloned()
    else {
        return Ok(());
    };
    if let Some(sandbox) = state
        .get_mut("toolsSandbox")
        .and_then(|t| t.as_object_mut())
    {
        sandbox.insert("enabledTools".to_owned(), tools);
        settings::put_value(db, "global", "settingsState", state).await?;
        tracing::info!("healed stale enabledTools — agents now see the full tool catalog");
    }
    Ok(())
}

pub async fn seed_demo(db: &DatabaseConnection) -> Result<(), DbErr> {
    // Run the enabled-tools heal on *every* boot, before the sentinel
    // early-return — otherwise an already-seeded DB stuck on the old
    // six-tool list would never recover.
    heal_enabled_tools(db).await?;

    // Idempotency guard: if a previous boot completed seeding, skip.
    // Avoids races on simultaneous startup (two processes both finding
    // an empty `projects` table) and avoids re-creating notifications
    // when the user has only deleted some demo rows.
    if settings::get_value(db, SEED_SENTINEL_SCOPE, SEED_SENTINEL_KEY)
        .await?
        .is_some()
    {
        return Ok(());
    }

    let project_specs = [
        ProjectSpec {
            name: "HIVE Dashboard",
            description: "Internal agent management dashboard",
            sovereignty_tier: "local",
            budget_total_cents: 20_000,
            health_score: 87,
            spec_completion: 73,
            test_coverage: 68,
        },
        ProjectSpec {
            name: "API Gateway v2",
            description: "Microservices gateway refactor",
            sovereignty_tier: "local",
            budget_total_cents: 15_000,
            health_score: 92,
            spec_completion: 91,
            test_coverage: 82,
        },
        ProjectSpec {
            name: "ML Pipeline",
            description: "Data processing and model training pipeline",
            sovereignty_tier: "cloud",
            budget_total_cents: 20_000,
            health_score: 64,
            spec_completion: 55,
            test_coverage: 41,
        },
    ];

    let mut project_ids = Vec::new();
    for spec in &project_specs {
        project_ids.push(ensure_project(db, spec).await?);
    }

    if notifications::list_all(db).await?.is_empty() {
        for (kind, title, message, actionable, action_label) in [
            (
                "critical",
                "Budget threshold reached",
                "Project budget at 89% - 3 agents throttled",
                true,
                Some("Extend Budget"),
            ),
            (
                "high",
                "Agent loop detected",
                "Doc Writer repeated the same action 4 times",
                true,
                Some("Intervene"),
            ),
            (
                "medium",
                "Spec drift in 4.2",
                "Implementation diverged from PRD",
                true,
                Some("Review"),
            ),
            (
                "info",
                "Eval batch complete",
                "QA Sentinel - 94% pass rate",
                false,
                None,
            ),
            (
                "info",
                "PR #11 ready",
                "Backend Engineer: auth middleware",
                false,
                None,
            ),
            (
                "medium",
                "Test coverage dropped",
                "Coverage fell below 70% threshold",
                false,
                None,
            ),
            (
                "high",
                "Security scan warning",
                "Potential credential leak in config.ts",
                true,
                Some("Review"),
            ),
        ] {
            notifications::create(
                db,
                notifications::CreateNotification {
                    project_id: Some(project_ids[0].clone()),
                    r#type: kind.into(),
                    title: title.into(),
                    message: message.into(),
                    actionable,
                    action_label: action_label.map(str::to_owned),
                    payload: None,
                },
            )
            .await?;
        }
    }

    for (profile, project_id) in project_ids.iter().enumerate() {
        ensure_agents(db, project_id, profile).await?;
        ensure_tasks(db, project_id, profile).await?;
        ensure_alerts(db, project_id, profile).await?;
        ensure_notes(db, project_id, project_specs[profile].name).await?;
        ensure_tech_debt(db, project_id, profile).await?;
        ensure_sprints(db, project_id, profile).await?;
        ensure_session_and_costs(db, project_id, profile).await?;
        ensure_project_scope_settings(db, project_id).await?;
    }

    settings::put_value(db, "global", "activeProjectId", json!(project_ids[0])).await?;
    settings::put_value(
        db,
        "global",
        "settingsState",
        json_value(include_str!("../../../seed/settings_state.json")),
    )
    .await?;
    settings::put_value(
        db,
        "global",
        "agentBlueprints",
        json_value(include_str!("../../../seed/agent_blueprints.json")),
    )
    .await?;
    settings::put_value(
        db,
        "global",
        "moduleCatalog",
        json_value(include_str!("../../../seed/module_catalog.json")),
    )
    .await?;

    // W1-A2: surface the audit retention so the operator can edit it from
    // Settings. Default 90 days; set to 0 to keep forever. Without seeding
    // this key the runtime falls back to 90 but no UI control would persist.
    settings::put_value(db, "global", "audit.retention_days", json!(90)).await?;

    if audit::list_for_entity(db, "project", &project_ids[0])
        .await?
        .is_empty()
    {
        audit::append(
            db,
            "system",
            "seed.demo",
            "project",
            &project_ids[0],
            None,
            Some(json!({ "seeded": true })),
        )
        .await?;
    }

    // Sentinel: subsequent calls short-circuit at the top.
    settings::put_value(
        db,
        SEED_SENTINEL_SCOPE,
        SEED_SENTINEL_KEY,
        json!({ "at": crate::repos::now_rfc3339() }),
    )
    .await?;

    Ok(())
}
