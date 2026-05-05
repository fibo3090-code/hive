//! `chat_message_attachments` — files the user attaches to a chat
//! message before send. Storage path is workspace-relative so the
//! per-project sandbox already handles isolation; the row is the
//! source of truth for size, mime type, and the original filename.
//!
//! Columns:
//!   id TEXT PK
//!   message_id TEXT NOT NULL FK→chat_messages
//!   kind TEXT NOT NULL                — 'image' | 'text' | 'binary'
//!   name TEXT NOT NULL                — original filename
//!   mime_type TEXT NOT NULL
//!   bytes_size INTEGER NOT NULL
//!   storage_path TEXT NOT NULL        — relative to ~/.hive/attachments/{project_id}/
//!   created_at TEXT NOT NULL
//!
//! Indexed on `message_id` so listing-per-message is O(rows).

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260603_000001_chat_attachments"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ChatAttachments::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ChatAttachments::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(ChatAttachments::MessageId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(ChatAttachments::Kind).string().not_null())
                    .col(ColumnDef::new(ChatAttachments::Name).string().not_null())
                    .col(
                        ColumnDef::new(ChatAttachments::MimeType)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ChatAttachments::BytesSize)
                            .big_integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ChatAttachments::StoragePath)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(ChatAttachments::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_chat_attachments_message")
                    .table(ChatAttachments::Table)
                    .col(ChatAttachments::MessageId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ChatAttachments::Table).to_owned())
            .await
    }
}

#[derive(Iden)]
enum ChatAttachments {
    Table,
    Id,
    MessageId,
    Kind,
    Name,
    MimeType,
    BytesSize,
    StoragePath,
    CreatedAt,
}
