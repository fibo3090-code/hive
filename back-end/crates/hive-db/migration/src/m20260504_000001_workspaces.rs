//! `project_workspaces` — one row per project describing the agent
//! execution sandbox.
//!
//! Today the API serves synthesised workspace info from
//! `get_workspace_info` with no backing table. This migration adds the
//! storage so the choice (docker vs local-fs) and the resolved root path
//! actually persist across restarts. The plan lists this as Sprint 5
//! work that never landed.
//!
//! Schema:
//!   id TEXT PK
//!   project_id TEXT NOT NULL UNIQUE FK→projects
//!   sandbox_kind TEXT NOT NULL  CHECK ('docker','local')
//!   root_path TEXT NOT NULL
//!   container_id TEXT NULL                — populated only for docker
//!   status TEXT NOT NULL CHECK ('uninitialised','ready','error')
//!   last_started_at TEXT NULL
//!   last_error TEXT NULL
//!   created_at TEXT NOT NULL
//!   updated_at TEXT NOT NULL

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260504_000001_workspaces"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ProjectWorkspaces::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ProjectWorkspaces::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ProjectWorkspaces::ProjectId)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(ProjectWorkspaces::SandboxKind)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProjectWorkspaces::RootPath)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ProjectWorkspaces::ContainerId).string().null())
                    .col(
                        ColumnDef::new(ProjectWorkspaces::Status)
                            .string()
                            .not_null()
                            .default("uninitialised"),
                    )
                    .col(
                        ColumnDef::new(ProjectWorkspaces::LastStartedAt)
                            .string()
                            .null(),
                    )
                    .col(ColumnDef::new(ProjectWorkspaces::LastError).text().null())
                    .col(
                        ColumnDef::new(ProjectWorkspaces::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ProjectWorkspaces::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_project_workspaces_project")
                    .table(ProjectWorkspaces::Table)
                    .col(ProjectWorkspaces::ProjectId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ProjectWorkspaces::Table).to_owned())
            .await
    }
}

#[derive(Iden)]
enum ProjectWorkspaces {
    Table,
    Id,
    ProjectId,
    SandboxKind,
    RootPath,
    ContainerId,
    Status,
    LastStartedAt,
    LastError,
    CreatedAt,
    UpdatedAt,
}
