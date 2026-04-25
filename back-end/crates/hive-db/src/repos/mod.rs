pub mod agent_messages;
pub mod agents;
pub mod alerts;
pub mod audit;
pub mod chat_messages;
pub mod chat_threads;
pub mod cost_events;
pub mod llm_providers;
pub mod notes;
pub mod notifications;
pub mod projects;
pub mod sessions;
pub mod settings;
pub mod sprints;
pub mod tasks;
pub mod tech_debt;

use ulid::Ulid;

/// Generate a new ULID string for use as a primary key.
pub fn new_id() -> String {
    Ulid::new().to_string().to_lowercase()
}

/// Get current UTC timestamp as RFC3339 string.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
