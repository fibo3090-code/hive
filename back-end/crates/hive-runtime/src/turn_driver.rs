//! `TurnDriver` — strategy interface that lets the executor delegate the actual
//! "run an LLM turn for this inbox item" work back to `hive-api`, which owns
//! provider construction, tool registry assembly, and chat-message persistence.
//!
//! The executor itself stays in `hive-runtime` and knows nothing about LLM
//! provider config: when an inbox item arrives, it calls `TurnDriver::drive`
//! with the inputs, and the driver does the heavy lifting (load agent, build
//! `chat::run_turn` params, stream tokens, mark `agent_messages` done).

use async_trait::async_trait;

use crate::executor::InboxItem;

#[derive(Debug, thiserror::Error)]
pub enum TurnDriverError {
    #[error("turn driver error: {0}")]
    Other(String),
}

pub struct TurnRequest {
    pub agent_id: String,
    pub project_id: String,
    pub item: InboxItem,
}

#[async_trait]
pub trait TurnDriver: Send + Sync {
    async fn drive(&self, req: TurnRequest) -> Result<(), TurnDriverError>;
}
