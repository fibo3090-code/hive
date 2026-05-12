pub use sea_orm_migration::prelude::*;

mod m20260414_000001_init;
mod m20260414_000002_indexes;
mod m20260414_000003_audit_log;
mod m20260415_000001_provider_keys;
mod m20260420_000001_chat_threads;
mod m20260427_000001_agent_relations;
mod m20260428_000001_cost_cents_i64;
mod m20260504_000001_workspaces;
mod m20260511_000001_synthesis_jobs;
mod m20260518_000001_search_config;
mod m20260601_000001_budget_cents_i64;
mod m20260602_000001_module_publish;
mod m20260603_000001_chat_attachments;
mod m20260605_000001_notification_payload;
mod m20260606_000001_redesign_foundations;
mod m20260606_000002_repair_chat_attachments;
mod m20260612_000001_chat_threads_agent_index;
mod m20260613_000001_agent_wires;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260414_000001_init::Migration),
            Box::new(m20260414_000002_indexes::Migration),
            Box::new(m20260414_000003_audit_log::Migration),
            Box::new(m20260415_000001_provider_keys::Migration),
            Box::new(m20260420_000001_chat_threads::Migration),
            Box::new(m20260427_000001_agent_relations::Migration),
            Box::new(m20260428_000001_cost_cents_i64::Migration),
            Box::new(m20260504_000001_workspaces::Migration),
            Box::new(m20260511_000001_synthesis_jobs::Migration),
            Box::new(m20260518_000001_search_config::Migration),
            Box::new(m20260601_000001_budget_cents_i64::Migration),
            Box::new(m20260602_000001_module_publish::Migration),
            Box::new(m20260603_000001_chat_attachments::Migration),
            Box::new(m20260605_000001_notification_payload::Migration),
            Box::new(m20260606_000001_redesign_foundations::Migration),
            Box::new(m20260606_000002_repair_chat_attachments::Migration),
            Box::new(m20260612_000001_chat_threads_agent_index::Migration),
            Box::new(m20260613_000001_agent_wires::Migration),
        ]
    }
}
