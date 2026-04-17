use sea_orm::{prelude::Expr, *};
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::notification::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNotification {
    pub project_id: Option<String>,
    pub r#type: String,
    pub title: String,
    pub message: String,
    pub actionable: bool,
    pub action_label: Option<String>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all non-dismissed notifications, newest first.
pub async fn list_all(db: &DatabaseConnection) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::DismissedAt.is_null())
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

/// Create a new notification.
pub async fn create(
    db: &DatabaseConnection,
    input: CreateNotification,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        r#type: Set(input.r#type),
        title: Set(input.title),
        message: Set(input.message),
        actionable: Set(input.actionable),
        action_label: Set(input.action_label),
        read_at: Set(None),
        dismissed_at: Set(None),
        created_at: Set(now),
    };
    model.insert(db).await
}

/// Mark a single notification as read.
pub async fn mark_read(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.read_at = Set(Some(now_rfc3339()));
    model.update(db).await?;
    Ok(())
}

/// Mark all unread, non-dismissed notifications as read.
pub async fn mark_all_read(db: &DatabaseConnection) -> Result<(), DbErr> {
    let now = now_rfc3339();
    Entity::update_many()
        .col_expr(Column::ReadAt, Expr::value(now))
        .filter(Column::ReadAt.is_null())
        .filter(Column::DismissedAt.is_null())
        .exec(db)
        .await?;
    Ok(())
}

/// Dismiss a notification.
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
