use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// Rich agent ↔ task association. The `state` column carries the 7-state
/// machine surfaced as `AgentStateChip` in the planning view:
/// `paused`, `started`, `in-progress`, `finished`, `blocked`,
/// `awaiting-authorization`, `requesting-input`.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_task_assignments")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub agent_id: String,
    pub task_id: String,
    pub assigned_at: String,
    pub expected_completion_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    /// 0.0 = on-track, 1.0 = severely drifted from the spec section.
    /// Updated by `drift_task.rs` after each turn.
    pub drift_score: f64,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::agent::Entity",
        from = "Column::AgentId",
        to = "super::agent::Column::Id"
    )]
    Agent,
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::TaskId",
        to = "super::task::Column::Id"
    )]
    Task,
}

impl ActiveModelBehavior for ActiveModel {}
