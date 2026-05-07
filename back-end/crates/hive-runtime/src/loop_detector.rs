//! Background daemon that scans recent `agent_messages` per agent
//! and inserts a `loop_detected` notification when the same
//! `(tool, args)` fingerprint repeats ≥4 times within a sliding
//! 5-minute window.
//!
//! Idempotent: if a `loop_detected` notification with the same
//! fingerprint exists for the agent within the last 5 minutes, the
//! producer skips inserting another. The frontend modal renders the
//! `payload` JSON shape directly (samples + probable cause) so the
//! daemon's job is to assemble that payload, not to rely on a
//! string-formatted message.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::time::Duration;

use chrono::{DateTime, Utc};
use hive_db::{
    repos::{agent_messages, agents, notifications},
    Db,
};
use serde_json::{json, Value};
use tokio::time::interval;

use crate::events::EventBus;

const SCAN_INTERVAL: Duration = Duration::from_secs(30);
const WINDOW_SECS: i64 = 300;
const REPEAT_THRESHOLD: usize = 4;
const NOTIFICATION_TYPE: &str = "loop_detected";
const PER_AGENT_FETCH: u64 = 30;

/// Spawn the detector as a tokio task. The handle is intentionally
/// dropped — the task lives for the process lifetime and is aborted
/// at shutdown when the runtime is dropped.
pub fn spawn(db: Db, bus: EventBus) {
    tokio::spawn(async move { run(db, bus).await });
}

async fn run(db: Db, bus: EventBus) {
    let mut ticker = interval(SCAN_INTERVAL);
    // First tick fires immediately; skip it so boot doesn't race the
    // initial seed inserts.
    ticker.tick().await;
    loop {
        ticker.tick().await;
        if let Err(err) = scan_once(&db, &bus).await {
            tracing::warn!(?err, "loop_detector scan failed");
        }
    }
}

async fn scan_once(db: &Db, bus: &EventBus) -> Result<(), sea_orm::DbErr> {
    let all_agents = agents::list_all(db.conn()).await?;
    for agent in all_agents {
        if agent.status == "deprecated" {
            continue;
        }
        let messages = agent_messages::list_by_agent(db.conn(), &agent.id, PER_AGENT_FETCH).await?;
        if messages.len() < REPEAT_THRESHOLD {
            continue;
        }
        if let Some(payload) = detect_loop(&agent.id, &agent.name, &agent.project_id, &messages) {
            insert_notification_if_new(db, bus, payload).await?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct LoopPayload {
    project_id: String,
    agent_id: String,
    agent_name: String,
    fingerprint: String,
    occurrences: usize,
    samples: Vec<LoopSample>,
    probable_cause: String,
}

#[derive(Debug, Clone)]
struct LoopSample {
    occurred_at: String,
    tool: String,
    description: String,
}

/// Extract the first `tool_use` call from a row's `tool_calls` JSON
/// blob and produce a stable fingerprint over `(tool_name, args)`.
fn tool_fingerprint(tool_calls: &Value) -> Option<(String, String, String)> {
    let calls = tool_calls.as_array()?;
    let first = calls.iter().find(|c| c.is_object())?;
    let name = first.get("name").and_then(Value::as_str)?.to_owned();
    let args = first.get("args").cloned().unwrap_or(Value::Null);
    let canon = canonical_json(&args);
    let mut hasher = DefaultHasher::new();
    name.hash(&mut hasher);
    canon.hash(&mut hasher);
    let fp = format!("{:016x}", hasher.finish());
    let description = if canon.len() > 80 {
        format!("{}…", &canon[..80])
    } else {
        canon
    };
    Some((fp, name, description))
}

/// Sort object keys recursively so equal-meaning JSON gets equal
/// strings. Plenty good enough for fingerprinting; not a canonical
/// JSON spec implementation.
fn canonical_json(v: &Value) -> String {
    fn walk(v: &Value, out: &mut String) {
        match v {
            Value::Null => out.push_str("null"),
            Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Value::Number(n) => out.push_str(&n.to_string()),
            Value::String(s) => {
                out.push('"');
                out.push_str(&s.replace('"', "\\\""));
                out.push('"');
            }
            Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    walk(item, out);
                }
                out.push(']');
            }
            Value::Object(map) => {
                let mut keys: Vec<_> = map.keys().collect();
                keys.sort();
                out.push('{');
                for (i, k) in keys.into_iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push('"');
                    out.push_str(k);
                    out.push_str("\":");
                    walk(map.get(k).unwrap(), out);
                }
                out.push('}');
            }
        }
    }
    let mut s = String::new();
    walk(v, &mut s);
    s
}

fn detect_loop(
    agent_id: &str,
    agent_name: &str,
    project_id: &str,
    messages: &[hive_db::entities::agent_message::Model],
) -> Option<LoopPayload> {
    let now = Utc::now();
    // Group recent messages by fingerprint within the sliding window.
    let mut by_fingerprint: HashMap<String, (String, Vec<LoopSample>)> = HashMap::new();
    for msg in messages {
        let occurred = match DateTime::parse_from_rfc3339(&msg.created_at) {
            Ok(dt) => dt.with_timezone(&Utc),
            Err(_) => continue,
        };
        if (now - occurred).num_seconds() > WINDOW_SECS {
            continue;
        }
        let Some((fp, tool, description)) = tool_fingerprint(&msg.tool_calls) else {
            continue;
        };
        by_fingerprint
            .entry(fp.clone())
            .or_insert_with(|| (tool.clone(), Vec::new()))
            .1
            .push(LoopSample {
                occurred_at: msg.created_at.clone(),
                tool,
                description,
            });
    }
    // Keep only fingerprints whose sample count crossed the threshold.
    let (fp, (_, samples)) = by_fingerprint
        .into_iter()
        .filter(|(_, (_, v))| v.len() >= REPEAT_THRESHOLD)
        .max_by_key(|(_, (_, v))| v.len())?;
    let occurrences = samples.len();
    let probable_cause = guess_cause(messages, &samples);
    Some(LoopPayload {
        project_id: project_id.to_owned(),
        agent_id: agent_id.to_owned(),
        agent_name: agent_name.to_owned(),
        fingerprint: fp,
        occurrences,
        // Cap to the 6 most recent for the modal.
        samples: samples.into_iter().rev().take(6).collect(),
        probable_cause,
    })
}

fn guess_cause(
    messages: &[hive_db::entities::agent_message::Model],
    samples: &[LoopSample],
) -> String {
    let recent_errors = messages
        .iter()
        .take(REPEAT_THRESHOLD)
        .filter(|m| m.status == "error")
        .count();
    if recent_errors >= REPEAT_THRESHOLD - 1 {
        return "Recent calls returned errors; the tool may be failing or rate-limited.".into();
    }
    let unique_descriptions = samples
        .iter()
        .map(|s| s.description.as_str())
        .collect::<std::collections::HashSet<_>>()
        .len();
    if unique_descriptions <= 1 {
        return "Identical arguments on every call; the agent may need to vary its inputs.".into();
    }
    "The agent appears stuck on a single tool. Consider pausing and clarifying the task.".into()
}

async fn insert_notification_if_new(
    db: &Db,
    bus: &EventBus,
    payload: LoopPayload,
) -> Result<(), sea_orm::DbErr> {
    // De-dup: if a loop_detected notification with the same fingerprint
    // exists in the last 5 minutes, skip.
    let existing = notifications::list_all(db.conn()).await?;
    let now = Utc::now();
    let fingerprint_already_open = existing.iter().any(|n| {
        if n.r#type != NOTIFICATION_TYPE {
            return false;
        }
        let Some(p) = n.payload.as_ref() else {
            return false;
        };
        let same_fp = p
            .get("fingerprint")
            .and_then(Value::as_str)
            .map(|fp| fp == payload.fingerprint)
            .unwrap_or(false);
        if !same_fp {
            return false;
        }
        let Ok(created) = DateTime::parse_from_rfc3339(&n.created_at) else {
            return false;
        };
        (now - created.with_timezone(&Utc)).num_seconds() < WINDOW_SECS
    });
    if fingerprint_already_open {
        return Ok(());
    }
    let json_payload = json!({
        "agentId": payload.agent_id,
        "agentName": payload.agent_name,
        "fingerprint": payload.fingerprint,
        "occurrences": payload.occurrences,
        "probableCause": payload.probable_cause,
        "samples": payload.samples.iter().map(|s| json!({
            "occurredAt": s.occurred_at,
            "tool": s.tool,
            "description": s.description,
        })).collect::<Vec<_>>(),
    });
    let title = format!(
        "{} repeated {} {} times",
        payload.agent_name,
        payload
            .samples
            .first()
            .map(|s| s.tool.as_str())
            .unwrap_or("a tool"),
        payload.occurrences
    );
    let message =
        "The loop detector noticed a repeated tool pattern. Review and resolve.".to_string();
    notifications::create(
        db.conn(),
        notifications::CreateNotification {
            project_id: Some(payload.project_id.clone()),
            r#type: NOTIFICATION_TYPE.into(),
            title,
            message,
            actionable: true,
            action_label: Some("Review".into()),
            payload: Some(json_payload.clone()),
        },
    )
    .await?;
    bus.emit(
        "notification.created",
        json!({
            "projectId": payload.project_id,
            "type": NOTIFICATION_TYPE,
            "payload": json_payload,
        }),
    );
    Ok(())
}
