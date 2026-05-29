//! `ExecutorRegistry` — process-wide map of agent_id → AgentExecutor.

use std::{collections::HashMap, sync::Arc};

use hive_db::{repos::agents, Db};
use serde_json::json;
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;

use crate::events::EventBus;
use crate::executor::{
    spawn_executor, AgentExecutor, DriverSlot, ExecutorError, ExecutorState, InboxItem,
};
use crate::turn_driver::TurnDriver;

#[derive(Clone)]
pub struct ExecutorRegistry {
    inner: Arc<RwLock<HashMap<String, Arc<AgentExecutor>>>>,
    /// Per-agent cancellation tokens. Children spawned via the
    /// `spawn_agent` tool derive their token from the parent's via
    /// `parent_token.child_token()`, so cancelling the parent's token
    /// cancels the entire descendant subtree automatically. The map
    /// outlives the executor so a token can be cancelled even after
    /// the executor has been drained from `inner`.
    tokens: Arc<RwLock<HashMap<String, CancellationToken>>>,
    db: Db,
    bus: EventBus,
    driver: DriverSlot,
}

#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("agent executor not found: {0}")]
    NotFound(String),
    #[error("executor error: {0}")]
    Executor(#[from] ExecutorError),
}

impl ExecutorRegistry {
    pub fn new(db: Db, bus: EventBus) -> Self {
        Self {
            inner: Arc::new(RwLock::new(HashMap::new())),
            tokens: Arc::new(RwLock::new(HashMap::new())),
            db,
            bus,
            driver: Arc::new(RwLock::new(None)),
        }
    }

    /// Install the strategy that turns inbox items into real LLM turns.
    /// hive-api wires this in once `AppState` is ready.
    pub async fn set_driver(&self, driver: Arc<dyn TurnDriver>) {
        *self.driver.write().await = Some(driver);
    }

    /// Spawn an executor for `agent_id` if one isn't already running.
    /// `parent_agent_id` (when set) is used to derive a child cancel
    /// token so cancelling the parent cascades to this agent — the
    /// `spawn_agent` tool path passes the spawning agent's id so the
    /// whole descendant subtree shares a cancel scope.
    pub async fn ensure(&self, agent_id: &str, project_id: &str) -> Arc<AgentExecutor> {
        self.ensure_with_parent(agent_id, project_id, None).await
    }

    pub async fn ensure_with_parent(
        &self,
        agent_id: &str,
        project_id: &str,
        parent_agent_id: Option<&str>,
    ) -> Arc<AgentExecutor> {
        {
            let map = self.inner.read().await;
            if let Some(existing) = map.get(agent_id) {
                return existing.clone();
            }
        }
        // Derive the cancel token. Children inherit a child token from
        // the parent so a single `parent.cancel()` propagates down the
        // tree. Top-level agents (no parent, or parent has no token
        // yet) get a fresh root token.
        let token = {
            let mut tokens = self.tokens.write().await;
            if let Some(existing) = tokens.get(agent_id) {
                existing.clone()
            } else {
                let new_token = match parent_agent_id.and_then(|p| tokens.get(p).cloned()) {
                    Some(parent) => parent.child_token(),
                    None => CancellationToken::new(),
                };
                tokens.insert(agent_id.to_owned(), new_token.clone());
                new_token
            }
        };

        let executor = Arc::new(spawn_executor(
            agent_id.to_owned(),
            project_id.to_owned(),
            self.db.clone(),
            self.bus.clone(),
            self.driver.clone(),
            token,
        ));
        let mut map = self.inner.write().await;
        map.entry(agent_id.to_owned())
            .or_insert_with(|| executor.clone())
            .clone()
    }

    /// Cancel an agent's token, cascading the cancel to every
    /// descendant agent spawned via `spawn_agent`. Idempotent.
    pub async fn cancel_subtree(&self, agent_id: &str) {
        if let Some(token) = self.tokens.read().await.get(agent_id).cloned() {
            token.cancel();
            self.bus.emit(
                format!("agent.{agent_id}.cancelled"),
                json!({ "agentId": agent_id, "subtree": true }),
            );
        }
    }

    /// Borrow the cancel token for an agent. Used by the chat-turn
    /// driver to plumb the same cancel scope through `RunTurn`.
    pub async fn token_for(&self, agent_id: &str) -> Option<CancellationToken> {
        self.tokens.read().await.get(agent_id).cloned()
    }

    pub async fn get(&self, agent_id: &str) -> Option<Arc<AgentExecutor>> {
        self.inner.read().await.get(agent_id).cloned()
    }

    pub async fn dispatch(&self, agent_id: &str, item: InboxItem) -> Result<(), RegistryError> {
        let exec = self
            .get(agent_id)
            .await
            .ok_or_else(|| RegistryError::NotFound(agent_id.to_owned()))?;
        exec.dispatch(item).await?;
        Ok(())
    }

    pub async fn pause(&self, agent_id: &str) -> Result<(), RegistryError> {
        let exec = self
            .get(agent_id)
            .await
            .ok_or_else(|| RegistryError::NotFound(agent_id.to_owned()))?;
        exec.pause().await;
        self.bus.emit(
            format!("agent.{agent_id}.status"),
            json!({ "agentId": agent_id, "status": "paused" }),
        );
        Ok(())
    }

    pub async fn resume(&self, agent_id: &str) -> Result<(), RegistryError> {
        let exec = self
            .get(agent_id)
            .await
            .ok_or_else(|| RegistryError::NotFound(agent_id.to_owned()))?;
        exec.resume().await;
        self.bus.emit(
            format!("agent.{agent_id}.status"),
            json!({ "agentId": agent_id, "status": "running" }),
        );
        Ok(())
    }

    pub async fn terminate(&self, agent_id: &str) -> Result<(), RegistryError> {
        let exec = self
            .get(agent_id)
            .await
            .ok_or_else(|| RegistryError::NotFound(agent_id.to_owned()))?;
        exec.terminate().await;
        self.inner.write().await.remove(agent_id);
        self.tokens.write().await.remove(agent_id);
        self.bus.emit(
            format!("agent.{agent_id}.status"),
            json!({ "agentId": agent_id, "status": "terminated" }),
        );
        Ok(())
    }

    pub async fn state(&self, agent_id: &str) -> Option<ExecutorState> {
        let exec = self.get(agent_id).await?;
        Some(exec.state().await)
    }

    /// On startup: walk every persisted agent and spin up an executor so the
    /// inbox can be drained without waiting for a fresh API call.
    ///
    /// ZZ13: Honour the persisted `parent_agent_id` so the cancel-token
    /// tree is rebuilt correctly across restarts. The old shape called
    /// the parent-less `ensure`, so every rehydrated child got a fresh
    /// root token; a later `cancel_subtree(parent)` only cancelled the
    /// parent while the child kept running.
    pub async fn rehydrate_from_db(&self) -> Result<usize, sea_orm::DbErr> {
        let all = agents::list_all(self.db.conn()).await?;
        // Index by parent so we can BFS roots-first. The child must be
        // ensured *after* its parent's token landed in the map, otherwise
        // `ensure_with_parent` falls back to a fresh root token.
        let mut by_parent: std::collections::HashMap<
            Option<String>,
            Vec<&hive_db::entities::agent::Model>,
        > = std::collections::HashMap::new();
        for agent in &all {
            by_parent
                .entry(agent.parent_agent_id.clone())
                .or_default()
                .push(agent);
        }
        let mut queue: std::collections::VecDeque<Option<String>> =
            std::collections::VecDeque::new();
        queue.push_back(None);
        while let Some(parent) = queue.pop_front() {
            if let Some(children) = by_parent.remove(&parent) {
                for child in children {
                    let _ = self
                        .ensure_with_parent(
                            &child.id,
                            &child.project_id,
                            child.parent_agent_id.as_deref(),
                        )
                        .await;
                    queue.push_back(Some(child.id.clone()));
                }
            }
        }
        // Stragglers: agents whose `parent_agent_id` doesn't match any
        // rehydrated row (dangling FK after corruption). Spin them up
        // parent-less so they still get an executor.
        for orphan_group in by_parent.into_values() {
            for agent in orphan_group {
                let _ = self.ensure(&agent.id, &agent.project_id).await;
            }
        }
        Ok(all.len())
    }

    /// Graceful shutdown: terminate every executor, await the abort, drain
    /// the map. Called from the API server's signal handler so SIGTERM
    /// during a streaming turn lets the in-flight work exit cleanly.
    pub async fn shutdown(&self) {
        let executors: Vec<Arc<AgentExecutor>> = {
            let map = self.inner.read().await;
            map.values().cloned().collect()
        };
        let count = executors.len();
        for exec in &executors {
            exec.terminate().await;
        }
        self.inner.write().await.clear();
        self.tokens.write().await.clear();
        if count > 0 {
            tracing::info!(count, "ExecutorRegistry: shutdown complete");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn fresh_registry() -> ExecutorRegistry {
        let db = Db::connect("sqlite::memory:", true)
            .await
            .expect("connect + migrate");
        let bus = EventBus::new(tokio::sync::broadcast::channel(16).0);
        ExecutorRegistry::new(db, bus)
    }

    #[tokio::test]
    async fn terminate_drops_cancelled_token_so_ensure_restarts_clean() {
        let registry = fresh_registry().await;

        let first = registry.ensure("agent-1", "project-1").await;
        registry.cancel_subtree("agent-1").await;
        assert!(first.cancel_token().is_cancelled());

        registry.terminate("agent-1").await.expect("terminate");
        assert!(
            registry.token_for("agent-1").await.is_none(),
            "terminated agents must not retain cancelled tokens"
        );

        let restarted = registry.ensure("agent-1", "project-1").await;
        assert!(
            !restarted.cancel_token().is_cancelled(),
            "restarted executor must receive a fresh cancellation token"
        );
    }

    #[tokio::test]
    async fn rehydrate_preserves_parent_token_so_cancel_subtree_cascades() {
        // ZZ13 regression: rehydrate_from_db must call ensure_with_parent
        // (not the parent-less `ensure`) so the cancel-token tree survives
        // a restart. Without the fix, a child's token is fresh-rooted and
        // `cancel_subtree(parent)` only stops the parent.
        use hive_db::repos::{agents, projects};

        let registry = fresh_registry().await;
        let db = registry.db.clone();

        // Seed a parent + child agent in the DB.
        let project = projects::create(
            db.conn(),
            projects::CreateProject {
                name: "rehydrate-test".into(),
                description: None,
                sovereignty_tier: "local".into(),
                budget_total_cents: 0,
                status: "active".into(),
            },
        )
        .await
        .expect("create project");
        let parent = agents::create(
            db.conn(),
            agents::CreateAgent {
                project_id: project.id.clone(),
                slug: "parent".into(),
                name: "Parent".into(),
                role: "coordinator".into(),
                model: "claude-sonnet-4-6".into(),
                status: "idle".into(),
                parent_agent_id: None,
                spawned_by_message_id: None,
                enabled_tools: None,
                system_prompt: None,
                model_provider_id: None,
                model_id: None,
            },
        )
        .await
        .expect("create parent");
        let child = agents::create(
            db.conn(),
            agents::CreateAgent {
                project_id: project.id.clone(),
                slug: "child".into(),
                name: "Child".into(),
                role: "worker".into(),
                model: "claude-haiku-4-5-20251001".into(),
                status: "idle".into(),
                parent_agent_id: Some(parent.id.clone()),
                spawned_by_message_id: None,
                enabled_tools: None,
                system_prompt: None,
                model_provider_id: None,
                model_id: None,
            },
        )
        .await
        .expect("create child");

        registry.rehydrate_from_db().await.expect("rehydrate");

        let parent_token = registry
            .token_for(&parent.id)
            .await
            .expect("parent has a token");
        let child_token = registry
            .token_for(&child.id)
            .await
            .expect("child has a token");

        assert!(!parent_token.is_cancelled());
        assert!(!child_token.is_cancelled());

        registry.cancel_subtree(&parent.id).await;

        assert!(parent_token.is_cancelled(), "parent must be cancelled");
        assert!(
            child_token.is_cancelled(),
            "child must inherit cancellation through the parent's token tree"
        );
    }

    #[tokio::test]
    async fn shutdown_drops_all_tokens() {
        let registry = fresh_registry().await;

        let _ = registry.ensure("agent-1", "project-1").await;
        let _ = registry.ensure("agent-2", "project-1").await;
        registry.cancel_subtree("agent-1").await;

        registry.shutdown().await;

        assert!(registry.token_for("agent-1").await.is_none());
        assert!(registry.token_for("agent-2").await.is_none());
    }
}
