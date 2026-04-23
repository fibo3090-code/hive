use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260420_000001_chat_threads"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(ChatThreads::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ChatThreads::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ChatThreads::ProjectId).string().not_null())
                    .col(ColumnDef::new(ChatThreads::AgentId).string().null())
                    .col(ColumnDef::new(ChatThreads::Title).string().not_null())
                    .col(ColumnDef::new(ChatThreads::CreatedAt).string().not_null())
                    .col(ColumnDef::new(ChatThreads::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(ChatThreads::Table, ChatThreads::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_chat_threads_project")
                    .table(ChatThreads::Table)
                    .col(ChatThreads::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(ChatMessages::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(ChatMessages::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(ChatMessages::ThreadId).string().not_null())
                    .col(ColumnDef::new(ChatMessages::Role).string().not_null())
                    .col(ColumnDef::new(ChatMessages::Content).text().not_null())
                    .col(
                        ColumnDef::new(ChatMessages::ToolCalls)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(ChatMessages::Model).string().null())
                    .col(ColumnDef::new(ChatMessages::ProviderId).string().null())
                    .col(
                        ColumnDef::new(ChatMessages::TokensIn)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(ChatMessages::TokensOut)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(ChatMessages::CostCents)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(ChatMessages::ParentMessageId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(ChatMessages::Status)
                            .string()
                            .not_null()
                            .default("done"),
                    )
                    .col(ColumnDef::new(ChatMessages::CreatedAt).string().not_null())
                    .col(ColumnDef::new(ChatMessages::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(ChatMessages::Table, ChatMessages::ThreadId)
                            .to(ChatThreads::Table, ChatThreads::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_chat_messages_thread")
                    .table(ChatMessages::Table)
                    .col(ChatMessages::ThreadId)
                    .col(ChatMessages::CreatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(ChatMessages::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(ChatThreads::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum ChatThreads {
    Table,
    Id,
    ProjectId,
    AgentId,
    Title,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum ChatMessages {
    Table,
    Id,
    ThreadId,
    Role,
    Content,
    ToolCalls,
    Model,
    ProviderId,
    TokensIn,
    TokensOut,
    CostCents,
    ParentMessageId,
    Status,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum Projects {
    Table,
    Id,
}
