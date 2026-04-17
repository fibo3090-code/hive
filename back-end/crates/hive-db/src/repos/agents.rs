use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgent {
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub role: String,
    pub model: String,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgent {
    pub slug: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub current_task: Option<Option<String>>,
    pub quality_score: Option<Option<i32>>,
    pub tokens_used: Option<i64>,
    pub eval_scores: Option<serde_json::Value>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all agents belonging to a project.
pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::DeletedAt.is_null())
        .all(db)
        .await
}

/// Get a single agent by id.
pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

/// Create a new agent.
pub async fn create(
    db: &DatabaseConnection,
    input: CreateAgent,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        slug: Set(input.slug),
        name: Set(input.name),
        role: Set(input.role),
        model: Set(input.model),
        status: Set(input.status),
        current_task: Set(None),
        quality_score: Set(None),
        tokens_used: Set(0),
        eval_scores: Set(serde_json::json!({})),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        deleted_at: Set(None),
    };
    model.insert(db).await
}

/// Partially update an existing agent.
pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    input: UpdateAgent,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();

    if let Some(v) = input.slug {
        model.slug = Set(v);
    }
    if let Some(v) = input.name {
        model.name = Set(v);
    }
    if let Some(v) = input.role {
        model.role = Set(v);
    }
    if let Some(v) = input.model {
        model.model = Set(v);
    }
    if let Some(v) = input.status {
        model.status = Set(v);
    }
    if let Some(v) = input.current_task {
        model.current_task = Set(v);
    }
    if let Some(v) = input.quality_score {
        model.quality_score = Set(v);
    }
    if let Some(v) = input.tokens_used {
        model.tokens_used = Set(v);
    }
    if let Some(v) = input.eval_scores {
        model.eval_scores = Set(v);
    }

    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Set the status of an agent.
pub async fn set_status(
    db: &DatabaseConnection,
    id: &str,
    status: &str,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Count agents belonging to a project.
pub async fn count_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<u64, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::DeletedAt.is_null())
        .count(db)
        .await
}
