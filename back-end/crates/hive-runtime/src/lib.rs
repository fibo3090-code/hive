//! Agent + chat execution runtime.
//!
//! Sprint 1 scope: a single `chat::run_completion` function that drives a
//! streaming LLM turn, emits granular SSE events on a shared broadcast bus,
//! persists tokens as they arrive, and writes a cost_event when done.
//!
//! Later sprints add: tool-use loop (Sprint 2), full agent executors with
//! inboxes (Sprint 3), module synthesis (Sprint 4).

pub mod chat;
pub mod events;

pub use events::{EventBus, RuntimeEvent};
