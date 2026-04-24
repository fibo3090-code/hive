//! Sandboxing abstraction for agent tool execution.
//!
//! Every tool that touches the host (file I/O, shell commands) goes through
//! this crate. Two implementations are planned:
//!
//! - `LocalFsSandbox` — workspace-scoped directory on the host with
//!   path-escape protection. This is the zero-config default and is
//!   implemented in Sprint 2 chunk 1.
//! - `DockerSandbox` — ephemeral container per project, mounted on a
//!   named volume. Added in a later chunk once the local-fs path is
//!   exercised.
//!
//! The API is identical for both — callers (tools) depend only on the
//! `Sandbox` trait.

pub mod local;

pub use local::LocalFsSandbox;

use std::{path::PathBuf, time::Duration};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("path {0:?} escapes workspace")]
    PathEscape(PathBuf),

    #[error("not found: {0:?}")]
    NotFound(PathBuf),

    #[error("timeout after {0:?}")]
    Timeout(Duration),

    #[error("execution failed: {0}")]
    Exec(String),

    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

/// What kind of sandbox this is — surfaced to the frontend so the UI can
/// explain what isolation is in effect.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SandboxKind {
    Docker,
    LocalFs,
}

/// A file or directory entry returned by `list`.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// Path relative to the workspace root.
    pub path: String,
    pub is_dir: bool,
    pub size: Option<u64>,
}

/// Result of a shell command invocation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    /// True when the command was killed by the timeout.
    pub timed_out: bool,
}

#[async_trait]
pub trait Sandbox: Send + Sync {
    fn kind(&self) -> SandboxKind;

    /// Absolute host path of the workspace root (diagnostic only; tools
    /// themselves operate on relative paths).
    fn root(&self) -> PathBuf;

    /// Read a file. `path` is a workspace-relative path; paths that escape
    /// the root must return `PathEscape`.
    async fn read(&self, path: &str) -> Result<Vec<u8>, SandboxError>;

    /// Write a file, creating parent directories as needed.
    async fn write(&self, path: &str, contents: &[u8]) -> Result<(), SandboxError>;

    /// List entries at a directory path. Non-recursive.
    async fn list(&self, path: &str) -> Result<Vec<Entry>, SandboxError>;

    /// Run a shell command in the workspace.
    async fn exec(
        &self,
        cmd: &str,
        args: &[String],
        timeout: Duration,
    ) -> Result<ExecOutput, SandboxError>;
}
