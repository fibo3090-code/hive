//! Built-in tools shipped with the runtime. These are the "safe" bundle
//! that every agent gets access to once its workspace is initialised.

pub mod fs;
pub mod shell;

use std::sync::Arc;

use crate::ToolRegistry;

/// Install all default tools into a registry. Call after constructing an
/// empty registry to get the standard tool surface.
pub fn register_defaults(registry: &mut ToolRegistry) {
    registry.insert(Arc::new(fs::FsReadTool));
    registry.insert(Arc::new(fs::FsWriteTool));
    registry.insert(Arc::new(fs::FsListTool));
    registry.insert(Arc::new(shell::ShellExecTool));
}

/// Names of the defaults, in the same order as `register_defaults`. Useful
/// for seeding a project's default `enabled_tools` setting.
pub fn default_names() -> Vec<String> {
    vec![
        "fs_read".into(),
        "fs_write".into(),
        "fs_list".into(),
        "shell_exec".into(),
    ]
}
