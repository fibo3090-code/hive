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
            .map_err(|e| ToolError::Io(std::io::Error::other(e)))?;
        ctx.sandbox.write(TODO_FILE_PATH, json.as_bytes()).await?;
        Ok(())
    }
}

#[async_trait]
impl Tool for TodoTool {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "todo".into(),
            description:
                "Manage a private project-local todo list stored in `.hive/todo.json`. Use this \
                to externalise your own working memory across a multi-step task — list what you \
                plan to do, complete items as you finish, and revisit `list` between tool calls \
                so you don't lose track of remaining work. \
                Actions: \
                - 'add' (requires `title`) — append an item. \
                - 'list' (no args) — show the current state. \
                - 'complete' (requires `id`) — mark an item done. \
                - 'remove' (requires `id`) — delete an item. \
                Do NOT use this for tasks the user should see — use `add_task` to file an \
                operator-visible task in the project's tasks table instead. Do NOT use this as \
                a substitute for `task_complete` — call `task_complete` when the whole user \
                request is finished."
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

        // C168: take the sandbox lock across the whole load→mutate→save
        // read-modify-write (not just the write) so the HiveGraph lock
        // overlay shows todo activity like it does for fs_write /
        // str_replace, and concurrent mutations are visible to each other.
        // RAII — drop releases. `list` is read-only and skips the lock.
        let _lock = (args.action != "list")
            .then(|| {
                ctx.sandbox_locks.as_ref().map(|reg| {
                    reg.acquire(
                        ctx.project_id.clone(),
                        ctx.agent_id.clone().unwrap_or_else(|| "unknown".to_owned()),
                        TODO_FILE_PATH.to_owned(),
                    )
                })
            })
            .flatten();

        let mut state = Self::load_state(ctx).await;

        match args.action.as_str() {
            "add" => {
                let title = args.title.ok_or_else(|| {
                    ToolError::InvalidArgs("missing 'title' for add action".into())
                })?;
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
                let id = args.id.ok_or_else(|| {
                    ToolError::InvalidArgs("missing 'id' for complete action".into())
                })?;
                if let Some(item) = state.items.iter_mut().find(|i| i.id == id) {
                    item.status = "done".into();
                    Self::save_state(ctx, &state).await?;
                    Ok(json!({ "ok": true, "items": state.items }))
                } else {
                    Ok(json!({ "ok": false, "error": format!("todo item '{id}' not found") }))
                }
            }
            "remove" => {
                let id = args.id.ok_or_else(|| {
                    ToolError::InvalidArgs("missing 'id' for remove action".into())
                })?;
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
            _ => Err(ToolError::InvalidArgs(format!(
                "unknown action: {}",
                args.action
            ))),
        }
    }
}
