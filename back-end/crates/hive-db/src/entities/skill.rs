use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "skills")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    /// `None` for global (cross-project) skills.
    pub project_id: Option<String>,
    pub slug: String,
    pub name: String,
    #[sea_orm(column_type = "Text")]
    pub description: String,
    /// Spliced into the agent system prompt when the skill is bound.
    #[sea_orm(column_type = "Text")]
    pub system_prompt_fragment: String,
    /// Tool names the skill expects to invoke (subset of the agent's
    /// `enabled_tools`). Used by the runtime to verify the skill is
    /// honourable before binding.
    #[sea_orm(column_type = "Json")]
    pub allowed_tools_json: serde_json::Value,
    /// Filesystem globs the skill is allowed to read/write — surfaced by
    /// `PermissionMatrix` per agent.
    #[sea_orm(column_type = "Json")]
    pub allowed_paths_json: serde_json::Value,
    /// Connector ids the skill needs (e.g. an API key for an external
    /// service). The Forge UI prevents binding when any are missing.
    #[sea_orm(column_type = "Json")]
    pub requires_connector_ids_json: serde_json::Value,
    /// Capability tags used by the spawn-pipeline matcher.
    #[sea_orm(column_type = "Json")]
    pub capabilities_json: serde_json::Value,
    /// Full markdown body — the long-form playbook. Surfaced lazily to
    /// agents via the `read_skill` tool so the always-spliced prompt
    /// stays short.
    #[sea_orm(column_type = "Text")]
    #[serde(default)]
    pub markdown_body: String,
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
