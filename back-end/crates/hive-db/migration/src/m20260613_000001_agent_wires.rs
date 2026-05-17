//! `agent_wires` — explicit parent→child authority/communication edges in the
//! HiveGraph. Distinct from `agents.parent_agent_id` (the spawn lineage): a
//! wire can be drawn between any two agents in a project as long as it doesn't
//! create a cycle. Visibility resolution (which agents an agent may message)
//! walks this table.

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260613_000001_agent_wires"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AgentWires::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentWires::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentWires::ProjectId).string().not_null())
                    .col(
                        ColumnDef::new(AgentWires::ParentAgentId)
                            .string()
                            .not_null(),
                    )
                    .col(ColumnDef::new(AgentWires::ChildAgentId).string().not_null())
                    .col(ColumnDef::new(AgentWires::CreatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentWires::Table, AgentWires::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentWires::Table, AgentWires::ParentAgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentWires::Table, AgentWires::ChildAgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_agent_wires_unique")
                    .table(AgentWires::Table)
                    .col(AgentWires::ParentAgentId)
                    .col(AgentWires::ChildAgentId)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_wires_parent")
                    .table(AgentWires::Table)
                    .col(AgentWires::ParentAgentId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_wires_child")
                    .table(AgentWires::Table)
                    .col(AgentWires::ChildAgentId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_wires_project")
                    .table(AgentWires::Table)
                    .col(AgentWires::ProjectId)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AgentWires::Table).to_owned())
            .await
    }
}

#[derive(Iden, Clone, Copy)]
enum AgentWires {
    Table,
    Id,
    ProjectId,
    ParentAgentId,
    ChildAgentId,
    CreatedAt,
}

#[derive(Iden, Clone, Copy)]
enum Agents {
    Table,
    Id,
}

#[derive(Iden, Clone, Copy)]
enum Projects {
    Table,
    Id,
}
