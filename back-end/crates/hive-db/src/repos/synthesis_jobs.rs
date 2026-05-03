use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::synthesis_job::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSynthesisJob {
    pub project_id: String,
    pub description: String,
    pub tier: Option<String>,
    pub provider_id: Option<String>,
    pub model_id: Option<String>,
}

pub async fn create(
    db: &DatabaseConnection,
    input: CreateSynthesisJob,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        status: Set("queued".to_owned()),
        description: Set(input.description),
        tier: Set(input.tier),
        provider_id: Set(input.provider_id),
        model_id: Set(input.model_id),
        manifest_json: Set(serde_json::json!({})),
        generated_files_json: Set(serde_json::json!([])),
        error: Set(None),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        completed_at: Set(None),
        published_at: Set(None),
        published_visibility: Set(None),
        published_summary: Set(None),
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

/// Publish a completed synthesis job. `visibility` must be `'project'`
/// or `'public'`. Returns the updated row.
pub async fn publish(
    db: &DatabaseConnection,
    id: &str,
    visibility: &str,
    summary: Option<String>,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.published_at = Set(Some(now_rfc3339()));
    model.published_visibility = Set(Some(visibility.to_owned()));
    model.published_summary = Set(summary);
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

pub async fn unpublish(db: &DatabaseConnection, id: &str) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.published_at = Set(None);
    model.published_visibility = Set(None);
    model.published_summary = Set(None);
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// List published modules. `visibility=None` returns all; `Some('public')`
/// or `Some('project')` filters.
pub async fn list_published(
    db: &DatabaseConnection,
    visibility: Option<&str>,
) -> Result<Vec<Model>, DbErr> {
    let mut q = Entity::find().filter(Column::PublishedAt.is_not_null());
    if let Some(v) = visibility {
        q = q.filter(Column::PublishedVisibility.eq(v));
    }
    q.order_by_desc(Column::PublishedAt).all(db).await
}

pub async fn set_status(
    db: &DatabaseConnection,
    id: &str,
    status: &str,
    manifest_json: serde_json::Value,
    generated_files_json: serde_json::Value,
    error: Option<String>,
    completed: bool,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    model.manifest_json = Set(manifest_json);
    model.generated_files_json = Set(generated_files_json);
    model.error = Set(error);
    model.updated_at = Set(now_rfc3339());
    if completed {
        model.completed_at = Set(Some(now_rfc3339()));
    }
    model.update(db).await
}
