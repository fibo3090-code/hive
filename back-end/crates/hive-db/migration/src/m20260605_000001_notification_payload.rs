//! Add a JSON `payload` column to `notifications` so structured
//! notifications (loop_detected, budget_exceeded, etc.) can carry
//! their full data shape to the frontend without overloading the
//! `message` column. NULL on existing rows.
//!
//! Cross-backend dispatch via the schema builder so SQLite gets a
//! plain TEXT column with serde-encoded JSON, Postgres gets `json`.

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260605_000001_notification_payload"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Notifications::Table)
                    .add_column(ColumnDef::new(Notifications::Payload).json().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Notifications::Table)
                    .drop_column(Notifications::Payload)
                    .to_owned(),
            )
            .await
    }
}

#[derive(Iden)]
enum Notifications {
    Table,
    Payload,
}
