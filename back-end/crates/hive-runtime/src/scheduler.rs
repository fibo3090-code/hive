//! W3-B3 — autonomous task scheduler.
//!
//! Without this, agents only act when a human pings them in the chat or
//! another agent A2A-messages them. The product promise of "supervise, not
//! pilot" requires the runtime to *itself* notice "agent X is idle and has
//! task Y assigned — go work on Y".
//!
//! Single global tick (every [`SCHEDULER_TICK`]). On each tick the
//! scheduler:
//!
//! 1. Lists every project that currently has an active session — projects
//!    whose operator turned the toggle OFF are skipped (no autonomous
//!    work behind the operator's back).
//! 2. For each such project, lists agents whose status is `idle` and
//!    whose currently-assigned task (`agent_task_assignments` state =
//!    `started` or `assigned`) is still in a non-terminal task status
//!    (`pending` / `in-progress` / `queued`).
//! 3. For the highest-priority such pairing per agent, enqueues an
//!    `agent_messages` row whose content is a short prompt asking the
//!    agent to make progress on that task, and dispatches it to the
//!    agent's executor — mirroring `dispatch_to_agent` in hive-api.
//!
//! De-duplication: the scheduler asks the executor for a state snapshot
//! before dispatching. If the executor isn't `Idle`, the dispatch is
//! skipped — that turn will land naturally when the previous one
//! finishes.
//!
//! Best-effort throughout: any DB error inside the tick is logged and the
//! loop continues. The operator's expectation is that they will see *some*
//! autonomous activity, not that every tick succeeds.

use std::{sync::Arc, time::Duration};

use hive_db::{
    repos::{
        agent_messages, agent_task_assignments, agents, projects, sessions, settings,
        sprint_dependencies, task_dependencies, tasks,
    },
    Db,
};
use serde_json::json;
use tokio::task::JoinHandle;

use crate::{
    events::EventBus,
    executor::{ExecutorState, InboxItem},
    registry::ExecutorRegistry,
};

/// Tick cadence. Short enough that newly-idle agents pick up work within
/// a few seconds; long enough that the DB churn stays trivial.
pub const SCHEDULER_TICK: Duration = Duration::from_secs(5);

/// Default `max parallel agents` per project when the operator hasn't
/// set one. Matches the onboarding slider's default so the platform
/// behaviour and the visible slider value agree.
pub const DEFAULT_MAX_PARALLEL_AGENTS: u64 = 4;

/// Settings key the operator-facing slider writes to. Read per project
/// scope first, then fall back to the global scope, then the default.
const MAX_PARALLEL_KEY: &str = "runtime.maxParallelAgents";

/// Spawn the scheduler. The returned handle aborts the loop on drop, so
/// callers (typically `hive-api::serve`) should hold onto it for the
/// lifetime of the process.
pub fn spawn(db: Db, bus: EventBus, executors: Arc<ExecutorRegistry>) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Skip the immediate first tick so that other startup work
        // (driver registration, settings load, orphan sweep) gets a
        // chance to complete before we start dispatching.
        let mut ticker = tokio::time::interval(SCHEDULER_TICK);
        ticker.tick().await;
        loop {
            ticker.tick().await;
            if let Err(err) = tick_once(&db, &bus, &executors).await {
                tracing::warn!(error = %err, "scheduler: tick failed");
            }
        }
    })
}

async fn tick_once(
    db: &Db,
    bus: &EventBus,
    executors: &Arc<ExecutorRegistry>,
) -> Result<(), sea_orm::DbErr> {
    let projects_list = projects::list(db.conn()).await?;

    for project in projects_list {
        // Operator-controlled gate: an inactive session means "do not
        // touch my project autonomously". Most projects in a demo seed
        // will have no active session, which is the right default — the
        // operator opts in by toggling the session on.
        let session_active = sessions::get_active_by_project(db.conn(), &project.id)
            .await
            .ok()
            .flatten()
            .map(|s| s.is_active)
            .unwrap_or(false);
        if !session_active {
            continue;
        }

        let agents = match agents::list_by_project(db.conn(), &project.id).await {
            Ok(rows) => rows,
            Err(err) => {
                tracing::warn!(project_id = %project.id, error = %err, "scheduler: agents list failed");
                continue;
            }
        };

        // Read the per-project / global cap once per tick so a config
        // change lands on the next 5s pass.
        let cap = read_max_parallel(db, &project.id).await;
        let mut in_flight = match agent_task_assignments::count_active_for_project(
            db.conn(),
            &project.id,
        )
        .await
        {
            Ok(n) => n,
            Err(err) => {
                tracing::warn!(project_id = %project.id, error = %err, "scheduler: active count failed");
                continue;
            }
        };

        for agent in agents {
            if agent.status != "idle" {
                continue;
            }
            if in_flight >= cap {
                // Cap reached. Don't dispatch more this tick; the next
                // tick will re-check after any in-flight turns settle.
                tracing::debug!(
                    project_id = %project.id,
                    cap,
                    in_flight,
                    "scheduler: max_parallel_agents reached, deferring"
                );
                break;
            }
            if dispatch_one_task_if_any(db, bus, executors, &project.id, &agent.id).await {
                in_flight += 1;
            }
        }
    }
    Ok(())
}

/// Read `runtime.maxParallelAgents` from the per-project scope first,
/// then the global scope, then fall back to `DEFAULT_MAX_PARALLEL_AGENTS`.
async fn read_max_parallel(db: &Db, project_id: &str) -> u64 {
    let project_scope = format!("project:{project_id}");
    for scope in [project_scope.as_str(), "global"] {
        if let Ok(Some(v)) = settings::get_value(db.conn(), scope, MAX_PARALLEL_KEY).await {
            if let Some(n) = v.as_u64() {
                if n > 0 {
                    return n;
                }
            }
        }
    }
    DEFAULT_MAX_PARALLEL_AGENTS
}

/// For one agent: pick its most-relevant non-terminal assignment whose
/// task is still pending, build an inbox item, dispatch.
///
/// Returns `true` if a dispatch landed (the caller increments the
/// in-flight counter against the project's `max_parallel_agents` cap),
/// `false` if no dispatch happened (no work, executor busy, etc.).
async fn dispatch_one_task_if_any(
    db: &Db,
    bus: &EventBus,
    executors: &Arc<ExecutorRegistry>,
    project_id: &str,
    agent_id: &str,
) -> bool {
    let assignments = match agent_task_assignments::list_for_agent(db.conn(), agent_id).await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(agent_id, error = %err, "scheduler: assignments list failed");
            return false;
        }
    };

    for assignment in assignments {
        // Skip assignments the agent or coordinator has already closed.
        let state = assignment.state.as_str();
        if matches!(
            state,
            "completed" | "cancelled" | "aborted" | "paused" | "finished" | "blocked"
        ) {
            continue;
        }

        let Some(task) = tasks::get(db.conn(), &assignment.task_id)
            .await
            .ok()
            .flatten()
        else {
            continue;
        };
        if matches!(task.status.as_str(), "completed" | "cancelled") {
            continue;
        }
        if !task_is_unlocked(db, project_id, &task).await {
            continue;
        }

        // De-dupe against an executor that's already burning the previous
        // dispatch. The scheduler is best-effort, not a "shove every tick"
        // mechanism — back off and try again next tick.
        let executor_state = executors.state(agent_id).await;
        if matches!(executor_state, Some(ExecutorState::Running)) {
            return false;
        }

        // Stamp the assignment's `started_at` on first dispatch so the
        // UI / drift hook / metrics see a real "work began" timestamp.
        // Idempotent: `update` only writes when `started_at` is Some.
        if assignment.started_at.is_none() {
            let _ = agent_task_assignments::update(
                db.conn(),
                &assignment.id,
                agent_task_assignments::UpdateAssignment {
                    state: Some("in-progress".into()),
                    started_at: Some(chrono::Utc::now().to_rfc3339()),
                    ..Default::default()
                },
            )
            .await;
        }

        dispatch_for_task(db, bus, executors, project_id, agent_id, &task).await;
        // One dispatch per tick per agent — keep parallelism flat and
        // give the previous turn time to actually do something.
        return true;
    }
    false
}

async fn task_is_unlocked(
    db: &Db,
    project_id: &str,
    task: &hive_db::entities::task::Model,
) -> bool {
    let all_tasks = match tasks::list_by_project(db.conn(), project_id).await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(project_id, error = %err, "scheduler: tasks list failed for dependency check");
            return false;
        }
    };
    let completed_task_ids = all_tasks
        .iter()
        .filter(|t| t.status == "completed")
        .map(|t| t.id.as_str())
        .collect::<std::collections::HashSet<_>>();

    if let Ok(edges) = task_dependencies::list_by_project(db.conn(), project_id).await {
        for edge in edges.iter().filter(|edge| edge.to_task_id == task.id) {
            if !completed_task_ids.contains(edge.from_task_id.as_str()) {
                return false;
            }
        }
    }

    let Some(sprint_id) = task.sprint_id.as_deref() else {
        return true;
    };
    let sprint_edges = match sprint_dependencies::list_by_project(db.conn(), project_id).await {
        Ok(rows) => rows,
        Err(err) => {
            tracing::warn!(project_id, error = %err, "scheduler: sprint dependencies list failed");
            return false;
        }
    };
    for edge in sprint_edges
        .iter()
        .filter(|edge| edge.to_sprint_id == sprint_id)
    {
        let upstream_tasks = all_tasks
            .iter()
            .filter(|candidate| {
                candidate.sprint_id.as_deref() == Some(edge.from_sprint_id.as_str())
            })
            .collect::<Vec<_>>();
        if upstream_tasks
            .iter()
            .any(|candidate| candidate.status != "completed")
        {
            return false;
        }
    }
    true
}

async fn dispatch_for_task(
    db: &Db,
    bus: &EventBus,
    executors: &Arc<ExecutorRegistry>,
    project_id: &str,
    agent_id: &str,
    task: &hive_db::entities::task::Model,
) {
    let prompt = build_autonomous_prompt(task);

    let msg = match agent_messages::enqueue(
        db.conn(),
        agent_messages::EnqueueAgentMessage {
            project_id: project_id.to_owned(),
            to_agent_id: agent_id.to_owned(),
            from_agent_id: None, // None = autonomous (scheduler), not A2A
            content: prompt,
            thread_id: None,
            reply_to_message_id: None,
        },
    )
    .await
    {
        Ok(model) => model,
        Err(err) => {
            tracing::warn!(agent_id, task_id = %task.id, error = %err, "scheduler: enqueue failed");
            return;
        }
    };

    let _ = executors.ensure(agent_id, project_id).await;
    if let Err(err) = executors
        .dispatch(
            agent_id,
            InboxItem {
                message_id: msg.id.clone(),
                content: msg.content.clone(),
                thread_id: None,
                from_agent_id: None,
            },
        )
        .await
    {
        tracing::warn!(agent_id, task_id = %task.id, error = %err, "scheduler: dispatch failed");
        return;
    }

    bus.emit(
        "task.autoDispatched",
        json!({
            "projectId": project_id,
            "agentId": agent_id,
            "taskId": task.id,
            "messageId": msg.id,
        }),
    );
}

/// The prompt the agent sees when the scheduler picks it. Plain text and
/// short on purpose — the agent already has its system prompt + tool
/// catalog from the four-layer composer.
fn build_autonomous_prompt(task: &hive_db::entities::task::Model) -> String {
    let mut prompt = format!(
        "Make progress on your assigned task.\n\nTask ID: {}\nTitle: {}",
        task.id,
        task.title.trim()
    );
    if let Some(phase) = task.phase.as_deref() {
        prompt.push_str(&format!("\nPhase: {}", phase.trim()));
    }
    prompt.push_str(
        "\n\nIf the task is complete, use the status tool with this task id to mark it completed and include a short summary. If blocked, mark it blocked with the blocker. Otherwise, do the next concrete unit of work toward completion.",
    );
    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_task(title: &str, phase: Option<&str>) -> hive_db::entities::task::Model {
        hive_db::entities::task::Model {
            id: "task-fake".into(),
            project_id: "proj".into(),
            agent_id: Some("ag".into()),
            title: title.into(),
            status: "pending".into(),
            phase: phase.map(str::to_owned),
            sprint_id: None,
            priority: "medium".into(),
            estimated_tokens: 0,
            created_at: "now".into(),
            updated_at: "now".into(),
            completed_at: None,
            deleted_at: None,
            spec_section_id: None,
            due_at: None,
            last_progress_at: None,
            graph_level: 0,
            graph_order: 0,
        }
    }

    #[test]
    fn prompt_includes_task_title_and_phase_when_present() {
        let task = fake_task("Implement OAuth callback", Some("Sprint 3"));
        let prompt = build_autonomous_prompt(&task);
        assert!(prompt.contains("Implement OAuth callback"));
        assert!(prompt.contains("task-fake"));
        assert!(prompt.contains("Sprint 3"));
        assert!(prompt.contains("mark it completed"));
    }

    #[test]
    fn prompt_omits_phase_section_when_absent() {
        let task = fake_task("Wire dark-mode toggle", None);
        let prompt = build_autonomous_prompt(&task);
        assert!(prompt.contains("Wire dark-mode toggle"));
        assert!(!prompt.contains("Phase:"));
    }

    #[test]
    fn scheduler_tick_is_short_enough_for_human_feedback_loop() {
        // 5s gives "the operator sees autonomous work start within a few
        // seconds of toggling the session" — anything above ~10s makes
        // the UI feel stalled on first impressions.
        assert!(SCHEDULER_TICK.as_secs() <= 10);
        assert!(SCHEDULER_TICK.as_secs() >= 1);
    }

    #[tokio::test]
    async fn max_parallel_falls_back_to_default_when_unset() {
        let db = Db::connect("sqlite::memory:", true).await.expect("connect");
        let cap = read_max_parallel(&db, "any-project").await;
        assert_eq!(cap, DEFAULT_MAX_PARALLEL_AGENTS);
    }

    #[tokio::test]
    async fn max_parallel_reads_project_scope_first() {
        use hive_db::repos::settings;
        let db = Db::connect("sqlite::memory:", true).await.expect("connect");
        // Global says 2, project says 5 — project should win.
        settings::put_value(db.conn(), "global", MAX_PARALLEL_KEY, json!(2))
            .await
            .expect("put global");
        settings::put_value(db.conn(), "project:p1", MAX_PARALLEL_KEY, json!(5))
            .await
            .expect("put project");
        assert_eq!(read_max_parallel(&db, "p1").await, 5);
        // Different project: falls through to global.
        assert_eq!(read_max_parallel(&db, "p2").await, 2);
    }
}
