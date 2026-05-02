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
        let conn = manager.get_connection();
        let backend = conn.get_database_backend();
        let now = chrono::Utc::now().to_rfc3339();

        // (scope, key, json_value). Stored as raw JSON strings — the
        // settings.value column is a JSON-typed column on Postgres and a
        // TEXT column with valid JSON on SQLite.
        let defaults: &[(&str, &str, &str)] = &[
            ("search", "provider", "\"searxng\""),
            ("search", "searxng_url", "\"http://localhost:8888\""),
        ];

        // Use parameter bindings rather than string interpolation: the
        // values are constants today, but treating SQL fragments as
        // templates is the wrong default to set in this codebase.
        let insert_sql = match backend {
            DatabaseBackend::Sqlite => {
                "INSERT OR IGNORE INTO settings (scope, key, value, updated_at) VALUES (?, ?, ?, ?)"
            }
            DatabaseBackend::Postgres => {
                "INSERT INTO settings (scope, key, value, updated_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (scope, key) DO NOTHING"
            }
            DatabaseBackend::MySql => {
                "INSERT IGNORE INTO settings (scope, key, value, updated_at) VALUES (?, ?, ?, ?)"
            }
        };

        for (scope, key, value) in defaults {
            conn.execute(Statement::from_sql_and_values(
                backend,
                insert_sql,
                [
                    (*scope).into(),
                    (*key).into(),
                    (*value).into(),
                    now.clone().into(),
                ],
            ))
            .await?;
        }

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let conn = manager.get_connection();
        let backend = conn.get_database_backend();
        conn.execute(Statement::from_sql_and_values(
            backend,
            "DELETE FROM settings WHERE scope = ?",
            ["search".into()],
        ))
        .await?;
        Ok(())
    }
}
