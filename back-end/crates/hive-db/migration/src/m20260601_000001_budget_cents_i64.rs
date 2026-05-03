//! Widen `projects.budget_total_cents` from i32 to i64.
//!
//! Why: `cost_events.cost_cents` and `chat_messages.cost_cents` are i64
//! end-to-end (since `m20260428_cost_cents_i64`). Comparing
//! "spend so far" against an i32 budget would saturate at $21.47M and
//! mislead the budget gauge on long-running tenants. Same dispatch
//! pattern as the cost migration: Postgres `ALTER COLUMN ... TYPE
//! BIGINT`; SQLite is a no-op (variable-width integer storage).

use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260601_000001_budget_cents_i64"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            conn.execute(Statement::from_string(
                DatabaseBackend::Postgres,
                "ALTER TABLE projects ALTER COLUMN budget_total_cents TYPE BIGINT".to_owned(),
            ))
            .await?;
        }
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Narrowing is destructive for tenants whose budget already
        // exceeds i32::MAX cents; intentional — the operator must clean
        // data first.
        let conn = manager.get_connection();
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            conn.execute(Statement::from_string(
                DatabaseBackend::Postgres,
                "ALTER TABLE projects ALTER COLUMN budget_total_cents TYPE INTEGER".to_owned(),
            ))
            .await?;
        }
        Ok(())
    }
}
