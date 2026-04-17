use sea_orm::*;

use super::{new_id, now_rfc3339};
use crate::entities::cost_event::{ActiveModel, Column, Entity, Model};

pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn list_by_session(
    db: &DatabaseConnection,
    session_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::SessionId.eq(session_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn total_cost_cents_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<i64, DbErr> {
    let items = list_by_project(db, project_id).await?;
    Ok(items.into_iter().map(|item| i64::from(item.cost_cents)).sum())
}

pub async fn total_cost_cents_for_session(
    db: &DatabaseConnection,
    session_id: &str,
) -> Result<i64, DbErr> {
    let items = list_by_session(db, session_id).await?;
    Ok(items.into_iter().map(|item| i64::from(item.cost_cents)).sum())
}

pub async fn total_tokens_for_session(
    db: &DatabaseConnection,
    session_id: &str,
) -> Result<i64, DbErr> {
    let items = list_by_session(db, session_id).await?;
    Ok(items
        .into_iter()
        .map(|item| i64::from(item.tokens_in + item.tokens_out))
        .sum())
}

pub async fn insert(
    db: &DatabaseConnection,
    project_id: &str,
    session_id: Option<&str>,
    agent_id: Option<&str>,
    kind: &str,
    tokens_in: i32,
    tokens_out: i32,
    cost_cents: i32,
    memo: Option<&str>,
) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(project_id.to_owned()),
        session_id: Set(session_id.map(ToOwned::to_owned)),
        agent_id: Set(agent_id.map(ToOwned::to_owned)),
        kind: Set(kind.to_owned()),
        tokens_in: Set(tokens_in),
        tokens_out: Set(tokens_out),
        cost_cents: Set(cost_cents),
        memo: Set(memo.map(ToOwned::to_owned)),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}
