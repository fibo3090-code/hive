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
    let result: Option<Option<i64>> = Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .select_only()
        .column_as(
            sea_orm::sea_query::Expr::col(Column::CostCents).sum(),
            "sum",
        )
        .into_tuple()
        .one(db)
        .await?;
    Ok(result.flatten().unwrap_or(0))
}

pub async fn total_cost_cents_for_session(
    db: &DatabaseConnection,
    session_id: &str,
) -> Result<i64, DbErr> {
    let result: Option<Option<i64>> = Entity::find()
        .filter(Column::SessionId.eq(session_id))
        .select_only()
        .column_as(
            sea_orm::sea_query::Expr::col(Column::CostCents).sum(),
            "sum",
        )
        .into_tuple()
        .one(db)
        .await?;
    Ok(result.flatten().unwrap_or(0))
}

pub async fn total_tokens_for_session(
    db: &DatabaseConnection,
    session_id: &str,
) -> Result<i64, DbErr> {
    let result: Option<(Option<i64>, Option<i64>)> = Entity::find()
        .filter(Column::SessionId.eq(session_id))
        .select_only()
        .column_as(
            sea_orm::sea_query::Expr::col(Column::TokensIn).sum(),
            "sum_in",
        )
        .column_as(
            sea_orm::sea_query::Expr::col(Column::TokensOut).sum(),
            "sum_out",
        )
        .into_tuple()
        .one(db)
        .await?;
    let (in_sum, out_sum) = result.unwrap_or((Some(0), Some(0)));
    Ok(in_sum.unwrap_or(0) + out_sum.unwrap_or(0))
}

pub struct NewCostEvent<'a> {
    pub project_id: &'a str,
    pub session_id: Option<&'a str>,
    pub agent_id: Option<&'a str>,
    pub kind: &'a str,
    pub tokens_in: i32,
    pub tokens_out: i32,
    pub cost_cents: i64,
    pub memo: Option<&'a str>,
}

pub async fn insert(db: &DatabaseConnection, event: NewCostEvent<'_>) -> Result<Model, DbErr> {
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
