//! `spawn_agent`, `message_agent`, `list_visible_agents`, `request_relay`.
//! These live in `hive-runtime` rather than `hive-tools` because they need
//! direct access to the `Db` and the `ExecutorRegistry`, both of which would
//! create a dependency cycle if pulled into `hive-tools`.

use std::sync::Arc;

use async_trait::async_trait;
use hive_db::{
    repos::{agent_messages, agent_wires, agents},
    Db,
};
use hive_tools::{Tool, ToolContext, ToolError, ToolManifest, ToolRegistry, ToolResult};
use serde_json::{json, Value};

use crate::events::EventBus;
use crate::executor::InboxItem;
use crate::registry::ExecutorRegistry;

/// Resolve whether `caller` may message `target` in `project`. If the project
/// has no wires at all, fall back to "same project" so projects that don't use
/// the wire graph keep working. Otherwise enforce the wire-derived visibility
/// rule (self + direct parents + descendants).
async fn can_message(
    db: &Db,
    project_id: &str,
    caller: Option<&str>,
    target: &str,
) -> ToolResult<bool> {
    let Some(caller) = caller else { return Ok(true) };
    let wires = agent_wires::list_by_project(db.conn(), project_id)
        .await
        .map_err(|e| ToolError::Other(format!("wires: {e}")))?;
    if wires.is_empty() {
        return Ok(true);
    }
    let visible = agent_wires::visible_agent_ids(db.conn(), project_id, caller)
        .await
        .map_err(|e| ToolError::Other(format!("visibility: {e}")))?;
    Ok(visible.contains(target))
}

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
            description:
                "Create a new sub-agent under the calling agent and dispatch it an initial task."
                    .into(),
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
        let tools = args.get("tools").and_then(Value::as_array).map(|arr| {
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

        // Record a HiveGraph wire parent→child so the visibility model and the
        // graph view both reflect the spawn. Best-effort: a fresh child can't
        // form a cycle or a duplicate, and a missing wire shouldn't fail spawn.
        if let Some(parent_id) = ctx.agent_id.as_deref() {
            let _ = agent_wires::create(self.db.conn(), &ctx.project_id, parent_id, &created.id).await;
        }

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

        if target.project_id != ctx.project_id {
            return Err(ToolError::InvalidArgs(format!("Access denied: agent {} belongs to a different project", agent_id)));
        }
        if !can_message(&self.db, &ctx.project_id, ctx.agent_id.as_deref(), &target.id).await? {
            return Err(ToolError::Other(format!(
                "agent {} is not in your visibility set — you may message your direct parents and your own descendants. Use `request_relay` to route through a parent, or `list_visible_agents` to see who you can reach.",
                agent_id
            )));
        }

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

// ── list_visible_agents ─────────────────────────────────────────────────────

pub struct ListVisibleAgents {
    db: Db,
}
impl ListVisibleAgents {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}
#[async_trait]
impl Tool for ListVisibleAgents {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "list_visible_agents".into(),
            description: "List the agents you can directly message: yourself, your direct parents in the HiveGraph, and all of your descendants. If the project has no wires, lists every agent in the project.".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            side_effects: false,
        }
    }
    async fn invoke(&self, _args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let all = agents::list_by_project(self.db.conn(), &ctx.project_id)
            .await
            .map_err(|e| ToolError::Other(format!("list agents: {e}")))?;
        let visible_ids: Option<std::collections::HashSet<String>> = match ctx.agent_id.as_deref() {
            Some(caller) => {
                let wires = agent_wires::list_by_project(self.db.conn(), &ctx.project_id)
                    .await
                    .map_err(|e| ToolError::Other(format!("wires: {e}")))?;
                if wires.is_empty() {
                    None
                } else {
                    Some(
                        agent_wires::visible_agent_ids(self.db.conn(), &ctx.project_id, caller)
                            .await
                            .map_err(|e| ToolError::Other(format!("visibility: {e}")))?,
                    )
                }
            }
            None => None,
        };
        let items: Vec<Value> = all
            .into_iter()
            .filter(|a| visible_ids.as_ref().map(|v| v.contains(&a.id)).unwrap_or(true))
            .map(|a| json!({ "id": a.id, "name": a.name, "role": a.role, "status": a.status }))
            .collect();
        Ok(json!({ "agents": items }))
    }
}

// ── request_relay ───────────────────────────────────────────────────────────

pub struct RequestRelay {
    db: Db,
    executors: Arc<ExecutorRegistry>,
}
impl RequestRelay {
    pub fn new(db: Db, executors: Arc<ExecutorRegistry>) -> Self {
        Self { db, executors }
    }
}
#[async_trait]
impl Tool for RequestRelay {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "request_relay".into(),
            description: "Ask one of your direct parents to deliver a message to an agent you can't see directly. `viaAgentId` must be a direct parent of yours, and `targetAgentId` must be visible to that parent.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "viaAgentId": { "type": "string", "description": "A direct parent of yours that can see the target." },
                    "targetAgentId": { "type": "string" },
                    "content": { "type": "string" }
                },
                "required": ["viaAgentId", "targetAgentId", "content"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let via = args.get("viaAgentId").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`viaAgentId` is required".into()))?;
        let target = args.get("targetAgentId").and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`targetAgentId` is required".into()))?;
        let content = args.get("content").and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("`content` is required".into()))?;
        let Some(caller) = ctx.agent_id.as_deref() else {
            return Err(ToolError::Other("request_relay can only be called by an agent".into()));
        };
        let parents = agent_wires::direct_parent_ids(self.db.conn(), &ctx.project_id, caller)
            .await
            .map_err(|e| ToolError::Other(format!("parents: {e}")))?;
        if !parents.iter().any(|p| p == via) {
            return Err(ToolError::Other(format!("{via} is not a direct parent of yours")));
        }
        if !can_message(&self.db, &ctx.project_id, Some(via), target).await? {
            return Err(ToolError::Other(format!("{via} cannot see {target}, so it can't relay to it")));
        }
        let target_agent = agents::get(self.db.conn(), target)
            .await
            .map_err(|e| ToolError::Other(format!("lookup target: {e}")))?
            .filter(|a| a.project_id == ctx.project_id)
            .ok_or_else(|| ToolError::Other(format!("agent {target} not found in this project")))?;
        let body = format!("[relayed by {via} on behalf of {caller}]\n\n{content}");
        let msg = agent_messages::enqueue(
            self.db.conn(),
            agent_messages::EnqueueAgentMessage {
                project_id: ctx.project_id.clone(),
                to_agent_id: target_agent.id.clone(),
                from_agent_id: Some(via.to_owned()),
                content: body.clone(),
                thread_id: ctx.thread_id.clone(),
                reply_to_message_id: None,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("enqueue: {e}")))?;
        let _ = self.executors.ensure(&target_agent.id, &target_agent.project_id).await;
        self.executors
            .dispatch(
                &target_agent.id,
                InboxItem {
                    message_id: msg.id.clone(),
                    content: msg.content.clone(),
                    thread_id: msg.thread_id.clone(),
                    from_agent_id: msg.from_agent_id.clone(),
                },
            )
            .await
            .map_err(|e| ToolError::Other(format!("dispatch: {e}")))?;
        Ok(json!({ "messageId": msg.id, "via": via, "agentId": target_agent.id }))
    }
}

/// Register the agent-coordination tools (`spawn_agent`, `message_agent`,
/// `list_visible_agents`, `request_relay`).
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
    registry.insert(Arc::new(MessageAgent::new(db.clone(), executors.clone())));
    registry.insert(Arc::new(ListVisibleAgents::new(db.clone())));
    registry.insert(Arc::new(RequestRelay::new(db, executors)));
}
