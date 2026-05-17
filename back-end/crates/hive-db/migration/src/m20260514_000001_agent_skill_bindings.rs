//! `agent_skill_bindings` — many-to-many between agents and skills. Plus a
//! `skills.markdown_body` column so a skill can carry a longer body that
//! the agent pulls in lazily via `read_skill` (vs. the always-spliced
//! `system_prompt_fragment`).

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260514_000001_agent_skill_bindings"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AgentSkillBindings::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentSkillBindings::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AgentSkillBindings::ProjectId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSkillBindings::AgentId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSkillBindings::SkillId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSkillBindings::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentSkillBindings::Table, AgentSkillBindings::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentSkillBindings::Table, AgentSkillBindings::AgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentSkillBindings::Table, AgentSkillBindings::SkillId)
                            .to(Skills::Table, Skills::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_agent_skill_bindings_unique")
                    .table(AgentSkillBindings::Table)
                    .col(AgentSkillBindings::AgentId)
                    .col(AgentSkillBindings::SkillId)
                    .unique()
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_skill_bindings_agent")
                    .table(AgentSkillBindings::Table)
                    .col(AgentSkillBindings::AgentId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_skill_bindings_project")
                    .table(AgentSkillBindings::Table)
                    .col(AgentSkillBindings::ProjectId)
                    .to_owned(),
            )
            .await?;

        // Lazy body for skills — the always-spliced `system_prompt_fragment`
        // stays as the short hint; `markdown_body` carries the full
        // playbook that an agent reads on demand via `read_skill`.
        manager
            .alter_table(
                Table::alter()
                    .table(Skills::Table)
                    .add_column(
                        ColumnDef::new(Skills::MarkdownBody)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AgentSkillBindings::Table).to_owned())
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Skills::Table)
                    .drop_column(Skills::MarkdownBody)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(Iden, Clone, Copy)]
enum AgentSkillBindings {
    Table,
    Id,
    ProjectId,
    AgentId,
    SkillId,
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

#[derive(Iden, Clone, Copy)]
enum Skills {
    Table,
    Id,
    MarkdownBody,
}
