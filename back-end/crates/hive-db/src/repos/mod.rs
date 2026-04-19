pub mod projects;
pub mod agents;
pub mod tasks;
pub mod alerts;
pub mod notifications;
pub mod notes;
pub mod tech_debt;
pub mod sprints;
pub mod sessions;
pub mod cost_events;
pub mod settings;
pub mod audit;
pub mod llm_providers;

use ulid::Ulid;

/// Generate a new ULID string for use as a primary key.
pub fn new_id() -> String {
    Ulid::new().to_string().to_lowercase()
}

/// Get current UTC timestamp as RFC3339 string.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
