use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// State machine row driving the auto-spawn pipeline. The runtime task
/// updates `status` as it walks the stages:
///   queued → planning-needs → matching-existing-mcp → researching-api →
///   synthesizing-mcp → composing-prompt → [awaiting-approval] →
///   materializing-agent → completed
///
/// Any stage can also transition to `failed` or `cancelled`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_spawn_requests")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub parent_agent_id: Option<String>,
    pub requested_role: String,
    /// Capabilities tag list — drives both the matcher and the API scout.
    #[sea_orm(column_type = "Json")]
    pub requested_capabilities_json: serde_json::Value,
    /// Free-form context the parent passed in (task at hand, current files,
    /// etc.) — ferried into the `composing-prompt` stage.
    #[sea_orm(column_type = "Json")]
    pub context_json: serde_json::Value,
    /// `"none"`, `"reuse-only"`, `"reuse-or-synth"`, `"force-synth"`.
    pub mcp_strategy: String,
    pub status: String,
    pub child_agent_id: Option<String>,
    #[sea_orm(column_type = "Json")]
    pub discovered_api_json: Option<serde_json::Value>,
    #[sea_orm(column_type = "Json")]
    pub matched_existing_mcp_ids_json: serde_json::Value,
    #[sea_orm(column_type = "Json")]
    pub synthesized_mcp_ids_json: serde_json::Value,
    #[sea_orm(column_type = "Text")]
    pub generated_system_prompt: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
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
