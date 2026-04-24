//! Tool registry — name → Tool lookup, plus filtering by allow-list.

use std::{collections::BTreeMap, sync::Arc};

use serde_json::Value;

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

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
        tool.invoke(args, ctx).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;

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
}
