//! Filesystem tools: fs_read, fs_write, fs_list.
//!
//! All three delegate to the context's Sandbox, which enforces path-escape
//! protection. The LLM sees these as three zero-side-effect (read/list) and
//! one side-effecting (write) tools.

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

// ── fs_read ──────────────────────────────────────────────────────────────

pub struct FsReadTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsReadArgs {
    path: String,
    #[serde(default)]
    max_bytes: Option<usize>,
}

/// Cap reads so an agent can't dump a 500 MB binary into its own context.
const DEFAULT_FS_READ_MAX: usize = 256 * 1024;

#[async_trait]
impl Tool for FsReadTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "fs_read".into(),
            description: "Read the full contents of a text file from the project workspace. \
                Returns the bytes decoded as UTF-8 (invalid sequences are replaced with the \
                Unicode replacement character) plus a `truncated` flag when the file exceeds \
                `maxBytes`. Use this any time you need to know what a file currently contains — \
                before editing it, when answering questions about the codebase, or to verify \
                another tool's output. \
                Do NOT use this for binary files (images, archives) — the contents will be \
                mangled. Do NOT use this to discover files — use `fs_list` to enumerate first \
                and only then `fs_read` what you actually need."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path to read.",
                    },
                    "maxBytes": {
                        "type": "integer",
                        "description": "Maximum bytes to return (defaults to 262144).",
                    },
                },
                "required": ["path"],
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: FsReadArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        // Zero Data Leakage: refuse reads of .env / .git / user-protected
        // paths — same surface fs_write enforces.
        ctx.check_path_allowed(&args.path)?;
        let bytes = ctx.sandbox.read(&args.path).await?;
        let limit = args.max_bytes.unwrap_or(DEFAULT_FS_READ_MAX);
        let total = bytes.len();
        let truncated = total > limit;
        let slice = if truncated {
            &bytes[..limit]
        } else {
            &bytes[..]
        };
        let text = String::from_utf8_lossy(slice).into_owned();
        Ok(json!({
            "path": args.path,
            "content": text,
            "bytes": total,
            "truncated": truncated,
        }))
    }
}

// ── fs_write ─────────────────────────────────────────────────────────────

pub struct FsWriteTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsWriteArgs {
    path: String,
    content: String,
}

#[async_trait]
impl Tool for FsWriteTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "fs_write".into(),
            description: "Create a new file or fully overwrite an existing one in the project \
                workspace. Parent directories are created automatically. \
                Use this to author a brand-new file from scratch. \
                Do NOT use this to edit an existing file — call `str_replace` instead, which is \
                far cheaper (no full-file regen) and far less error-prone. \
                Do NOT use this to append to a file — read first with `fs_read`, modify in your \
                head, then overwrite with the complete new contents (or use `str_replace`)."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path.",
                    },
                    "content": {
                        "type": "string",
                        "description": "File contents.",
                    },
                },
                "required": ["path", "content"],
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: FsWriteArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;

        // Part 10.6: Enforce File Protection Zones — centralised in
        // ToolContext so fs_read / fs_list / shell_exec share the surface.
        ctx.check_path_allowed(&args.path)?;

        // D2: take a sandbox-lock for the duration of the write so the
        // HiveGraph lock-overlay reflects real activity. RAII — drop
        // releases. `agent_id` falls back to "unknown" for chat-driven
        // writes that aren't bound to a named agent (rare).
        let _lock = ctx.sandbox_locks.as_ref().map(|reg| {
            reg.acquire(
                ctx.project_id.clone(),
                ctx.agent_id.clone().unwrap_or_else(|| "unknown".to_owned()),
                args.path.clone(),
            )
        });

        ctx.sandbox
            .write(&args.path, args.content.as_bytes())
            .await?;
        Ok(json!({
            "path": args.path,
            "bytes": args.content.len(),
            "ok": true,
        }))
    }
}

// ── fs_list ──────────────────────────────────────────────────────────────

pub struct FsListTool;

/// Cap directory listings so an agent listing `node_modules` doesn't
/// blow its own context budget.
const DEFAULT_FS_LIST_MAX: usize = 1_000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsListArgs {
    #[serde(default = "default_list_path")]
    path: String,
    #[serde(default)]
    max_entries: Option<usize>,
}

fn default_list_path() -> String {
    ".".into()
}

#[async_trait]
impl Tool for FsListTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "fs_list".into(),
            description: "List the immediate entries of a directory in the project workspace \
                (non-recursive). Each entry is `{path, isDir, size}`. Use this to discover what \
                files exist before reading or editing — operating on a path you haven't verified \
                exists is a common source of failed turns. \
                Do NOT use this when you already know the exact path you need — just `fs_read` \
                or `str_replace` directly. The output caps at `maxEntries` (default 1000) and \
                surfaces a `truncated: true` flag if more existed; narrow with a deeper path \
                when truncated."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative directory path. Defaults to '.'.",
                    },
                    "maxEntries": {
                        "type": "integer",
                        "description": "Maximum entries to return (defaults to 1000).",
                    },
                },
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: FsListArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        // Refuse listing of .git/ etc. — listing reveals filenames and
        // structure that should stay opaque to the agent.
        ctx.check_path_allowed(&args.path)?;
        let entries = ctx.sandbox.list(&args.path).await?;
        let limit = args.max_entries.unwrap_or(DEFAULT_FS_LIST_MAX);
        let total = entries.len();
        let truncated = total > limit;
        let returned: Vec<_> = entries.into_iter().take(limit).collect();
        Ok(json!({
            "path": args.path,
            "entries": returned,
            "totalEntries": total,
            "truncated": truncated,
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
            .subsec_nanos();
        let dir = std::env::temp_dir().join(format!("hive-tools-test-{nanos:x}"));
        Arc::new(LocalFsSandbox::new(dir).unwrap())
    }

    #[tokio::test]
    async fn fs_write_then_read() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(FsReadTool));
        reg.insert(Arc::new(FsWriteTool));

        let ctx = ToolContext::new("p1", fresh_sandbox());

        reg.invoke(
            "fs_write",
            json!({ "path": "hello.txt", "content": "hi there" }),
            &ctx,
        )
        .await
        .unwrap();

        let result = reg
            .invoke("fs_read", json!({ "path": "hello.txt" }), &ctx)
            .await
            .unwrap();
        assert_eq!(result["content"], "hi there");
        assert_eq!(result["truncated"], false);
    }

    #[tokio::test]
    async fn fs_write_rejects_path_escape() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(FsWriteTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        let err = reg
            .invoke(
                "fs_write",
                json!({ "path": "../../etc/passwd", "content": "pwn" }),
                &ctx,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::Sandbox(_)));
    }

    #[tokio::test]
    async fn fs_list_defaults_to_root() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(FsWriteTool));
        reg.insert(Arc::new(FsListTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        reg.invoke("fs_write", json!({ "path": "a.txt", "content": "x" }), &ctx)
            .await
            .unwrap();
        let out = reg.invoke("fs_list", json!({}), &ctx).await.unwrap();
        let entries = out["entries"].as_array().unwrap();
        assert!(entries.iter().any(|e| e["path"] == "a.txt"));
    }
}
