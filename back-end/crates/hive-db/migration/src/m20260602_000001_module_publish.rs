//! Add publish-state columns to `synthesis_jobs`. Modules surface in
//! the UI as completed synthesis jobs; "publishing" flips a row to
//! visible in the cross-project catalog. Three columns:
//!
//! - `published_at TEXT NULL` — RFC3339 timestamp, NULL = not published.
//! - `published_visibility TEXT NULL` — `'project'` (visible to the
//!   project's tier) or `'public'` (visible everywhere).
//! - `published_summary TEXT NULL` — short marketing-style description
//!   the publisher writes; falls back to the synthesis description.
//!
//! All three additive — no data migration needed; existing rows stay
//! unpublished. Cross-backend dispatch (Sea-ORM schema builder lowers
//! correctly).

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260602_000001_module_publish"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(SynthesisJobs::Table)
                    .add_column(
                        ColumnDef::new(SynthesisJobs::PublishedAt).string().null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SynthesisJobs::Table)
                    .add_column(
                        ColumnDef::new(SynthesisJobs::PublishedVisibility)
                            .string()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(SynthesisJobs::Table)
                    .add_column(
                        ColumnDef::new(SynthesisJobs::PublishedSummary)
                            .text()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for col in [
            SynthesisJobs::PublishedAt,
            SynthesisJobs::PublishedVisibility,
            SynthesisJobs::PublishedSummary,
        ] {
            manager
                .alter_table(
                    Table::alter()
                        .table(SynthesisJobs::Table)
                        .drop_column(col)
                        .to_owned(),
                )
                .await?;
        }
        Ok(())
    }
}

#[derive(Iden)]
enum SynthesisJobs {
    Table,
    PublishedAt,
    PublishedVisibility,
    PublishedSummary,
}
