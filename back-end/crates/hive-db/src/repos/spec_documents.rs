use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::spec_document::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpecDocument {
    pub project_id: String,
    pub title: String,
    pub source: String,
    #[serde(default)]
    pub markdown: String,
}

pub async fn create(
    db: &DatabaseConnection,
    input: CreateSpecDocument,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        title: Set(input.title),
        source: Set(input.source),
        markdown: Set(input.markdown),
        version: Set(1),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    }
    .insert(db)
    .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

pub async fn list_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

/// Patch markdown + bump version. Sections must be re-derived by the caller
/// — this repo doesn't know about the section table to keep the layering
/// honest (`crate::repos::spec_document_sections::sync_for_document`).
pub async fn update_markdown(
    db: &DatabaseConnection,
    id: &str,
    title: Option<String>,
    markdown: String,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    if let Some(t) = title {
        model.title = Set(t);
    }
    model.markdown = Set(markdown);
    let prev_version = match &model.version {
        ActiveValue::Set(v) | ActiveValue::Unchanged(v) => *v,
        ActiveValue::NotSet => 1,
    };
    model.version = Set(prev_version + 1);
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    Entity::delete_by_id(id.to_owned()).exec(db).await.map(|_| ())
}
