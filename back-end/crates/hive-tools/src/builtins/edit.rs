//! Surgical file edits — `str_replace`.
//!
//! The single biggest accuracy + token-cost win for coding agents is letting
//! them edit files by replacing exact substrings rather than re-writing the
//! whole file. Without this tool, every one-line change forces the model to
//! regenerate the entire file (5–10× token cost, far more failure modes).

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

// ── str_replace ──────────────────────────────────────────────────────────

pub struct StrReplaceTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StrReplaceArgs {
    path: String,
    old_string: String,
    new_string: String,
    /// When `true`, replace every occurrence. When `false` (default), the
    /// tool fails with a clear error if `old_string` matches more than
    /// once — pushing the LLM to give a more specific match instead of
    /// accidentally clobbering similar lines.
    #[serde(default)]
    replace_all: bool,
}

#[async_trait]
impl Tool for StrReplaceTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "str_replace".into(),
            description: "Replace an exact substring inside a file in the project workspace. \
                Use this for every code edit — it is far cheaper and far more reliable \
                than rewriting an entire file with `fs_write` for a small change. The \
                `oldString` must match the existing text exactly (whitespace included); \
                supply enough surrounding context to make the match unique. \
                Do NOT use this to create new files — use `fs_write` for that. \
                Do NOT use this when you want to replace many ambiguous lines at once \
                without thinking — make each call's `oldString` deterministic instead."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path of the file to edit.",
                    },
                    "oldString": {
                        "type": "string",
                        "description": "Exact substring to find. Include enough surrounding context to be unique.",
                    },
                    "newString": {
                        "type": "string",
                        "description": "Replacement text. May be empty to delete the matched range.",
                    },
                    "replaceAll": {
                        "type": "boolean",
                        "description": "Replace every occurrence (defaults to false — must be exactly one match).",
                    },
                },
                "required": ["path", "oldString", "newString"],
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: StrReplaceArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        // Same File Protection Zone gate as fs_write / fs_read.
        ctx.check_path_allowed(&args.path)?;

        let bytes = ctx.sandbox.read(&args.path).await?;
        let original = String::from_utf8(bytes)
            .map_err(|e| ToolError::InvalidArgs(format!("file is not UTF-8: {e}")))?;

        if args.old_string.is_empty() {
            return Err(ToolError::InvalidArgs(
                "oldString must not be empty; use fs_write to create new files".into(),
            ));
        }

        let match_count = original.matches(&args.old_string).count();
        if match_count == 0 {
            return Ok(json!({
                "ok": false,
                "error": "oldString not found",
                "hint": "Include enough surrounding context for an exact match. Whitespace and case both matter.",
                "matchCount": 0,
            }));
        }
        if match_count > 1 && !args.replace_all {
            return Ok(json!({
                "ok": false,
                "error": format!("oldString matched {match_count} times"),
                "hint": "Make oldString unique by adding more surrounding context, or pass replaceAll=true to overwrite every occurrence.",
                "matchCount": match_count,
            }));
        }

        let updated = if args.replace_all {
            original.replace(&args.old_string, &args.new_string)
        } else {
            original.replacen(&args.old_string, &args.new_string, 1)
        };

        // D2: sandbox lock for the duration of the write so the HiveGraph
        // lock-overlay reflects real activity. RAII — drop releases.
        let _lock = ctx.sandbox_locks.as_ref().map(|reg| {
            reg.acquire(
                ctx.project_id.clone(),
                ctx.agent_id.clone().unwrap_or_else(|| "unknown".to_owned()),
                args.path.clone(),
            )
        });

        ctx.sandbox.write(&args.path, updated.as_bytes()).await?;

        let bytes_before = original.len();
        let bytes_after = updated.len();
        Ok(json!({
            "ok": true,
            "path": args.path,
            "replacements": match_count,
            "bytesBefore": bytes_before,
            "bytesAfter": bytes_after,
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
        let dir = std::env::temp_dir().join(format!("hive-tools-strrepl-{nanos:x}"));
        Arc::new(LocalFsSandbox::new(dir).unwrap())
    }

    async fn write_file(ctx: &ToolContext, path: &str, body: &str) {
        ctx.sandbox.write(path, body.as_bytes()).await.unwrap();
    }

    #[tokio::test]
    async fn replaces_unique_match() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(StrReplaceTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        write_file(&ctx, "main.rs", "fn main() {\n    println!(\"hi\");\n}\n").await;

        let result = reg
            .invoke(
                "str_replace",
                json!({
                    "path": "main.rs",
                    "oldString": "println!(\"hi\");",
                    "newString": "println!(\"world\");",
                }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["replacements"], 1);

        let after = String::from_utf8(ctx.sandbox.read("main.rs").await.unwrap()).unwrap();
        assert!(after.contains("println!(\"world\");"));
        assert!(!after.contains("println!(\"hi\");"));
    }

    #[tokio::test]
    async fn rejects_ambiguous_match_without_replace_all() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(StrReplaceTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        write_file(&ctx, "f.txt", "x\nx\n").await;

        let result = reg
            .invoke(
                "str_replace",
                json!({ "path": "f.txt", "oldString": "x", "newString": "y" }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["matchCount"], 2);
        // File untouched.
        let after = String::from_utf8(ctx.sandbox.read("f.txt").await.unwrap()).unwrap();
        assert_eq!(after, "x\nx\n");
    }

    #[tokio::test]
    async fn replace_all_honoured_when_set() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(StrReplaceTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        write_file(&ctx, "f.txt", "x\nx\n").await;

        let result = reg
            .invoke(
                "str_replace",
                json!({ "path": "f.txt", "oldString": "x", "newString": "y", "replaceAll": true }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(result["ok"], true);
        assert_eq!(result["replacements"], 2);
        let after = String::from_utf8(ctx.sandbox.read("f.txt").await.unwrap()).unwrap();
        assert_eq!(after, "y\ny\n");
    }

    #[tokio::test]
    async fn missing_match_returns_structured_error() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(StrReplaceTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        write_file(&ctx, "f.txt", "hello").await;

        let result = reg
            .invoke(
                "str_replace",
                json!({ "path": "f.txt", "oldString": "world", "newString": "x" }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["matchCount"], 0);
        assert_eq!(
            String::from_utf8(ctx.sandbox.read("f.txt").await.unwrap()).unwrap(),
            "hello"
        );
    }

    #[tokio::test]
    async fn rejects_protected_path() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(StrReplaceTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        // No file needs to exist — the protection check fires first.
        let err = reg
            .invoke(
                "str_replace",
                json!({ "path": ".env", "oldString": "x", "newString": "y" }),
                &ctx,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::InvalidArgs(_)));
    }
}
