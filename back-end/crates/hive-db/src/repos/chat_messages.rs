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
    let now = now_rfc3339();
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
        created_at: Set(now.clone()),
        updated_at: Set(now),
    };
    model.insert(db).await
}

pub async fn append_content(db: &DatabaseConnection, id: &str, chunk: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut combined = existing.content.clone();
    combined.push_str(chunk);
    let mut model: ActiveModel = existing.into();
    model.content = Set(combined);
    model.updated_at = Set(now_rfc3339());
    model.update(db).await?;
    Ok(())
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
