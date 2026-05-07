use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::skill::{ActiveModel, Column, Entity, Model};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSkill {
    /// `None` creates a global (cross-project) skill.
    pub project_id: Option<String>,
    pub slug: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub system_prompt_fragment: String,
    #[serde(default = "json_empty_array")]
    pub allowed_tools_json: serde_json::Value,
    #[serde(default = "json_empty_array")]
    pub allowed_paths_json: serde_json::Value,
    #[serde(default = "json_empty_array")]
    pub requires_connector_ids_json: serde_json::Value,
    #[serde(default = "json_empty_array")]
    pub capabilities_json: serde_json::Value,
}

fn json_empty_array() -> serde_json::Value {
    serde_json::json!([])
}

pub async fn create(db: &DatabaseConnection, input: CreateSkill) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        slug: Set(input.slug),
        name: Set(input.name),
        description: Set(input.description),
        system_prompt_fragment: Set(input.system_prompt_fragment),
        allowed_tools_json: Set(input.allowed_tools_json),
        allowed_paths_json: Set(input.allowed_paths_json),
        requires_connector_ids_json: Set(input.requires_connector_ids_json),
        capabilities_json: Set(input.capabilities_json),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    }
    .insert(db)
    .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

/// List skills available to a project: rows scoped to the project plus
/// every global skill (where `project_id IS NULL`).
pub async fn list_for_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(
            Condition::any()
                .add(Column::ProjectId.eq(project_id))
                .add(Column::ProjectId.is_null()),
        )
        .order_by_asc(Column::Name)
        .all(db)
        .await
}

#[derive(Debug, Clone, Deserialize, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSkill {
    pub name: Option<String>,
    pub description: Option<String>,
    pub system_prompt_fragment: Option<String>,
    pub allowed_tools_json: Option<serde_json::Value>,
    pub allowed_paths_json: Option<serde_json::Value>,
    pub requires_connector_ids_json: Option<serde_json::Value>,
    pub capabilities_json: Option<serde_json::Value>,
}

pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    patch: UpdateSkill,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;
    let mut model: ActiveModel = existing.into();
    if let Some(v) = patch.name {
        model.name = Set(v);
    }
    if let Some(v) = patch.description {
        model.description = Set(v);
    }
    if let Some(v) = patch.system_prompt_fragment {
        model.system_prompt_fragment = Set(v);
    }
    if let Some(v) = patch.allowed_tools_json {
        model.allowed_tools_json = Set(v);
    }
    if let Some(v) = patch.allowed_paths_json {
        model.allowed_paths_json = Set(v);
    }
    if let Some(v) = patch.requires_connector_ids_json {
        model.requires_connector_ids_json = Set(v);
    }
    if let Some(v) = patch.capabilities_json {
        model.capabilities_json = Set(v);
    }
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    Entity::delete_by_id(id.to_owned()).exec(db).await.map(|_| ())
}
