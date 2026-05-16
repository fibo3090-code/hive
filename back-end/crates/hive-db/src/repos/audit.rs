use sea_orm::*;

use super::{new_id, now_rfc3339};
use crate::entities::audit_log::{ActiveModel, Column, Entity, Model};

pub async fn append(
    db: &DatabaseConnection,
    actor: &str,
    action: &str,
    entity_type: &str,
    entity_id: &str,
    before: Option<serde_json::Value>,
    after: Option<serde_json::Value>,
) -> Result<Model, DbErr> {
    ActiveModel {
        id: Set(new_id()),
        actor: Set(actor.to_owned()),
        action: Set(action.to_owned()),
        entity_type: Set(entity_type.to_owned()),
        entity_id: Set(entity_id.to_owned()),
        before: Set(before),
        after: Set(after),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}

pub async fn list_for_entity(
    db: &DatabaseConnection,
    entity_type: &str,
    entity_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::EntityType.eq(entity_type))
        .filter(Column::EntityId.eq(entity_id))
        .order_by_desc(Column::CreatedAt)
        .all(db)
        .await
}

/// Paginated listing for the audit-log inspector. Newest first.
pub async fn list(
    db: &DatabaseConnection,
    limit: u64,
    offset: u64,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .order_by_desc(Column::CreatedAt)
        .limit(limit)
        .offset(offset)
        .all(db)
        .await
}

/// Delete every row whose `created_at` is *strictly* less than `cutoff_iso`
/// (RFC3339). Returns the number of rows removed.
pub async fn delete_before(
    db: &DatabaseConnection,
    cutoff_iso: &str,
) -> Result<u64, DbErr> {
    let result = Entity::delete_many()
        .filter(Column::CreatedAt.lt(cutoff_iso))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}
