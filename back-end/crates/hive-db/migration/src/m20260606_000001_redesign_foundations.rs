//! Phase 0b foundations migration for the workflow redesign.
//!
//! Adds the seven new tables that subsequent phases (CEO orchestrator,
//! Forge tab, auto-spawn pipeline, planning/drift) all rely on. Also
//! extends `tasks` with the spec-section FK and SLA columns needed by
//! the planning Skill-Sprint view.
//!
//! Tables created:
//!   - skills                     (reusable capability packages, per-project or global)
//!   - connectors                 (external API + MCP servers, encrypted creds)
//!   - spec_documents             (CEO-produced spec markdown, multiple per project)
//!   - spec_document_sections     (anchored slices for FK from tasks)
//!   - agent_task_assignments     (agent ↔ task with rich state machine)
//!   - drift_events               (unified drift across the 3 kinds)
//!   - agent_spawn_requests       (state machine for the auto-spawn pipeline)
//!   - custom_mcp_servers         (per-agent generated MCP servers)
//!   - agent_mcp_bindings         (N:N agent ↔ MCP, custom or shared connector)
//!
//! Columns added:
//!   - tasks.spec_section_id      (nullable FK)
//!   - tasks.due_at               (nullable RFC3339)
//!   - tasks.last_progress_at     (nullable RFC3339)

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260606_000001_redesign_foundations"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // ---- skills ---------------------------------------------------
        manager
            .create_table(
                Table::create()
                    .table(Skills::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Skills::Id).string().not_null().primary_key())
                    // Nullable so a "global" skill can exist outside any project.
                    .col(ColumnDef::new(Skills::ProjectId).string().null())
                    .col(ColumnDef::new(Skills::Slug).string().not_null())
                    .col(ColumnDef::new(Skills::Name).string().not_null())
                    .col(
                        ColumnDef::new(Skills::Description)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(Skills::SystemPromptFragment)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(Skills::AllowedToolsJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(Skills::AllowedPathsJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(Skills::RequiresConnectorIdsJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(Skills::CapabilitiesJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(ColumnDef::new(Skills::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Skills::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Skills::Table, Skills::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_skills_project_slug")
                    .table(Skills::Table)
                    .col(Skills::ProjectId)
                    .col(Skills::Slug)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---- connectors ----------------------------------------------
        manager
            .create_table(
                Table::create()
                    .table(Connectors::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Connectors::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Connectors::ProjectId).string().not_null())
                    // "api" | "mcp"
                    .col(ColumnDef::new(Connectors::Kind).string().not_null())
                    .col(ColumnDef::new(Connectors::Slug).string().not_null())
                    .col(ColumnDef::new(Connectors::Name).string().not_null())
                    .col(ColumnDef::new(Connectors::BaseUrl).string().null())
                    // "none" | "bearer" | "basic" | "oauth2" | "mcp_handshake"
                    .col(
                        ColumnDef::new(Connectors::AuthKind)
                            .string()
                            .not_null()
                            .default("none"),
                    )
                    // Encrypted via hive-crypto, identical pattern to llm_providers.
                    .col(
                        ColumnDef::new(Connectors::EncryptedCredentials)
                            .text()
                            .null(),
                    )
                    .col(ColumnDef::new(Connectors::MaskedKey).string().null())
                    .col(
                        ColumnDef::new(Connectors::ConfigJson)
                            .json()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(Connectors::ProtocolHandshakeJson)
                            .json()
                            .null(),
                    )
                    // "untested" | "connected" | "error"
                    .col(
                        ColumnDef::new(Connectors::Status)
                            .string()
                            .not_null()
                            .default("untested"),
                    )
                    .col(ColumnDef::new(Connectors::LastTestedAt).string().null())
                    .col(ColumnDef::new(Connectors::CreatedAt).string().not_null())
                    .col(ColumnDef::new(Connectors::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(Connectors::Table, Connectors::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_connectors_project_slug")
                    .table(Connectors::Table)
                    .col(Connectors::ProjectId)
                    .col(Connectors::Slug)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---- spec_documents -----------------------------------------
        manager
            .create_table(
                Table::create()
                    .table(SpecDocuments::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SpecDocuments::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SpecDocuments::ProjectId).string().not_null())
                    .col(ColumnDef::new(SpecDocuments::Title).string().not_null())
                    // "ceo-conversation" | "upload" | "manual"
                    .col(
                        ColumnDef::new(SpecDocuments::Source)
                            .string()
                            .not_null()
                            .default("manual"),
                    )
                    .col(
                        ColumnDef::new(SpecDocuments::Markdown)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(SpecDocuments::Version)
                            .integer()
                            .not_null()
                            .default(1),
                    )
                    .col(ColumnDef::new(SpecDocuments::CreatedAt).string().not_null())
                    .col(ColumnDef::new(SpecDocuments::UpdatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(SpecDocuments::Table, SpecDocuments::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_spec_documents_project_created")
                    .table(SpecDocuments::Table)
                    .col(SpecDocuments::ProjectId)
                    .col(SpecDocuments::CreatedAt)
                    .to_owned(),
            )
            .await?;

        // ---- spec_document_sections ---------------------------------
        manager
            .create_table(
                Table::create()
                    .table(SpecDocumentSections::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SpecDocumentSections::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SpecDocumentSections::SpecDocumentId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SpecDocumentSections::Anchor)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SpecDocumentSections::Title)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SpecDocumentSections::Body)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(SpecDocumentSections::Ordinal)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(
                                SpecDocumentSections::Table,
                                SpecDocumentSections::SpecDocumentId,
                            )
                            .to(SpecDocuments::Table, SpecDocuments::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_spec_sections_doc_anchor")
                    .table(SpecDocumentSections::Table)
                    .col(SpecDocumentSections::SpecDocumentId)
                    .col(SpecDocumentSections::Anchor)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---- agent_task_assignments ---------------------------------
        manager
            .create_table(
                Table::create()
                    .table(AgentTaskAssignments::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentTaskAssignments::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::AgentId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::TaskId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::AssignedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::ExpectedCompletionAt)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::StartedAt)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::CompletedAt)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::DriftScore)
                            .double()
                            .not_null()
                            .default(0.0),
                    )
                    // "paused" | "started" | "in-progress" | "finished"
                    // | "blocked" | "awaiting-authorization" | "requesting-input"
                    .col(
                        ColumnDef::new(AgentTaskAssignments::State)
                            .string()
                            .not_null()
                            .default("started"),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentTaskAssignments::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentTaskAssignments::Table, AgentTaskAssignments::AgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentTaskAssignments::Table, AgentTaskAssignments::TaskId)
                            .to(Tasks::Table, Tasks::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_assignments_agent")
                    .table(AgentTaskAssignments::Table)
                    .col(AgentTaskAssignments::AgentId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_assignments_task")
                    .table(AgentTaskAssignments::Table)
                    .col(AgentTaskAssignments::TaskId)
                    .to_owned(),
            )
            .await?;

        // ---- drift_events -------------------------------------------
        manager
            .create_table(
                Table::create()
                    .table(DriftEvents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(DriftEvents::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(DriftEvents::ProjectId).string().not_null())
                    // "agent-vs-task" | "code-vs-spec" | "agent-vs-system-prompt"
                    .col(ColumnDef::new(DriftEvents::Kind).string().not_null())
                    .col(ColumnDef::new(DriftEvents::SubjectId).string().not_null())
                    // "agent" | "requirement" | "task" | etc.
                    .col(ColumnDef::new(DriftEvents::SubjectKind).string().not_null())
                    .col(
                        ColumnDef::new(DriftEvents::EvidenceJson)
                            .json()
                            .not_null()
                            .default("{}"),
                    )
                    // "low" | "medium" | "high"
                    .col(
                        ColumnDef::new(DriftEvents::Severity)
                            .string()
                            .not_null()
                            .default("medium"),
                    )
                    // "open" | "approved" | "corrected" | "dismissed"
                    .col(
                        ColumnDef::new(DriftEvents::Status)
                            .string()
                            .not_null()
                            .default("open"),
                    )
                    .col(ColumnDef::new(DriftEvents::CreatedAt).string().not_null())
                    .col(ColumnDef::new(DriftEvents::ResolvedAt).string().null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(DriftEvents::Table, DriftEvents::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_drift_events_project_status")
                    .table(DriftEvents::Table)
                    .col(DriftEvents::ProjectId)
                    .col(DriftEvents::Status)
                    .to_owned(),
            )
            .await?;

        // ---- custom_mcp_servers -------------------------------------
        // Persists generated handlers for the auto-spawn pipeline. Set
        // `reusable=true` (default) so future spawns can match against
        // these via embedding similarity instead of regenerating.
        manager
            .create_table(
                Table::create()
                    .table(CustomMcpServers::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(CustomMcpServers::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::ProjectId)
                            .string()
                            .not_null(),
                    )
                    // The agent the server was originally generated for. Other
                    // agents may bind via agent_mcp_bindings when reusable.
                    .col(
                        ColumnDef::new(CustomMcpServers::OwnerAgentId)
                            .string()
                            .null(),
                    )
                    .col(ColumnDef::new(CustomMcpServers::Name).string().not_null())
                    .col(ColumnDef::new(CustomMcpServers::Slug).string().not_null())
                    .col(
                        ColumnDef::new(CustomMcpServers::SourceApiUrl)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::SourceApiSpecJson)
                            .json()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::GeneratedManifestJson)
                            .json()
                            .not_null()
                            .default("{}"),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::GeneratedHandlerCode)
                            .text()
                            .not_null()
                            .default(""),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::Transport)
                            .string()
                            .not_null()
                            .default("http"),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::EncryptedCredentials)
                            .text()
                            .null(),
                    )
                    // "draft" | "active" | "disabled" | "error"
                    .col(
                        ColumnDef::new(CustomMcpServers::Status)
                            .string()
                            .not_null()
                            .default("draft"),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::Reusable)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::CapabilitiesJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    // Optional similarity-search vector cached for the matcher.
                    // JSON of f32[]; refreshed when capabilities or description change.
                    .col(
                        ColumnDef::new(CustomMcpServers::EmbeddingJson)
                            .json()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(CustomMcpServers::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(CustomMcpServers::Table, CustomMcpServers::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_custom_mcp_project_slug")
                    .table(CustomMcpServers::Table)
                    .col(CustomMcpServers::ProjectId)
                    .col(CustomMcpServers::Slug)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---- agent_spawn_requests -----------------------------------
        manager
            .create_table(
                Table::create()
                    .table(AgentSpawnRequests::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentSpawnRequests::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::ProjectId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::ParentAgentId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::RequestedRole)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::RequestedCapabilitiesJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::ContextJson)
                            .json()
                            .not_null()
                            .default("{}"),
                    )
                    // "none" | "reuse-only" | "reuse-or-synth" | "force-synth"
                    .col(
                        ColumnDef::new(AgentSpawnRequests::McpStrategy)
                            .string()
                            .not_null()
                            .default("reuse-or-synth"),
                    )
                    // "queued" | "planning-needs" | "matching-existing-mcp"
                    // | "researching-api" | "synthesizing-mcp" | "composing-prompt"
                    // | "awaiting-approval" | "materializing-agent"
                    // | "completed" | "failed" | "cancelled"
                    .col(
                        ColumnDef::new(AgentSpawnRequests::Status)
                            .string()
                            .not_null()
                            .default("queued"),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::ChildAgentId)
                            .string()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::DiscoveredApiJson)
                            .json()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::MatchedExistingMcpIdsJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::SynthesizedMcpIdsJson)
                            .json()
                            .not_null()
                            .default("[]"),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::GeneratedSystemPrompt)
                            .text()
                            .null(),
                    )
                    .col(ColumnDef::new(AgentSpawnRequests::Error).text().null())
                    .col(
                        ColumnDef::new(AgentSpawnRequests::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentSpawnRequests::CompletedAt)
                            .string()
                            .null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentSpawnRequests::Table, AgentSpawnRequests::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_spawn_requests_project_status")
                    .table(AgentSpawnRequests::Table)
                    .col(AgentSpawnRequests::ProjectId)
                    .col(AgentSpawnRequests::Status)
                    .to_owned(),
            )
            .await?;

        // ---- agent_mcp_bindings -------------------------------------
        // N:N association: an agent may bind to several MCP servers (custom
        // and shared connectors), and an MCP may serve several agents.
        manager
            .create_table(
                Table::create()
                    .table(AgentMcpBindings::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentMcpBindings::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(AgentMcpBindings::AgentId)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(AgentMcpBindings::McpServerId)
                            .string()
                            .not_null(),
                    )
                    // "custom" (-> custom_mcp_servers) | "connector" (-> connectors)
                    .col(ColumnDef::new(AgentMcpBindings::Kind).string().not_null())
                    .col(
                        ColumnDef::new(AgentMcpBindings::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentMcpBindings::Table, AgentMcpBindings::AgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_mcp_unique")
                    .table(AgentMcpBindings::Table)
                    .col(AgentMcpBindings::AgentId)
                    .col(AgentMcpBindings::McpServerId)
                    .col(AgentMcpBindings::Kind)
                    .unique()
                    .to_owned(),
            )
            .await?;

        // ---- tasks columns ------------------------------------------
        // Spec-section FK + SLA timestamps for the Skill-Sprint planning
        // view. All nullable so existing rows backfill cleanly.
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .add_column(ColumnDef::new(Tasks::SpecSectionId).string().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .add_column(ColumnDef::new(Tasks::DueAt).string().null())
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .add_column(ColumnDef::new(Tasks::LastProgressAt).string().null())
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        // Reverse order to respect FK dependencies.
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .drop_column(Tasks::LastProgressAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .drop_column(Tasks::DueAt)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(Tasks::Table)
                    .drop_column(Tasks::SpecSectionId)
                    .to_owned(),
            )
            .await?;

        for tbl in [
            AgentMcpBindings::Table.into_iden(),
            AgentSpawnRequests::Table.into_iden(),
            CustomMcpServers::Table.into_iden(),
            DriftEvents::Table.into_iden(),
            AgentTaskAssignments::Table.into_iden(),
            SpecDocumentSections::Table.into_iden(),
            SpecDocuments::Table.into_iden(),
            Connectors::Table.into_iden(),
            Skills::Table.into_iden(),
        ] {
            manager
                .drop_table(Table::drop().table(tbl).if_exists().to_owned())
                .await?;
        }

        Ok(())
    }
}

#[derive(Iden)]
enum Skills {
    Table,
    Id,
    ProjectId,
    Slug,
    Name,
    Description,
    SystemPromptFragment,
    AllowedToolsJson,
    AllowedPathsJson,
    RequiresConnectorIdsJson,
    CapabilitiesJson,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum Connectors {
    Table,
    Id,
    ProjectId,
    Kind,
    Slug,
    Name,
    BaseUrl,
    AuthKind,
    EncryptedCredentials,
    MaskedKey,
    ConfigJson,
    ProtocolHandshakeJson,
    Status,
    LastTestedAt,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SpecDocuments {
    Table,
    Id,
    ProjectId,
    Title,
    Source,
    Markdown,
    Version,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum SpecDocumentSections {
    Table,
    Id,
    SpecDocumentId,
    Anchor,
    Title,
    Body,
    Ordinal,
}

#[derive(Iden)]
enum AgentTaskAssignments {
    Table,
    Id,
    AgentId,
    TaskId,
    AssignedAt,
    ExpectedCompletionAt,
    StartedAt,
    CompletedAt,
    DriftScore,
    State,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum DriftEvents {
    Table,
    Id,
    ProjectId,
    Kind,
    SubjectId,
    SubjectKind,
    EvidenceJson,
    Severity,
    Status,
    CreatedAt,
    ResolvedAt,
}

#[derive(Iden)]
enum CustomMcpServers {
    Table,
    Id,
    ProjectId,
    OwnerAgentId,
    Name,
    Slug,
    SourceApiUrl,
    SourceApiSpecJson,
    GeneratedManifestJson,
    GeneratedHandlerCode,
    Transport,
    EncryptedCredentials,
    Status,
    Reusable,
    CapabilitiesJson,
    EmbeddingJson,
    CreatedAt,
    UpdatedAt,
}

#[derive(Iden)]
enum AgentSpawnRequests {
    Table,
    Id,
    ProjectId,
    ParentAgentId,
    RequestedRole,
    RequestedCapabilitiesJson,
    ContextJson,
    McpStrategy,
    Status,
    ChildAgentId,
    DiscoveredApiJson,
    MatchedExistingMcpIdsJson,
    SynthesizedMcpIdsJson,
    GeneratedSystemPrompt,
    Error,
    CreatedAt,
    UpdatedAt,
    CompletedAt,
}

#[derive(Iden)]
enum AgentMcpBindings {
    Table,
    Id,
    AgentId,
    McpServerId,
    Kind,
    CreatedAt,
}

#[derive(Iden)]
enum Projects {
    Table,
    Id,
}

#[derive(Iden)]
enum Agents {
    Table,
    Id,
}

#[derive(Iden)]
enum Tasks {
    Table,
    Id,
    SpecSectionId,
    DueAt,
    LastProgressAt,
}
