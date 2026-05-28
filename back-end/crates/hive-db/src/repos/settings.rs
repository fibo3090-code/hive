use sea_orm::sea_query::OnConflict;
use sea_orm::*;

use super::now_rfc3339;
use crate::entities::setting::{ActiveModel, Column, Entity, Model};

pub async fn list_scope(db: &DatabaseConnection, scope: &str) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::Scope.eq(scope))
        .order_by_asc(Column::Key)
        .all(db)
        .await
}

pub async fn get_value(
    db: &DatabaseConnection,
    scope: &str,
    key: &str,
) -> Result<Option<serde_json::Value>, DbErr> {
    Entity::find_by_id((scope.to_owned(), key.to_owned()))
        .one(db)
        .await
        .map(|row| row.map(|entry| entry.value))
}

pub async fn put_value(
    db: &DatabaseConnection,
    scope: &str,
    key: &str,
    value: serde_json::Value,
) -> Result<(), DbErr> {
    let model = ActiveModel {
        scope: Set(scope.to_owned()),
        key: Set(key.to_owned()),
        value: Set(value),
        updated_at: Set(now_rfc3339()),
    };

    Entity::insert(model)
        .on_conflict(
            OnConflict::columns([Column::Scope, Column::Key])
                .update_columns([Column::Value, Column::UpdatedAt])
                .to_owned(),
        )
        .exec(db)
        .await?;

    Ok(())
}

/// Insert iff the (scope, key) row doesn't already exist. Returns `true`
/// if this call wrote the row, `false` if a row was already there.
///
/// Useful as a coarse mutex over slow boot-time work — `seed_demo`
/// claims its sentinel up-front so two concurrent first-boots can't
/// both run the body and create duplicates (BACKLOG ZZ38).
pub async fn put_value_if_absent(
    db: &DatabaseConnection,
    scope: &str,
    key: &str,
    value: serde_json::Value,
) -> Result<bool, DbErr> {
    let model = ActiveModel {
        scope: Set(scope.to_owned()),
        key: Set(key.to_owned()),
        value: Set(value),
        updated_at: Set(now_rfc3339()),
    };

    let result = Entity::insert(model)
        .on_conflict(
            OnConflict::columns([Column::Scope, Column::Key])
                .do_nothing()
                .to_owned(),
        )
        .exec(db)
        .await;

    match result {
        Ok(_) => Ok(true),
        Err(DbErr::RecordNotInserted) => Ok(false),
        Err(e) => Err(e),
    }
}
