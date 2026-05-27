//! Repo for `agent_eval_runs` — the D1 eval pipeline's history table.
//! Each row is one scoring pass over an agent's recent work.

use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent_eval_run::{ActiveModel, Column, Entity, Model};

/// Input for [`create`]. `scores` is the per-metric 0-100 map; `overall`
/// is computed by the caller (mean of present metrics) and stored so the
/// leaderboard sort doesn't recompute it per read.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateEvalRun {
    pub project_id: String,
    pub agent_id: String,
    pub evaluator: String,
    pub scores_json: serde_json::Value,
    pub overall_score: i32,
    #[serde(default)]
    pub sample_size: i32,
    #[serde(default)]
    pub notes: Option<String>,
}

pub async fn create(db: &DatabaseConnection, input: CreateEvalRun) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        agent_id: Set(input.agent_id),
        evaluator: Set(input.evaluator),
        scores_json: Set(input.scores_json),
        overall_score: Set(input.overall_score),
        sample_size: Set(input.sample_size),
        notes: Set(input.notes),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}

/// All eval runs for a project, newest first.
pub async fn list_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

/// All eval runs for one agent, newest first.
pub async fn list_for_agent(db: &DatabaseConnection, agent_id: &str) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::AgentId.eq(agent_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

/// The most recent eval run for an agent, if any.
pub async fn latest_for_agent(
    db: &DatabaseConnection,
    agent_id: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::AgentId.eq(agent_id))
        .order_by_desc(Column::CreatedAt)
        .one(db)
        .await
}
