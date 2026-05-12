use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::chat_message::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewMessage {
    pub thread_id: String,
    pub role: String,
    pub content: String,
    pub tool_calls: serde_json::Value,
    pub model: Option<String>,
    pub provider_id: Option<String>,
    pub tokens_in: i32,
    pub tokens_out: i32,
    pub cost_cents: i64,
    pub parent_message_id: Option<String>,
    pub status: String,
}

pub async fn list_by_thread(db: &DatabaseConnection, thread_id: &str) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ThreadId.eq(thread_id))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

pub async fn insert(db: &DatabaseConnection, input: NewMessage) -> Result<Model, DbErr> {
    insert_at(db, input, now_rfc3339()).await
}

/// Like [`insert`] but with an explicit `created_at` — used by `/compact` so the
/// synthetic summary message sorts ahead of the messages it replaces.
pub async fn insert_at(
    db: &DatabaseConnection,
    input: NewMessage,
    created_at: String,
) -> Result<Model, DbErr> {
    let model = ActiveModel {
        id: Set(new_id()),
        thread_id: Set(input.thread_id),
        role: Set(input.role),
        content: Set(input.content),
        tool_calls: Set(input.tool_calls),
        model: Set(input.model),
        provider_id: Set(input.provider_id),
        tokens_in: Set(input.tokens_in),
        tokens_out: Set(input.tokens_out),
        cost_cents: Set(input.cost_cents),
        parent_message_id: Set(input.parent_message_id),
        status: Set(input.status),
        created_at: Set(created_at.clone()),
        updated_at: Set(created_at),
    };
    model.insert(db).await
}

/// Delete a specific set of messages by id. Returns the number of rows removed.
pub async fn delete_ids(db: &DatabaseConnection, ids: &[String]) -> Result<u64, DbErr> {
    if ids.is_empty() {
        return Ok(0);
    }
    let result = Entity::delete_many()
        .filter(Column::Id.is_in(ids.iter().cloned()))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}

pub async fn finalize(
    db: &DatabaseConnection,
    id: &str,
    content: &str,
    tokens_in: i32,
    tokens_out: i32,
    cost_cents: i64,
    status: &str,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.content = Set(content.to_owned());
    model.tokens_in = Set(tokens_in);
    model.tokens_out = Set(tokens_out);
    model.cost_cents = Set(cost_cents);
    model.status = Set(status.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

pub async fn set_tool_calls(
    db: &DatabaseConnection,
    id: &str,
    tool_calls: serde_json::Value,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.tool_calls = Set(tool_calls);
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Delete every message in a thread. Used by the "Clear chat history"
/// flow so threads can be removed without orphaning their messages.
pub async fn delete_for_thread(db: &DatabaseConnection, thread_id: &str) -> Result<u64, DbErr> {
    let result = Entity::delete_many()
        .filter(Column::ThreadId.eq(thread_id))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}

pub async fn set_status(db: &DatabaseConnection, id: &str, status: &str) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}
