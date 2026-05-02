//! Seed default search-provider settings rows.
//!
//! The `settings` table already exists with `(scope, key) -> JSON value`
//! shape (no DDL change needed). This migration just bootstraps the
//! rows the runtime expects so callers can read them without falling
//! back to hardcoded defaults:
//!
//!   scope='search', key='provider'        -> 'searxng' | 'tavily'
//!   scope='search', key='searxng_url'     -> URL string
//!   scope='search', key='tavily_api_key'  -> base64 ciphertext (when set)
//!
//! Ciphertext is encrypted via `hive-crypto` at write time — same flow
//! as `llm_providers.api_key_ciphertext`. Reads return only the masked
//! representation.

use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, DatabaseBackend, Statement};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260518_000001_search_config"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // INSERT defaults if the scope is empty. Use ON CONFLICT DO NOTHING
        // so the migration is rerunnable; on Postgres the same SQL works,
        // on SQLite we use the same syntax (Sea-ORM normalises).
        let conn = manager.get_connection();
        let backend = conn.get_database_backend();

        // (scope, key, json_value)
        let defaults: &[(&str, &str, &str)] = &[
            ("search", "provider", "\"searxng\""),
            ("search", "searxng_url", "\"http://localhost:8888\""),
        ];

        for (scope, key, value) in defaults {
            let sql = match backend {
                DatabaseBackend::Sqlite => format!(
                    "INSERT OR IGNORE INTO settings (scope, key, value, updated_at) \
                     VALUES ('{scope}', '{key}', '{value}', datetime('now'))"
                ),
                DatabaseBackend::Postgres => format!(
                    "INSERT INTO settings (scope, key, value, updated_at) \
                     VALUES ('{scope}', '{key}', '{value}'::jsonb, NOW()) \
                     ON CONFLICT (scope, key) DO NOTHING"
                ),
                DatabaseBackend::MySql => format!(
                    "INSERT IGNORE INTO settings (scope, key, value, updated_at) \
                     VALUES ('{scope}', '{key}', '{value}', NOW())"
                ),
            };
            conn.execute(Statement::from_string(backend, sql)).await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        let backend = conn.get_database_backend();
        conn.execute(Statement::from_string(
            backend,
            "DELETE FROM settings WHERE scope = 'search'".to_owned(),
        ))
        .await?;
        Ok(())
    }
}
