//! Tool invocation context — environment the tool runs against.
//!
//! Every tool call in Sprint 2 is scoped to a specific project; the context
//! carries the sandbox the tool should use for filesystem + shell access,
//! plus identifiers the tool can include in audit metadata.

use std::sync::Arc;

use hive_sandbox::Sandbox;

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
        }
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
}
