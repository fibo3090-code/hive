//! Built-in tools shipped with the runtime. These are the "safe" bundle
//! that every agent gets access to once its workspace is initialised.
//!
//! ## Schema audit (pre-invoke validation in `hive-runtime::chat`)
//!
//! Chat validates each tool call against the manifest `required` list before
//! dispatch. Small models most often omit fields on tools with **multiple**
//! required keys — highest risk: **`fs_write`** (`path` + `content`). Others:
//! **`fs_read`** / **`web_fetch`** / **`web_search`** each require one string
//! (`path`, `url`, `query`). **`shell_exec`** requires `command`. **`fs_list`**
//! defaults `path` to `"."` so it is lenient.

pub mod fs;
pub mod shell;
pub mod web;

use std::sync::Arc;

use hive_search::SearchProvider;

use crate::ToolRegistry;

/// Install the sandbox-scoped built-ins (fs_read/write/list, shell_exec)
/// plus `web_fetch`. Call after constructing an empty registry to get
/// the standard tool surface. `web_search` requires a provider and is
/// added separately via `register_web_search`.
pub fn register_defaults(registry: &mut ToolRegistry) {
    registry.insert(Arc::new(fs::FsReadTool));
    registry.insert(Arc::new(fs::FsWriteTool));
    registry.insert(Arc::new(fs::FsListTool));
    registry.insert(Arc::new(shell::ShellExecTool));
    registry.insert(Arc::new(web::WebFetchTool::with_default_client()));
}

/// Install `web_search` backed by the caller-supplied `SearchProvider`.
/// Split out so the runtime can omit it when no provider is configured,
/// or swap providers without rebuilding the whole registry.
pub fn register_web_search(registry: &mut ToolRegistry, provider: Arc<dyn SearchProvider>) {
    registry.insert(Arc::new(web::WebSearchTool::new(provider)));
}

/// Names of the defaults, in the same order as `register_defaults`. Useful
/// for seeding a project's default `enabled_tools` setting.
pub fn default_names() -> Vec<String> {
    vec![
        "fs_read".into(),
        "fs_write".into(),
        "fs_list".into(),
        "shell_exec".into(),
        "web_fetch".into(),
    ]
}
