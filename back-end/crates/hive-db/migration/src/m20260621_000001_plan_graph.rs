use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260621_000001_plan_graph"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(Sprints::Table)
                    .add_column(
                        ColumnDef::new(Sprints::GraphLevel)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Sprints::Table)
                    .add_column(
                        ColumnDef::new(Sprints::GraphOrder)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .add_column(
                        ColumnDef::new(Tasks::GraphLevel)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .add_column(
                        ColumnDef::new(Tasks::GraphOrder)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SprintDependencies::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SprintDependencies::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SprintDependencies::ProjectId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SprintDependencies::FromSprintId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SprintDependencies::ToSprintId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SprintDependencies::Kind)
                            .string()
                            .not_null()
                            .default("dependency"),
                    )
                    .col(ColumnDef::new(SprintDependencies::CreatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(SprintDependencies::Table, SprintDependencies::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(SprintDependencies::Table, SprintDependencies::FromSprintId)
                            .to(Sprints::Table, Sprints::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(SprintDependencies::Table, SprintDependencies::ToSprintId)
                            .to(Sprints::Table, Sprints::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_sprint_dependencies_project")
                    .table(SprintDependencies::Table)
                    .col(SprintDependencies::ProjectId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(TaskDependencies::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TaskDependencies::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(TaskDependencies::ProjectId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TaskDependencies::FromTaskId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TaskDependencies::ToTaskId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(TaskDependencies::Kind)
                            .string()
                            .not_null()
                            .default("dependency"),
                    )
                    .col(ColumnDef::new(TaskDependencies::CreatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(TaskDependencies::Table, TaskDependencies::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(TaskDependencies::Table, TaskDependencies::FromTaskId)
                            .to(Tasks::Table, Tasks::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(TaskDependencies::Table, TaskDependencies::ToTaskId)
                            .to(Tasks::Table, Tasks::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_task_dependencies_project")
                    .table(TaskDependencies::Table)
                    .col(TaskDependencies::ProjectId)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(TaskDependencies::Table).to_owned())
            .await?;
        manager
            .drop_table(Table::drop().table(SprintDependencies::Table).to_owned())
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .drop_column(Tasks::GraphOrder)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .drop_column(Tasks::GraphLevel)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Sprints::Table)
                    .drop_column(Sprints::GraphOrder)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Sprints::Table)
                    .drop_column(Sprints::GraphLevel)
                    .to_owned(),
            )
            .await
    }
}

#[derive(Iden, Clone, Copy)]
enum Projects {
    Table,
    Id,
}

#[derive(Iden, Clone, Copy)]
enum Sprints {
    Table,
    Id,
    GraphLevel,
    GraphOrder,
}

#[derive(Iden, Clone, Copy)]
enum Tasks {
    Table,
    Id,
    GraphLevel,
    GraphOrder,
}

#[derive(Iden, Clone, Copy)]
enum SprintDependencies {
    Table,
    Id,
    ProjectId,
    FromSprintId,
    ToSprintId,
    Kind,
    CreatedAt,
}

#[derive(Iden, Clone, Copy)]
enum TaskDependencies {
    Table,
    Id,
    ProjectId,
    FromTaskId,
    ToTaskId,
    Kind,
    CreatedAt,
}
