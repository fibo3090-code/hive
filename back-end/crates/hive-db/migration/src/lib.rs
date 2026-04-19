pub use sea_orm_migration::prelude::*;

mod m20260414_000001_init;
mod m20260414_000002_indexes;
mod m20260414_000003_audit_log;
mod m20260415_000001_provider_keys;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m20260414_000001_init::Migration),
            Box::new(m20260414_000002_indexes::Migration),
            Box::new(m20260414_000003_audit_log::Migration),
            Box::new(m20260415_000001_provider_keys::Migration),
        ]
    }
}
