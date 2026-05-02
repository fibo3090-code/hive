//! `ExecutorRegistry` — process-wide map of agent_id → AgentExecutor.

use std::{collections::HashMap, sync::Arc};

use hive_db::{repos::agents, Db};
use serde_json::json;
use tokio::sync::RwLock;

use crate::events::EventBus;
use crate::executor::{spawn_executor, AgentExecutor, DriverSlot, ExecutorError, ExecutorState, InboxItem};
use crate::turn_driver::TurnDriver;

#[derive(Clone)]
pub struct ExecutorRegistry {
    inner: Arc<RwLock<HashMap<String, Arc<AgentExecutor>>>>,
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

    /// Spawn an executor for `agent_id` if one isn't already running and
    /// return a clone of the handle.
    pub async fn ensure(&self, agent_id: &str, project_id: &str) -> Arc<AgentExecutor> {
        {
            let map = self.inner.read().await;
            if let Some(existing) = map.get(agent_id) {
                return existing.clone();
            }
        }
        let executor = Arc::new(spawn_executor(
            agent_id.to_owned(),
            project_id.to_owned(),
            self.db.clone(),
            self.bus.clone(),
            self.driver.clone(),
        ));
        let mut map = self.inner.write().await;
        map.entry(agent_id.to_owned())
            .or_insert_with(|| executor.clone())
            .clone()
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
    pub async fn rehydrate_from_db(&self) -> Result<usize, sea_orm::DbErr> {
        let all = agents::list_all(self.db.conn()).await?;
        for agent in &all {
            let _ = self.ensure(&agent.id, &agent.project_id).await;
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
        if count > 0 {
            tracing::info!(count, "ExecutorRegistry: shutdown complete");
        }
    }
}
