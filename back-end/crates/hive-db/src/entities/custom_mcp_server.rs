use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// MCP server generated on the fly by the auto-spawn pipeline for a
/// specific agent. When `reusable=true`, future spawn requests can match
/// against this server via embedding similarity instead of regenerating.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "custom_mcp_servers")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    /// Originally-spawned-for agent. Other agents may bind via
    /// `agent_mcp_bindings` when `reusable=true`.
    pub owner_agent_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub source_api_url: Option<String>,
    /// Captured OpenAPI/Swagger fragment (or scraped doc essence) used to
    /// regenerate the handler if the spec ever changes upstream.
    #[sea_orm(column_type = "Json")]
    pub source_api_spec_json: Option<serde_json::Value>,
    /// MCP `initialize` manifest the server advertises to clients (tools,
    /// resources, prompts).
    #[sea_orm(column_type = "Json")]
    pub generated_manifest_json: serde_json::Value,
    /// Source of the proxy handler (Rust today; future: Python/TS).
    /// Sandboxed via `hive-sandbox` when launched.
    #[sea_orm(column_type = "Text")]
    pub generated_handler_code: String,
    /// `"http"` (MVP). `"stdio"` deferred.
    pub transport: String,
    pub encrypted_credentials: Option<String>,
    /// `"draft"`, `"active"`, `"disabled"`, `"error"`.
    pub status: String,
    pub reusable: bool,
    /// Tags used by the matcher; populated from the spawn request that
    /// triggered the synthesis.
    #[sea_orm(column_type = "Json")]
    pub capabilities_json: serde_json::Value,
    /// JSON `f32[]` cached for similarity search. Refreshed when
    /// capabilities or description change.
    #[sea_orm(column_type = "Json")]
    pub embedding_json: Option<serde_json::Value>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::project::Entity",
        from = "Column::ProjectId",
        to = "super::project::Column::Id"
    )]
    Project,
}

impl ActiveModelBehavior for ActiveModel {}
