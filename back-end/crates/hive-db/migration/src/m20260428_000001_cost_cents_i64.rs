//! Widen `cost_cents` from i32 to i64 across `cost_events` and
//! `chat_messages`.
//!
//! Why: i32 saturates at ~$21.47M total spend. Long-running tenants can
//! reach that number and the in-memory accumulators in `hive-runtime` are
//! already i64; persisting to an i32 column required a saturating cast at
//! the boundary which silently caps the recorded spend.
//!
//! Backend-specific behaviour:
//! - **Postgres**: emit `ALTER TABLE … ALTER COLUMN … TYPE BIGINT` to grow
//!   the storage type. Postgres is strict about column types.
//! - **SQLite**: no-op. SQLite's dynamic typing already stores integers in
//!   a variable-width form (1, 2, 4, 6, or 8 bytes depending on value), so
//!   an `INTEGER` column already fits an i64 with no schema change needed.
//!   The SeaORM entity-side change (i32 → i64) is enough for SQLite.

use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260428_000001_cost_cents_i64"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            for sql in [
                "ALTER TABLE cost_events ALTER COLUMN cost_cents TYPE BIGINT",
                "ALTER TABLE chat_messages ALTER COLUMN cost_cents TYPE BIGINT",
            ] {
                conn.execute(Statement::from_string(
                    DatabaseBackend::Postgres,
                    sql.to_owned(),
                ))
                .await?;
            }
        }
        // SQLite: no schema change required; entity-side i64 is sufficient.
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Best-effort revert. Narrowing is destructive and may fail on rows
        // whose cost_cents already exceeds i32 — that's intentional, the
        // operator must clean up data before downgrading.
        let conn = manager.get_connection();
        if conn.get_database_backend() == DatabaseBackend::Postgres {
            for sql in [
                "ALTER TABLE cost_events ALTER COLUMN cost_cents TYPE INTEGER",
                "ALTER TABLE chat_messages ALTER COLUMN cost_cents TYPE INTEGER",
            ] {
                conn.execute(Statement::from_string(
                    DatabaseBackend::Postgres,
                    sql.to_owned(),
                ))
                .await?;
            }
        }
        Ok(())
    }
}
