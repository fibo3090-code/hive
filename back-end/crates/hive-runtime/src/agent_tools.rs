//! `spawn_agent`, `message_agent`, `list_visible_agents`, `request_relay`.
//! These live in `hive-runtime` rather than `hive-tools` because they need
//! direct access to the `Db` and the `ExecutorRegistry`, both of which would
//! create a dependency cycle if pulled into `hive-tools`.

use std::sync::Arc;

use async_trait::async_trait;
use hive_db::{
    repos::{agent_messages, agent_spawn_requests, agent_wires, agents, tasks},
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
    let Some(caller) = caller else {
        return Ok(true);
    };
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

        // ULID-suffixed slug: collision-resistant across the same-second-mod-1000
        // window that the old `timestamp() % 1000` format could collide on.
        let slug = format!(
            "{}-{}",
            role.to_lowercase().chars().take(2).collect::<String>(),
            ulid::Ulid::new()
                .to_string()
                .to_lowercase()
                .chars()
                .take(8)
                .collect::<String>(),
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
            let _ =
                agent_wires::create(self.db.conn(), &ctx.project_id, parent_id, &created.id).await;
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
                // `parentId` (not `parentAgentId`) — the frontend SSE
                // handler in `useSse.ts` reads this exact key to scope
                // the agent-lineage cache invalidation. Renaming this
                // silently de-scopes the invalidate to *all* lineages.
                "parentId": ctx.agent_id,
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
            return Err(ToolError::InvalidArgs(format!(
                "Access denied: agent {} belongs to a different project",
                agent_id
            )));
        }
        if !can_message(
            &self.db,
            &ctx.project_id,
            ctx.agent_id.as_deref(),
            &target.id,
        )
        .await?
        {
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
            .filter(|a| {
                visible_ids
                    .as_ref()
                    .map(|v| v.contains(&a.id))
                    .unwrap_or(true)
            })
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
        let via = args
            .get("viaAgentId")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`viaAgentId` is required".into()))?;
        let target = args
            .get("targetAgentId")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`targetAgentId` is required".into()))?;
        let content = args
            .get("content")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("`content` is required".into()))?;
        let Some(caller) = ctx.agent_id.as_deref() else {
            return Err(ToolError::Other(
                "request_relay can only be called by an agent".into(),
            ));
        };
        let parents = agent_wires::direct_parent_ids(self.db.conn(), &ctx.project_id, caller)
            .await
            .map_err(|e| ToolError::Other(format!("parents: {e}")))?;
        if !parents.iter().any(|p| p == via) {
            return Err(ToolError::Other(format!(
                "{via} is not a direct parent of yours"
            )));
        }
        if !can_message(&self.db, &ctx.project_id, Some(via), target).await? {
            return Err(ToolError::Other(format!(
                "{via} cannot see {target}, so it can't relay to it"
            )));
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
        let _ = self
            .executors
            .ensure(&target_agent.id, &target_agent.project_id)
            .await;
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

// ── delete_agent ────────────────────────────────────────────────────────────

/// True if `caller` may manage (delete) the target agent: the target is a direct
/// child of `caller` (by spawn lineage `target_parent`, or by wire), or there is
/// no caller (legacy single-project mode).
async fn can_manage(
    db: &Db,
    project_id: &str,
    caller: Option<&str>,
    target_id: &str,
    target_parent: Option<&str>,
) -> ToolResult<bool> {
    let Some(caller) = caller else {
        return Ok(true);
    };
    if target_parent == Some(caller) {
        return Ok(true);
    }
    let wired_parents = agent_wires::direct_parent_ids(db.conn(), project_id, target_id)
        .await
        .map_err(|e| ToolError::Other(format!("wires: {e}")))?;
    Ok(wired_parents.iter().any(|p| p == caller))
}

pub struct DeleteAgent {
    db: Db,
    executors: Arc<ExecutorRegistry>,
}
impl DeleteAgent {
    pub fn new(db: Db, executors: Arc<ExecutorRegistry>) -> Self {
        Self { db, executors }
    }
}
#[async_trait]
impl Tool for DeleteAgent {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "delete_agent".into(),
            description: "Retire one of your direct sub-agents: cancels its (and its descendants') work and marks it deprecated.".into(),
            input_schema: json!({ "type": "object", "properties": { "agentId": { "type": "string" } }, "required": ["agentId"] }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let agent_id = args
            .get("agentId")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`agentId` is required".into()))?;
        let target = agents::get(self.db.conn(), agent_id)
            .await
            .map_err(|e| ToolError::Other(format!("lookup agent: {e}")))?
            .filter(|a| a.project_id == ctx.project_id)
            .ok_or_else(|| {
                ToolError::Other(format!("agent {agent_id} not found in this project"))
            })?;
        if !can_manage(
            &self.db,
            &ctx.project_id,
            ctx.agent_id.as_deref(),
            &target.id,
            target.parent_agent_id.as_deref(),
        )
        .await?
        {
            return Err(ToolError::Other(format!(
                "{agent_id} is not one of your direct sub-agents"
            )));
        }
        self.executors.cancel_subtree(agent_id).await;
        let _ = self.executors.terminate(agent_id).await;
        let _ =
            agents::set_status(self.db.conn(), &target.project_id, agent_id, "deprecated").await;
        Ok(json!({ "ok": true, "agentId": agent_id, "status": "deprecated" }))
    }
}

// ── monitor_agent ───────────────────────────────────────────────────────────

pub struct MonitorAgent {
    db: Db,
    executors: Arc<ExecutorRegistry>,
}
impl MonitorAgent {
    pub fn new(db: Db, executors: Arc<ExecutorRegistry>) -> Self {
        Self { db, executors }
    }
}
#[async_trait]
impl Tool for MonitorAgent {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "monitor_agent".into(),
            description: "Inspect another agent you can see: status, current task, model, and its most recent inbox messages.".into(),
            input_schema: json!({ "type": "object", "properties": { "agentId": { "type": "string" }, "messageLimit": { "type": "integer", "minimum": 1, "maximum": 20 } }, "required": ["agentId"] }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let agent_id = args
            .get("agentId")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`agentId` is required".into()))?;
        let target = agents::get(self.db.conn(), agent_id)
            .await
            .map_err(|e| ToolError::Other(format!("lookup agent: {e}")))?
            .filter(|a| a.project_id == ctx.project_id)
            .ok_or_else(|| {
                ToolError::Other(format!("agent {agent_id} not found in this project"))
            })?;
        if !can_message(
            &self.db,
            &ctx.project_id,
            ctx.agent_id.as_deref(),
            &target.id,
        )
        .await?
        {
            return Err(ToolError::Other(format!(
                "{agent_id} is not in your visibility set"
            )));
        }
        let limit = args
            .get("messageLimit")
            .and_then(Value::as_u64)
            .unwrap_or(5)
            .clamp(1, 20);
        let messages = agent_messages::list_by_agent(self.db.conn(), agent_id, limit)
            .await
            .map_err(|e| ToolError::Other(format!("messages: {e}")))?;
        let runtime_state = self
            .executors
            .state(agent_id)
            .await
            .map(|s| format!("{s:?}"));
        let msg_items: Vec<Value> = messages
            .into_iter()
            .map(|m| {
                let snippet: String = m.content.chars().take(160).collect();
                json!({ "id": m.id, "from": m.from_agent_id, "status": m.status, "createdAt": m.created_at, "snippet": snippet })
            })
            .collect();
        Ok(json!({
            "id": target.id,
            "name": target.name,
            "role": target.role,
            "status": target.status,
            "runtimeState": runtime_state,
            "model": target.model,
            "currentTask": target.current_task,
            "recentMessages": msg_items,
        }))
    }
}

// ── delegate_task ───────────────────────────────────────────────────────────

pub struct DelegateTask {
    db: Db,
    executors: Arc<ExecutorRegistry>,
}
impl DelegateTask {
    pub fn new(db: Db, executors: Arc<ExecutorRegistry>) -> Self {
        Self { db, executors }
    }
}
#[async_trait]
impl Tool for DelegateTask {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "delegate_task".into(),
            description: "Hand a task to another agent you can see: creates a tracked task assigned to it and dispatches the task to its inbox.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "agentId": { "type": "string" },
                    "task": { "type": "string", "description": "Instructions to send to the agent." },
                    "title": { "type": "string", "description": "Short title for the tracked task (defaults to a truncation of `task`)." },
                    "priority": { "type": "string", "enum": ["low", "medium", "high"] }
                },
                "required": ["agentId", "task"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let agent_id = args
            .get("agentId")
            .and_then(Value::as_str)
            .ok_or_else(|| ToolError::InvalidArgs("`agentId` is required".into()))?;
        let task_text = args
            .get("task")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("`task` is required".into()))?;
        let target = agents::get(self.db.conn(), agent_id)
            .await
            .map_err(|e| ToolError::Other(format!("lookup agent: {e}")))?
            .filter(|a| a.project_id == ctx.project_id)
            .ok_or_else(|| {
                ToolError::Other(format!("agent {agent_id} not found in this project"))
            })?;
        if !can_message(
            &self.db,
            &ctx.project_id,
            ctx.agent_id.as_deref(),
            &target.id,
        )
        .await?
        {
            return Err(ToolError::Other(format!(
                "{agent_id} is not in your visibility set"
            )));
        }
        let title = args
            .get("title")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| task_text.chars().take(80).collect());
        let priority = args
            .get("priority")
            .and_then(Value::as_str)
            .map(|p| p.to_lowercase())
            .filter(|p| ["low", "medium", "high"].contains(&p.as_str()))
            .unwrap_or_else(|| "medium".to_owned());
        let task = tasks::create(
            self.db.conn(),
            tasks::CreateTask {
                project_id: ctx.project_id.clone(),
                title,
                status: "in_progress".into(),
                phase: None,
                priority,
                estimated_tokens: 0,
                agent_id: Some(target.id.clone()),
                sprint_id: None,
                spec_section_id: None,
                due_at: None,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("create task: {e}")))?;
        let body = format!("[delegated task #{}] {task_text}", task.id);
        let msg = agent_messages::enqueue(
            self.db.conn(),
            agent_messages::EnqueueAgentMessage {
                project_id: ctx.project_id.clone(),
                to_agent_id: target.id.clone(),
                from_agent_id: ctx.agent_id.clone(),
                content: body.clone(),
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
        Ok(json!({ "taskId": task.id, "messageId": msg.id, "agentId": target.id }))
    }
}

/// B4 — `request_capability` agent tool. An agent that finds it's
/// missing a capability (e.g. "I need a Stripe customer-lookup MCP")
/// files a spawn request; the auto-MCP synthesis pipeline researches,
/// synthesises, and (after operator approval if needed) materialises a
/// new sub-agent bound to a fresh MCP server.
///
/// Decoupling: this tool only persists the `agent_spawn_requests` row
/// and pushes its id onto a mpsc channel; the consumer task in
/// `hive-api::serve` owns the `PipelineDeps` (which need LLM providers,
/// search providers, etc. — all of which live in hive-api) and runs the
/// actual pipeline. Keeps hive-runtime free of hive-api deps.
pub struct RequestCapability {
    db: Db,
    /// Send the new spawn_request id to the hive-api pipeline launcher.
    /// `None` = test fixture / pre-runtime-init; the row is still
    /// persisted but no pipeline runs.
    launcher: Option<tokio::sync::mpsc::UnboundedSender<String>>,
}

impl RequestCapability {
    pub fn new(db: Db, launcher: Option<tokio::sync::mpsc::UnboundedSender<String>>) -> Self {
        Self { db, launcher }
    }
}

#[async_trait]
impl Tool for RequestCapability {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "request_capability".into(),
            description:
                "Request a brand-new capability — describes what you need and the auto-MCP \
                 synthesis pipeline researches an API, generates an MCP server, optionally \
                 awaits operator approval, and materialises a sub-agent bound to it. \
                 Returns a `spawnRequestId` you can monitor via `monitor_spawn_request`."
                    .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "role": {
                        "type": "string",
                        "description": "Role label for the new sub-agent, e.g. 'Stripe Integrator'.",
                    },
                    "capabilities": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Concrete capability strings the new agent needs (e.g. ['stripe.customer.read', 'stripe.refund.create']). The pipeline first tries to match these against existing connectors/MCPs before synthesising.",
                    },
                    "description": {
                        "type": "string",
                        "description": "Free-form context the pipeline uses when researching and composing the prompt.",
                    },
                    "mcpStrategy": {
                        "type": "string",
                        "enum": ["none", "reuse-only", "reuse-or-synth", "force-synth"],
                        "description": "How aggressive to be about creating new MCP servers. Default: reuse-or-synth.",
                    },
                },
                "required": ["role", "capabilities"],
            }),
            side_effects: true,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let role = args
            .get("role")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("`role` is required".into()))?
            .to_owned();
        let capabilities: Vec<String> = args
            .get("capabilities")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        if capabilities.is_empty() {
            return Err(ToolError::InvalidArgs(
                "`capabilities` must list at least one capability string".into(),
            ));
        }
        let description = args
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mcp_strategy = args
            .get("mcpStrategy")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| "reuse-or-synth".to_owned());

        // Context payload that becomes `spawn_request.context_json` —
        // gets surfaced in the UI detail drawer and feeds the prompt
        // composer at the end of the pipeline.
        let mut context_blob = json!({
            "requestedBy": ctx.agent_id.clone().unwrap_or_else(|| "unknown".to_owned()),
        });
        if let Some(desc) = &description {
            if let Some(obj) = context_blob.as_object_mut() {
                obj.insert("description".to_owned(), Value::String(desc.clone()));
            }
        }

        let row = agent_spawn_requests::create(
            self.db.conn(),
            agent_spawn_requests::CreateSpawnRequest {
                project_id: ctx.project_id.clone(),
                parent_agent_id: ctx.agent_id.clone(),
                requested_role: role,
                requested_capabilities_json: json!(capabilities),
                context_json: context_blob,
                mcp_strategy,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("create spawn request: {e}")))?;

        // Kick the pipeline. Best-effort: if the launcher isn't wired
        // (test fixture, or an old binary that pre-dates the channel),
        // the row still exists and the operator can trigger via the
        // REST `approve` route once the pipeline launcher lands.
        if let Some(tx) = &self.launcher {
            let _ = tx.send(row.id.clone());
        }

        Ok(json!({
            "spawnRequestId": row.id,
            "status": row.status,
            "requestedRole": row.requested_role,
            "queued": self.launcher.is_some(),
        }))
    }
}

/// `monitor_spawn_request` — poll the state of a previously-filed
/// capability request. Lets the calling agent decide whether to wait,
/// move on, or message the operator for approval.
pub struct MonitorSpawnRequest {
    db: Db,
}

impl MonitorSpawnRequest {
    pub fn new(db: Db) -> Self {
        Self { db }
    }
}

#[async_trait]
impl Tool for MonitorSpawnRequest {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "monitor_spawn_request".into(),
            description:
                "Get the current state of an auto-MCP spawn request you previously created \
                 with `request_capability`. Returns status, any matched/synthesised MCP ids, \
                 and (when complete) the new sub-agent id."
                    .into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "spawnRequestId": { "type": "string" }
                },
                "required": ["spawnRequestId"]
            }),
            side_effects: false,
        }
    }

    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let id = args
            .get("spawnRequestId")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| ToolError::InvalidArgs("`spawnRequestId` is required".into()))?;
        let row = agent_spawn_requests::get(self.db.conn(), id)
            .await
            .map_err(|e| ToolError::Other(format!("lookup spawn request: {e}")))?
            .filter(|r| r.project_id == ctx.project_id)
            .ok_or_else(|| {
                ToolError::Other(format!("spawn request {id} not found in this project"))
            })?;
        Ok(json!({
            "id": row.id,
            "status": row.status,
            "requestedRole": row.requested_role,
            "childAgentId": row.child_agent_id,
            "matchedMcpIds": row.matched_existing_mcp_ids_json,
            "synthesizedMcpIds": row.synthesized_mcp_ids_json,
            "error": row.error,
            "updatedAt": row.updated_at,
        }))
    }
}

/// Register the agent-coordination tools (`spawn_agent`, `message_agent`,
/// `list_visible_agents`, `request_relay`, `delete_agent`, `monitor_agent`,
/// `delegate_task`, `request_capability`, `monitor_spawn_request`).
pub fn register_agent_tools(
    registry: &mut ToolRegistry,
    db: Db,
    executors: Arc<ExecutorRegistry>,
    bus: EventBus,
    spawn_pipeline_launcher: Option<tokio::sync::mpsc::UnboundedSender<String>>,
) {
    registry.insert(Arc::new(SpawnAgent::new(
        db.clone(),
        executors.clone(),
        bus,
    )));
    registry.insert(Arc::new(MessageAgent::new(db.clone(), executors.clone())));
    registry.insert(Arc::new(ListVisibleAgents::new(db.clone())));
    registry.insert(Arc::new(RequestRelay::new(db.clone(), executors.clone())));
    registry.insert(Arc::new(DeleteAgent::new(db.clone(), executors.clone())));
    registry.insert(Arc::new(MonitorAgent::new(db.clone(), executors.clone())));
    registry.insert(Arc::new(DelegateTask::new(db.clone(), executors)));
    registry.insert(Arc::new(RequestCapability::new(
        db.clone(),
        spawn_pipeline_launcher,
    )));
    registry.insert(Arc::new(MonitorSpawnRequest::new(db)));
}
