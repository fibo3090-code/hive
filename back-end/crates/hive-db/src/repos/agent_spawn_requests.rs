use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent_spawn_request::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSpawnRequest {
    pub project_id: String,
    pub parent_agent_id: Option<String>,
    pub requested_role: String,
    #[serde(default = "json_empty_array")]
    pub requested_capabilities_json: serde_json::Value,
    #[serde(default = "json_empty_object")]
    pub context_json: serde_json::Value,
    #[serde(default = "default_strategy")]
    pub mcp_strategy: String,
}

fn default_strategy() -> String {
    "reuse-or-synth".to_owned()
}
fn json_empty_array() -> serde_json::Value {
    serde_json::json!([])
}
fn json_empty_object() -> serde_json::Value {
    serde_json::json!({})
}

pub async fn create(db: &DatabaseConnection, input: CreateSpawnRequest) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        parent_agent_id: Set(input.parent_agent_id),
        requested_role: Set(input.requested_role),
        requested_capabilities_json: Set(input.requested_capabilities_json),
        context_json: Set(input.context_json),
        mcp_strategy: Set(input.mcp_strategy),
        status: Set("queued".to_owned()),
        child_agent_id: Set(None),
        discovered_api_json: Set(None),
        matched_existing_mcp_ids_json: Set(serde_json::json!([])),
        synthesized_mcp_ids_json: Set(serde_json::json!([])),
        generated_system_prompt: Set(None),
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

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSpawnRequest {
    pub status: Option<String>,
    pub child_agent_id: Option<String>,
    pub discovered_api_json: Option<serde_json::Value>,
    pub matched_existing_mcp_ids_json: Option<serde_json::Value>,
    pub synthesized_mcp_ids_json: Option<serde_json::Value>,
    pub generated_system_prompt: Option<String>,
    pub error: Option<String>,
    pub completed: Option<bool>,
}

pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    patch: UpdateSpawnRequest,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    if let Some(v) = patch.status {
        model.status = Set(v);
    }
    if patch.child_agent_id.is_some() {
        model.child_agent_id = Set(patch.child_agent_id);
    }
    if patch.discovered_api_json.is_some() {
        model.discovered_api_json = Set(patch.discovered_api_json);
    }
    if let Some(v) = patch.matched_existing_mcp_ids_json {
        model.matched_existing_mcp_ids_json = Set(v);
    }
    if let Some(v) = patch.synthesized_mcp_ids_json {
        model.synthesized_mcp_ids_json = Set(v);
    }
    if patch.generated_system_prompt.is_some() {
        model.generated_system_prompt = Set(patch.generated_system_prompt);
    }
    if patch.error.is_some() {
        model.error = Set(patch.error);
    }
    if patch.completed == Some(true) {
        model.completed_at = Set(Some(now_rfc3339()));
    }
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}
