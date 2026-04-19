use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260414_000002_indexes"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // agents.project_id
        manager
            .create_index(
                Index::create()
                    .name("idx_agents_project_id")
                    .table(Alias::new("agents"))
                    .col(Alias::new("project_id"))
                    .to_owned(),
            )
            .await?;
        // agents unique (project_id, slug)
        manager
            .create_index(
                Index::create()
                    .name("idx_agents_project_slug")
                    .table(Alias::new("agents"))
                    .col(Alias::new("project_id"))
                    .col(Alias::new("slug"))
                    .unique()
                    .to_owned(),
            )
            .await?;
        // tasks.project_id
        manager
            .create_index(
                Index::create()
                    .name("idx_tasks_project_id")
                    .table(Alias::new("tasks"))
                    .col(Alias::new("project_id"))
                    .to_owned(),
            )
            .await?;
        // alerts.project_id
        manager
            .create_index(
                Index::create()
                    .name("idx_alerts_project_id")
                    .table(Alias::new("alerts"))
                    .col(Alias::new("project_id"))
                    .to_owned(),
            )
            .await?;
        // cost_events (project_id, created_at)
        manager
            .create_index(
                Index::create()
                    .name("idx_cost_events_project_created")
                    .table(Alias::new("cost_events"))
                    .col(Alias::new("project_id"))
                    .col(Alias::new("created_at"))
                    .to_owned(),
            )
            .await?;
        // cost_events.session_id
        manager
            .create_index(
                Index::create()
                    .name("idx_cost_events_session_id")
                    .table(Alias::new("cost_events"))
                    .col(Alias::new("session_id"))
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for idx in [
            "idx_agents_project_id",
            "idx_agents_project_slug",
            "idx_tasks_project_id",
            "idx_alerts_project_id",
            "idx_cost_events_project_created",
            "idx_cost_events_session_id",
        ] {
            manager
                .drop_index(Index::drop().name(idx).to_owned())
                .await?;
        }
        Ok(())
    }
}
