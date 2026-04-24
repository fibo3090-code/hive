//! Tool invocation context — environment the tool runs against.
//!
//! Every tool call in Sprint 2 is scoped to a specific project; the context
//! carries the sandbox the tool should use for filesystem + shell access,
//! plus identifiers the tool can include in audit metadata.

use std::sync::Arc;

use hive_sandbox::Sandbox;

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
}

impl ToolContext {
    pub fn new(project_id: impl Into<String>, sandbox: Arc<dyn Sandbox>) -> Self {
        Self {
            project_id: project_id.into(),
            agent_id: None,
            thread_id: None,
            message_id: None,
            sandbox,
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
}
