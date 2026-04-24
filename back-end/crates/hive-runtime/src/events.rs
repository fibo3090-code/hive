//! Runtime event bus. Matches `hive-api::DomainEvent` shape (name + JSON)
//! but is re-exported so downstream crates don't depend on hive-api.

use serde_json::Value;
use tokio::sync::broadcast;

#[derive(Clone, Debug)]
pub struct RuntimeEvent {
    pub event: String,
    pub data: Value,
}

/// Thin wrapper over `broadcast::Sender` so callers don't need to think about
/// the underlying channel semantics.
#[derive(Clone)]
pub struct EventBus {
    sender: broadcast::Sender<RuntimeEvent>,
}

impl EventBus {
    pub fn new(sender: broadcast::Sender<RuntimeEvent>) -> Self {
        Self { sender }
    }

    pub fn emit(&self, event: impl Into<String>, data: Value) {
        let _ = self.sender.send(RuntimeEvent {
            event: event.into(),
            data,
        });
    }
}
