use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent_task_assignment::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAssignment {
    pub agent_id: String,
    pub task_id: String,
    pub expected_completion_at: Option<String>,
    /// Initial state: typically `"started"` (default) or `"paused"`.
    #[serde(default = "default_state")]
    pub state: String,
}

fn default_state() -> String {
    "started".to_owned()
}

pub async fn create(db: &DatabaseConnection, input: CreateAssignment) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        agent_id: Set(input.agent_id),
        task_id: Set(input.task_id),
        assigned_at: Set(now.clone()),
        expected_completion_at: Set(input.expected_completion_at),
        started_at: Set(None),
        completed_at: Set(None),
        drift_score: Set(0.0),
        state: Set(input.state),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    }
    .insert(db)
    .await
}

pub async fn list_for_project_via_tasks(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    use crate::entities::task::{Column as TaskColumn, Entity as TaskEntity};
    let task_ids: Vec<String> = TaskEntity::find()
        .filter(TaskColumn::ProjectId.eq(project_id))
        .all(db)
        .await?
        .into_iter()
        .map(|t| t.id)
        .collect();
    if task_ids.is_empty() {
        return Ok(Vec::new());
    }
    Entity::find()
        .filter(Column::TaskId.is_in(task_ids))
        .order_by_desc(Column::AssignedAt)
        .all(db)
        .await
}

pub async fn list_for_agent(db: &DatabaseConnection, agent_id: &str) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::AgentId.eq(agent_id))
        .order_by_desc(Column::AssignedAt)
        .all(db)
        .await
}

pub async fn list_for_task(db: &DatabaseConnection, task_id: &str) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::TaskId.eq(task_id))
        .order_by_desc(Column::AssignedAt)
        .all(db)
        .await
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAssignment {
    pub state: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub expected_completion_at: Option<String>,
    pub drift_score: Option<f64>,
}

pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    patch: UpdateAssignment,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    if let Some(v) = patch.state {
        model.state = Set(v);
    }
    if let Some(v) = patch.started_at {
        model.started_at = Set(Some(v));
    }
    if let Some(v) = patch.completed_at {
        model.completed_at = Set(Some(v));
    }
    if let Some(v) = patch.expected_completion_at {
        model.expected_completion_at = Set(Some(v));
    }
    if let Some(v) = patch.drift_score {
        model.drift_score = Set(v);
    }
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}
