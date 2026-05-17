//! DB-backed agent tools that don't need the executor registry — Hive Mind
//! notes, spec-doc reads, task creation, tech-debt CRUD, and drift recording.
//! Like `agent_tools`, these live in `hive-runtime` (not `hive-tools`) because
//! they touch the `Db`. Everything here is automatically scoped to the calling
//! agent's `project_id` via [`ToolContext`].

use std::sync::Arc;

use async_trait::async_trait;
use hive_db::{
    repos::{
        agent_skill_bindings, drift_events, notes, spec_document_sections, spec_documents, tasks,
        tech_debt,
    },
    Db,
};
use hive_tools::{Tool, ToolContext, ToolError, ToolManifest, ToolRegistry, ToolResult};
use serde_json::{json, Value};

/// Every tool name registered by [`register_agent_tools`] +
/// [`register_db_tools`]. `hive-api` uses this to keep its tool-allowlist
/// validation and category map in sync without re-listing the names.
pub const RUNTIME_TOOL_NAMES: &[&str] = &[
    "spawn_agent",
    "message_agent",
    "list_visible_agents",
    "request_relay",
    "delete_agent",
    "monitor_agent",
    "delegate_task",
    "hive_mind_write",
    "hive_mind_read",
    "hive_mind_list",
    "hive_mind_delete",
    "list_spec_docs",
    "read_spec_doc",
    "add_task",
    "set_task_status",
    "add_tech_debt",
    "update_tech_debt",
    "record_drift",
    "list_skills",
    "read_skill",
];

/// The subset of [`RUNTIME_TOOL_NAMES`] that is safe to enable for every agent
/// by default (read/write project state, but no agent-spawning authority).
pub const RUNTIME_DEFAULT_TOOL_NAMES: &[&str] = &[
    "hive_mind_write",
    "hive_mind_read",
    "hive_mind_list",
    "hive_mind_delete",
    "list_spec_docs",
    "read_spec_doc",
    "add_task",
    "set_task_status",
    "add_tech_debt",
    "update_tech_debt",
    "record_drift",
    "list_skills",
    "read_skill",
];

fn str_arg<'a>(args: &'a Value, key: &str) -> ToolResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| ToolError::InvalidArgs(format!("`{key}` is required")))
}

fn opt_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
}

fn author_of(ctx: &ToolContext) -> String {
    ctx.agent_id.clone().unwrap_or_else(|| "agent".to_owned())
}

// ── Hive Mind ───────────────────────────────────────────────────────────────

pub struct HiveMindWrite {
    db: Db,
}
#[async_trait]
impl Tool for HiveMindWrite {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "hive_mind_write".into(),
            description: "Persist a note into the shared Hive Mind for this project (decisions, facts, conventions other agents should remember).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "body": { "type": "string", "description": "Note body / content." },
                    "topic": { "type": "string", "description": "Optional category, e.g. 'decisions', 'conventions'. Defaults to 'general'." }
                },
                "required": ["title", "body"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let title = str_arg(&args, "title")?.to_owned();
        let body = str_arg(&args, "body")?.to_owned();
        let topic = opt_str(&args, "topic").unwrap_or_else(|| "general".to_owned());
        let note = notes::create(
            self.db.conn(),
            notes::CreateNote {
                project_id: ctx.project_id.clone(),
                category: topic,
                title,
                content: body,
                auto: true,
                author: author_of(ctx),
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("write note: {e}")))?;
        Ok(json!({ "id": note.id, "title": note.title, "topic": note.category }))
    }
}

pub struct HiveMindList {
    db: Db,
}
#[async_trait]
impl Tool for HiveMindList {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "hive_mind_list".into(),
            description: "List Hive Mind notes for this project (optionally filtered by topic).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "topic": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 200 }
                }
            }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let topic = opt_str(&args, "topic");
        let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(50).min(200) as usize;
        let mut rows = notes::list_by_project(self.db.conn(), &ctx.project_id)
            .await
            .map_err(|e| ToolError::Other(format!("list notes: {e}")))?;
        if let Some(t) = &topic {
            rows.retain(|n| n.category.eq_ignore_ascii_case(t));
        }
        rows.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        rows.truncate(limit);
        let items: Vec<Value> = rows
            .into_iter()
            .map(|n| {
                let snippet: String = n.content.chars().take(160).collect();
                json!({ "id": n.id, "topic": n.category, "title": n.title, "snippet": snippet, "author": n.author, "updatedAt": n.updated_at })
            })
            .collect();
        Ok(json!({ "notes": items }))
    }
}

pub struct HiveMindRead {
    db: Db,
}
#[async_trait]
impl Tool for HiveMindRead {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "hive_mind_read".into(),
            description: "Read the full body of a single Hive Mind note by id.".into(),
            input_schema: json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let id = str_arg(&args, "id")?;
        let row = notes::list_by_project(self.db.conn(), &ctx.project_id)
            .await
            .map_err(|e| ToolError::Other(format!("read note: {e}")))?
            .into_iter()
            .find(|n| n.id == id)
            .ok_or_else(|| ToolError::Other(format!("note {id} not found in this project")))?;
        Ok(json!({ "id": row.id, "topic": row.category, "title": row.title, "content": row.content, "author": row.author, "createdAt": row.created_at, "updatedAt": row.updated_at }))
    }
}

pub struct HiveMindDelete {
    db: Db,
}
#[async_trait]
impl Tool for HiveMindDelete {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "hive_mind_delete".into(),
            description: "Delete a Hive Mind note by id.".into(),
            input_schema: json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let id = str_arg(&args, "id")?;
        // One DELETE WHERE id=? AND project_id=? — no list+iterate +
        // bare-id delete window where an agent could smuggle in a foreign
        // note id and silently nuke it. `RecordNotFound` covers both
        // "doesn't exist" and "exists but isn't in this project".
        match notes::delete_for_project(self.db.conn(), id, &ctx.project_id).await {
            Ok(()) => Ok(json!({ "ok": true, "id": id })),
            Err(sea_orm::DbErr::RecordNotFound(_)) => Err(ToolError::Other(format!(
                "note {id} not found in this project"
            ))),
            Err(e) => Err(ToolError::Other(format!("delete note: {e}"))),
        }
    }
}

// ── Spec docs ───────────────────────────────────────────────────────────────

pub struct ListSpecDocs {
    db: Db,
}
#[async_trait]
impl Tool for ListSpecDocs {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "list_spec_docs".into(),
            description: "List the spec documents attached to this project.".into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            side_effects: false,
        }
    }
    async fn invoke(&self, _args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let rows = spec_documents::list_for_project(self.db.conn(), &ctx.project_id)
            .await
            .map_err(|e| ToolError::Other(format!("list spec docs: {e}")))?;
        let items: Vec<Value> = rows
            .into_iter()
            .map(|d| json!({ "id": d.id, "title": d.title, "source": d.source, "version": d.version, "updatedAt": d.updated_at }))
            .collect();
        Ok(json!({ "specDocs": items }))
    }
}

pub struct ReadSpecDoc {
    db: Db,
}
#[async_trait]
impl Tool for ReadSpecDoc {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "read_spec_doc".into(),
            description: "Read a spec document's markdown and its section anchors.".into(),
            input_schema: json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let id = str_arg(&args, "id")?;
        let doc = spec_documents::get(self.db.conn(), id)
            .await
            .map_err(|e| ToolError::Other(format!("read spec doc: {e}")))?
            .filter(|d| d.project_id == ctx.project_id)
            .ok_or_else(|| ToolError::Other(format!("spec doc {id} not found in this project")))?;
        let sections = spec_document_sections::list_for_document(self.db.conn(), id)
            .await
            .map_err(|e| ToolError::Other(format!("read spec sections: {e}")))?;
        let section_values: Vec<Value> = sections
            .into_iter()
            .map(|s| serde_json::to_value(&s).unwrap_or(Value::Null))
            .collect();
        Ok(json!({ "id": doc.id, "title": doc.title, "source": doc.source, "version": doc.version, "markdown": doc.markdown, "sections": section_values }))
    }
}

// ── Tasks ───────────────────────────────────────────────────────────────────

pub struct AddTask {
    db: Db,
}
#[async_trait]
impl Tool for AddTask {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "add_task".into(),
            description: "Create a task in this project's backlog, optionally assigned to an agent.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "agentId": { "type": "string" },
                    "phase": { "type": "string" },
                    "priority": { "type": "string", "enum": ["low", "medium", "high"] }
                },
                "required": ["title"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let title = str_arg(&args, "title")?.to_owned();
        let task = tasks::create(
            self.db.conn(),
            tasks::CreateTask {
                project_id: ctx.project_id.clone(),
                title,
                status: "pending".into(),
                phase: opt_str(&args, "phase"),
                priority: opt_str(&args, "priority").unwrap_or_else(|| "medium".to_owned()),
                estimated_tokens: 0,
                agent_id: opt_str(&args, "agentId"),
                sprint_id: None,
                spec_section_id: None,
                due_at: None,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("add task: {e}")))?;
        Ok(json!({ "id": task.id, "title": task.title, "status": task.status }))
    }
}

/// `set_task_status` — agents call this to mark their own assigned task
/// `completed`, `blocked`, `in-progress`, `cancelled`, etc. This is the
/// closing-the-loop tool that lets the W3-B3 scheduler stop redispatching
/// a finished task. Project isolation is enforced in the repo layer
/// (`tasks::set_status` uses `WHERE id = ? AND project_id = ?`).
pub struct SetTaskStatus {
    db: Db,
}
#[async_trait]
impl Tool for SetTaskStatus {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "set_task_status".into(),
            description: "Set the status of a task in this project. Use 'completed' when done, 'blocked' if you need help, 'in-progress' to claim it. Include a brief outcome/blocker note in 'summary'.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "taskId": { "type": "string" },
                    "status": {
                        "type": "string",
                        "enum": ["pending", "in-progress", "queued", "completed", "blocked", "cancelled"]
                    },
                    "summary": { "type": "string", "description": "Optional one-line outcome or blocker note, surfaced to the operator." }
                },
                "required": ["taskId", "status"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let task_id = str_arg(&args, "taskId")?;
        let status = str_arg(&args, "status")?;
        let summary = opt_str(&args, "summary");
        let updated = match tasks::set_status(self.db.conn(), &ctx.project_id, task_id, status).await {
            Ok(t) => t,
            Err(sea_orm::DbErr::RecordNotFound(_)) => {
                return Err(ToolError::Other(format!(
                    "task {task_id} not found in this project"
                )))
            }
            Err(e) => return Err(ToolError::Other(format!("set task status: {e}"))),
        };
        // Append a note onto the Hive Mind so the operator sees *why* the
        // agent flipped the status — without forcing an Alert. The author
        // is the calling agent's id (or the fallback "agent" string).
        if let Some(note) = summary {
            let _ = notes::create(
                self.db.conn(),
                notes::CreateNote {
                    project_id: ctx.project_id.clone(),
                    category: "Auto-generated".into(),
                    title: format!("Task {status}: {}", updated.title),
                    content: note,
                    auto: true,
                    author: author_of(ctx),
                },
            )
            .await;
        }
        Ok(json!({
            "id": updated.id,
            "status": updated.status,
            "completedAt": updated.completed_at,
        }))
    }
}

// ── Tech debt ───────────────────────────────────────────────────────────────

pub struct AddTechDebt {
    db: Db,
}
#[async_trait]
impl Tool for AddTechDebt {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "add_tech_debt".into(),
            description: "Log a tech-debt item for this project.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "severity": { "type": "string", "enum": ["low", "medium", "high"] },
                    "description": { "type": "string" },
                    "file": { "type": "string" },
                    "impact": { "type": "string" }
                },
                "required": ["title"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let title = str_arg(&args, "title")?.to_owned();
        let item = tech_debt::create(
            self.db.conn(),
            tech_debt::CreateTechDebt {
                project_id: ctx.project_id.clone(),
                title,
                description: opt_str(&args, "description"),
                file: opt_str(&args, "file"),
                impact: opt_str(&args, "impact"),
                severity: opt_str(&args, "severity").unwrap_or_else(|| "medium".to_owned()),
                lines: 0,
                position: 0,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("add tech debt: {e}")))?;
        Ok(json!({ "id": item.id, "title": item.title, "severity": item.severity }))
    }
}

pub struct UpdateTechDebt {
    db: Db,
}
#[async_trait]
impl Tool for UpdateTechDebt {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "update_tech_debt".into(),
            description: "Update a tech-debt item (title / description / severity).".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "severity": { "type": "string", "enum": ["low", "medium", "high"] }
                },
                "required": ["id"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let id = str_arg(&args, "id")?;
        let belongs = tech_debt::list_by_project(self.db.conn(), &ctx.project_id)
            .await
            .map_err(|e| ToolError::Other(format!("update tech debt: {e}")))?
            .iter()
            .any(|t| t.id == id);
        if !belongs {
            return Err(ToolError::Other(format!("tech-debt item {id} not found in this project")));
        }
        let item = tech_debt::update(
            self.db.conn(),
            id,
            tech_debt::UpdateTechDebt {
                title: opt_str(&args, "title"),
                description: opt_str(&args, "description").map(Some),
                file: None,
                impact: None,
                severity: opt_str(&args, "severity"),
                lines: None,
                position: None,
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("update tech debt: {e}")))?;
        Ok(json!({ "id": item.id, "title": item.title, "severity": item.severity }))
    }
}

// ── Drift ───────────────────────────────────────────────────────────────────

pub struct RecordDrift {
    db: Db,
}
#[async_trait]
impl Tool for RecordDrift {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "record_drift".into(),
            description: "Record a drift event — your work has diverged from the task, the code from the spec, or behaviour from the system prompt.".into(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "summary": { "type": "string", "description": "What drifted and how." },
                    "severity": { "type": "string", "enum": ["low", "medium", "high"] },
                    "kind": { "type": "string", "enum": ["agent-vs-task", "code-vs-spec", "agent-vs-system-prompt"] },
                    "subjectId": { "type": "string", "description": "Id of the drifting thing (defaults to the calling agent)." }
                },
                "required": ["summary"]
            }),
            side_effects: true,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let summary = str_arg(&args, "summary")?.to_owned();
        let kind = opt_str(&args, "kind").unwrap_or_else(|| "agent-vs-task".to_owned());
        let subject_id = opt_str(&args, "subjectId")
            .or_else(|| ctx.agent_id.clone())
            .unwrap_or_else(|| "unknown".to_owned());
        let event = drift_events::create(
            self.db.conn(),
            drift_events::CreateDriftEvent {
                project_id: ctx.project_id.clone(),
                kind,
                subject_id,
                subject_kind: "agent".into(),
                evidence_json: json!({ "summary": summary, "reportedBy": author_of(ctx) }),
                severity: opt_str(&args, "severity").unwrap_or_else(|| "medium".to_owned()),
            },
        )
        .await
        .map_err(|e| ToolError::Other(format!("record drift: {e}")))?;
        Ok(json!({ "id": event.id, "kind": event.kind, "severity": event.severity }))
    }
}

// ── Skills ──────────────────────────────────────────────────────────────────

pub struct ListSkills {
    db: Db,
}
#[async_trait]
impl Tool for ListSkills {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "list_skills".into(),
            description:
                "List the skills bound to this agent. Returns slug, name, and a short \
                 description; call `read_skill` with the slug to get the full playbook."
                    .into(),
            input_schema: json!({ "type": "object", "properties": {} }),
            side_effects: false,
        }
    }
    async fn invoke(&self, _args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let Some(agent_id) = ctx.agent_id.as_deref() else {
            return Ok(json!({ "skills": [] }));
        };
        let bound = agent_skill_bindings::list_skills_for_agent(self.db.conn(), agent_id)
            .await
            .map_err(|e| ToolError::Other(format!("list skills: {e}")))?;
        let items: Vec<Value> = bound
            .into_iter()
            .map(|s| {
                json!({
                    "slug": s.slug,
                    "name": s.name,
                    "description": s.description,
                })
            })
            .collect();
        Ok(json!({ "skills": items }))
    }
}

pub struct ReadSkill {
    db: Db,
}
#[async_trait]
impl Tool for ReadSkill {
    fn manifest(&self) -> ToolManifest {
        ToolManifest {
            name: "read_skill".into(),
            description:
                "Fetch a bound skill's full playbook (system prompt fragment, allowed tools \
                 / paths, required connectors, capability tags, and the markdown body). \
                 Pass the `slug` returned by `list_skills`."
                    .into(),
            input_schema: json!({
                "type": "object",
                "properties": { "slug": { "type": "string" } },
                "required": ["slug"]
            }),
            side_effects: false,
        }
    }
    async fn invoke(&self, args: Value, ctx: &ToolContext) -> ToolResult<Value> {
        let slug = str_arg(&args, "slug")?;
        let agent_id = ctx
            .agent_id
            .as_deref()
            .ok_or_else(|| ToolError::Other("read_skill: caller has no agent_id".into()))?;
        // Reject reads of skills the caller isn't bound to. Without this an
        // agent could enumerate the whole project skill catalogue at will.
        let bound = agent_skill_bindings::list_skills_for_agent(self.db.conn(), agent_id)
            .await
            .map_err(|e| ToolError::Other(format!("list bound skills: {e}")))?;
        let skill = bound.into_iter().find(|s| s.slug == slug).ok_or_else(|| {
            ToolError::Other(format!("skill `{slug}` is not bound to this agent"))
        })?;
        Ok(json!({
            "slug": skill.slug,
            "name": skill.name,
            "description": skill.description,
            "systemPromptFragment": skill.system_prompt_fragment,
            "allowedTools": skill.allowed_tools_json,
            "allowedPaths": skill.allowed_paths_json,
            "requiresConnectorIds": skill.requires_connector_ids_json,
            "capabilities": skill.capabilities_json,
            "markdownBody": skill.markdown_body,
        }))
    }
}

/// Register the DB-backed agent tools (Hive Mind, spec, task, tech-debt, drift, skills).
pub fn register_db_tools(registry: &mut ToolRegistry, db: Db) {
    registry.insert(Arc::new(HiveMindWrite { db: db.clone() }));
    registry.insert(Arc::new(HiveMindList { db: db.clone() }));
    registry.insert(Arc::new(HiveMindRead { db: db.clone() }));
    registry.insert(Arc::new(HiveMindDelete { db: db.clone() }));
    registry.insert(Arc::new(ListSpecDocs { db: db.clone() }));
    registry.insert(Arc::new(ReadSpecDoc { db: db.clone() }));
    registry.insert(Arc::new(AddTask { db: db.clone() }));
    registry.insert(Arc::new(SetTaskStatus { db: db.clone() }));
    registry.insert(Arc::new(AddTechDebt { db: db.clone() }));
    registry.insert(Arc::new(UpdateTechDebt { db: db.clone() }));
    registry.insert(Arc::new(RecordDrift { db: db.clone() }));
    registry.insert(Arc::new(ListSkills { db: db.clone() }));
    registry.insert(Arc::new(ReadSkill { db }));
}
