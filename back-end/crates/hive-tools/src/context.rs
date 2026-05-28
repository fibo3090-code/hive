//! Tool invocation context — environment the tool runs against.
//!
//! Every tool call in Sprint 2 is scoped to a specific project; the context
//! carries the sandbox the tool should use for filesystem + shell access,
//! plus identifiers the tool can include in audit metadata.

use std::sync::Arc;

use hive_sandbox::Sandbox;

use crate::locks::SandboxLockRegistry;
use crate::permission::PermissionMatrix;

/// Per-invocation environment handed to `Tool::invoke`.
#[derive(Clone)]
pub struct ToolContext {
    pub project_id: String,
    pub agent_id: Option<String>,
    /// Thread the tool call originated from (used for SSE attribution).
    pub thread_id: Option<String>,
    /// Message the tool call originated from.
    pub message_id: Option<String>,
    /// Sandbox for file/shell operations.
    pub sandbox: Arc<dyn Sandbox>,
    /// Capability gating policy. Defaults to `PermissionMatrix::unrestricted`
    /// so existing tools keep working; the runtime will swap in a profile
    /// matrix per-agent in Phase 0c-bis when the approval SSE flow lands.
    permissions: PermissionMatrix,
    /// User-defined files that are blocked from modification.
    pub protected_files: Vec<String>,
    /// D2: shared registry tracking which agent currently holds a write
    /// on which sandbox path. `fs_write` (and any future mutating tool)
    /// takes a RAII lock for the duration of the I/O so the HiveGraph
    /// lock-overlay can show real activity. `None` = the runner didn't
    /// wire one (test fixtures); the tool then skips the visibility
    /// hook but still performs the write.
    pub sandbox_locks: Option<std::sync::Arc<SandboxLockRegistry>>,
}

impl ToolContext {
    pub fn new(project_id: impl Into<String>, sandbox: Arc<dyn Sandbox>) -> Self {
        Self {
            project_id: project_id.into(),
            agent_id: None,
            thread_id: None,
            message_id: None,
            sandbox,
            permissions: PermissionMatrix::default(),
            protected_files: Vec::new(),
            sandbox_locks: None,
        }
    }

    /// Wire the process-wide [`SandboxLockRegistry`] for D2 lock-overlay
    /// visibility. Without it, `fs_write` still works — but the HiveGraph
    /// lock-overlay will show nothing for this turn's writes.
    pub fn with_sandbox_locks(mut self, registry: Arc<SandboxLockRegistry>) -> Self {
        self.sandbox_locks = Some(registry);
        self
    }

    pub fn with_agent(mut self, id: impl Into<String>) -> Self {
        self.agent_id = Some(id.into());
        self
    }

    pub fn with_thread(mut self, id: impl Into<String>) -> Self {
        self.thread_id = Some(id.into());
        self
    }

    pub fn with_message(mut self, id: impl Into<String>) -> Self {
        self.message_id = Some(id.into());
        self
    }

    /// Override the default permission matrix. Use the named profiles on
    /// `PermissionMatrix` (`plan`, `build`, `explore`) or build a custom
    /// one. Tools should read this via [`Self::permissions`].
    pub fn with_permissions(mut self, matrix: PermissionMatrix) -> Self {
        self.permissions = matrix;
        self
    }

    /// Set user-defined protected files that the tools (e.g. fs_write) cannot modify.
    pub fn with_protected_files(mut self, files: Vec<String>) -> Self {
        self.protected_files = files;
        self
    }

    /// Read-only access to the active permission matrix.
    pub fn permissions(&self) -> &PermissionMatrix {
        &self.permissions
    }

    /// Return `Err(ToolError::InvalidArgs)` if `path` (workspace-relative) is
    /// a system-protected file (`.env*`, `.git/`) or a user-protected entry
    /// from `protected_files`. Centralised here so every tool — fs_read,
    /// fs_list, fs_write, shell_exec, anything new — enforces the same
    /// File Protection Zone surface ("Zero Data Leakage" guarantee).
    ///
    /// Normalisation: backslashes → forward slashes, leading `./` stripped,
    /// trailing `/` stripped, case-folded on Windows where filesystems are
    /// case-insensitive. This blocks `./.env`, `.env/`, `.\.env` and the
    /// upper/lower-case variants that previously slipped through.
    pub fn check_path_allowed(&self, path: &str) -> crate::ToolResult<()> {
        let norm = normalize_protected_path(path);
        if is_system_protected(&norm) {
            return Err(crate::ToolError::InvalidArgs(format!(
                "Access denied: {path} is a system-protected file"
            )));
        }
        for protected in &self.protected_files {
            let p = normalize_protected_path(protected);
            if norm == p || norm.starts_with(&format!("{p}/")) {
                return Err(crate::ToolError::InvalidArgs(format!(
                    "Access denied: {path} is a user-protected file"
                )));
            }
        }
        Ok(())
    }
}

/// Normalise a workspace-relative path for protection comparison:
/// - backslashes → forward slashes,
/// - strip leading `./`,
/// - strip trailing `/`,
/// - lowercase on Windows (case-insensitive filesystems).
fn normalize_protected_path(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    while let Some(rest) = s.strip_prefix("./") {
        s = rest.to_owned();
    }
    while s.ends_with('/') && s.len() > 1 {
        s.pop();
    }
    if cfg!(windows) {
        s = s.to_lowercase();
    }
    s
}

fn is_system_protected(norm: &str) -> bool {
    norm.split('/')
        .any(|part| part == ".env" || part.starts_with(".env.") || part == ".git")
}

#[cfg(test)]
mod path_protection_tests {
    use super::*;

    #[test]
    fn blocks_dot_env_and_variants() {
        assert!(is_system_protected(&normalize_protected_path(".env")));
        assert!(is_system_protected(&normalize_protected_path("./.env")));
        assert!(is_system_protected(&normalize_protected_path(".\\.env")));
        assert!(is_system_protected(&normalize_protected_path(".env.local")));
        if cfg!(windows) {
            assert!(is_system_protected(&normalize_protected_path(".ENV")));
        }
    }

    #[test]
    fn blocks_git_directory() {
        assert!(is_system_protected(&normalize_protected_path(".git")));
        assert!(is_system_protected(&normalize_protected_path(
            ".git/config"
        )));
        assert!(is_system_protected(&normalize_protected_path(
            "./.git/HEAD"
        )));
    }

    #[test]
    fn blocks_nested_env_and_git_entries() {
        assert!(is_system_protected(&normalize_protected_path(
            "apps/web/.env"
        )));
        assert!(is_system_protected(&normalize_protected_path(
            "packages/api/.env.production"
        )));
        assert!(is_system_protected(&normalize_protected_path(
            "vendor/submodule/.git/config"
        )));
    }

    #[test]
    fn allows_unrelated_paths() {
        assert!(!is_system_protected(&normalize_protected_path(
            "src/main.rs"
        )));
        assert!(!is_system_protected(&normalize_protected_path("README.md")));
        assert!(!is_system_protected(&normalize_protected_path(
            "env-vars.json"
        )));
        assert!(!is_system_protected(&normalize_protected_path(
            "src/dot.env.example"
        )));
    }
}
