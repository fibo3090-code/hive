use sea_orm::*;

use super::{new_id, now_rfc3339};
use crate::entities::session::{ActiveModel, Column, Entity, Model};

pub async fn get_active_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::IsActive.eq(true))
        .order_by_desc(Column::StartedAt)
        .one(db)
        .await
}

pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_desc(Column::StartedAt)
        .all(db)
        .await
}

pub async fn create_active(db: &DatabaseConnection, project_id: &str) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(project_id.to_owned()),
        is_active: Set(true),
        started_at: Set(now),
        ended_at: Set(None),
    }
    .insert(db)
    .await
}

pub async fn toggle_for_project(db: &DatabaseConnection, project_id: &str) -> Result<Model, DbErr> {
    if let Some(active) = get_active_by_project(db, project_id).await? {
        let mut model: ActiveModel = active.into();
        model.is_active = Set(false);
        model.ended_at = Set(Some(now_rfc3339()));
        return model.update(db).await;
    }

    create_active(db, project_id).await
}
