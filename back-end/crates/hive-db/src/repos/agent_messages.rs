use sea_orm::prelude::Expr;
use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent_message::{ActiveModel, Column, Entity, Model};

pub const STATUS_QUEUED: &str = "queued";
pub const STATUS_RUNNING: &str = "running";
pub const STATUS_DONE: &str = "done";
pub const STATUS_ERROR: &str = "error";
pub const STATUS_CANCELLED: &str = "cancelled";

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnqueueAgentMessage {
    pub project_id: String,
    pub to_agent_id: String,
    pub content: String,
    #[serde(default)]
    pub from_agent_id: Option<String>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub reply_to_message_id: Option<String>,
}

pub async fn enqueue(db: &DatabaseConnection, input: EnqueueAgentMessage) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        from_agent_id: Set(input.from_agent_id),
        to_agent_id: Set(input.to_agent_id),
        thread_id: Set(input.thread_id),
        reply_to_message_id: Set(input.reply_to_message_id),
        content: Set(input.content),
        tool_calls: Set(serde_json::json!([])),
        status: Set(STATUS_QUEUED.to_owned()),
        created_at: Set(now),
        completed_at: Set(None),
        deleted_at: Set(None),
    };
    model.insert(db).await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned())
        .filter(Column::DeletedAt.is_null())
        .one(db)
        .await
}

pub async fn next_queued_for(
    db: &DatabaseConnection,
    to_agent_id: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::ToAgentId.eq(to_agent_id))
        .filter(Column::Status.eq(STATUS_QUEUED))
        .filter(Column::DeletedAt.is_null())
        .order_by_asc(Column::CreatedAt)
        .one(db)
        .await
}

pub async fn list_by_agent(
    db: &DatabaseConnection,
    to_agent_id: &str,
    limit: u64,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ToAgentId.eq(to_agent_id))
        .filter(Column::DeletedAt.is_null())
        .order_by_desc(Column::CreatedAt)
        .limit(limit)
        .all(db)
        .await
}

async fn update_status(
    db: &DatabaseConnection,
    id: &str,
    status: &str,
    completed: bool,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut active: ActiveModel = existing.into();
    active.status = Set(status.to_owned());
    if completed {
        active.completed_at = Set(Some(now_rfc3339()));
    }
    active.update(db).await
}

pub async fn mark_running(db: &DatabaseConnection, id: &str) -> Result<Model, DbErr> {
    update_status(db, id, STATUS_RUNNING, false).await
}

pub async fn mark_done(db: &DatabaseConnection, id: &str) -> Result<Model, DbErr> {
    update_status(db, id, STATUS_DONE, true).await
}

pub async fn mark_error(db: &DatabaseConnection, id: &str) -> Result<Model, DbErr> {
    update_status(db, id, STATUS_ERROR, true).await
}

pub async fn mark_cancelled(db: &DatabaseConnection, id: &str) -> Result<Model, DbErr> {
    update_status(db, id, STATUS_CANCELLED, true).await
}

/// Reset any `running` rows back to `queued` — used at boot to recover from
/// crashes so no in-flight executor work is silently lost.
pub async fn requeue_running(db: &DatabaseConnection) -> Result<u64, DbErr> {
    let res = Entity::update_many()
        .col_expr(Column::Status, Expr::value(STATUS_QUEUED))
        .filter(Column::Status.eq(STATUS_RUNNING))
        .exec(db)
        .await?;
    Ok(res.rows_affected)
}
