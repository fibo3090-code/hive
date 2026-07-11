//! Regression coverage for `agents::ancestors` / `agents::descendants`
//! (C143/C144 batched rewrite; C152 flagged the walk as untested).

use hive_db::repos::{
    agents::{self, CreateAgent},
    projects::{self, CreateProject},
};
use hive_db::Db;

async fn fresh_db() -> Db {
    Db::connect("sqlite::memory:", true)
        .await
        .expect("connect + migrate")
}

async fn make_project(db: &Db) -> String {
    projects::create(
        db.conn(),
        CreateProject {
            name: "tree-walk".into(),
            description: None,
            sovereignty_tier: "standard".into(),
            budget_total_cents: 0,
            status: "active".into(),
        },
    )
    .await
    .expect("create project")
    .id
}

async fn make_agent(db: &Db, project_id: &str, slug: &str, parent: Option<&str>) -> String {
    agents::create(
        db.conn(),
        CreateAgent {
            project_id: project_id.to_owned(),
            slug: slug.to_owned(),
            name: slug.to_owned(),
            role: "worker".into(),
            model: "test".into(),
            status: "idle".into(),
            parent_agent_id: parent.map(str::to_owned),
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

/// root → mid → leaf; a sibling of mid hangs off root.
async fn scaffold() -> (Db, String, String, String, String) {
    let db = fresh_db().await;
    let project = make_project(&db).await;
    let root = make_agent(&db, &project, "root", None).await;
    let mid = make_agent(&db, &project, "mid", Some(&root)).await;
    let sibling = make_agent(&db, &project, "sibling", Some(&root)).await;
    let leaf = make_agent(&db, &project, "leaf", Some(&mid)).await;
    (db, root, mid, sibling, leaf)
}

#[tokio::test]
async fn ancestors_returns_chain_closest_first() {
    let (db, root, mid, _sibling, leaf) = scaffold().await;
    let chain = agents::ancestors(db.conn(), &leaf).await.unwrap();
    let ids: Vec<&str> = chain.iter().map(|a| a.id.as_str()).collect();
    assert_eq!(ids, vec![mid.as_str(), root.as_str()]);
}

#[tokio::test]
async fn ancestors_of_root_is_empty() {
    let (db, root, ..) = scaffold().await;
    assert!(agents::ancestors(db.conn(), &root)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn ancestors_of_unknown_id_is_empty() {
    let (db, ..) = scaffold().await;
    assert!(agents::ancestors(db.conn(), "nope")
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn descendants_returns_full_subtree_bfs() {
    let (db, root, mid, sibling, leaf) = scaffold().await;
    let subtree = agents::descendants(db.conn(), &root).await.unwrap();
    let ids: Vec<&str> = subtree.iter().map(|a| a.id.as_str()).collect();
    // Level 1 (mid + sibling, id order) before level 2 (leaf).
    assert_eq!(ids.len(), 3);
    let mut level1 = [mid.as_str(), sibling.as_str()];
    level1.sort();
    assert_eq!(&ids[..2], &level1[..]);
    assert_eq!(ids[2], leaf.as_str());
}

#[tokio::test]
async fn descendants_of_leaf_is_empty() {
    let (db, _root, _mid, _sibling, leaf) = scaffold().await;
    assert!(agents::descendants(db.conn(), &leaf)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
async fn soft_deleted_agents_are_excluded_from_walks() {
    let (db, root, mid, _sibling, leaf) = scaffold().await;
    {
        use sea_orm::{ActiveModelTrait, ActiveValue::Set};
        let mut row: hive_db::entities::agent::ActiveModel =
            agents::get(db.conn(), &mid).await.unwrap().unwrap().into();
        row.deleted_at = Set(Some(chrono::Utc::now().to_rfc3339()));
        row.update(db.conn()).await.unwrap();
    }
    // mid is gone: leaf's ancestor chain stops, root's subtree drops mid
    // (and leaf, which is only reachable through mid).
    assert!(agents::ancestors(db.conn(), &leaf)
        .await
        .unwrap()
        .is_empty());
    let subtree = agents::descendants(db.conn(), &root).await.unwrap();
    assert!(subtree.iter().all(|a| a.id != mid && a.id != leaf));
}
