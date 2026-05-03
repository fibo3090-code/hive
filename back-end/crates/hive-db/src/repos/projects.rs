use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::project::{ActiveModel, Column, Entity, Model};
use crate::entities::setting;

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProject {
    pub name: String,
    pub description: Option<String>,
    pub sovereignty_tier: String,
    pub budget_total_cents: i64,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProject {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub sovereignty_tier: Option<String>,
    pub budget_total_cents: Option<i64>,
    pub status: Option<String>,
    pub health_score: Option<i32>,
    pub spec_completion: Option<i32>,
    pub test_coverage: Option<i32>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all non-deleted projects ordered by last activity.
pub async fn list(db: &DatabaseConnection) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::DeletedAt.is_null())
        .order_by_desc(Column::LastActivityAt)
        .all(db)
        .await
}

/// Get a single project by id, excluding soft-deleted ones.
pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned())
        .filter(Column::DeletedAt.is_null())
        .one(db)
        .await
}

/// Create a new project.
pub async fn create(db: &DatabaseConnection, input: CreateProject) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        name: Set(input.name),
        description: Set(input.description),
        health_score: Set(0),
        spec_completion: Set(0),
        test_coverage: Set(0),
        sovereignty_tier: Set(input.sovereignty_tier),
        status: Set(input.status),
        budget_total_cents: Set(input.budget_total_cents),
        last_activity_at: Set(Some(now.clone())),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        deleted_at: Set(None),
    };
    model.insert(db).await
}

/// Partially update an existing project.
pub async fn update(
    db: &DatabaseConnection,
    id: &str,
    input: UpdateProject,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();

    if let Some(v) = input.name {
        model.name = Set(v);
    }
    if let Some(v) = input.description {
        model.description = Set(v);
    }
    if let Some(v) = input.sovereignty_tier {
        model.sovereignty_tier = Set(v);
    }
    if let Some(v) = input.budget_total_cents {
        model.budget_total_cents = Set(v);
    }
    if let Some(v) = input.status {
        model.status = Set(v);
    }
    if let Some(v) = input.health_score {
        model.health_score = Set(v);
    }
    if let Some(v) = input.spec_completion {
        model.spec_completion = Set(v);
    }
    if let Some(v) = input.test_coverage {
        model.test_coverage = Set(v);
    }

    model.updated_at = Set(now_rfc3339());
    model.last_activity_at = Set(Some(now_rfc3339()));
    model.update(db).await
}

/// Soft-delete a project by setting `deleted_at`.
pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.deleted_at = Set(Some(now_rfc3339()));
    model.updated_at = Set(now_rfc3339());
    model.update(db).await?;
    Ok(())
}

/// Set the active project in the global settings table.
pub async fn activate(db: &DatabaseConnection, id: &str) -> Result<(), DbErr> {
    // Verify project exists
    Entity::find_by_id(id.to_owned())
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let now = now_rfc3339();
    let setting = setting::ActiveModel {
        scope: Set("global".to_owned()),
        key: Set("activeProjectId".to_owned()),
        value: Set(serde_json::Value::String(id.to_owned())),
        updated_at: Set(now),
    };

    // Upsert: insert or update on conflict
    setting::Entity::insert(setting)
        .on_conflict(
            sea_query::OnConflict::columns([setting::Column::Scope, setting::Column::Key])
                .update_columns([setting::Column::Value, setting::Column::UpdatedAt])
                .to_owned(),
        )
        .exec(db)
        .await?;

    Ok(())
}
