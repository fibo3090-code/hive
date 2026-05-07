use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent_mcp_binding::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBinding {
    pub agent_id: String,
    pub mcp_server_id: String,
    /// `"custom"` (-> custom_mcp_servers) or `"connector"` (-> connectors).
    pub kind: String,
}

pub async fn create(
    db: &DatabaseConnection,
    input: CreateBinding,
) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        agent_id: Set(input.agent_id),
        mcp_server_id: Set(input.mcp_server_id),
        kind: Set(input.kind),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}

pub async fn list_for_agent(
    db: &DatabaseConnection,
    agent_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::AgentId.eq(agent_id))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    Entity::delete_by_id(id.to_owned()).exec(db).await.map(|_| ())
}

/// Convenience: remove every binding pointing at a given mcp_server_id.
/// Useful when an MCP server is deleted/disabled.
pub async fn delete_for_server(
    db: &DatabaseConnection,
    mcp_server_id: &str,
) -> Result<u64, DbErr> {
    Entity::delete_many()
        .filter(Column::McpServerId.eq(mcp_server_id))
        .exec(db)
        .await
        .map(|r| r.rows_affected)
}
