//! End-to-end coverage for the Phase 0b redesign foundations: confirms
//! that the migration applies cleanly on a fresh SQLite database and that
//! every new repo can round-trip rows.

use hive_db::repos::{
    agent_mcp_bindings, agent_spawn_requests, agent_task_assignments, connectors,
    custom_mcp_servers, drift_events, skills, spec_document_sections, spec_documents,
};
use hive_db::Db;

async fn fresh_db() -> Db {
    // SQLite in-memory; auto_migrate runs the full migration set including
    // our new m20260606 foundations migration.
    Db::connect("sqlite::memory:", true)
        .await
        .expect("connect + migrate")
}

/// Insert a project + agent + task + sprint scaffold so FKs the new tables
/// reference resolve. Returns (project_id, agent_id, task_id).
async fn seed_scaffold(db: &Db) -> (String, String, String) {
    use hive_db::entities::{agent, project, sprint, task};
    use sea_orm::{ActiveModelTrait, Set};

    let now = chrono::Utc::now().to_rfc3339();
    let project_id = ulid::Ulid::new().to_string().to_lowercase();
    project::ActiveModel {
        id: Set(project_id.clone()),
        name: Set("test-project".into()),
        description: Set(None),
        health_score: Set(100),
        spec_completion: Set(0),
        test_coverage: Set(0),
        sovereignty_tier: Set("standard".into()),
        status: Set("active".into()),
        budget_total_cents: Set(0),
        last_activity_at: Set(None),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
        deleted_at: Set(None),
    }
    .insert(db.conn())
    .await
    .expect("insert project");

    let agent_id = ulid::Ulid::new().to_string().to_lowercase();
    agent::ActiveModel {
        id: Set(agent_id.clone()),
        project_id: Set(project_id.clone()),
        slug: Set(format!("a-{}", &agent_id[..8])),
        name: Set("Test Agent".into()),
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
        updated_at: Set(now.clone()),
        deleted_at: Set(None),
    }
    .insert(db.conn())
    .await
    .expect("insert agent");

    let sprint_id = ulid::Ulid::new().to_string().to_lowercase();
    sprint::ActiveModel {
        id: Set(sprint_id.clone()),
        project_id: Set(project_id.clone()),
        name: Set("Sprint 1".into()),
        status: Set("active".into()),
        start_date: Set(now.clone()),
        end_date: Set(now.clone()),
        velocity: Set(None),
        points: Set(0),
        position: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    }
    .insert(db.conn())
    .await
    .expect("insert sprint");

    let task_id = ulid::Ulid::new().to_string().to_lowercase();
    task::ActiveModel {
        id: Set(task_id.clone()),
        project_id: Set(project_id.clone()),
        agent_id: Set(Some(agent_id.clone())),
        title: Set("Test task".into()),
        status: Set("queued".into()),
        phase: Set(None),
        sprint_id: Set(Some(sprint_id)),
        priority: Set("medium".into()),
        estimated_tokens: Set(0),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        completed_at: Set(None),
        deleted_at: Set(None),
        spec_section_id: Set(None),
        due_at: Set(None),
        last_progress_at: Set(None),
    }
    .insert(db.conn())
    .await
    .expect("insert task");

    (project_id, agent_id, task_id)
}

#[tokio::test]
async fn migration_creates_all_new_tables() {
    let db = fresh_db().await;
    // If any table failed to create, listing returns DbErr. We don't care
    // about contents here — only that the schema exists.
    skills::list_for_project(db.conn(), "missing")
        .await
        .expect("skills table exists");
    connectors::list_for_project(db.conn(), "missing")
        .await
        .expect("connectors table exists");
    spec_documents::list_for_project(db.conn(), "missing")
        .await
        .expect("spec_documents table exists");
    spec_document_sections::list_for_document(db.conn(), "missing")
        .await
        .expect("spec_document_sections table exists");
    agent_task_assignments::list_for_agent(db.conn(), "missing")
        .await
        .expect("agent_task_assignments table exists");
    drift_events::list_for_project(db.conn(), "missing", false)
        .await
        .expect("drift_events table exists");
    custom_mcp_servers::list_for_project(db.conn(), "missing")
        .await
        .expect("custom_mcp_servers table exists");
    agent_spawn_requests::list_for_project(db.conn(), "missing")
        .await
        .expect("agent_spawn_requests table exists");
    agent_mcp_bindings::list_for_agent(db.conn(), "missing")
        .await
        .expect("agent_mcp_bindings table exists");
}

#[tokio::test]
async fn skills_round_trip_global_and_project_scoped() {
    let db = fresh_db().await;
    let (project_id, _, _) = seed_scaffold(&db).await;

    // Global skill (project_id None) — visible to every project.
    let global = skills::create(
        db.conn(),
        skills::CreateSkill {
            project_id: None,
            slug: "g-skill".into(),
            name: "Global Skill".into(),
            description: "shared".into(),
            system_prompt_fragment: "Be concise.".into(),
            allowed_tools_json: serde_json::json!(["fs_read"]),
            allowed_paths_json: serde_json::json!(["**/*.md"]),
            requires_connector_ids_json: serde_json::json!([]),
            capabilities_json: serde_json::json!(["docs"]),
        },
    )
    .await
    .unwrap();

    let scoped = skills::create(
        db.conn(),
        skills::CreateSkill {
            project_id: Some(project_id.clone()),
            slug: "p-skill".into(),
            name: "Project Skill".into(),
            description: "scoped".into(),
            system_prompt_fragment: String::new(),
            allowed_tools_json: serde_json::json!([]),
            allowed_paths_json: serde_json::json!([]),
            requires_connector_ids_json: serde_json::json!([]),
            capabilities_json: serde_json::json!([]),
        },
    )
    .await
    .unwrap();

    let listed = skills::list_for_project(db.conn(), &project_id).await.unwrap();
    let ids: Vec<&str> = listed.iter().map(|s| s.id.as_str()).collect();
    assert!(ids.contains(&global.id.as_str()), "global skill must surface");
    assert!(ids.contains(&scoped.id.as_str()), "project skill must surface");

    // A different project sees the global one but not the scoped one.
    let listed_other = skills::list_for_project(db.conn(), "other-project")
        .await
        .unwrap();
    assert!(listed_other.iter().any(|s| s.id == global.id));
    assert!(!listed_other.iter().any(|s| s.id == scoped.id));
}

#[tokio::test]
async fn spec_document_section_anchors_remain_unique_per_document() {
    let db = fresh_db().await;
    let (project_id, _, _) = seed_scaffold(&db).await;

    let doc = spec_documents::create(
        db.conn(),
        spec_documents::CreateSpecDocument {
            project_id: project_id.clone(),
            title: "v1".into(),
            source: "manual".into(),
            markdown: "# Hello\n## Payments".into(),
        },
    )
    .await
    .unwrap();

    let synced = spec_document_sections::sync_for_document(
        db.conn(),
        &doc.id,
        vec![
            spec_document_sections::UpsertSection {
                anchor: "hello".into(),
                title: "Hello".into(),
                body: String::new(),
                ordinal: 0,
            },
            spec_document_sections::UpsertSection {
                anchor: "payments".into(),
                title: "Payments".into(),
                body: String::new(),
                ordinal: 1,
            },
        ],
    )
    .await
    .unwrap();
    assert_eq!(synced.len(), 2);

    // Re-syncing replaces (does not duplicate) — anchors stable across versions.
    let resynced = spec_document_sections::sync_for_document(
        db.conn(),
        &doc.id,
        vec![spec_document_sections::UpsertSection {
            anchor: "hello".into(),
            title: "Hello v2".into(),
            body: "updated".into(),
            ordinal: 0,
        }],
    )
    .await
    .unwrap();
    assert_eq!(resynced.len(), 1);
    let listed = spec_document_sections::list_for_document(db.conn(), &doc.id)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].title, "Hello v2");
}

#[tokio::test]
async fn assignment_state_machine_transitions() {
    let db = fresh_db().await;
    let (_, agent_id, task_id) = seed_scaffold(&db).await;

    let asn = agent_task_assignments::create(
        db.conn(),
        agent_task_assignments::CreateAssignment {
            agent_id: agent_id.clone(),
            task_id: task_id.clone(),
            expected_completion_at: Some(chrono::Utc::now().to_rfc3339()),
            state: "started".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(asn.state, "started");
    assert!(asn.started_at.is_none());

    let now = chrono::Utc::now().to_rfc3339();
    let updated = agent_task_assignments::update(
        db.conn(),
        &asn.id,
        agent_task_assignments::UpdateAssignment {
            state: Some("in-progress".into()),
            started_at: Some(now.clone()),
            drift_score: Some(0.42),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(updated.state, "in-progress");
    assert_eq!(updated.started_at.as_deref(), Some(now.as_str()));
    assert!((updated.drift_score - 0.42).abs() < f64::EPSILON);

    let by_agent = agent_task_assignments::list_for_agent(db.conn(), &agent_id)
        .await
        .unwrap();
    assert_eq!(by_agent.len(), 1);
    let by_task = agent_task_assignments::list_for_task(db.conn(), &task_id)
        .await
        .unwrap();
    assert_eq!(by_task.len(), 1);
}

#[tokio::test]
async fn drift_events_filter_open_only() {
    let db = fresh_db().await;
    let (project_id, agent_id, _) = seed_scaffold(&db).await;

    let open = drift_events::create(
        db.conn(),
        drift_events::CreateDriftEvent {
            project_id: project_id.clone(),
            kind: "agent-vs-task".into(),
            subject_id: agent_id.clone(),
            subject_kind: "agent".into(),
            evidence_json: serde_json::json!({"score": 0.7}),
            severity: "high".into(),
        },
    )
    .await
    .unwrap();
    let resolved = drift_events::create(
        db.conn(),
        drift_events::CreateDriftEvent {
            project_id: project_id.clone(),
            kind: "code-vs-spec".into(),
            subject_id: "req-1".into(),
            subject_kind: "requirement".into(),
            evidence_json: serde_json::json!({}),
            severity: "low".into(),
        },
    )
    .await
    .unwrap();
    drift_events::set_status(db.conn(), &resolved.id, "approved")
        .await
        .unwrap();

    let only_open = drift_events::list_for_project(db.conn(), &project_id, true)
        .await
        .unwrap();
    assert_eq!(only_open.len(), 1);
    assert_eq!(only_open[0].id, open.id);

    let all = drift_events::list_for_project(db.conn(), &project_id, false)
        .await
        .unwrap();
    assert_eq!(all.len(), 2);
    let approved = all.iter().find(|e| e.id == resolved.id).unwrap();
    assert_eq!(approved.status, "approved");
    assert!(approved.resolved_at.is_some());
}

#[tokio::test]
async fn spawn_request_walks_state_machine() {
    let db = fresh_db().await;
    let (project_id, agent_id, _) = seed_scaffold(&db).await;

    let req = agent_spawn_requests::create(
        db.conn(),
        agent_spawn_requests::CreateSpawnRequest {
            project_id: project_id.clone(),
            parent_agent_id: Some(agent_id.clone()),
            requested_role: "weather-fetcher".into(),
            requested_capabilities_json: serde_json::json!(["weather", "geocoding"]),
            context_json: serde_json::json!({}),
            mcp_strategy: "reuse-or-synth".into(),
        },
    )
    .await
    .unwrap();
    assert_eq!(req.status, "queued");

    let req = agent_spawn_requests::update(
        db.conn(),
        &req.id,
        agent_spawn_requests::UpdateSpawnRequest {
            status: Some("matching-existing-mcp".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(req.status, "matching-existing-mcp");

    // Synthesize an MCP, attach via the bindings table, finish.
    let mcp = custom_mcp_servers::create(
        db.conn(),
        custom_mcp_servers::CreateCustomMcpServer {
            project_id: project_id.clone(),
            owner_agent_id: Some(agent_id.clone()),
            name: "Weather MCP".into(),
            slug: "weather".into(),
            source_api_url: Some("https://api.example.com/weather".into()),
            source_api_spec_json: None,
            generated_manifest_json: serde_json::json!({"tools": ["forecast"]}),
            generated_handler_code: "// generated".into(),
            transport: "http".into(),
            encrypted_credentials: None,
            reusable: true,
            capabilities_json: serde_json::json!(["weather"]),
            embedding_json: None,
        },
    )
    .await
    .unwrap();
    custom_mcp_servers::set_status(db.conn(), &mcp.id, "active").await.unwrap();

    let reusable = custom_mcp_servers::list_reusable_for_project(db.conn(), &project_id)
        .await
        .unwrap();
    assert!(reusable.iter().any(|s| s.id == mcp.id));

    agent_mcp_bindings::create(
        db.conn(),
        agent_mcp_bindings::CreateBinding {
            agent_id: agent_id.clone(),
            mcp_server_id: mcp.id.clone(),
            kind: "custom".into(),
        },
    )
    .await
    .unwrap();
    let bindings = agent_mcp_bindings::list_for_agent(db.conn(), &agent_id)
        .await
        .unwrap();
    assert_eq!(bindings.len(), 1);
    assert_eq!(bindings[0].mcp_server_id, mcp.id);

    let finished = agent_spawn_requests::update(
        db.conn(),
        &req.id,
        agent_spawn_requests::UpdateSpawnRequest {
            status: Some("completed".into()),
            child_agent_id: Some(agent_id.clone()),
            synthesized_mcp_ids_json: Some(serde_json::json!([mcp.id])),
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(finished.status, "completed");
    assert!(finished.completed_at.is_some());
    assert_eq!(finished.child_agent_id.as_deref(), Some(agent_id.as_str()));
}

#[tokio::test]
async fn connector_list_filters_mcp_kind() {
    let db = fresh_db().await;
    let (project_id, _, _) = seed_scaffold(&db).await;

    let api = connectors::create(
        db.conn(),
        connectors::CreateConnector {
            project_id: project_id.clone(),
            kind: "api".into(),
            slug: "github".into(),
            name: "GitHub".into(),
            base_url: Some("https://api.github.com".into()),
            auth_kind: "bearer".into(),
            encrypted_credentials: Some("ciphertext".into()),
            masked_key: Some("ghp_…42".into()),
            config_json: serde_json::json!({}),
        },
    )
    .await
    .unwrap();
    let mcp = connectors::create(
        db.conn(),
        connectors::CreateConnector {
            project_id: project_id.clone(),
            kind: "mcp".into(),
            slug: "linear-mcp".into(),
            name: "Linear MCP".into(),
            base_url: Some("https://mcp.linear.app".into()),
            auth_kind: "mcp_handshake".into(),
            encrypted_credentials: None,
            masked_key: None,
            config_json: serde_json::json!({}),
        },
    )
    .await
    .unwrap();

    let all = connectors::list_for_project(db.conn(), &project_id).await.unwrap();
    assert_eq!(all.len(), 2);

    let mcp_only = connectors::list_mcp_for_project(db.conn(), &project_id).await.unwrap();
    assert_eq!(mcp_only.len(), 1);
    assert_eq!(mcp_only[0].id, mcp.id);
    assert_ne!(mcp_only[0].id, api.id);
}
