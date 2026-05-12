//! Agent + chat execution runtime.
//!
//! Sprint 1 scope: a single `chat::run_completion` function that drives a
//! streaming LLM turn, emits granular SSE events on a shared broadcast bus,
//! persists tokens as they arrive, and writes a cost_event when done.
//!
//! Later sprints add: tool-use loop (Sprint 2), full agent executors with
//! inboxes (Sprint 3), module synthesis (Sprint 4).

pub mod agent_tools;
pub mod chat;
pub mod db_tools;
pub mod drift;
pub mod events;
pub mod executor;
pub mod git_tools;
pub mod loop_detector;
pub mod prompt;
pub mod registry;
pub mod spawn;
pub mod spec_doc;
pub mod turn_driver;

pub use agent_tools::register_agent_tools;
pub use db_tools::{register_db_tools, RUNTIME_DEFAULT_TOOL_NAMES, RUNTIME_TOOL_NAMES};
pub use git_tools::{register_git_tools, GIT_TOOL_NAMES};

pub use events::{EventBus, RuntimeEvent};
pub use executor::{AgentExecutor, ExecutorState, InboxItem};
pub use registry::{ExecutorRegistry, RegistryError};
pub use turn_driver::{TurnDriver, TurnDriverError, TurnRequest};
