use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::custom_mcp_server::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomMcpServer {
    pub project_id: String,
    pub owner_agent_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub source_api_url: Option<String>,
    pub source_api_spec_json: Option<serde_json::Value>,
    pub generated_manifest_json: serde_json::Value,
    pub generated_handler_code: String,
    #[serde(default = "default_transport")]
    pub transport: String,
    pub encrypted_credentials: Option<String>,
    #[serde(default = "default_reusable")]
    pub reusable: bool,
    #[serde(default = "json_empty_array")]
    pub capabilities_json: serde_json::Value,
    pub embedding_json: Option<serde_json::Value>,
}

fn default_transport() -> String {
    "http".to_owned()
}
fn default_reusable() -> bool {
    true
}
fn json_empty_array() -> serde_json::Value {
    serde_json::json!([])
}

pub async fn create(db: &DatabaseConnection, input: CreateCustomMcpServer) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        owner_agent_id: Set(input.owner_agent_id),
        name: Set(input.name),
        slug: Set(input.slug),
        source_api_url: Set(input.source_api_url),
        source_api_spec_json: Set(input.source_api_spec_json),
        generated_manifest_json: Set(input.generated_manifest_json),
        generated_handler_code: Set(input.generated_handler_code),
        transport: Set(input.transport),
        encrypted_credentials: Set(input.encrypted_credentials),
        status: Set("draft".to_owned()),
        reusable: Set(input.reusable),
        capabilities_json: Set(input.capabilities_json),
        embedding_json: Set(input.embedding_json),
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

/// Reusable + active candidates for the spawn-pipeline matcher.
pub async fn list_reusable_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::Reusable.eq(true))
        .filter(Column::Status.eq("active"))
        .all(db)
        .await
}

pub async fn set_status(db: &DatabaseConnection, id: &str, status: &str) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}
