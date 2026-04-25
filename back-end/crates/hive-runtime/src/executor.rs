//! Per-agent executor task. Each live agent owns one of these for the lifetime
//! of the process — it pulls inbox items off an mpsc channel, drives an LLM
//! turn via the registered `TurnDriver`, and reports back on the event bus.
//!
//! The executor itself is provider-agnostic. The actual LLM work is delegated
//! to a `TurnDriver` that hive-api installs at boot — that lets the executor
//! live in `hive-runtime` without pulling in provider construction, tool
//! registry assembly, or chat-message persistence.

use std::sync::Arc;

use hive_db::{repos::agent_messages, Db};
use serde_json::json;
use tokio::sync::{mpsc, Notify, RwLock};
use tokio::task::JoinHandle;

use crate::events::EventBus;
use crate::turn_driver::{TurnDriver, TurnRequest};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExecutorState {
    Running,
    Paused,
    Terminated,
}

#[derive(Debug, Clone)]
pub struct InboxItem {
    pub message_id: String,
    pub content: String,
    pub thread_id: Option<String>,
    pub from_agent_id: Option<String>,
}

pub type DriverSlot = Arc<RwLock<Option<Arc<dyn TurnDriver>>>>;

pub struct AgentExecutor {
    pub agent_id: String,
    pub project_id: String,
    inbox_tx: mpsc::Sender<InboxItem>,
    state: Arc<RwLock<ExecutorState>>,
    resume: Arc<Notify>,
    handle: JoinHandle<()>,
}

impl AgentExecutor {
    pub fn agent_id(&self) -> &str {
        &self.agent_id
    }

    pub async fn dispatch(&self, item: InboxItem) -> Result<(), ExecutorError> {
        if matches!(*self.state.read().await, ExecutorState::Terminated) {
            return Err(ExecutorError::Terminated);
        }
        self.inbox_tx
            .send(item)
            .await
            .map_err(|_| ExecutorError::Closed)
    }

    pub async fn pause(&self) {
        *self.state.write().await = ExecutorState::Paused;
    }

    pub async fn resume(&self) {
        let mut guard = self.state.write().await;
        if *guard != ExecutorState::Terminated {
            *guard = ExecutorState::Running;
            self.resume.notify_waiters();
        }
    }

    pub async fn terminate(&self) {
        *self.state.write().await = ExecutorState::Terminated;
        self.resume.notify_waiters();
        self.handle.abort();
    }

    pub async fn state(&self) -> ExecutorState {
        *self.state.read().await
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ExecutorError {
    #[error("executor inbox closed")]
    Closed,
    #[error("executor has been terminated")]
    Terminated,
}

/// Spawn a new executor task. The `driver` slot is shared with the
/// `ExecutorRegistry` — if installed, every inbox item is handed to it; if
/// `None`, the executor falls back to the `process_inbox_item` stub (echo).
pub fn spawn_executor(
    agent_id: String,
    project_id: String,
    db: Db,
    bus: EventBus,
    driver: DriverSlot,
) -> AgentExecutor {
    let (inbox_tx, mut inbox_rx) = mpsc::channel::<InboxItem>(64);
    let state = Arc::new(RwLock::new(ExecutorState::Running));
    let resume = Arc::new(Notify::new());

    let task_state = state.clone();
    let task_resume = resume.clone();
    let task_agent_id = agent_id.clone();
    let task_project_id = project_id.clone();
    let task_db = db;
    let task_bus = bus;
    let task_driver = driver;

    let handle = tokio::spawn(async move {
        while let Some(item) = inbox_rx.recv().await {
            // Honor pause: park until resumed (or terminated).
            loop {
                let s = *task_state.read().await;
                match s {
                    ExecutorState::Running => break,
                    ExecutorState::Terminated => return,
                    ExecutorState::Paused => task_resume.notified().await,
                }
            }

            let driver_snapshot = task_driver.read().await.clone();
            match driver_snapshot {
                Some(driver) => {
                    drive_inbox_item(
                        driver,
                        &task_db,
                        &task_bus,
                        &task_agent_id,
                        &task_project_id,
                        item,
                    )
                    .await;
                }
                None => {
                    process_inbox_item_stub(
                        &task_db,
                        &task_bus,
                        &task_agent_id,
                        &task_project_id,
                        item,
                    )
                    .await;
                }
            }
        }
    });

    AgentExecutor {
        agent_id,
        project_id,
        inbox_tx,
        state,
        resume,
        handle,
    }
}

/// Real path: hand the item to the registered `TurnDriver`. The driver is
/// responsible for the running/done lifecycle on the underlying
/// `agent_messages` row; this wrapper only emits the inbox `received` event
/// up-front and an `error` event if the driver itself returned an error.
async fn drive_inbox_item(
    driver: Arc<dyn TurnDriver>,
    db: &Db,
    bus: &EventBus,
    agent_id: &str,
    project_id: &str,
    item: InboxItem,
) {
    bus.emit(
        format!("agent.{agent_id}.inbox"),
        json!({
            "agentId": agent_id,
            "projectId": project_id,
            "messageId": item.message_id,
            "fromAgentId": item.from_agent_id,
            "status": "received",
        }),
    );

    let req = TurnRequest {
        agent_id: agent_id.to_owned(),
        project_id: project_id.to_owned(),
        item: item.clone(),
    };

    if let Err(err) = driver.drive(req).await {
        let detail = err.to_string();
        let _ = agent_messages::mark_error(db.conn(), &item.message_id).await;
        bus.emit(
            format!("agent.{agent_id}.inbox"),
            json!({
                "agentId": agent_id,
                "projectId": project_id,
                "messageId": item.message_id,
                "fromAgentId": item.from_agent_id,
                "status": "error",
                "error": detail,
            }),
        );
    }
}

/// Fallback when no `TurnDriver` is installed — marks the agent_message
/// running → done and emits inbox events. Useful for the boot window before
/// hive-api has wired its driver, and for tests that don't want a real LLM.
async fn process_inbox_item_stub(
    db: &Db,
    bus: &EventBus,
    agent_id: &str,
    project_id: &str,
    item: InboxItem,
) {
    let _ = agent_messages::mark_running(db.conn(), &item.message_id).await;
    bus.emit(
        format!("agent.{agent_id}.inbox"),
        json!({
            "agentId": agent_id,
            "projectId": project_id,
            "messageId": item.message_id,
            "fromAgentId": item.from_agent_id,
            "status": "running",
        }),
    );

    let _ = agent_messages::mark_done(db.conn(), &item.message_id).await;
    bus.emit(
        format!("agent.{agent_id}.inbox"),
        json!({
            "agentId": agent_id,
            "projectId": project_id,
            "messageId": item.message_id,
            "fromAgentId": item.from_agent_id,
            "status": "done",
            "content": item.content,
        }),
    );
}
