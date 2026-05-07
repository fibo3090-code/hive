//! End-to-end coverage for the doc→sprint decomposition pipeline:
//! parse a markdown spec, persist sections, materialize a decomposition,
//! and verify tasks resolve back to their source sections via the
//! `spec_section_id` FK.
//!
//! No LLM is invoked — `DecomposeOutput` is the contract the LLM call
//! eventually fulfills, so wiring tests against a hand-built
//! decomposition gives us an authoritative regression net before any
//! provider variance enters the picture.

use hive_db::{
    repos::{
        spec_document_sections,
        spec_documents::{self, CreateSpecDocument},
        sprints, tasks,
    },
    Db,
};
use hive_runtime::spec_doc::{
    into_upserts, materialize_decomposition, parse_sections, DecomposeOutput, DecomposeSprint,
    DecomposeTask,
};
use sea_orm::ActiveModelTrait;

async fn fresh_db() -> Db {
    Db::connect("sqlite::memory:", true)
        .await
        .expect("connect + migrate")
}

async fn seed_project(db: &Db) -> String {
    use hive_db::entities::project;
    use sea_orm::Set;
    let now = chrono::Utc::now().to_rfc3339();
    let id = ulid::Ulid::new().to_string().to_lowercase();
    project::ActiveModel {
        id: Set(id.clone()),
        name: Set("decompose-test".into()),
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
    id
}

const SAMPLE_SPEC: &str = "\
intro paragraph\n\
\n\
# Payments\n\
\n\
We must support Stripe checkout and refunds.\n\
\n\
## Auth\n\
\n\
SSO via Okta. JWT lifetime 1 hour.\n\
\n\
## Payments\n\
\n\
Webhook handlers for charge.succeeded.\n";

#[tokio::test]
async fn end_to_end_decompose_creates_sprints_and_tasks_linked_to_sections() {
    let db = fresh_db().await;
    let project_id = seed_project(&db).await;

    // 1. Persist a spec doc with parsed sections.
    let doc = spec_documents::create(
        db.conn(),
        CreateSpecDocument {
            project_id: project_id.clone(),
            title: "Spec v1".into(),
            source: "ceo-conversation".into(),
            markdown: SAMPLE_SPEC.into(),
        },
    )
    .await
    .unwrap();
    let parsed = parse_sections(SAMPLE_SPEC);
    // The parser produces: preamble, payments, auth, payments-2.
    assert_eq!(parsed.len(), 4, "preamble + 3 sections");
    let upserts = into_upserts(parsed);
    let sections = spec_document_sections::sync_for_document(db.conn(), &doc.id, upserts)
        .await
        .unwrap();
    assert_eq!(sections.len(), 4);

    // 2. Materialize a hand-built decomposition that links tasks to two
    // of those anchors and references one missing one.
    let decomposition = DecomposeOutput {
        sprints: vec![
            DecomposeSprint {
                name: "Foundations".into(),
                goal: Some("Auth + payments scaffolding".into()),
                start_date: Some("2026-05-01".into()),
                end_date: Some("2026-05-15".into()),
                tasks: vec![
                    DecomposeTask {
                        title: "Wire SSO callback".into(),
                        spec_section_anchor: Some("auth".into()),
                        agent_role: Some("backend-dev".into()),
                        priority: "high".into(),
                        estimated_tokens: 1200,
                        due_at: Some("2026-05-10T00:00:00Z".into()),
                    },
                    // `#payments` should also resolve once the leading
                    // hash is trimmed (matches what GitHub-style anchor
                    // links look like in the doc).
                    DecomposeTask {
                        title: "Webhook deduper".into(),
                        spec_section_anchor: Some("#payments".into()),
                        agent_role: Some("backend-dev".into()),
                        priority: "medium".into(),
                        estimated_tokens: 800,
                        due_at: None,
                    },
                ],
            },
            DecomposeSprint {
                name: "Refunds".into(),
                goal: None,
                start_date: None,
                end_date: None,
                tasks: vec![DecomposeTask {
                    title: "Refund flow UX".into(),
                    spec_section_anchor: Some("nope-not-real".into()),
                    agent_role: Some("frontend-dev".into()),
                    priority: "medium".into(),
                    estimated_tokens: 500,
                    due_at: None,
                }],
            },
        ],
    };

    let result = materialize_decomposition(db.conn(), &project_id, &doc.id, decomposition, 0)
        .await
        .unwrap();

    // 3. Sprints + tasks were created.
    assert_eq!(result.sprint_ids.len(), 2);
    assert_eq!(result.task_ids.len(), 3);
    assert_eq!(result.unmatched_anchors, vec!["nope-not-real".to_owned()]);

    let listed_sprints = sprints::list_by_project(db.conn(), &project_id).await.unwrap();
    assert_eq!(listed_sprints.len(), 2);
    // The sprint with a `goal` shows it appended to the name.
    assert!(listed_sprints[0].name.contains("Foundations"));
    assert!(listed_sprints[0].name.contains("Auth + payments"));
    // The sprint without a goal preserves its plain name.
    assert_eq!(listed_sprints[1].name, "Refunds");
    // Position is 0-based and contiguous, matching `starting_position=0`.
    assert_eq!(listed_sprints[0].position, 0);
    assert_eq!(listed_sprints[1].position, 1);

    // 4. Task FK links resolve back to spec sections (the whole point).
    let listed_tasks = tasks::list_by_project(db.conn(), &project_id).await.unwrap();
    assert_eq!(listed_tasks.len(), 3);

    let auth_section_id = sections.iter().find(|s| s.anchor == "auth").unwrap().id.clone();
    let payments_section_id = sections.iter().find(|s| s.anchor == "payments").unwrap().id.clone();

    let sso_task = listed_tasks
        .iter()
        .find(|t| t.title == "Wire SSO callback")
        .unwrap();
    assert_eq!(sso_task.spec_section_id.as_deref(), Some(auth_section_id.as_str()));
    assert_eq!(sso_task.due_at.as_deref(), Some("2026-05-10T00:00:00Z"));
    assert_eq!(sso_task.priority, "high");
    assert_eq!(sso_task.estimated_tokens, 1200);
    assert_eq!(sso_task.phase.as_deref(), Some("backend-dev"));
    assert_eq!(sso_task.status, "queued");

    let webhook_task = listed_tasks
        .iter()
        .find(|t| t.title == "Webhook deduper")
        .unwrap();
    // `#payments` (with leading hash) must resolve to the same id as
    // `payments` since the parser slugified the anchor.
    assert_eq!(
        webhook_task.spec_section_id.as_deref(),
        Some(payments_section_id.as_str())
    );

    // The unmatched anchor → task without a section FK, but still
    // persisted so the sprint isn't torn apart by one bad reference.
    let refund_task = listed_tasks
        .iter()
        .find(|t| t.title == "Refund flow UX")
        .unwrap();
    assert!(refund_task.spec_section_id.is_none());
}

#[tokio::test]
async fn empty_decomposition_creates_nothing() {
    let db = fresh_db().await;
    let project_id = seed_project(&db).await;
    let doc = spec_documents::create(
        db.conn(),
        CreateSpecDocument {
            project_id: project_id.clone(),
            title: "Empty".into(),
            source: "manual".into(),
            markdown: String::new(),
        },
    )
    .await
    .unwrap();

    let result = materialize_decomposition(
        db.conn(),
        &project_id,
        &doc.id,
        DecomposeOutput { sprints: vec![] },
        0,
    )
    .await
    .unwrap();
    assert!(result.sprint_ids.is_empty());
    assert!(result.task_ids.is_empty());
    assert!(result.unmatched_anchors.is_empty());
}

#[tokio::test]
async fn task_without_anchor_is_persisted_without_section_link() {
    let db = fresh_db().await;
    let project_id = seed_project(&db).await;
    let doc = spec_documents::create(
        db.conn(),
        CreateSpecDocument {
            project_id: project_id.clone(),
            title: "Spec".into(),
            source: "manual".into(),
            markdown: "# Top\n\nbody".into(),
        },
    )
    .await
    .unwrap();
    let _ = spec_document_sections::sync_for_document(
        db.conn(),
        &doc.id,
        into_upserts(parse_sections("# Top\n\nbody")),
    )
    .await
    .unwrap();

    let result = materialize_decomposition(
        db.conn(),
        &project_id,
        &doc.id,
        DecomposeOutput {
            sprints: vec![DecomposeSprint {
                name: "S1".into(),
                goal: None,
                start_date: None,
                end_date: None,
                tasks: vec![DecomposeTask {
                    title: "Manual task".into(),
                    spec_section_anchor: None,
                    agent_role: None,
                    priority: "medium".into(),
                    estimated_tokens: 0,
                    due_at: None,
                }],
            }],
        },
        0,
    )
    .await
    .unwrap();

    assert_eq!(result.task_ids.len(), 1);
    // No anchor was supplied → not counted as unmatched (only explicitly
    // bad references are surfaced).
    assert!(result.unmatched_anchors.is_empty());

    let listed = tasks::list_by_project(db.conn(), &project_id).await.unwrap();
    assert!(listed.iter().all(|t| t.spec_section_id.is_none()));
}

#[tokio::test]
async fn starting_position_offsets_subsequent_sprints() {
    // Re-decomposing a project (e.g. after an incremental spec edit)
    // must not collide with existing sprint positions.
    let db = fresh_db().await;
    let project_id = seed_project(&db).await;
    let doc = spec_documents::create(
        db.conn(),
        CreateSpecDocument {
            project_id: project_id.clone(),
            title: "Spec".into(),
            source: "manual".into(),
            markdown: "# T".into(),
        },
    )
    .await
    .unwrap();

    let make_doc = || DecomposeOutput {
        sprints: vec![DecomposeSprint {
            name: "First".into(),
            goal: None,
            start_date: None,
            end_date: None,
            tasks: vec![],
        }],
    };

    let _ = materialize_decomposition(db.conn(), &project_id, &doc.id, make_doc(), 0)
        .await
        .unwrap();
    let _ = materialize_decomposition(db.conn(), &project_id, &doc.id, make_doc(), 1)
        .await
        .unwrap();

    let listed = sprints::list_by_project(db.conn(), &project_id).await.unwrap();
    assert_eq!(listed.len(), 2);
    assert_eq!(listed[0].position, 0);
    assert_eq!(listed[1].position, 1);
}
