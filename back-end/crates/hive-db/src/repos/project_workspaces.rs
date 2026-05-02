//! CRUD for `project_workspaces`. One row per project; the entry is
//! created lazily on first sandbox use and updated when the runtime
//! starts a container or transitions state.

use sea_orm::*;

use super::{new_id, now_rfc3339};
use crate::entities::project_workspace::{ActiveModel, Column, Entity, Model};

/// Sandbox kind. Stored as `'docker'` / `'local'` in the column.
#[derive(Clone, Copy, Debug)]
pub enum SandboxKind {
    Docker,
    Local,
}

impl SandboxKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Docker => "docker",
            Self::Local => "local",
        }
    }
}

/// Workspace status.
#[derive(Clone, Copy, Debug)]
pub enum WorkspaceStatus {
    Uninitialised,
    Ready,
    Error,
}

impl WorkspaceStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Uninitialised => "uninitialised",
            Self::Ready => "ready",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpsertWorkspace {
    pub project_id: String,
    pub sandbox_kind: SandboxKind,
    pub root_path: String,
    pub container_id: Option<String>,
    pub status: WorkspaceStatus,
    pub last_error: Option<String>,
}

pub async fn get_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Option<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .one(db)
        .await
}

/// Insert or update the row for `project_id`. Idempotent.
pub async fn upsert(db: &DatabaseConnection, input: UpsertWorkspace) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    if let Some(existing) = get_by_project(db, &input.project_id).await? {
        let mut model: ActiveModel = existing.into();
        model.sandbox_kind = Set(input.sandbox_kind.as_str().to_owned());
        model.root_path = Set(input.root_path);
        model.container_id = Set(input.container_id);
        model.status = Set(input.status.as_str().to_owned());
        model.last_error = Set(input.last_error);
        model.updated_at = Set(now);
        model.update(db).await
    } else {
        ActiveModel {
            id: Set(new_id()),
            project_id: Set(input.project_id),
            sandbox_kind: Set(input.sandbox_kind.as_str().to_owned()),
            root_path: Set(input.root_path),
            container_id: Set(input.container_id),
            status: Set(input.status.as_str().to_owned()),
            last_started_at: Set(None),
            last_error: Set(input.last_error),
            created_at: Set(now.clone()),
            updated_at: Set(now),
        }
        .insert(db)
        .await
    }
}

pub async fn mark_started(db: &DatabaseConnection, project_id: &str) -> Result<(), DbErr> {
    let Some(existing) = get_by_project(db, project_id).await? else {
        return Ok(());
    };
    let mut model: ActiveModel = existing.into();
    let now = now_rfc3339();
    model.last_started_at = Set(Some(now.clone()));
    model.status = Set(WorkspaceStatus::Ready.as_str().to_owned());
    model.last_error = Set(None);
    model.updated_at = Set(now);
    model.update(db).await?;
    Ok(())
}

pub async fn mark_error(
    db: &DatabaseConnection,
    project_id: &str,
    error: &str,
) -> Result<(), DbErr> {
    let Some(existing) = get_by_project(db, project_id).await? else {
        return Ok(());
    };
    let mut model: ActiveModel = existing.into();
    let now = now_rfc3339();
    model.status = Set(WorkspaceStatus::Error.as_str().to_owned());
    model.last_error = Set(Some(error.to_owned()));
    model.updated_at = Set(now);
    model.update(db).await?;
    Ok(())
}
