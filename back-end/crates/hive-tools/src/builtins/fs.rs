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
            description: "Read a text file from the project workspace. \
                Returns the file contents as UTF-8; invalid UTF-8 is \
                replaced with the Unicode replacement character."
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
            description: "Write (or overwrite) a text file in the project \
                workspace. Creates parent directories as needed."
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FsListArgs {
    #[serde(default = "default_list_path")]
    path: String,
}

fn default_list_path() -> String {
    ".".into()
}

#[async_trait]
impl Tool for FsListTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "fs_list".into(),
            description: "List the entries of a directory in the project \
                workspace. Returns entries as [{path, isDir, size}]."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative directory path. Defaults to '.'.",
                    },
                },
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: FsListArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        let entries = ctx.sandbox.list(&args.path).await?;
        Ok(json!({
            "path": args.path,
            "entries": entries,
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
