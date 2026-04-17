use sea_orm_migration::prelude::*;

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260414_000003_audit_log"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.create_table(
            Table::create()
                .table(AuditLog::Table)
                .if_not_exists()
                .col(ColumnDef::new(AuditLog::Id).string().not_null().primary_key())
                .col(ColumnDef::new(AuditLog::Actor).string().not_null())
                .col(ColumnDef::new(AuditLog::Action).string().not_null())
                .col(ColumnDef::new(AuditLog::EntityType).string().not_null())
                .col(ColumnDef::new(AuditLog::EntityId).string().not_null())
                .col(ColumnDef::new(AuditLog::Before).json().null())
                .col(ColumnDef::new(AuditLog::After).json().null())
                .col(ColumnDef::new(AuditLog::CreatedAt).string().not_null())
                .to_owned(),
        ).await?;
        manager.create_index(Index::create().name("idx_audit_log_entity").table(AuditLog::Table).col(AuditLog::EntityType).col(AuditLog::EntityId).to_owned()).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager.drop_index(Index::drop().name("idx_audit_log_entity").to_owned()).await?;
        manager.drop_table(Table::drop().table(AuditLog::Table).if_exists().to_owned()).await?;
        Ok(())
    }
}

#[derive(Iden)]
enum AuditLog { Table, Id, Actor, Action, EntityType, EntityId, Before, After, CreatedAt }
