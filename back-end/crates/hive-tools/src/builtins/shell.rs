//! Shell execution tool.
//!
//! Runs the command inside the sandbox (Docker container when available,
//! otherwise the project workspace directory). Timeout is capped to one
//! minute by default so a runaway agent can't block the runner.

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TIMEOUT: Duration = Duration::from_secs(300);

pub struct ShellExecTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShellExecArgs {
    command: String,
    #[serde(default)]
    args: Vec<String>,
    /// Timeout in seconds. Capped server-side at MAX_TIMEOUT to keep a
    /// runaway agent from hanging the runner.
    #[serde(default)]
    timeout_seconds: Option<u64>,
}

#[async_trait]
impl Tool for ShellExecTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "shell_exec".into(),
            description: "Run a command inside the project sandbox. \
                Returns stdout, stderr, exit code, and a timed_out flag. \
                Timeout defaults to 60 s; values above 300 s are clamped."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The program to run (e.g. 'cargo').",
                    },
                    "args": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Arguments to pass to the command.",
                    },
                    "timeoutSeconds": {
                        "type": "integer",
                        "description": "Maximum runtime before the command is killed.",
                    },
                },
                "required": ["command"],
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: ShellExecArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;
        let timeout = args
            .timeout_seconds
            .map(|s| Duration::from_secs(s).min(MAX_TIMEOUT))
            .unwrap_or(DEFAULT_TIMEOUT);

        let out = ctx.sandbox.exec(&args.command, &args.args, timeout).await?;
        Ok(json!({
            "command": args.command,
            "args": args.args,
            "stdout": out.stdout,
            "stderr": out.stderr,
            "exitCode": out.exit_code,
            "timedOut": out.timed_out,
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
        let dir = std::env::temp_dir().join(format!("hive-tools-shell-test-{nanos:x}"));
        Arc::new(LocalFsSandbox::new(dir).unwrap())
    }

    fn shell_command(script: &str) -> (&'static str, Vec<String>) {
        if cfg!(windows) {
            ("powershell", vec!["-Command".into(), script.into()])
        } else {
            ("sh", vec!["-c".into(), script.into()])
        }
    }

    #[tokio::test]
    async fn runs_echo() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(ShellExecTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        let (command, args) = if cfg!(windows) {
            shell_command("Write-Output hi")
        } else {
            shell_command("echo hi")
        };

        let out = reg
            .invoke(
                "shell_exec",
                json!({ "command": command, "args": args }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(out["stdout"].as_str().unwrap().trim(), "hi");
        assert_eq!(out["exitCode"], 0);
        assert_eq!(out["timedOut"], false);
    }

    #[tokio::test]
    async fn clamps_oversized_timeout() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(ShellExecTool));
        let ctx = ToolContext::new("p1", fresh_sandbox());
        let (command, args) = shell_command("exit 0");
        // 10 000 s is clamped to 300 s, but since `true` exits instantly
        // the test just verifies no rejection.
        let out = reg
            .invoke(
                "shell_exec",
                json!({
                    "command": command,
                    "args": args,
                    "timeoutSeconds": 10_000,
                }),
                &ctx,
            )
            .await
            .unwrap();
        assert_eq!(out["exitCode"], 0);
    }
}
