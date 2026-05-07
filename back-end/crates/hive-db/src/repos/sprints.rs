use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::sprint::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSprint {
    pub project_id: String,
    pub name: String,
    pub status: String,
    pub start_date: String,
    pub end_date: String,
    pub velocity: Option<i32>,
    pub points: i32,
    pub position: i32,
}

pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_asc(Column::Position)
        .all(db)
        .await
}

pub async fn create<C: ConnectionTrait>(db: &C, input: CreateSprint) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        name: Set(input.name),
        status: Set(input.status),
        start_date: Set(input.start_date),
        end_date: Set(input.end_date),
        velocity: Set(input.velocity),
        points: Set(input.points),
        position: Set(input.position),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    }
    .insert(db)
    .await
}

pub async fn reorder(
    db: &DatabaseConnection,
    project_id: &str,
    from_id: &str,
    to_id: &str,
) -> Result<Vec<Model>, DbErr> {
    let mut items = list_by_project(db, project_id).await?;
    let source_index = items.iter().position(|item| item.id == from_id);
    let target_index = items.iter().position(|item| item.id == to_id);

    let (Some(source_index), Some(target_index)) = (source_index, target_index) else {
        return Ok(items);
    };

    if source_index == target_index {
        return Ok(items);
    }

    let moved = items.remove(source_index);
    items.insert(target_index, moved);

    let now = now_rfc3339();
    let txn = db.begin().await?;
    for (position, item) in items.iter().enumerate() {
        let mut model: ActiveModel = item.clone().into();
        model.position = Set(position as i32);
        model.updated_at = Set(now.clone());
        model.update(&txn).await?;
    }
    txn.commit().await?;

    list_by_project(db, project_id).await
}
