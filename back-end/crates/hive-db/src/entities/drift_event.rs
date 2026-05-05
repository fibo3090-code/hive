use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Unified drift event. Three flavours via `kind`:
///   - `"agent-vs-task"`        — agent diverging from its assignment.
///   - `"code-vs-spec"`         — committed code diverging from the spec.
///   - `"agent-vs-system-prompt"` — agent behaviour diverging from its prompt.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "drift_events")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub kind: String,
    /// Subject id depends on `subject_kind`: an agent_id, requirement_id,
    /// task_id, etc.
    pub subject_id: String,
    pub subject_kind: String,
    /// Detector-supplied evidence payload (diffs, scores, sample turns).
    #[sea_orm(column_type = "Json")]
    pub evidence_json: serde_json::Value,
    /// `"low"`, `"medium"`, `"high"`.
    pub severity: String,
    /// `"open"`, `"approved"`, `"corrected"`, `"dismissed"`.
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
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
