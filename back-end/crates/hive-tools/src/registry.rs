//! Tool registry — name → Tool lookup, plus filtering by allow-list.

use std::{collections::BTreeMap, sync::Arc};

use serde_json::Value;

use crate::{
    ActionClass, PermissionDecision, Tool, ToolContext, ToolError, ToolManifest, ToolResult,
};

/// Ordered collection of tools keyed by name. Order matters so that the
/// manifest list sent to the LLM is deterministic (stable prompts = stable
/// token caching).
#[derive(Default, Clone)]
pub struct ToolRegistry {
    tools: BTreeMap<String, Arc<dyn Tool>>,
}

impl ToolRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, tool: Arc<dyn Tool>) {
        let manifest = tool.manifest();
        self.tools.insert(manifest.name, tool);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Tool>> {
        self.tools.get(name).cloned()
    }

    pub fn names(&self) -> Vec<String> {
        self.tools.keys().cloned().collect()
    }

    pub fn manifests(&self) -> Vec<ToolManifest> {
        self.tools.values().map(|t| t.manifest()).collect()
    }

    /// Return a new registry that contains only the tools whose names are
    /// in `allow`. Names not in `self` are silently ignored — the caller
    /// may pass stale configuration from the DB.
    pub fn filtered(&self, allow: &[String]) -> Self {
        let mut out = Self::new();
        for name in allow {
            if let Some(tool) = self.tools.get(name).cloned() {
                out.tools.insert(name.clone(), tool);
            }
        }
        out
    }

    /// Convenience for the runtime: invoke by name with error-shaped JSON.
    pub async fn invoke(&self, name: &str, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let Some(tool) = self.get(name) else {
            return Err(ToolError::NotFound(format!("tool {name} not registered")));
        };
        if let Some(class) = action_class_for_tool(name) {
            match ctx.permissions().decide(name, class) {
                PermissionDecision::Allow => {}
                PermissionDecision::Ask => {
                    return Err(ToolError::Permission(format!(
                        "tool {name} requires approval under the {} permission profile",
                        ctx.permissions().profile()
                    )));
                }
                PermissionDecision::Deny => {
                    return Err(ToolError::Permission(format!(
                        "tool {name} is denied under the {} permission profile",
                        ctx.permissions().profile()
                    )));
                }
            }
        }
        tool.invoke(args, ctx).await
    }
}

fn action_class_for_tool(name: &str) -> Option<ActionClass> {
    match name {
        "fs_read" | "fs_list" => Some(ActionClass::FsRead),
        "fs_write" | "str_replace" | "todo" => Some(ActionClass::FsWrite),
        "shell_exec" => Some(ActionClass::ShellExec),
        "web_fetch" | "web_search" => Some(ActionClass::NetFetch),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use hive_sandbox::LocalFsSandbox;
    use serde_json::json;
    use std::sync::Arc;

    struct Echo;

    #[async_trait]
    impl Tool for Echo {
        fn manifest(&self) -> ToolManifest {
            ToolManifest {
                name: "echo".into(),
                description: "echoes input".into(),
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": { "msg": { "type": "string" } },
                    "required": ["msg"],
                }),
                side_effects: false,
            }
        }

        async fn invoke(&self, args: Value, _ctx: &ToolContext) -> ToolResult<Value> {
            Ok(args)
        }
    }

    #[test]
    fn filtered_drops_unknown_names() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(Echo));
        let filtered = reg.filtered(&["echo".into(), "nope".into()]);
        assert_eq!(filtered.names(), vec!["echo"]);
    }

    #[test]
    fn manifests_include_registered_tools() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(Echo));
        let m = reg.manifests();
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].name, "echo");
        assert!(!m[0].side_effects);
    }

    #[tokio::test]
    async fn explore_profile_denies_write_tools_before_invocation() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(crate::builtins::fs::FsWriteTool));
        let dir = std::env::temp_dir().join(format!(
            "hive-tools-permission-test-{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let ctx = ToolContext::new("p1", Arc::new(LocalFsSandbox::new(dir).unwrap()))
            .with_permissions(crate::PermissionMatrix::explore());

        let err = reg
            .invoke(
                "fs_write",
                json!({ "path": "blocked.txt", "content": "nope" }),
                &ctx,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::Permission(_)));
    }

    #[tokio::test]
    async fn build_profile_surfaces_ask_as_permission_block() {
        let mut reg = ToolRegistry::new();
        reg.insert(Arc::new(crate::builtins::fs::FsWriteTool));
        let dir = std::env::temp_dir().join(format!(
            "hive-tools-permission-ask-test-{:x}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let ctx = ToolContext::new("p1", Arc::new(LocalFsSandbox::new(dir).unwrap()))
            .with_permissions(crate::PermissionMatrix::build());

        let err = reg
            .invoke(
                "fs_write",
                json!({ "path": "needs-approval.txt", "content": "wait" }),
                &ctx,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ToolError::Permission(_)));
    }
}
