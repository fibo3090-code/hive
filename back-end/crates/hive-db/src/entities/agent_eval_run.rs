use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

/// One scoring pass over an agent's recent work (D1 eval pipeline). The
/// Stats leaderboard reads the latest run per agent; the history powers a
/// per-agent trend view.
#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "agent_eval_runs")]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[sea_orm(primary_key, auto_increment = false)]
    pub id: String,
    pub project_id: String,
    pub agent_id: String,
    /// `agent:<id>` (a judge agent), `system`, or `operator`.
    pub evaluator: String,
    /// 0-100 per-metric scores: `{correctness, style, efficiency,
    /// testQuality, docQuality}`. JSON so a new metric needs no migration.
    pub scores_json: serde_json::Value,
    /// Mean of the present metric scores — what the leaderboard sorts on.
    pub overall_score: i32,
    /// How many work items this run looked at; 0 = unknown.
    pub sample_size: i32,
    pub notes: Option<String>,
    pub created_at: String,
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

impl Related<super::project::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Project.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
