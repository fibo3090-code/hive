use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260511_000001_synthesis_jobs"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SynthesisJobs::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SynthesisJobs::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SynthesisJobs::ProjectId).string().not_null())
                    .col(ColumnDef::new(SynthesisJobs::Status).string().not_null())
                    .col(ColumnDef::new(SynthesisJobs::Description).text().not_null())
                    .col(ColumnDef::new(SynthesisJobs::Tier).string().null())
                    .col(ColumnDef::new(SynthesisJobs::ProviderId).string().null())
                    .col(ColumnDef::new(SynthesisJobs::ModelId).string().null())
                    .col(
                        ColumnDef::new(SynthesisJobs::ManifestJson)
                            .json()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(SynthesisJobs::GeneratedFilesJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(SynthesisJobs::Error).text().null())
                    .col(ColumnDef::new(SynthesisJobs::CreatedAt).string().not_null())
                    .col(ColumnDef::new(SynthesisJobs::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(SynthesisJobs::CompletedAt).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(SynthesisJobs::Table, SynthesisJobs::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_synthesis_jobs_project")
                    .table(SynthesisJobs::Table)
                    .col(SynthesisJobs::ProjectId)
                    .col(SynthesisJobs::CreatedAt)
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(SynthesisJobs::Table).to_owned())
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum SynthesisJobs {
    Table,
    Id,
    ProjectId,
    Status,
    Description,
    Tier,
    ProviderId,
    ModelId,
    ManifestJson,
    GeneratedFilesJson,
    Error,
    CreatedAt,
    UpdatedAt,
    CompletedAt,
}

#[derive(Iden)]
enum Projects {
    Table,
    Id,
}
