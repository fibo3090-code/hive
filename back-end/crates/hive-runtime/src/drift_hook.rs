//! W3-B5 — automatic drift detection after each agent turn.
//!
//! The scorers in [`crate::drift`] are pure logic and are unit-tested in
//! isolation. This module is the runtime side: after every successful
//! agent turn, [`record_after_turn`] looks up the agent's current task,
//! tokenises the task title against the artifacts the turn actually
//! touched (file paths, tool names, shell argv), scores the gap, and —
//! when the score crosses a threshold — writes a [`DriftEvent`] row,
//! creates an alert/notification at higher severity, and pauses the agent
//! at the highest band.
//!
//! Three explicit bands map raw scores → operator-visible reactions:
//!
//! | score    | severity | side-effects                                           |
//! |----------|----------|--------------------------------------------------------|
//! | < 0.4    | low      | nothing — the assignment's `drift_score` is updated    |
//! | 0.4–0.69 | medium   | `drift_events` row only                                |
//! | 0.7–0.89 | high     | `drift_events` + `alerts` + `notifications`            |
//! | ≥ 0.9    | high     | all of the above + `agents::set_status(paused)`        |
//!
//! The thresholds match the bands in [`crate::drift::DriftSeverity`].
//! Everything is best-effort: a DB error inside the hook is logged but
//! never bubbles up to fail the turn the operator already saw complete.

use hive_db::{
    repos::{
        agent_task_assignments, agents, alerts, drift_events,
        notifications::{self, CreateNotification},
        tasks,
    },
    Db,
};
use serde_json::{json, Value};

use crate::{
    drift::{score_task_drift, DriftSeverity, TaskDriftInput},
    events::EventBus,
};

/// Pause the agent above this score. Distinct from severity-High because
/// "drifted a bit" shouldn't yank an operator's attention.
const PAUSE_THRESHOLD: f32 = 0.9;

/// Don't even update assignment.drift_score for very small drift — keeps
/// the UI's "drifting" badge from flickering on benign turns.
const RECORD_THRESHOLD: f32 = 0.4;

/// Compute drift for an agent's most-recent in-progress assignment and
/// react per the band table at the top of this module. `executed_calls`
/// is the same `Vec<Value>` that `chat::run_turn_inner` already maintains
/// — each entry is `{tool, arguments, result, request}`.
pub async fn record_after_turn(
    db: &Db,
    bus: &EventBus,
    project_id: &str,
    agent_id: &str,
    executed_calls: &[Value],
) {
    let result = inner(db, bus, project_id, agent_id, executed_calls).await;
    if let Err(err) = result {
        // Never poison the caller — the operator already saw the turn complete.
        tracing::warn!(
            project_id, agent_id, error = %err,
            "drift_hook: skipped (best-effort failure)"
        );
    }
}

async fn inner(
    db: &Db,
    bus: &EventBus,
    project_id: &str,
    agent_id: &str,
    executed_calls: &[Value],
) -> Result<(), sea_orm::DbErr> {
    // Pick the most-recent non-terminal assignment for this agent. We
    // skip drift entirely when the agent has no live task: nothing to
    // measure deviation *from*.
    let mut assignments = agent_task_assignments::list_for_agent(db.conn(), agent_id).await?;
    assignments.retain(|a| {
        let s = a.state.as_str();
        s != "completed" && s != "cancelled" && s != "aborted"
    });
    let Some(assignment) = assignments.into_iter().next() else {
        return Ok(());
    };

    let Some(task) = tasks::get(db.conn(), &assignment.task_id).await? else {
        return Ok(());
    };

    let expected = expected_artifacts_from_task(&task.title);
    let touched = touched_artifacts_from_calls(executed_calls);

    let score = score_task_drift(TaskDriftInput {
        expected_artifacts: &expected,
        touched_artifacts: &touched,
    });

    // Always persist the score onto the assignment — even when low, the
    // Planning UI shows the bar moving so the operator can see the agent
    // staying on-track.
    let _ = agent_task_assignments::update(
        db.conn(),
        &assignment.id,
        agent_task_assignments::UpdateAssignment {
            drift_score: Some(score.score as f64),
            ..Default::default()
        },
    )
    .await;

    if score.score < RECORD_THRESHOLD {
        return Ok(());
    }

    let severity_key = score.severity.as_key();
    let event = drift_events::create(
        db.conn(),
        drift_events::CreateDriftEvent {
            project_id: project_id.to_owned(),
            kind: "agent-vs-task".to_owned(),
            subject_id: agent_id.to_owned(),
            subject_kind: "agent".to_owned(),
            evidence_json: json!({
                "taskId": task.id,
                "taskTitle": task.title,
                "score": score.score,
                "severity": severity_key,
                "details": score.evidence,
            }),
            severity: severity_key.to_owned(),
        },
    )
    .await?;

    bus.emit(
        "drift.detected",
        json!({
            "projectId": project_id,
            "agentId": agent_id,
            "taskId": task.id,
            "severity": severity_key,
            "score": score.score,
            "eventId": event.id,
        }),
    );

    // High severity → operator-visible alert + notification.
    if matches!(score.severity, DriftSeverity::High) {
        let title = "Agent drifting from its task";
        let msg = format!(
            "Drift score {:.2} on task \"{}\". The agent's recent actions don't cover the task's expected artifacts.",
            score.score, task.title
        );
        let _ = alerts::create(
            db.conn(),
            alerts::CreateAlert {
                project_id: project_id.to_owned(),
                severity: "high".to_owned(),
                title: title.to_owned(),
                message: msg.clone(),
                source: format!("drift:{agent_id}"),
                action_label: Some("Review".to_owned()),
                action_kind: Some("review".to_owned()),
            },
        )
        .await;
        let _ = notifications::create(
            db.conn(),
            CreateNotification {
                project_id: Some(project_id.to_owned()),
                r#type: "high".to_owned(),
                title: title.to_owned(),
                message: msg,
                actionable: true,
                action_label: Some("Open Drift".to_owned()),
                payload: Some(json!({
                    "kind": "drift",
                    "agentId": agent_id,
                    "taskId": task.id,
                    "driftEventId": event.id,
                })),
            },
        )
        .await;
    }

    // Top band → also pause the agent so it stops piling up wrong work.
    if score.score >= PAUSE_THRESHOLD {
        if let Err(err) = agents::set_status(db.conn(), project_id, agent_id, "paused").await {
            tracing::warn!(project_id, agent_id, error = %err, "drift_hook: pause failed");
        } else {
            bus.emit(
                "agent.status",
                json!({
                    "projectId": project_id,
                    "agentId": agent_id,
                    "status": "paused",
                    "reason": "drift_auto_pause",
                }),
            );
        }
    }

    Ok(())
}

/// Tokens the task title declared. Used to score how much the agent's
/// actions actually covered. The `tokenise_set` inside [`crate::drift`]
/// already splits on non-alphanumeric, so passing the raw title (and the
/// optional `phase` / `spec_section_id`) is enough.
fn expected_artifacts_from_task(title: &str) -> Vec<String> {
    vec![title.to_owned()]
}

/// Extract a flat list of "what did this turn touch" from the tool calls
/// the LLM made. We feed both the tool *name* (so the score reflects
/// whether the agent used the right kind of action) and any `path` /
/// `command` argument (so file-level coverage is measured too).
fn touched_artifacts_from_calls(executed: &[Value]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for call in executed {
        if let Some(name) = call.get("tool").and_then(Value::as_str) {
            out.push(name.to_owned());
        }
        if let Some(args) = call.get("arguments") {
            push_path_like(&mut out, args);
        }
    }
    out
}

/// Walk a JSON arguments blob and collect anything that *looks* like a
/// file path or a shell command word. The scoring function is
/// punctuation-aware (see `tokenise_set` in `drift.rs`), so we don't need
/// exact-match here — passing the raw strings is enough.
fn push_path_like(sink: &mut Vec<String>, v: &Value) {
    match v {
        Value::String(s) => sink.push(s.clone()),
        Value::Array(items) => items.iter().for_each(|it| push_path_like(sink, it)),
        Value::Object(map) => {
            for (k, val) in map {
                if matches!(
                    k.as_str(),
                    "path" | "paths" | "file" | "files" | "command" | "cmd" | "args" | "url"
                ) {
                    push_path_like(sink, val);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn touched_artifacts_extracts_tool_name_and_path() {
        let calls = vec![json!({
            "tool": "fs_write",
            "arguments": { "path": "src/payments.rs", "content": "..." },
        })];
        let touched = touched_artifacts_from_calls(&calls);
        assert!(touched.contains(&"fs_write".to_owned()));
        assert!(touched.contains(&"src/payments.rs".to_owned()));
        // The content blob is *not* surfaced — only path-like fields.
        assert!(!touched.iter().any(|s| s == "..."));
    }

    #[test]
    fn touched_artifacts_walks_shell_argv() {
        let calls = vec![json!({
            "tool": "shell_exec",
            "arguments": {
                "command": "cargo",
                "args": ["build", "--release"],
            },
        })];
        let touched = touched_artifacts_from_calls(&calls);
        assert!(touched.contains(&"shell_exec".to_owned()));
        assert!(touched.contains(&"cargo".to_owned()));
        assert!(touched.contains(&"--release".to_owned()));
    }

    #[test]
    fn touched_artifacts_ignores_unrelated_object_fields() {
        let calls = vec![json!({
            "tool": "fs_read",
            "arguments": {
                "path": "README.md",
                "secret_token": "ABC123",
            },
        })];
        let touched = touched_artifacts_from_calls(&calls);
        assert!(touched.contains(&"README.md".to_owned()));
        assert!(!touched.iter().any(|s| s.contains("ABC123")));
    }

    #[test]
    fn record_threshold_matches_severity_band() {
        // The constants document the same boundary as DriftSeverity::Medium.
        assert_eq!(RECORD_THRESHOLD, 0.4);
        assert!(matches!(
            DriftSeverity::from_score(RECORD_THRESHOLD),
            DriftSeverity::Medium
        ));
    }

    #[test]
    fn pause_threshold_is_strictly_above_high_band() {
        // 0.9 sits inside the High band; "pause" is reserved for *very*
        // drifted, not merely high. The const-comparison is enforced at
        // compile-time via the const block below; the runtime check uses
        // the score → severity mapping so any future re-banding is caught.
        const _: () = assert!(PAUSE_THRESHOLD > 0.7);
        assert!(matches!(
            DriftSeverity::from_score(PAUSE_THRESHOLD),
            DriftSeverity::High
        ));
    }
}
