use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::task::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTask {
    pub project_id: String,
    pub title: String,
    pub status: String,
    pub phase: Option<String>,
    pub priority: String,
    pub estimated_tokens: i32,
    pub agent_id: Option<String>,
    pub sprint_id: Option<String>,
    /// Phase 0b: anchor link from this task back to the spec section that
    /// originated it. Set by the doc→sprint decomposition pipeline; manual
    /// task creators leave it `None`.
    #[serde(default)]
    pub spec_section_id: Option<String>,
    /// Phase 0b: SLA deadline (RFC3339).
    #[serde(default)]
    pub due_at: Option<String>,
    #[serde(default)]
    pub graph_level: i32,
    #[serde(default)]
    pub graph_order: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTask {
    pub title: Option<String>,
    pub status: Option<String>,
    pub phase: Option<Option<String>>,
    pub priority: Option<String>,
    pub estimated_tokens: Option<i32>,
    pub agent_id: Option<Option<String>>,
    pub sprint_id: Option<Option<String>>,
    pub graph_level: Option<i32>,
    pub graph_order: Option<i32>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all tasks belonging to a project.
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

/// Get a single task by id.
pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned())
        .filter(Column::DeletedAt.is_null())
        .one(db)
        .await
}

/// Create a new task.
pub async fn create<C: ConnectionTrait>(db: &C, input: CreateTask) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        agent_id: Set(input.agent_id),
        title: Set(input.title),
        status: Set(input.status),
        phase: Set(input.phase),
        sprint_id: Set(input.sprint_id),
        priority: Set(input.priority),
        estimated_tokens: Set(input.estimated_tokens),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        completed_at: Set(None),
        deleted_at: Set(None),
        spec_section_id: Set(input.spec_section_id),
        due_at: Set(input.due_at),
        last_progress_at: Set(None),
        graph_level: Set(input.graph_level),
        graph_order: Set(input.graph_order),
    };
    model.insert(db).await
}

/// Partially update an existing task.
pub async fn update(
    db: &DatabaseConnection,
    project_id: &str,
    id: &str,
    input: UpdateTask,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .filter(Column::ProjectId.eq(project_id))
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();

    if let Some(v) = input.title {
        model.title = Set(v);
    }
    if let Some(v) = input.status {
        model.status = Set(v.clone());
        if v == "completed" {
            model.completed_at = Set(Some(now_rfc3339()));
        }
    }
    if let Some(v) = input.phase {
        model.phase = Set(v);
    }
    if let Some(v) = input.priority {
        model.priority = Set(v);
    }
    if let Some(v) = input.estimated_tokens {
        model.estimated_tokens = Set(v);
    }
    if let Some(v) = input.agent_id {
        model.agent_id = Set(v);
    }
    if let Some(v) = input.sprint_id {
        model.sprint_id = Set(v);
    }
    if let Some(v) = input.graph_level {
        model.graph_level = Set(v);
    }
    if let Some(v) = input.graph_order {
        model.graph_order = Set(v);
    }

    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Set the status of a task. When status is "completed", also sets `completed_at`.
pub async fn set_status(
    db: &DatabaseConnection,
    project_id: &str,
    id: &str,
    status: &str,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .filter(Column::ProjectId.eq(project_id))
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    model.updated_at = Set(now_rfc3339());

    if status == "completed" {
        model.completed_at = Set(Some(now_rfc3339()));
    }

    model.update(db).await
}
