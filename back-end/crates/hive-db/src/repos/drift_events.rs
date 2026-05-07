use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::drift_event::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDriftEvent {
    pub project_id: String,
    /// `"agent-vs-task"`, `"code-vs-spec"`, `"agent-vs-system-prompt"`.
    pub kind: String,
    pub subject_id: String,
    pub subject_kind: String,
    #[serde(default = "json_empty_object")]
    pub evidence_json: serde_json::Value,
    #[serde(default = "default_severity")]
    pub severity: String,
}

fn default_severity() -> String {
    "medium".to_owned()
}

fn json_empty_object() -> serde_json::Value {
    serde_json::json!({})
}

pub async fn create(
    db: &DatabaseConnection,
    input: CreateDriftEvent,
) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        kind: Set(input.kind),
        subject_id: Set(input.subject_id),
        subject_kind: Set(input.subject_kind),
        evidence_json: Set(input.evidence_json),
        severity: Set(input.severity),
        status: Set("open".to_owned()),
        created_at: Set(now_rfc3339()),
        resolved_at: Set(None),
    }
    .insert(db)
    .await
}

pub async fn list_for_project(
    db: &DatabaseConnection,
    project_id: &str,
    open_only: bool,
) -> Result<Vec<Model>, DbErr> {
    let mut q = Entity::find().filter(Column::ProjectId.eq(project_id));
    if open_only {
        q = q.filter(Column::Status.eq("open"));
    }
    q.order_by_desc(Column::CreatedAt).all(db).await
}

pub async fn set_status(
    db: &DatabaseConnection,
    id: &str,
    status: &str,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    if status != "open" {
        model.resolved_at = Set(Some(now_rfc3339()));
    } else {
        model.resolved_at = Set(None);
    }
    model.update(db).await
}
