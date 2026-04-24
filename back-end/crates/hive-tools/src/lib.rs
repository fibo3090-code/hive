//! Tool trait + registry for agent-invokable operations.
//!
//! Sprint 2 introduces the tool layer. A `Tool` is any named capability an
//! LLM can request — file I/O, shell commands, web fetches, web search,
//! later on agent spawning. Each tool declares a JSON-schema-shaped manifest
//! that the LLM sees (so it knows what arguments to provide) and an async
//! `invoke` that executes the call.
//!
//! This crate is deliberately provider-agnostic. Each LLM client
//! (hive-llm/providers/*) renders these manifests into its own tool-use
//! wire format; each chat runner (hive-runtime::chat) translates provider
//! tool-use requests back into `Tool::invoke` calls.

pub mod builtins;
pub mod context;
pub mod error;
pub mod manifest;
pub mod registry;

pub use builtins::{default_names, register_defaults};
pub use context::ToolContext;
pub use error::{ToolError, ToolResult};
pub use manifest::ToolManifest;
pub use registry::ToolRegistry;

use async_trait::async_trait;
use serde_json::Value;

/// A tool an agent can invoke during a chat turn.
#[async_trait]
pub trait Tool: Send + Sync {
    /// Manifest describing the tool's name, description, and argument schema.
    /// The LLM sees this when deciding whether to call the tool.
    fn manifest(&self) -> ToolManifest;

    /// Execute the tool with the LLM-provided arguments.
    ///
    /// `args` is JSON matching `manifest().input_schema`. Return value is
    /// JSON-serialisable and is fed back to the LLM as a tool-result.
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value>;
}
