use sea_orm::*;
use serde::{Deserialize, Serialize};

use super::{new_id, now_rfc3339};
use crate::entities::agent::{ActiveModel, Column, Entity, Model};

// ── Input structs ────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgent {
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub role: String,
    pub model: String,
    pub status: String,
    #[serde(default)]
    pub parent_agent_id: Option<String>,
    #[serde(default)]
    pub spawned_by_message_id: Option<String>,
    #[serde(default)]
    pub enabled_tools: Option<Vec<String>>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub model_provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAgent {
    pub slug: Option<String>,
    pub name: Option<String>,
    pub role: Option<String>,
    pub model: Option<String>,
    pub status: Option<String>,
    pub current_task: Option<Option<String>>,
    pub quality_score: Option<Option<i32>>,
    pub tokens_used: Option<i64>,
    pub eval_scores: Option<serde_json::Value>,
    pub enabled_tools: Option<Vec<String>>,
    pub system_prompt: Option<Option<String>>,
    pub model_provider_id: Option<Option<String>>,
    pub model_id: Option<Option<String>>,
}

// ── Queries ──────────────────────────────────────────────────────────────────

/// List all agents belonging to a project.
pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::DeletedAt.is_null())
        .all(db)
        .await
}

/// List every non-deleted agent across all projects.
pub async fn list_all(db: &DatabaseConnection) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::DeletedAt.is_null())
        .all(db)
        .await
}

/// Get a single agent by id.
pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned())
        .filter(Column::DeletedAt.is_null())
        .one(db)
        .await
}

/// Create a new agent.
pub async fn create<C: ConnectionTrait>(db: &C, input: CreateAgent) -> Result<Model, DbErr> {
    let now = now_rfc3339();
    let enabled_tools = input
        .enabled_tools
        .map(|v| serde_json::to_value(v).unwrap_or_else(|_| serde_json::json!([])))
        .unwrap_or_else(|| serde_json::json!([]));
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(input.project_id),
        slug: Set(input.slug),
        name: Set(input.name),
        role: Set(input.role),
        model: Set(input.model),
        status: Set(input.status),
        current_task: Set(None),
        quality_score: Set(None),
        tokens_used: Set(0),
        eval_scores: Set(serde_json::json!({})),
        parent_agent_id: Set(input.parent_agent_id),
        spawned_by_message_id: Set(input.spawned_by_message_id),
        enabled_tools: Set(enabled_tools),
        system_prompt: Set(input.system_prompt),
        model_provider_id: Set(input.model_provider_id),
        model_id: Set(input.model_id),
        created_at: Set(now.clone()),
        updated_at: Set(now),
        deleted_at: Set(None),
    };
    model.insert(db).await
}

/// Partially update an existing agent.
pub async fn update(
    db: &DatabaseConnection,
    project_id: &str,
    id: &str,
    input: UpdateAgent,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .filter(Column::ProjectId.eq(project_id))
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();

    if let Some(v) = input.slug {
        model.slug = Set(v);
    }
    if let Some(v) = input.name {
        model.name = Set(v);
    }
    if let Some(v) = input.role {
        model.role = Set(v);
    }
    if let Some(v) = input.model {
        model.model = Set(v);
    }
    if let Some(v) = input.status {
        model.status = Set(v);
    }
    if let Some(v) = input.current_task {
        model.current_task = Set(v);
    }
    if let Some(v) = input.quality_score {
        model.quality_score = Set(v);
    }
    if let Some(v) = input.tokens_used {
        model.tokens_used = Set(v);
    }
    if let Some(v) = input.eval_scores {
        model.eval_scores = Set(v);
    }
    if let Some(v) = input.enabled_tools {
        model.enabled_tools =
            Set(serde_json::to_value(v).unwrap_or_else(|_| serde_json::json!([])));
    }
    if let Some(v) = input.system_prompt {
        model.system_prompt = Set(v);
    }
    if let Some(v) = input.model_provider_id {
        model.model_provider_id = Set(v);
    }
    if let Some(v) = input.model_id {
        model.model_id = Set(v);
    }

    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Set the status of an agent.
pub async fn set_status(
    db: &DatabaseConnection,
    project_id: &str,
    id: &str,
    status: &str,
) -> Result<Model, DbErr> {
    let existing = Entity::find_by_id(id.to_owned())
        .filter(Column::ProjectId.eq(project_id))
        .one(db)
        .await?
        .ok_or(DbErr::RecordNotFound(id.to_owned()))?;

    let mut model: ActiveModel = existing.into();
    model.status = Set(status.to_owned());
    model.updated_at = Set(now_rfc3339());
    model.update(db).await
}

/// Count agents belonging to a project.
pub async fn count_by_project(db: &DatabaseConnection, project_id: &str) -> Result<u64, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::DeletedAt.is_null())
        .count(db)
        .await
}

/// Batched [`count_by_project`] across the whole DB: one
/// `GROUP BY project_id` query returning `project_id → live agent count`.
/// Lets `list_projects` avoid an N+1 (C060). Projects with no agents are
/// absent from the map (callers default to 0).
pub async fn count_by_project_all(
    db: &DatabaseConnection,
) -> Result<std::collections::HashMap<String, i64>, DbErr> {
    let rows: Vec<(String, i64)> = Entity::find()
        .select_only()
        .column(Column::ProjectId)
        .column_as(Column::Id.count(), "count")
        .filter(Column::DeletedAt.is_null())
        .group_by(Column::ProjectId)
        .into_tuple()
        .all(db)
        .await?;
    Ok(rows.into_iter().collect())
}

/// Get the agent's enabled-tools list as a `Vec<String>` (best-effort parse).
pub fn parse_enabled_tools(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// List direct children of an agent.
pub async fn list_children(
    db: &DatabaseConnection,
    parent_agent_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ParentAgentId.eq(parent_agent_id))
        .filter(Column::DeletedAt.is_null())
        .all(db)
        .await
}

/// Load every live agent in the subject's project, keyed by id. One query
/// replaces the old per-node/per-level fetches in `ancestors`/`descendants`
/// (C143/C144); projects hold tens of agents, so walking in memory is cheap.
async fn project_agents_by_id(
    db: &DatabaseConnection,
    subject: &Model,
) -> Result<std::collections::HashMap<String, Model>, DbErr> {
    let rows = Entity::find()
        .filter(Column::ProjectId.eq(subject.project_id.clone()))
        .filter(Column::DeletedAt.is_null())
        .all(db)
        .await?;
    Ok(rows.into_iter().map(|a| (a.id.clone(), a)).collect())
}

/// Walk up the parent chain. Returns ordered ancestors closest-first.
pub async fn ancestors(db: &DatabaseConnection, id: &str) -> Result<Vec<Model>, DbErr> {
    let Some(subject) = Entity::find_by_id(id.to_owned())
        .filter(Column::DeletedAt.is_null())
        .one(db)
        .await?
    else {
        return Ok(Vec::new());
    };
    let by_id = project_agents_by_id(db, &subject).await?;
    let mut chain = Vec::new();
    let mut cursor = subject.parent_agent_id.clone();
    let mut depth = 0;
    while depth < 32 {
        let Some(parent_id) = cursor else { break };
        let Some(agent) = by_id.get(&parent_id) else {
            break;
        };
        cursor = agent.parent_agent_id.clone();
        chain.push(agent.clone());
        depth += 1;
    }
    Ok(chain)
}

/// Walk down the descendant tree (BFS).
pub async fn descendants(db: &DatabaseConnection, id: &str) -> Result<Vec<Model>, DbErr> {
    let Some(subject) = Entity::find_by_id(id.to_owned())
        .filter(Column::DeletedAt.is_null())
        .one(db)
        .await?
    else {
        return Ok(Vec::new());
    };
    let by_id = project_agents_by_id(db, &subject).await?;
    let mut children_of: std::collections::HashMap<&str, Vec<&Model>> =
        std::collections::HashMap::new();
    for agent in by_id.values() {
        if let Some(parent) = agent.parent_agent_id.as_deref() {
            children_of.entry(parent).or_default().push(agent);
        }
    }
    // Deterministic order within a level (HashMap iteration isn't).
    for kids in children_of.values_mut() {
        kids.sort_by(|a, b| a.id.cmp(&b.id));
    }
    let mut out = Vec::new();
    let mut frontier = vec![id];
    let mut depth = 0;
    while !frontier.is_empty() && depth < 16 {
        let mut next = Vec::new();
        for parent_id in frontier {
            for kid in children_of.get(parent_id).into_iter().flatten() {
                next.push(kid.id.as_str());
                out.push((*kid).clone());
            }
        }
        frontier = next;
        depth += 1;
    }
    Ok(out)
}
