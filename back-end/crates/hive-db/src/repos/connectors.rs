use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::connector::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateConnector {
    pub project_id: String,
    /// `"api"` or `"mcp"`.
    pub kind: String,
    pub slug: String,
    pub name: String,
    pub base_url: Option<String>,
    pub auth_kind: String,
    pub encrypted_credentials: Option<String>,
    pub masked_key: Option<String>,
    #[serde(default = "json_empty_object")]
    pub config_json: serde_json::Value,
}

fn json_empty_object() -> serde_json::Value {
    serde_json::json!({})
}

pub async fn create(
    db: &DatabaseConnection,
    input: CreateConnector,
) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        kind: Set(input.kind),
        slug: Set(input.slug),
        name: Set(input.name),
        base_url: Set(input.base_url),
        auth_kind: Set(input.auth_kind),
        encrypted_credentials: Set(input.encrypted_credentials),
        masked_key: Set(input.masked_key),
        config_json: Set(input.config_json),
        protocol_handshake_json: Set(None),
        status: Set("untested".to_owned()),
        last_tested_at: Set(None),
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
        .order_by_asc(Column::Name)
        .all(db)
        .await
}

/// MCP connectors only — used by the spawn-pipeline matcher.
pub async fn list_mcp_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::Kind.eq("mcp"))
        .order_by_asc(Column::Name)
        .all(db)
        .await
}

pub async fn set_status(
    db: &DatabaseConnection,
    id: &str,
    status: &str,
    handshake: Option<serde_json::Value>,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    if handshake.is_some() {
        model.protocol_handshake_json = Set(handshake);
    }
    model.last_tested_at = Set(Some(now_rfc3339()));
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    Entity::delete_by_id(id.to_owned()).exec(db).await.map(|_| ())
}
