use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::{
    agent_skill_binding::{ActiveModel, Column, Entity, Model},
    skill,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBinding {
    pub project_id: String,
    pub agent_id: String,
    pub skill_id: String,
}

pub async fn bind(db: &DatabaseConnection, input: CreateBinding) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        agent_id: Set(input.agent_id),
        skill_id: Set(input.skill_id),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}

pub async fn list_for_agent(db: &DatabaseConnection, agent_id: &str) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::AgentId.eq(agent_id))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

/// Skill rows bound to an agent, joined so callers don't have to round-trip
/// through `skills::get` for every binding.
pub async fn list_skills_for_agent(
    db: &DatabaseConnection,
    agent_id: &str,
) -> Result<Vec<skill::Model>, DbErr> {
    Entity::find()
        .filter(Column::AgentId.eq(agent_id))
        .find_also_related(skill::Entity)
        .all(db)
        .await
        .map(|rows| rows.into_iter().filter_map(|(_, skill)| skill).collect())
}

pub async fn unbind(db: &DatabaseConnection, agent_id: &str, skill_id: &str) -> Result<u64, DbErr> {
    Entity::delete_many()
        .filter(Column::AgentId.eq(agent_id))
        .filter(Column::SkillId.eq(skill_id))
        .exec(db)
        .await
        .map(|r| r.rows_affected)
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    Entity::delete_by_id(id.to_owned())
        .exec(db)
        .await
        .map(|_| ())
}
