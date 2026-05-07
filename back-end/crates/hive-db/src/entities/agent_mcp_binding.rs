use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// N:N association linking an agent to an MCP server. `kind` discriminates
/// between custom-generated servers (FK to `custom_mcp_servers`) and shared
/// project-level connectors (FK to `connectors` with `kind="mcp"`). We
/// don't model the FK constraint at the DB level because the target table
/// depends on `kind` — handlers enforce the relation.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_mcp_bindings")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub agent_id: String,
    pub mcp_server_id: String,
    /// `"custom"` or `"connector"`.
    pub kind: String,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::agent::Entity",
        from = "Column::AgentId",
        to = "super::agent::Column::Id"
    )]
    Agent,
}

impl ActiveModelBehavior for ActiveModel {}
