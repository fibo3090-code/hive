//! Repo for `agent_wires` — explicit parent→child edges in the HiveGraph, plus
//! the visibility resolution agents use to decide who they may message.

use std::collections::{HashSet, VecDeque};

use sea_orm::*;

use super::{new_id, now_rfc3339};
use crate::entities::agent_wire::{ActiveModel, Column, Entity, Model};

#[derive(Debug, thiserror::Error)]
pub enum WireError {
    #[error(transparent)]
    Db(#[from] DbErr),
    #[error("a wire cannot connect an agent to itself")]
    SelfLoop,
    #[error("agent {0} is not part of project {1}")]
    AgentNotInProject(String, String),
    #[error("a wire {0} -> {1} already exists")]
    Duplicate(String, String),
    #[error("that wire would create a cycle (a path already runs {1} -> ... -> {0})")]
    Cycle(String, String),
}

pub async fn list_by_project(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<Vec<Model>, DbErr> {
    Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .order_by_asc(Column::CreatedAt)
        .all(db)
        .await
}

pub async fn get(db: &DatabaseConnection, id: &str) -> Result<Option<Model>, DbErr> {
    Entity::find_by_id(id.to_owned()).one(db).await
}

pub async fn delete(db: &DatabaseConnection, id: &str) -> Result<bool, DbErr> {
    let res = Entity::delete_by_id(id.to_owned()).exec(db).await?;
    Ok(res.rows_affected > 0)
}

/// Outgoing adjacency: `parent_agent_id -> [child_agent_id]` for a project.
async fn child_adjacency(
    db: &DatabaseConnection,
    project_id: &str,
) -> Result<std::collections::HashMap<String, Vec<String>>, DbErr> {
    let mut map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for w in list_by_project(db, project_id).await? {
        map.entry(w.parent_agent_id)
            .or_default()
            .push(w.child_agent_id);
    }
    Ok(map)
}

/// Create a wire `parent -> child`, rejecting self-loops, cross-project agents,
/// duplicates, and any edge that would introduce a cycle.
pub async fn create(
    db: &DatabaseConnection,
    project_id: &str,
    parent_agent_id: &str,
    child_agent_id: &str,
) -> Result<Model, WireError> {
    if parent_agent_id == child_agent_id {
        return Err(WireError::SelfLoop);
    }
    // Both agents must belong to this project.
    for aid in [parent_agent_id, child_agent_id] {
        let belongs = crate::entities::agent::Entity::find_by_id(aid.to_owned())
            .filter(crate::entities::agent::Column::ProjectId.eq(project_id))
            .one(db)
            .await?
            .is_some();
        if !belongs {
            return Err(WireError::AgentNotInProject(
                aid.to_owned(),
                project_id.to_owned(),
            ));
        }
    }
    // Duplicate?
    let exists = Entity::find()
        .filter(Column::ParentAgentId.eq(parent_agent_id))
        .filter(Column::ChildAgentId.eq(child_agent_id))
        .one(db)
        .await?
        .is_some();
    if exists {
        return Err(WireError::Duplicate(
            parent_agent_id.to_owned(),
            child_agent_id.to_owned(),
        ));
    }
    // Cycle check: adding parent -> child closes a loop iff `child` can already
    // reach `parent` along existing wires. BFS forward from `child`.
    let adj = child_adjacency(db, project_id).await?;
    let mut seen: HashSet<&str> = HashSet::new();
    let mut q: VecDeque<&str> = VecDeque::new();
    q.push_back(child_agent_id);
    seen.insert(child_agent_id);
    while let Some(cur) = q.pop_front() {
        if cur == parent_agent_id {
            return Err(WireError::Cycle(
                parent_agent_id.to_owned(),
                child_agent_id.to_owned(),
            ));
        }
        if let Some(children) = adj.get(cur) {
            for c in children {
                if seen.insert(c.as_str()) {
                    q.push_back(c.as_str());
                }
            }
        }
    }

    let now = now_rfc3339();
    let model = ActiveModel {
        id: Set(new_id()),
        project_id: Set(project_id.to_owned()),
        parent_agent_id: Set(parent_agent_id.to_owned()),
        child_agent_id: Set(child_agent_id.to_owned()),
        created_at: Set(now),
    };
    Ok(model.insert(db).await?)
}

/// Agents the given agent may directly message: itself, its **direct** parents
/// (wires where it is the child), and all of its descendants (transitively, via
/// wires where it is the parent). Mirrors the HiveGraph visibility rule.
pub async fn visible_agent_ids(
    db: &DatabaseConnection,
    project_id: &str,
    agent_id: &str,
) -> Result<HashSet<String>, DbErr> {
    let mut visible: HashSet<String> = HashSet::new();
    visible.insert(agent_id.to_owned());

    let wires = list_by_project(db, project_id).await?;

    // Direct parents.
    for w in &wires {
        if w.child_agent_id == agent_id {
            visible.insert(w.parent_agent_id.clone());
        }
    }

    // Descendants (BFS over outgoing wires).
    let mut adj: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
    for w in &wires {
        adj.entry(w.parent_agent_id.as_str())
            .or_default()
            .push(w.child_agent_id.as_str());
    }
    let mut q: VecDeque<&str> = VecDeque::new();
    q.push_back(agent_id);
    let mut seen: HashSet<&str> = HashSet::new();
    seen.insert(agent_id);
    while let Some(cur) = q.pop_front() {
        if let Some(children) = adj.get(cur) {
            for c in children {
                if seen.insert(c) {
                    visible.insert((*c).to_owned());
                    q.push_back(c);
                }
            }
        }
    }
    Ok(visible)
}

/// Direct parents of `agent_id` (wires where it is the child).
pub async fn direct_parent_ids(
    db: &DatabaseConnection,
    project_id: &str,
    agent_id: &str,
) -> Result<Vec<String>, DbErr> {
    Ok(Entity::find()
        .filter(Column::ProjectId.eq(project_id))
        .filter(Column::ChildAgentId.eq(agent_id))
        .all(db)
        .await?
        .into_iter()
        .map(|w| w.parent_agent_id)
        .collect())
}
