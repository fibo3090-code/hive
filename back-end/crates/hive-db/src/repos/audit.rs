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
