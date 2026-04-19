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
    Ok(items
        .into_iter()
        .map(|item| i64::from(item.cost_cents))
        .sum())
}

pub async fn total_cost_cents_for_session(
    db: &DatabaseConnection,
    session_id: &str,
) -> Result<i64, DbErr> {
    let items = list_by_session(db, session_id).await?;
    Ok(items
        .into_iter()
        .map(|item| i64::from(item.cost_cents))
        .sum())
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

pub struct NewCostEvent<'a> {
    pub project_id: &'a str,
    pub session_id: Option<&'a str>,
    pub agent_id: Option<&'a str>,
    pub kind: &'a str,
    pub tokens_in: i32,
    pub tokens_out: i32,
    pub cost_cents: i32,
    pub memo: Option<&'a str>,
}

pub async fn insert(
    db: &DatabaseConnection,
    event: NewCostEvent<'_>,
) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(event.project_id.to_owned()),
        session_id: Set(event.session_id.map(ToOwned::to_owned)),
        agent_id: Set(event.agent_id.map(ToOwned::to_owned)),
        kind: Set(event.kind.to_owned()),
        tokens_in: Set(event.tokens_in),
        tokens_out: Set(event.tokens_out),
        cost_cents: Set(event.cost_cents),
        memo: Set(event.memo.map(ToOwned::to_owned)),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}
