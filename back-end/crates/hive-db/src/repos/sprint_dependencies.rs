use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::sprint_dependency::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSprintDependency {
    pub project_id: String,
    pub from_sprint_id: String,
    pub to_sprint_id: String,
    #[serde(default = "default_kind")]
    pub kind: String,
}

fn default_kind() -> String {
    "dependency".to_owned()
}

pub async fn create<C: ConnectionTrait>(
    db: &C,
    input: CreateSprintDependency,
) -> Result<Model, DbErr> {
    if input.from_sprint_id == input.to_sprint_id {
        return Err(DbErr::Custom(
            "self-loop sprint dependency is not allowed".into(),
        ));
    }
    let duplicate = Entity::find()
        .filter(Column::ProjectId.eq(&input.project_id))
        .filter(Column::FromSprintId.eq(&input.from_sprint_id))
        .filter(Column::ToSprintId.eq(&input.to_sprint_id))
        .filter(Column::Kind.eq(&input.kind))
        .one(db)
        .await?;
    if duplicate.is_some() {
        return Err(DbErr::Custom(
            "duplicate sprint dependency is not allowed".into(),
        ));
    }
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        from_sprint_id: Set(input.from_sprint_id),
        to_sprint_id: Set(input.to_sprint_id),
        kind: Set(input.kind),
        created_at: Set(now_rfc3339()),
    }
    .insert(db)
    .await
}

pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn delete_by_project<C: ConnectionTrait>(
    db: &C,
    project_id: &str,
) -> Result<DeleteResult, DbErr> {
    Entity::delete_many()
        .filter(Column::ProjectId.eq(project_id))
        .exec(db)
        .await
}
