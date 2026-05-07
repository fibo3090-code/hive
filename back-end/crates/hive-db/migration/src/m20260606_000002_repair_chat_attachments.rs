//! Repair migration for local databases where
//! `m20260603_000001_chat_attachments` was recorded but the table is
//! missing. The original migration already used `IF NOT EXISTS`; this
//! later migration makes the repair visible to SeaORM's migration
//! runner even when the original version is marked as applied.

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260606_000001_repair_chat_attachments"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Alias::new("chat_message_attachments"))
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Alias::new("id"))
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Alias::new("message_id")).string().not_null())
                    .col(ColumnDef::new(Alias::new("kind")).string().not_null())
                    .col(ColumnDef::new(Alias::new("name")).string().not_null())
                    .col(ColumnDef::new(Alias::new("mime_type")).string().not_null())
                    .col(
                        ColumnDef::new(Alias::new("bytes_size"))
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(Alias::new("storage_path"))
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(Alias::new("created_at")).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_chat_message_attachments_message")
                    .table(Alias::new("chat_message_attachments"))
                    .col(Alias::new("message_id"))
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        Ok(())
    }
}
