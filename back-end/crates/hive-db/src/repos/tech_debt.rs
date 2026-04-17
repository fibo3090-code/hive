use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::tech_debt_item::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTechDebt {
    pub project_id: String,
    pub title: String,
    pub description: Option<String>,
    pub file: Option<String>,
    pub impact: Option<String>,
    pub severity: String,
    pub lines: i32,
    pub position: i32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTechDebt {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub file: Option<Option<String>>,
    pub impact: Option<Option<String>>,
    pub severity: Option<String>,
    pub lines: Option<i32>,
    pub position: Option<i32>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all tech-debt items for a project, ordered by severity then position.
pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_asc(Column::Severity)
        .order_by_asc(Column::Position)
        .all(db)
        .await
}

/// Create a new tech-debt item.
pub async fn create(
    db: &DatabaseConnection,
    input: CreateTechDebt,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        title: Set(input.title),
        description: Set(input.description),
        file: Set(input.file),
        impact: Set(input.impact),
        severity: Set(input.severity),
        lines: Set(input.lines),
        position: Set(input.position),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    };
    model.insert(db).await
}

/// Partially update an existing tech-debt item.
pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    input: UpdateTechDebt,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();

    if let Some(v) = input.title {
        model.title = Set(v);
    }
    if let Some(v) = input.description {
        model.description = Set(v);
    }
    if let Some(v) = input.file {
        model.file = Set(v);
    }
    if let Some(v) = input.impact {
        model.impact = Set(v);
    }
    if let Some(v) = input.severity {
        model.severity = Set(v);
    }
    if let Some(v) = input.lines {
        model.lines = Set(v);
    }
    if let Some(v) = input.position {
        model.position = Set(v);
    }

    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Move an item to a different severity lane.
pub async fn move_item(
    db: &DatabaseConnection,
    id: &str,
    severity: &str,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.severity = Set(severity.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Hard-delete a tech-debt item.
pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    existing.delete(db).await?;
    Ok(())
}
