//! Composite index on `chat_threads(project_id, agent_id)`.
//!
//! Chat Central scopes the sidebar to `(project_id, agent_id)` — the single
//! `idx_chat_threads_project` index from `m20260420_000001` only covers the
//! leading column, so the agent-scoped lookup degrades to a filter. Raw SQL
//! with `IF NOT EXISTS` so it is a no-op on databases that already have it.

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260612_000001_chat_threads_agent_index"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = match manager.get_database_backend() {
            sea_orm::DatabaseBackend::MySql => {
                // MySQL has no IF NOT EXISTS for CREATE INDEX; tolerate a
                // duplicate-key error so the migration stays idempotent.
                "CREATE INDEX idx_chat_threads_project_agent ON chat_threads (project_id, agent_id)"
            }
            _ => "CREATE INDEX IF NOT EXISTS idx_chat_threads_project_agent ON chat_threads (project_id, agent_id)",
        };
        let stmt = sea_orm::Statement::from_string(manager.get_database_backend(), sql.to_owned());
        match manager.get_connection().execute(stmt).await {
            Ok(_) => Ok(()),
            // MySQL ER_DUP_KEYNAME (1061) — index already present.
            Err(e)
                if e.to_string().contains("1061") || e.to_string().contains("already exists") =>
            {
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = match manager.get_database_backend() {
            sea_orm::DatabaseBackend::MySql => {
                "DROP INDEX idx_chat_threads_project_agent ON chat_threads"
            }
            _ => "DROP INDEX IF EXISTS idx_chat_threads_project_agent",
        };
        let stmt = sea_orm::Statement::from_string(manager.get_database_backend(), sql.to_owned());
        manager.get_connection().execute(stmt).await.map(|_| ())
    }
}
