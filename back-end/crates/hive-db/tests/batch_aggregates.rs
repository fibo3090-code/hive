//! Regression coverage for the batched aggregate repo functions that back
//! the `list_projects` (C060) and `export_project` (C061) N+1 fixes.
//! Each batched function must agree with the per-item version it replaces.

use hive_db::repos::{
    agents::{self, CreateAgent},
    chat_messages::{self, NewMessage},
    chat_threads::{self, CreateThread},
    cost_events::{self, NewCostEvent},
    projects::{self, CreateProject},
};
use hive_db::Db;

async fn fresh_db() -> Db {
    Db::connect("sqlite::memory:", true)
        .await
        .expect("connect + migrate")
}

async fn make_project(db: &Db, name: &str, budget: i64) -> String {
    projects::create(
        db.conn(),
        CreateProject {
            name: name.into(),
            description: None,
            sovereignty_tier: "standard".into(),
            budget_total_cents: budget,
            status: "active".into(),
        },
    )
    .await
    .expect("create project")
    .id
}

async fn make_agent(db: &Db, project_id: &str, slug: &str) -> String {
    agents::create(
        db.conn(),
        CreateAgent {
            project_id: project_id.to_owned(),
            slug: slug.to_owned(),
            name: slug.to_owned(),
            role: "worker".into(),
            model: "test".into(),
            status: "idle".into(),
            parent_agent_id: None,
            spawned_by_message_id: None,
            enabled_tools: None,
            system_prompt: None,
            model_provider_id: None,
            model_id: None,
        },
    )
    .await
    .expect("create agent")
    .id
}

async fn add_cost(db: &Db, project_id: &str, cents: i64) {
    cost_events::insert(
        db.conn(),
        NewCostEvent {
            project_id,
            session_id: None,
            agent_id: None,
            kind: "final",
            tokens_in: 1,
            tokens_out: 1,
            cost_cents: cents,
            memo: None,
        },
    )
    .await
    .expect("insert cost event");
}

#[tokio::test]
async fn count_by_project_all_matches_per_project() {
    let db = fresh_db().await;
    let p1 = make_project(&db, "p1", 0).await;
    let p2 = make_project(&db, "p2", 0).await;
    let p3 = make_project(&db, "p3-empty", 0).await; // no agents
    make_agent(&db, &p1, "a1").await;
    make_agent(&db, &p1, "a2").await;
    make_agent(&db, &p2, "b1").await;

    let map = agents::count_by_project_all(db.conn()).await.unwrap();
    assert_eq!(map.get(&p1).copied().unwrap_or(0), 2);
    assert_eq!(map.get(&p2).copied().unwrap_or(0), 1);
    // Project with no agents is absent from the map (caller defaults to 0).
    assert_eq!(map.get(&p3), None);

    // Cross-check against the per-project function.
    for pid in [&p1, &p2, &p3] {
        let per = agents::count_by_project(db.conn(), pid).await.unwrap() as i64;
        assert_eq!(map.get(pid).copied().unwrap_or(0), per);
    }
}

#[tokio::test]
async fn total_cost_cents_by_project_matches_per_project() {
    let db = fresh_db().await;
    let p1 = make_project(&db, "p1", 0).await;
    let p2 = make_project(&db, "p2-empty", 0).await;
    add_cost(&db, &p1, 100).await;
    add_cost(&db, &p1, 250).await;

    let map = cost_events::total_cost_cents_by_project(db.conn())
        .await
        .unwrap();
    assert_eq!(map.get(&p1).copied().unwrap_or(0), 350);
    assert_eq!(map.get(&p2), None);

    for pid in [&p1, &p2] {
        let per = cost_events::total_cost_cents_for_project(db.conn(), pid)
            .await
            .unwrap();
        assert_eq!(map.get(pid).copied().unwrap_or(0), per);
    }
}

#[tokio::test]
async fn list_by_thread_ids_matches_per_thread_and_groups() {
    let db = fresh_db().await;
    let project = make_project(&db, "p", 0).await;
    let mut thread_ids = Vec::new();
    for t in 0..3 {
        let thread = chat_threads::create(
            db.conn(),
            CreateThread {
                project_id: project.clone(),
                agent_id: None,
                title: format!("thread {t}"),
            },
        )
        .await
        .unwrap();
        // Thread t gets t+1 messages so grouping/counts are distinguishable.
        for m in 0..=t {
            chat_messages::insert(
                db.conn(),
                NewMessage {
                    thread_id: thread.id.clone(),
                    role: "user".into(),
                    content: format!("t{t}-m{m}"),
                    tool_calls: serde_json::json!([]),
                    model: None,
                    provider_id: None,
                    tokens_in: 0,
                    tokens_out: 0,
                    cost_cents: 0,
                    parent_message_id: None,
                    status: "done".into(),
                },
            )
            .await
            .unwrap();
        }
        thread_ids.push(thread.id);
    }

    let all = chat_messages::list_by_thread_ids(db.conn(), &thread_ids)
        .await
        .unwrap();
    assert_eq!(all.len(), 1 + 2 + 3);

    // Group and compare against the per-thread function.
    let mut by_thread: std::collections::HashMap<String, Vec<_>> = std::collections::HashMap::new();
    for msg in all {
        by_thread
            .entry(msg.thread_id.clone())
            .or_default()
            .push(msg);
    }
    for (i, tid) in thread_ids.iter().enumerate() {
        let per = chat_messages::list_by_thread(db.conn(), tid).await.unwrap();
        let batched = by_thread.get(tid).cloned().unwrap_or_default();
        assert_eq!(batched.len(), i + 1);
        assert_eq!(
            batched.iter().map(|m| &m.id).collect::<Vec<_>>(),
            per.iter().map(|m| &m.id).collect::<Vec<_>>(),
            "batched order must match per-thread order (created_at asc)"
        );
    }
}

#[tokio::test]
async fn list_by_thread_ids_empty_input_is_empty() {
    let db = fresh_db().await;
    assert!(chat_messages::list_by_thread_ids(db.conn(), &[])
        .await
        .unwrap()
        .is_empty());
}
