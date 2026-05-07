use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260427_000001_agent_relations"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Extend the existing `agents` table with relational + runtime columns.
        let alterations: [(Agents, ColumnDef); 6] = [
            (
                Agents::ParentAgentId,
                ColumnDef::new(Agents::ParentAgentId)
                    .string()
                    .null()
                    .to_owned(),
            ),
            (
                Agents::SpawnedByMessageId,
                ColumnDef::new(Agents::SpawnedByMessageId)
                    .string()
                    .null()
                    .to_owned(),
            ),
            (
                Agents::EnabledTools,
                ColumnDef::new(Agents::EnabledTools)
                    .json()
                    .not_null()
                    .default("[]")
                    .to_owned(),
            ),
            (
                Agents::SystemPrompt,
                ColumnDef::new(Agents::SystemPrompt)
                    .text()
                    .null()
                    .to_owned(),
            ),
            (
                Agents::ModelProviderId,
                ColumnDef::new(Agents::ModelProviderId)
                    .string()
                    .null()
                    .to_owned(),
            ),
            (
                Agents::ModelId,
                ColumnDef::new(Agents::ModelId).string().null().to_owned(),
            ),
        ];

        for (_col, def) in alterations.iter() {
            manager
                .alter_table(
                    Table::alter()
                        .table(Agents::Table)
                        .add_column(def.clone())
                        .to_owned(),
                )
                .await?;
        }

        // Create the inter-agent inbox table.
        manager
            .create_table(
                Table::create()
                    .table(AgentMessages::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentMessages::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentMessages::ProjectId).string().not_null())
                    .col(ColumnDef::new(AgentMessages::FromAgentId).string().null())
                    .col(ColumnDef::new(AgentMessages::ToAgentId).string().not_null())
                    .col(ColumnDef::new(AgentMessages::ThreadId).string().null())
                    .col(
                        ColumnDef::new(AgentMessages::ReplyToMessageId)
                            .string()
                            .null(),
                    )
                    .col(ColumnDef::new(AgentMessages::Content).text().not_null())
                    .col(
                        ColumnDef::new(AgentMessages::ToolCalls)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(AgentMessages::Status)
                            .string()
                            .not_null()
                            .default("queued"),
                    )
                    .col(ColumnDef::new(AgentMessages::CreatedAt).string().not_null())
                    .col(ColumnDef::new(AgentMessages::CompletedAt).string().null())
                    .col(ColumnDef::new(AgentMessages::DeletedAt).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentMessages::Table, AgentMessages::ToAgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentMessages::Table, AgentMessages::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_agent_message_to_status")
                    .table(AgentMessages::Table)
                    .col(AgentMessages::ToAgentId)
                    .col(AgentMessages::Status)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_agent_message_thread")
                    .table(AgentMessages::Table)
                    .col(AgentMessages::ThreadId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_agents_parent")
                    .table(Agents::Table)
                    .col(Agents::ParentAgentId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AgentMessages::Table).to_owned())
            .await?;

        for col in [
            Agents::ParentAgentId,
            Agents::SpawnedByMessageId,
            Agents::EnabledTools,
            Agents::SystemPrompt,
            Agents::ModelProviderId,
            Agents::ModelId,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(Agents::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }

        Ok(())
    }
}

#[derive(Iden, Clone, Copy)]
enum Agents {
    Table,
    Id,
    ParentAgentId,
    SpawnedByMessageId,
    EnabledTools,
    SystemPrompt,
    ModelProviderId,
    ModelId,
}

#[derive(Iden, Clone, Copy)]
enum AgentMessages {
    Table,
    Id,
    ProjectId,
    FromAgentId,
    ToAgentId,
    ThreadId,
    ReplyToMessageId,
    Content,
    ToolCalls,
    Status,
    CreatedAt,
    CompletedAt,
    DeletedAt,
}

#[derive(Iden, Clone, Copy)]
enum Projects {
    Table,
    Id,
}
