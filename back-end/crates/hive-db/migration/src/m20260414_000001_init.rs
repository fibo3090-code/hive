use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260414_000001_init"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ─── projects ───────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Projects::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Projects::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Projects::Name).string().not_null())
                    .col(ColumnDef::new(Projects::Description).string().null())
                    .col(
                        ColumnDef::new(Projects::HealthScore)
                            .integer()
                            .not_null()
                            .default(100),
                    )
                    .col(
                        ColumnDef::new(Projects::SpecCompletion)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(Projects::TestCoverage)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(Projects::SovereigntyTier)
                            .string()
                            .not_null()
                            .default("local"),
                    )
                    .col(
                        ColumnDef::new(Projects::Status)
                            .string()
                            .not_null()
                            .default("active"),
                    )
                    .col(
                        ColumnDef::new(Projects::BudgetTotalCents)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Projects::LastActivityAt).string().null())
                    .col(ColumnDef::new(Projects::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Projects::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(Projects::DeletedAt).string().null())
                    .to_owned(),
            )
            .await?;

        // ─── agents ─────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Agents::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Agents::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Agents::ProjectId).string().not_null())
                    .col(ColumnDef::new(Agents::Slug).string().not_null())
                    .col(ColumnDef::new(Agents::Name).string().not_null())
                    .col(ColumnDef::new(Agents::Role).string().not_null())
                    .col(ColumnDef::new(Agents::Model).string().not_null())
                    .col(
                        ColumnDef::new(Agents::Status)
                            .string()
                            .not_null()
                            .default("idle"),
                    )
                    .col(ColumnDef::new(Agents::CurrentTask).string().null())
                    .col(ColumnDef::new(Agents::QualityScore).integer().null())
                    .col(
                        ColumnDef::new(Agents::TokensUsed)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(Agents::EvalScores)
                            .json()
                            .not_null()
                            .default("{}"),
                    )
                    .col(ColumnDef::new(Agents::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Agents::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(Agents::DeletedAt).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Agents::Table, Agents::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── tasks ───────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Tasks::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Tasks::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Tasks::ProjectId).string().not_null())
                    .col(ColumnDef::new(Tasks::AgentId).string().null())
                    .col(ColumnDef::new(Tasks::Title).string().not_null())
                    .col(
                        ColumnDef::new(Tasks::Status)
                            .string()
                            .not_null()
                            .default("queued"),
                    )
                    .col(ColumnDef::new(Tasks::Phase).string().null())
                    .col(ColumnDef::new(Tasks::SprintId).string().null())
                    .col(
                        ColumnDef::new(Tasks::Priority)
                            .string()
                            .not_null()
                            .default("medium"),
                    )
                    .col(
                        ColumnDef::new(Tasks::EstimatedTokens)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Tasks::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Tasks::UpdatedAt).string().not_null())
                    .col(ColumnDef::new(Tasks::CompletedAt).string().null())
                    .col(ColumnDef::new(Tasks::DeletedAt).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Tasks::Table, Tasks::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── alerts ──────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Alerts::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Alerts::Id).string().not_null().primary_key())
                    .col(ColumnDef::new(Alerts::ProjectId).string().not_null())
                    .col(ColumnDef::new(Alerts::Severity).string().not_null())
                    .col(ColumnDef::new(Alerts::Title).string().not_null())
                    .col(ColumnDef::new(Alerts::Message).string().not_null())
                    .col(ColumnDef::new(Alerts::Source).string().not_null())
                    .col(ColumnDef::new(Alerts::ActionLabel).string().null())
                    .col(ColumnDef::new(Alerts::ActionKind).string().null())
                    .col(ColumnDef::new(Alerts::DismissedAt).string().null())
                    .col(ColumnDef::new(Alerts::CreatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Alerts::Table, Alerts::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── notifications ───────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Notifications::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Notifications::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Notifications::ProjectId).string().null())
                    .col(ColumnDef::new(Notifications::Type).string().not_null())
                    .col(ColumnDef::new(Notifications::Title).string().not_null())
                    .col(ColumnDef::new(Notifications::Message).string().not_null())
                    .col(
                        ColumnDef::new(Notifications::Actionable)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(Notifications::ActionLabel).string().null())
                    .col(ColumnDef::new(Notifications::ReadAt).string().null())
                    .col(ColumnDef::new(Notifications::DismissedAt).string().null())
                    .col(ColumnDef::new(Notifications::CreatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        // ─── hive_mind_notes ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(HiveMindNotes::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(HiveMindNotes::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(HiveMindNotes::ProjectId).string().not_null())
                    .col(ColumnDef::new(HiveMindNotes::Category).string().not_null())
                    .col(ColumnDef::new(HiveMindNotes::Title).string().not_null())
                    .col(ColumnDef::new(HiveMindNotes::Content).string().not_null())
                    .col(
                        ColumnDef::new(HiveMindNotes::Auto)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(HiveMindNotes::Author).string().not_null())
                    .col(ColumnDef::new(HiveMindNotes::CreatedAt).string().not_null())
                    .col(ColumnDef::new(HiveMindNotes::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(HiveMindNotes::Table, HiveMindNotes::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── tech_debt_items ─────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(TechDebtItems::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(TechDebtItems::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(TechDebtItems::ProjectId).string().not_null())
                    .col(ColumnDef::new(TechDebtItems::Title).string().not_null())
                    .col(ColumnDef::new(TechDebtItems::Description).string().null())
                    .col(ColumnDef::new(TechDebtItems::File).string().null())
                    .col(ColumnDef::new(TechDebtItems::Impact).string().null())
                    .col(ColumnDef::new(TechDebtItems::Severity).string().not_null())
                    .col(
                        ColumnDef::new(TechDebtItems::Lines)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(TechDebtItems::Position)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(TechDebtItems::CreatedAt).string().not_null())
                    .col(ColumnDef::new(TechDebtItems::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(TechDebtItems::Table, TechDebtItems::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── sprints ─────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Sprints::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Sprints::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Sprints::ProjectId).string().not_null())
                    .col(ColumnDef::new(Sprints::Name).string().not_null())
                    .col(
                        ColumnDef::new(Sprints::Status)
                            .string()
                            .not_null()
                            .default("planned"),
                    )
                    .col(ColumnDef::new(Sprints::StartDate).string().not_null())
                    .col(ColumnDef::new(Sprints::EndDate).string().not_null())
                    .col(ColumnDef::new(Sprints::Velocity).integer().null())
                    .col(
                        ColumnDef::new(Sprints::Points)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(Sprints::Position)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(Sprints::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Sprints::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Sprints::Table, Sprints::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── sessions ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Sessions::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Sessions::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Sessions::ProjectId).string().not_null())
                    .col(
                        ColumnDef::new(Sessions::IsActive)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(ColumnDef::new(Sessions::StartedAt).string().not_null())
                    .col(ColumnDef::new(Sessions::EndedAt).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Sessions::Table, Sessions::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── cost_events ─────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(CostEvents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CostEvents::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(CostEvents::ProjectId).string().not_null())
                    .col(ColumnDef::new(CostEvents::SessionId).string().null())
                    .col(ColumnDef::new(CostEvents::AgentId).string().null())
                    .col(ColumnDef::new(CostEvents::Kind).string().not_null())
                    .col(
                        ColumnDef::new(CostEvents::TokensIn)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(CostEvents::TokensOut)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(CostEvents::CostCents).integer().not_null())
                    .col(ColumnDef::new(CostEvents::Memo).string().null())
                    .col(ColumnDef::new(CostEvents::CreatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(CostEvents::Table, CostEvents::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // ─── settings ────────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Settings::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Settings::Scope).string().not_null())
                    .col(ColumnDef::new(Settings::Key).string().not_null())
                    .col(ColumnDef::new(Settings::Value).json().not_null())
                    .col(ColumnDef::new(Settings::UpdatedAt).string().not_null())
                    .primary_key(Index::create().col(Settings::Scope).col(Settings::Key))
                    .to_owned(),
            )
            .await?;

        // ─── llm_providers ───────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(LlmProviders::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(LlmProviders::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(LlmProviders::Name)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(LlmProviders::Connected)
                            .boolean()
                            .not_null()
                            .default(false),
                    )
                    .col(ColumnDef::new(LlmProviders::ApiKeyCiphertext).blob().null())
                    .col(ColumnDef::new(LlmProviders::MaskedKey).string().null())
                    .col(ColumnDef::new(LlmProviders::CreatedAt).string().not_null())
                    .col(ColumnDef::new(LlmProviders::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        // ─── integrations ────────────────────────────────────────────────
        manager
            .create_table(
                Table::create()
                    .table(Integrations::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Integrations::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(Integrations::Name)
                            .string()
                            .not_null()
                            .unique_key(),
                    )
                    .col(
                        ColumnDef::new(Integrations::Status)
                            .string()
                            .not_null()
                            .default("disconnected"),
                    )
                    .col(ColumnDef::new(Integrations::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Integrations::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        for table in [
            Integrations::Table.into_iden(),
            LlmProviders::Table.into_iden(),
            Settings::Table.into_iden(),
            CostEvents::Table.into_iden(),
            Sessions::Table.into_iden(),
            Sprints::Table.into_iden(),
            TechDebtItems::Table.into_iden(),
            HiveMindNotes::Table.into_iden(),
            Notifications::Table.into_iden(),
            Alerts::Table.into_iden(),
            Tasks::Table.into_iden(),
            Agents::Table.into_iden(),
            Projects::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(table).if_exists().to_owned())
                .await?;
        }
        Ok(())
    }
}

// ─── Identifiers ────────────────────────────────────────────────────────────

#[derive(Iden)]
enum Projects {
    Table,
    Id,
    Name,
    Description,
    HealthScore,
    SpecCompletion,
    TestCoverage,
    SovereigntyTier,
    Status,
    BudgetTotalCents,
    LastActivityAt,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}
#[derive(Iden)]
enum Agents {
    Table,
    Id,
    ProjectId,
    Slug,
    Name,
    Role,
    Model,
    Status,
    CurrentTask,
    QualityScore,
    TokensUsed,
    EvalScores,
    CreatedAt,
    UpdatedAt,
    DeletedAt,
}
#[derive(Iden)]
enum Tasks {
    Table,
    Id,
    ProjectId,
    AgentId,
    Title,
    Status,
    Phase,
    SprintId,
    Priority,
    EstimatedTokens,
    CreatedAt,
    UpdatedAt,
    CompletedAt,
    DeletedAt,
}
#[derive(Iden)]
enum Alerts {
    Table,
    Id,
    ProjectId,
    Severity,
    Title,
    Message,
    Source,
    ActionLabel,
    ActionKind,
    DismissedAt,
    CreatedAt,
}
#[derive(Iden)]
enum Notifications {
    Table,
    Id,
    ProjectId,
    Type,
    Title,
    Message,
    Actionable,
    ActionLabel,
    ReadAt,
    DismissedAt,
    CreatedAt,
}
#[derive(Iden)]
enum HiveMindNotes {
    Table,
    Id,
    ProjectId,
    Category,
    Title,
    Content,
    Auto,
    Author,
    CreatedAt,
    UpdatedAt,
}
#[derive(Iden)]
enum TechDebtItems {
    Table,
    Id,
    ProjectId,
    Title,
    Description,
    File,
    Impact,
    Severity,
    Lines,
    Position,
    CreatedAt,
    UpdatedAt,
}
#[derive(Iden)]
enum Sprints {
    Table,
    Id,
    ProjectId,
    Name,
    Status,
    StartDate,
    EndDate,
    Velocity,
    Points,
    Position,
    CreatedAt,
    UpdatedAt,
}
#[derive(Iden)]
enum Sessions {
    Table,
    Id,
    ProjectId,
    IsActive,
    StartedAt,
    EndedAt,
}
#[derive(Iden)]
enum CostEvents {
    Table,
    Id,
    ProjectId,
    SessionId,
    AgentId,
    Kind,
    TokensIn,
    TokensOut,
    CostCents,
    Memo,
    CreatedAt,
}
#[derive(Iden)]
enum Settings {
    Table,
    Scope,
    Key,
    Value,
    UpdatedAt,
}
#[derive(Iden)]
enum LlmProviders {
    Table,
    Id,
    Name,
    Connected,
    ApiKeyCiphertext,
    MaskedKey,
    CreatedAt,
    UpdatedAt,
}
#[derive(Iden)]
enum Integrations {
    Table,
    Id,
    Name,
    Status,
    CreatedAt,
    UpdatedAt,
}
