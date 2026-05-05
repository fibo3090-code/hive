//! `spawn_agent` + `message_agent` tools. These live in `hive-runtime` rather
//! than `hive-tools` because they need direct access to the `Db` and the
//! `ExecutorRegistry`, both of which would create a dependency cycle if
//! pulled into `hive-tools`.

use std::sync::Arc;

use async_trait::async_trait;
use hive_db::{
    repos::{agent_messages, agents},
    Db,
};
use hive_tools::{Tool, ToolContext, ToolError, ToolManifest, ToolRegistry, ToolResult};
use serde_json::{json, Value};

use crate::events::EventBus;
use crate::executor::InboxItem;
use crate::registry::ExecutorRegistry;

pub struct SpawnAgent {
    db: Db,
    executors: Arc<ExecutorRegistry>,
    bus: EventBus,
}

impl SpawnAgent {
    pub fn new(db: Db, executors: Arc<ExecutorRegistry>, bus: EventBus) -> Self {
        Self { db, executors, bus }
    }
}

#[async_trait]
impl Tool for SpawnAgent {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "spawn_agent".into(),
            description: "Create a new sub-agent under the calling agent and dispatch it an initial task.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "role": { "type": "string", "description": "Agent role label, e.g. 'Frontend Architect'." },
                    "name": { "type": "string", "description": "Display name for the agent (optional)." },
                    "task": { "type": "string", "description": "Initial task / message to dispatch." },
                    "model": {
                        "type": "object",
                        "properties": {
                            "providerId": { "type": "string" },
                            "modelId": { "type": "string" }
                        }
                    },
                    "tools": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional allow-list of tool names for the new agent."
                    },
                    "systemPrompt": { "type": "string" }
                },
                "required": ["role", "task"]
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let role = args
            .get("role")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("role is required".into()))?
            .to_owned();
        let task = args
            .get("task")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("task is required".into()))?
            .to_owned();
        let name = args
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| role.clone());
        let provider_id = args
            .get("model")
            .and_then(|m| m.get("providerId"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let model_id = args
            .get("model")
            .and_then(|m| m.get("modelId"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let tools = args
            .get("tools")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            });
        let system_prompt = args
            .get("systemPrompt")
            .and_then(Value::as_str)
            .map(str::to_owned);

        let slug = format!(
            "{}-{}",
            role.to_lowercase().chars().take(2).collect::<String>(),
            chrono::Utc::now().timestamp() % 1000
        );

        let created = agents::create(
            self.db.conn(),
            agents::CreateAgent {
                project_id: ctx.project_id.clone(),
                slug,
                name,
                role,
                model: model_id.clone().unwrap_or_else(|| "auto".into()),
                status: "working".into(),
                parent_agent_id: ctx.agent_id.clone(),
                spawned_by_message_id: ctx.message_id.clone(),
                enabled_tools: tools,
                system_prompt,
                model_provider_id: provider_id,
                model_id,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("create agent: {e}")))?;

        // Bring the executor up under the parent's cancel scope so cancelling
        // the spawning agent cascades through every descendant.
        let _exec = self
            .executors
            .ensure_with_parent(&created.id, &ctx.project_id, ctx.agent_id.as_deref())
            .await;
        let msg = agent_messages::enqueue(
            self.db.conn(),
            agent_messages::EnqueueAgentMessage {
                project_id: ctx.project_id.clone(),
                to_agent_id: created.id.clone(),
                from_agent_id: ctx.agent_id.clone(),
                content: task,
                thread_id: ctx.thread_id.clone(),
                reply_to_message_id: None,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("enqueue agent message: {e}")))?;

        self.executors
            .dispatch(
                &created.id,
                InboxItem {
                    message_id: msg.id.clone(),
                    content: msg.content.clone(),
                    thread_id: msg.thread_id.clone(),
                    from_agent_id: msg.from_agent_id.clone(),
                },
            )
            .await
            .map_err(|e| ToolError::Other(format!("dispatch: {e}")))?;

        // Emit `agent.spawned` so the frontend (HiveGraph, agents list,
        // lineage views) refreshes within ~1s of the parent's spawn
        // tool call. The `useSse` map already routes this to
        // ['agents', projectId] + ['agent-lineage', parentId].
        self.bus.emit(
            "agent.spawned",
            json!({
                "agentId": created.id,
                "projectId": ctx.project_id,
                "parentAgentId": ctx.agent_id,
                "role": created.role,
                "name": created.name,
                "model": created.model,
                "spawnedByMessageId": ctx.message_id,
            }),
        );

        Ok(json!({
            "agentId": created.id,
            "messageId": msg.id,
            "role": created.role,
        }))
    }
}

pub struct MessageAgent {
    db: Db,
    executors: Arc<ExecutorRegistry>,
}

impl MessageAgent {
    pub fn new(db: Db, executors: Arc<ExecutorRegistry>) -> Self {
        Self { db, executors }
    }
}

#[async_trait]
impl Tool for MessageAgent {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "message_agent".into(),
            description: "Send a message to another agent's inbox.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "agentId": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["agentId", "content"]
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let agent_id = args
            .get("agentId")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("agentId is required".into()))?
            .to_owned();
        let content = args
            .get("content")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("content is required".into()))?
            .to_owned();

        let target = agents::get(self.db.conn(), &agent_id)
            .await
            .map_err(|e| ToolError::Other(format!("lookup agent: {e}")))?
            .ok_or_else(|| ToolError::Other(format!("agent {agent_id} not found")))?;

        let msg = agent_messages::enqueue(
            self.db.conn(),
            agent_messages::EnqueueAgentMessage {
                project_id: target.project_id.clone(),
                to_agent_id: target.id.clone(),
                from_agent_id: ctx.agent_id.clone(),
                content,
                thread_id: ctx.thread_id.clone(),
                reply_to_message_id: None,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("enqueue: {e}")))?;

        let _ = self.executors.ensure(&target.id, &target.project_id).await;
        self.executors
            .dispatch(
                &target.id,
                InboxItem {
                    message_id: msg.id.clone(),
                    content: msg.content.clone(),
                    thread_id: msg.thread_id.clone(),
                    from_agent_id: msg.from_agent_id.clone(),
                },
            )
            .await
            .map_err(|e| ToolError::Other(format!("dispatch: {e}")))?;

        Ok(json!({ "messageId": msg.id, "agentId": target.id }))
    }
}

/// Register both `spawn_agent` and `message_agent` on the registry.
pub fn register_agent_tools(
    registry: &mut ToolRegistry,
    db: Db,
    executors: Arc<ExecutorRegistry>,
    bus: EventBus,
) {
    registry.insert(Arc::new(SpawnAgent::new(
        db.clone(),
        executors.clone(),
        bus,
    )));
    registry.insert(Arc::new(MessageAgent::new(db, executors)));
}
