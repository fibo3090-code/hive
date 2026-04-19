use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::alert::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAlert {
    pub project_id: String,
    pub severity: String,
    pub title: String,
    pub message: String,
    pub source: String,
    pub action_label: Option<String>,
    pub action_kind: Option<String>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all non-dismissed alerts for a project.
pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::DismissedAt.is_null())
        .all(db)
        .await
}

/// Create a new alert.
pub async fn create(db: &DatabaseConnection, input: CreateAlert) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        severity: Set(input.severity),
        title: Set(input.title),
        message: Set(input.message),
        source: Set(input.source),
        action_label: Set(input.action_label),
        action_kind: Set(input.action_kind),
        dismissed_at: Set(None),
        created_at: Set(now),
    };
    model.insert(db).await
}

/// Dismiss an alert by setting `dismissed_at`.
pub async fn dismiss(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.dismissed_at = Set(Some(now_rfc3339()));
    model.update(db).await?;
    Ok(())
}
