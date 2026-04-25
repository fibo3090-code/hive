use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::synthesis_job::{ActiveModel, Entity, Model};

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
    }
    .insert(db)
    .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
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
