//! Tool error types. Designed to produce sensible JSON responses that the
//! LLM can read and recover from (e.g. "the path you asked for is outside
//! the workspace — try a relative path").

use thiserror::Error;

pub type ToolResult<T> = std::result::Result<T, ToolError>;

#[derive(Debug, Error)]
pub enum ToolError {
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),

    #[error("not permitted: {0}")]
    Permission(String),

    #[error("path escapes workspace: {0}")]
    PathEscape(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("timeout after {0:?}")]
    Timeout(std::time::Duration),

    #[error("sandbox error: {0}")]
    Sandbox(#[from] hive_sandbox::SandboxError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Other(String),
}

impl ToolError {
    /// Serialise for the LLM. The LLM sees `{ error: "...", code: "..." }`
    /// and can retry with corrected arguments.
    pub fn to_result_json(&self) -> serde_json::Value {
        let code = match self {
            Self::InvalidArgs(_) => "invalid_args",
            Self::Permission(_) => "permission",
            Self::PathEscape(_) => "path_escape",
            Self::NotFound(_) => "not_found",
            Self::Timeout(_) => "timeout",
            Self::Sandbox(_) => "sandbox",
            Self::Io(_) => "io",
            Self::Other(_) => "other",
        };
        serde_json::json!({ "error": self.to_string(), "code": code })
    }
}
