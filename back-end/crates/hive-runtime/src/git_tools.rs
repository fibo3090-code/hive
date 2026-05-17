//! Git agent tools — read/write the project's working tree from inside a chat
//! turn. Like `db_tools`, these live in `hive-runtime` because the
//! remote-affecting operations (`git_pull` / `git_push`) are gated on the
//! project's sovereignty tier, which requires the `Db`.

use std::sync::Arc;

use async_trait::async_trait;
use hive_db::{repos::projects, Db};
use hive_git::GitRepo;
use hive_tools::{Tool, ToolContext, ToolError, ToolManifest, ToolRegistry, ToolResult};
use serde_json::{json, Value};

pub const GIT_TOOL_NAMES: &[&str] = &[
    "git_status",
    "git_diff",
    "git_log",
    "git_commit",
    "git_pull",
    "git_push",
];

fn repo_for(ctx: &ToolContext) -> GitRepo {
    GitRepo::new(ctx.sandbox.root())
}

fn map_git_err(e: hive_git::GitError) -> ToolError {
    ToolError::Other(format!("git: {e}"))
}

/// Reject remote operations when the project is pinned to the `local`
/// sovereignty tier (stay offline; pushing/pulling needs a remote).
async fn require_remote_allowed(db: &Db, project_id: &str) -> ToolResult<()> {
    let project = projects::get(db.conn(), project_id)
        .await
        .map_err(|e| ToolError::Other(format!("lookup project: {e}")))?
        .ok_or_else(|| ToolError::Other("project not found".into()))?;
    if project.sovereignty_tier.eq_ignore_ascii_case("local") {
        return Err(ToolError::Other(
            "this project's sovereignty tier is 'local' — remote git operations (pull/push) are disabled. Switch the tier in Settings → Sovereignty to allow them.".into(),
        ));
    }
    Ok(())
}

pub struct GitStatus;
#[async_trait]
impl Tool for GitStatus {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "git_status".into(),
            description: "Show the working-tree status of the project repo (porcelain entries)."
                .into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            side_effects: false,
        }
    }
    async fn invoke(&self, _args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let entries = repo_for(ctx).status().map_err(map_git_err)?;
        let items: Vec<Value> = entries
            .into_iter()
            .map(|e| json!({ "path": e.path, "indexStatus": e.index_status, "worktreeStatus": e.worktree_status }))
            .collect();
        Ok(json!({ "entries": items, "clean": items.is_empty() }))
    }
}

pub struct GitDiff;
#[async_trait]
impl Tool for GitDiff {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "git_diff".into(),
            description: "Show a unified diff. With no args: working tree vs HEAD. With `reference`: the patch introduced by that commit/ref.".into(),
            input_schema: json!({ "type": "object", "properties": { "reference": { "type": "string", "description": "Commit SHA or ref. Omit for the working-tree diff." } } }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let reference = args.get("reference").and_then(Value::as_str);
        let diff = repo_for(ctx).diff(reference).map_err(map_git_err)?;
        Ok(json!({ "reference": diff.reference, "patch": diff.patch }))
    }
}

pub struct GitLog;
#[async_trait]
impl Tool for GitLog {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "git_log".into(),
            description: "List recent commits (newest first).".into(),
            input_schema: json!({ "type": "object", "properties": { "limit": { "type": "integer", "minimum": 1, "maximum": 100 } } }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let limit = args
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(20)
            .min(100) as usize;
        let commits = repo_for(ctx).log(limit).map_err(map_git_err)?;
        let items: Vec<Value> = commits
            .into_iter()
            .map(|c| json!({ "hash": c.hash, "shortHash": c.short_hash, "author": c.author, "authoredAt": c.authored_at, "summary": c.summary }))
            .collect();
        Ok(json!({ "commits": items }))
    }
}

pub struct GitCommit;
#[async_trait]
impl Tool for GitCommit {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "git_commit".into(),
            description: "Stage and commit changes. With `paths`: stage only those; otherwise stage everything.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "message": { "type": "string" },
                    "paths": { "type": "array", "items": { "type": "string" } }
                },
                "required": ["message"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let message = args
            .get("message")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("`message` is required".into()))?;
        let paths: Option<Vec<String>> = args.get("paths").and_then(Value::as_array).map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        });
        let author_name = ctx
            .agent_id
            .clone()
            .unwrap_or_else(|| "hive-agent".to_owned());
        let commit = repo_for(ctx)
            .commit(message, &author_name, "agent@hive.local", paths.as_deref())
            .map_err(map_git_err)?;
        Ok(
            json!({ "hash": commit.hash, "shortHash": commit.short_hash, "summary": commit.summary }),
        )
    }
}

pub struct GitPull {
    db: Db,
}
#[async_trait]
impl Tool for GitPull {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "git_pull".into(),
            description:
                "Fast-forward pull from the configured upstream. Disabled on `local`-tier projects."
                    .into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            side_effects: true,
        }
    }
    async fn invoke(&self, _args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        require_remote_allowed(&self.db, &ctx.project_id).await?;
        let out = repo_for(ctx).pull().map_err(map_git_err)?;
        Ok(json!({ "ok": true, "output": out }))
    }
}

pub struct GitPush {
    db: Db,
}
#[async_trait]
impl Tool for GitPush {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "git_push".into(),
            description:
                "Push the current branch to its upstream. Disabled on `local`-tier projects.".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            side_effects: true,
        }
    }
    async fn invoke(&self, _args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        require_remote_allowed(&self.db, &ctx.project_id).await?;
        let out = repo_for(ctx).push().map_err(map_git_err)?;
        Ok(json!({ "ok": true, "output": out }))
    }
}

/// Register the git agent tools. `git_pull` / `git_push` are sovereignty-gated.
pub fn register_git_tools(registry: &mut ToolRegistry, db: Db) {
    registry.insert(Arc::new(GitStatus));
    registry.insert(Arc::new(GitDiff));
    registry.insert(Arc::new(GitLog));
    registry.insert(Arc::new(GitCommit));
    registry.insert(Arc::new(GitPull { db: db.clone() }));
    registry.insert(Arc::new(GitPush { db }));
}
