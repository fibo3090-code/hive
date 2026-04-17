use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::hive_mind_note::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateNote {
    pub project_id: String,
    pub category: String,
    pub title: String,
    pub content: String,
    pub auto: bool,
    pub author: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateNote {
    pub category: Option<String>,
    pub title: Option<String>,
    pub content: Option<String>,
    pub auto: Option<bool>,
    pub author: Option<String>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all notes belonging to a project.
pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .all(db)
        .await
}

/// Create a new note.
pub async fn create(
    db: &DatabaseConnection,
    input: CreateNote,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        category: Set(input.category),
        title: Set(input.title),
        content: Set(input.content),
        auto: Set(input.auto),
        author: Set(input.author),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    };
    model.insert(db).await
}

/// Partially update an existing note.
pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    input: UpdateNote,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();

    if let Some(v) = input.category {
        model.category = Set(v);
    }
    if let Some(v) = input.title {
        model.title = Set(v);
    }
    if let Some(v) = input.content {
        model.content = Set(v);
    }
    if let Some(v) = input.auto {
        model.auto = Set(v);
    }
    if let Some(v) = input.author {
        model.author = Set(v);
    }

    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Hard-delete a note.
pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    existing.delete(db).await?;
    Ok(())
}
