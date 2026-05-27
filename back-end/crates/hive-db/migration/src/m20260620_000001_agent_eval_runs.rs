//! `agent_eval_runs` — D1 eval pipeline. Each row is one scoring pass over an
//! agent's recent work, producing a 0-100 score per metric. The Stats
//! leaderboard reads the latest run per agent; the history enables a
//! per-agent trend view later. Distinct from the `agents.quality_score` /
//! `agents.eval_scores` columns (those hold the *current* snapshot — the
//! `record_eval` tool updates both: a fresh run row here + the snapshot
//! columns so the existing leaderboard reflects it without a join).

use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260620_000001_agent_eval_runs"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AgentEvalRuns::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AgentEvalRuns::Id)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AgentEvalRuns::ProjectId).string().not_null())
                    .col(ColumnDef::new(AgentEvalRuns::AgentId).string().not_null())
                    // `evaluator` records who produced the score:
                    // `agent:<id>` (a judge agent), `system` (an automated
                    // post-sprint pass), or `operator` (manual).
                    .col(ColumnDef::new(AgentEvalRuns::Evaluator).string().not_null())
                    // Per-metric 0-100 scores stored as a JSON object so a
                    // future metric doesn't need a migration. Keys:
                    // correctness, style, efficiency, testQuality, docQuality.
                    .col(ColumnDef::new(AgentEvalRuns::ScoresJson).json().not_null())
                    // The aggregate 0-100 the leaderboard sorts on — the
                    // mean of the present metric scores, stored so the
                    // sort doesn't recompute it on every read.
                    .col(
                        ColumnDef::new(AgentEvalRuns::OverallScore)
                            .integer()
                            .not_null(),
                    )
                    // How many work items (tasks / turns / diffs) this run
                    // looked at. 0 = unknown.
                    .col(
                        ColumnDef::new(AgentEvalRuns::SampleSize)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(ColumnDef::new(AgentEvalRuns::Notes).string().null())
                    .col(ColumnDef::new(AgentEvalRuns::CreatedAt).string().not_null())
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentEvalRuns::Table, AgentEvalRuns::ProjectId)
                            .to(Projects::Table, Projects::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .from(AgentEvalRuns::Table, AgentEvalRuns::AgentId)
                            .to(Agents::Table, Agents::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_agent_eval_runs_project")
                    .table(AgentEvalRuns::Table)
                    .col(AgentEvalRuns::ProjectId)
                    .to_owned(),
            )
            .await?;
        manager
            .create_index(
                Index::create()
                    .name("idx_agent_eval_runs_agent")
                    .table(AgentEvalRuns::Table)
                    .col(AgentEvalRuns::AgentId)
                    .col(AgentEvalRuns::CreatedAt)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AgentEvalRuns::Table).to_owned())
            .await
    }
}

#[derive(Iden, Clone, Copy)]
enum AgentEvalRuns {
    Table,
    Id,
    ProjectId,
    AgentId,
    Evaluator,
    ScoresJson,
    OverallScore,
    SampleSize,
    Notes,
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
