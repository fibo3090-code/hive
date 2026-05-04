use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::chat_thread::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateThread {
    pub project_id: String,
    pub agent_id: Option<String>,
    pub title: String,
}

pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_desc(Column::UpdatedAt)
        .all(db)
        .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

pub async fn get_or_create_for_agent(
    db: &DatabaseConnection,
    project_id: &str,
    agent_id: Option<&str>,
    default_title: &str,
) -> Result<Model, DbErr> {
    let mut query = Entity::find().filter(Column::ProjectId.eq(project_id));
    query = match agent_id {
        Some(id) => query.filter(Column::AgentId.eq(id)),
        None => query.filter(Column::AgentId.is_null()),
    };
    if let Some(existing) = query.one(db).await? {
        return Ok(existing);
    }
    create(
        db,
        CreateThread {
            project_id: project_id.to_owned(),
            agent_id: agent_id.map(str::to_owned),
            title: default_title.to_owned(),
        },
    )
    .await
}

pub async fn create(db: &DatabaseConnection, input: CreateThread) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        agent_id: Set(input.agent_id),
        title: Set(input.title),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    };
    model.insert(db).await
}

pub async fn touch(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.updated_at = Set(now_rfc3339());
    model.update(db).await?;
    Ok(())
}

pub async fn rename(db: &DatabaseConnection, id: &str, title: &str) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    model.title = Set(title.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Delete every thread in a project. Cascading-deletes the
/// `chat_messages` rows too via the message repo helper. Returns
/// the count of threads removed (the caller surfaces this to the
/// UI / audit log).
pub async fn clear_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<u64, DbErr> {
    let threads = list_by_project(db, project_id).await?;
    for t in &threads {
        crate::repos::chat_messages::delete_for_thread(db, &t.id).await?;
    }
    let result = Entity::delete_many()
        .filter(Column::ProjectId.eq(project_id))
        .exec(db)
        .await?;
    Ok(result.rows_affected)
}
