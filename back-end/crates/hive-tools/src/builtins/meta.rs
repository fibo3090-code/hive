//! Meta-tools that don't touch the workspace: `think` (silent scratchpad)
//! and `task_complete` (clean termination signal).
//!
//! Both are zero-side-effect from the system's point of view but unblock
//! significant accuracy gains for small / non-reasoning models. `think`
//! gives them an explicit working-memory step before committing to a tool;
//! `task_complete` gives the turn loop an unambiguous "I'm done" signal
//! so the model doesn't fall into elaboration loops.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

// ── think ────────────────────────────────────────────────────────────────

pub struct ThinkTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThinkArgs {
    thought: String,
}

#[async_trait]
impl Tool for ThinkTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "think".into(),
            description: "Write a free-form thought to your private scratchpad without \
                taking any external action. Use this to plan, reflect, weigh options, or \
                compress earlier observations before deciding what to do next — \
                especially useful for smaller models that don't have a built-in \
                reasoning channel. The thought is NOT visible to the user and does NOT \
                change any state; it is purely for your own working memory. \
                Do NOT use this to ask the user a question — produce a normal assistant \
                message for that. Do NOT use this when you already know what to do — \
                call the relevant tool directly instead."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "thought": {
                        "type": "string",
                        "description": "Free-form private reasoning. Will be logged but not shown to the user.",
                    },
                },
                "required": ["thought"],
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: ThinkArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        tracing::debug!(
            agent_id = ctx.agent_id.as_deref().unwrap_or("unknown"),
            project_id = %ctx.project_id,
            thought_len = args.thought.len(),
            "think: agent scratchpad"
        );
        Ok(json!({
            "ok": true,
            "noted": true,
        }))
    }
}

// ── task_complete ────────────────────────────────────────────────────────

pub struct TaskCompleteTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TaskCompleteArgs {
    summary: String,
    #[serde(default)]
    work_done: Option<String>,
    #[serde(default)]
    issues_found: Option<String>,
}

#[async_trait]
impl Tool for TaskCompleteTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "task_complete".into(),
            description: "Signal that you have finished the user's request. Provide a \
                short `summary` of what you accomplished. Do NOT emit further tool \
                calls after this unless the runtime explicitly asks for another step. \
                Use this instead of generating a final assistant message when the task \
                involved tool work, so the runtime gets an unambiguous completion \
                signal and the UI can render a clean completion state. \
                Do NOT use this for partial progress — call it only when the user's \
                request is fully addressed (or you have hit a blocker you can't resolve \
                yourself, in which case put the blocker in `issuesFound`)."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "summary": {
                        "type": "string",
                        "description": "Plain-English summary of the outcome (1-3 sentences).",
                    },
                    "workDone": {
                        "type": "string",
                        "description": "Optional bullet list of concrete actions you took.",
                    },
                    "issuesFound": {
                        "type": "string",
                        "description": "Optional list of blockers, gaps, or follow-ups for the user.",
                    },
                },
                "required": ["summary"],
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolResult<Value> {
        let args: TaskCompleteArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        Ok(json!({
            "ok": true,
            "complete": true,
            "summary": args.summary,
            "workDone": args.work_done,
            "issuesFound": args.issues_found,
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use hive_sandbox::LocalFsSandbox;

    use super::*;
    use crate::{ToolContext, ToolRegistry};

    fn fresh_sandbox() -> Arc<LocalFsSandbox> {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("hive-tools-meta-{nanos:x}"));
        Arc::new(LocalFsSandbox::new(dir).unwrap())
    }

    #[tokio::test]
    async fn think_accepts_arbitrary_thought() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(ThinkTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        let result = reg
            .invoke(
                "think",
                json!({ "thought": "plan: read file, then edit" }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["noted"], true);
    }

    #[tokio::test]
    async fn task_complete_echoes_summary() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(TaskCompleteTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        let result = reg
            .invoke(
                "task_complete",
                json!({
                    "summary": "Refactored auth flow.",
                    "workDone": "- Renamed AuthHandler\n- Added test",
                }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(result["complete"], true);
        assert_eq!(result["summary"], "Refactored auth flow.");
        assert_eq!(result["workDone"], "- Renamed AuthHandler\n- Added test");
    }

    #[tokio::test]
    async fn task_complete_requires_summary() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(TaskCompleteTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        let err = reg
            .invoke("task_complete", json!({}), &ctx)
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidArgs(_)));
    }
}
