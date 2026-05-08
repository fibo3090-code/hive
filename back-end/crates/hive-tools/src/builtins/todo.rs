//! Todo tool: manage a local `.hive/todo.json` task list.
//!
//! Provides `add`, `complete`, `remove`, and `list` operations to track
//! multi-step work within the project sandbox.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{Tool, ToolContext, ToolError, ToolManifest, ToolResult};

pub struct TodoTool;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TodoArgs {
    action: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    title: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Default)]
struct TodoState {
    items: Vec<TodoItem>,
    next_id: usize,
}

#[derive(Serialize, Deserialize, Clone)]
struct TodoItem {
    id: String,
    title: String,
    status: String,
}

const TODO_FILE_PATH: &str = ".hive/todo.json";

impl TodoTool {
    async fn load_state(ctx: &ToolContext) -> TodoState {
        match ctx.sandbox.read(TODO_FILE_PATH).await {
            Ok(bytes) => {
                if let Ok(text) = String::from_utf8(bytes) {
                    serde_json::from_str(&text).unwrap_or_default()
                } else {
                    TodoState::default()
                }
            }
            Err(_) => TodoState::default(),
        }
    }

    async fn save_state(ctx: &ToolContext, state: &TodoState) -> Result<(), ToolError> {
        let json = serde_json::to_string_pretty(state)
            .map_err(|e| ToolError::Io(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
        ctx.sandbox.write(TODO_FILE_PATH, json.as_bytes()).await?;
        Ok(())
    }
}

#[async_trait]
impl Tool for TodoTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "todo".into(),
            description: "Manage a project-local todo list. Use this to keep track of multi-step execution. \
                Actions: \
                - 'add': requires 'title', adds a new todo item. \
                - 'complete': requires 'id', marks an item as done. \
                - 'remove': requires 'id', removes an item. \
                - 'list': lists current items."
                .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["add", "complete", "remove", "list"],
                        "description": "The action to perform.",
                    },
                    "id": {
                        "type": "string",
                        "description": "The ID of the item (required for complete and remove).",
                    },
                    "title": {
                        "type": "string",
                        "description": "The title of the new item (required for add).",
                    },
                },
                "required": ["action"],
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let args: TodoArgs =
            serde_json::from_value(args).map_err(|e| ToolError::InvalidArgs(e.to_string()))?;

        let mut state = Self::load_state(ctx).await;

        match args.action.as_str() {
            "add" => {
                let title = args
                    .title
                    .ok_or_else(|| ToolError::InvalidArgs("missing 'title' for add action".into()))?;
                let item = TodoItem {
                    id: state.next_id.to_string(),
                    title,
                    status: "todo".into(),
                };
                state.items.push(item);
                state.next_id += 1;
                Self::save_state(ctx, &state).await?;
                Ok(json!({ "ok": true, "items": state.items }))
            }
            "complete" => {
                let id = args
                    .id
                    .ok_or_else(|| ToolError::InvalidArgs("missing 'id' for complete action".into()))?;
                if let Some(item) = state.items.iter_mut().find(|i| i.id == id) {
                    item.status = "done".into();
                    Self::save_state(ctx, &state).await?;
                    Ok(json!({ "ok": true, "items": state.items }))
                } else {
                    Ok(json!({ "ok": false, "error": format!("todo item '{id}' not found") }))
                }
            }
            "remove" => {
                let id = args
                    .id
                    .ok_or_else(|| ToolError::InvalidArgs("missing 'id' for remove action".into()))?;
                let initial_len = state.items.len();
                state.items.retain(|i| i.id != id);
                if state.items.len() < initial_len {
                    Self::save_state(ctx, &state).await?;
                    Ok(json!({ "ok": true, "items": state.items }))
                } else {
                    Ok(json!({ "ok": false, "error": format!("todo item '{id}' not found") }))
                }
            }
            "list" => Ok(json!({ "ok": true, "items": state.items })),
            _ => Err(ToolError::InvalidArgs(format!("unknown action: {}", args.action))),
        }
    }
}
