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

/// Sum of `cost_cents` across every cost-event row for `project_id` —
/// **including in-flight reservations** (rows with `kind = "reservation"`
/// inserted by `chat::run_turn_inner` up-front and updated at finalize).
///
/// Generic over `ConnectionTrait` so callers can pass either a
/// `DatabaseConnection` or a `DatabaseTransaction`; the latter is how
/// the budget gate (Z10) closes the check-then-insert TOCTOU.
pub async fn total_cost_cents_for_project<C: ConnectionTrait>(
    db: &C,
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

pub async fn insert<C: ConnectionTrait>(db: &C, event: NewCostEvent<'_>) -> Result<Model, DbErr> {
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

/// Update a previously-inserted cost-event row (typically a `reservation`
/// inserted up-front by `chat::run_turn_inner`) with its final `kind`,
/// token counts, and `cost_cents`. The row id stays the same so any
/// `cost.ingested` SSE events that referenced it stay consistent.
///
/// Used by the Z10 reservation-then-finalize pattern to keep budget
/// accounting accurate without inserting two rows per turn.
pub async fn update_to_final<C: ConnectionTrait>(
    db: &C,
    id: &str,
    kind: &str,
    tokens_in: i32,
    tokens_out: i32,
    cost_cents: i64,
    memo: Option<&str>,
) -> Result<Option<Model>, DbErr> {
    let res = Entity::update_many()
        .col_expr(Column::Kind, sea_orm::sea_query::Expr::value(kind.to_owned()))
        .col_expr(
            Column::TokensIn,
            sea_orm::sea_query::Expr::value(tokens_in),
        )
        .col_expr(
            Column::TokensOut,
            sea_orm::sea_query::Expr::value(tokens_out),
        )
        .col_expr(
            Column::CostCents,
            sea_orm::sea_query::Expr::value(cost_cents),
        )
        .col_expr(
            Column::Memo,
            sea_orm::sea_query::Expr::value(memo.map(ToOwned::to_owned)),
        )
        .filter(Column::Id.eq(id.to_owned()))
        .exec(db)
        .await?;
    if res.rows_affected == 0 {
        return Ok(None);
    }
    Entity::find_by_id(id.to_owned()).one(db).await
}

/// Delete a reservation row by id. Used when the turn aborts before
/// the round loop starts and there's no spend to record at all.
pub async fn delete_reservation<C: ConnectionTrait>(db: &C, id: &str) -> Result<u64, DbErr> {
    let res = Entity::delete_many()
        .filter(Column::Id.eq(id.to_owned()))
        .filter(Column::Kind.eq("reservation"))
        .exec(db)
        .await?;
    Ok(res.rows_affected)
}
