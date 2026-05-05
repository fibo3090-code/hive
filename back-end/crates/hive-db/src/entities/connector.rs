use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// External integration: HTTP API or MCP server. Credentials are stored
/// encrypted via `hive-crypto`, mirroring the `llm_providers` pattern.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "connectors")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    /// `"api"` or `"mcp"`.
    pub kind: String,
    pub slug: String,
    pub name: String,
    pub base_url: Option<String>,
    /// `"none"`, `"bearer"`, `"basic"`, `"oauth2"`, `"mcp_handshake"`.
    pub auth_kind: String,
    /// ChaCha20-Poly1305 ciphertext (base64). NULL when `auth_kind="none"`.
    pub encrypted_credentials: Option<String>,
    /// User-visible last-N-chars or first-N-chars hint of the credential
    /// for "yes I set this" feedback without leaking the secret.
    pub masked_key: Option<String>,
    /// Free-form per-connector config (e.g. headers, MCP capabilities).
    #[sea_orm(column_type = "Json")]
    pub config_json: serde_json::Value,
    /// MCP-only: cached `initialize` response so we know which tools the
    /// server exposes without re-handshaking on every list.
    #[sea_orm(column_type = "Json")]
    pub protocol_handshake_json: Option<serde_json::Value>,
    /// `"untested"`, `"connected"`, `"error"`.
    pub status: String,
    pub last_tested_at: Option<String>,
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
