use sea_orm_migration::prelude::*;
use sea_orm_migration::sea_orm::{ConnectionTrait, Statement};

pub struct Migration;

impl MigrationName for Migration {
    fn name(&self) -> &str {
        "m20260415_000001_provider_keys"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(LlmProviders::Table)
                    .add_column(
                        ColumnDef::new(LlmProviders::Kind)
                            .string()
                            .not_null()
                            .default(""),
                    )
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmProviders::Table)
                    .add_column(ColumnDef::new(LlmProviders::BaseUrl).string().null())
                    .to_owned(),
            )
            .await?;

        let db = manager.get_connection();
        let backend = db.get_database_backend();
        let now = chrono::Utc::now().to_rfc3339();

        let seeds: &[(&str, &str, &str, &str)] = &[
            ("anthropic", "Anthropic", "anthropic", "https://api.anthropic.com"),
            ("openai", "OpenAI", "openai", "https://api.openai.com"),
            ("gemini", "Google Gemini", "gemini", "https://generativelanguage.googleapis.com"),
            ("ollama", "Ollama", "ollama", "http://localhost:11434"),
        ];

        for (id, name, kind, base_url) in seeds {
            let sql = "INSERT OR IGNORE INTO llm_providers (id, name, connected, kind, base_url, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?)";
            db.execute(Statement::from_sql_and_values(
                backend,
                sql,
                [
                    (*id).into(),
                    (*name).into(),
                    (*kind).into(),
                    (*base_url).into(),
                    now.clone().into(),
                    now.clone().into(),
                ],
            ))
            .await?;
        }

        db.execute(Statement::from_sql_and_values(
            backend,
            "UPDATE llm_providers SET kind = ? WHERE id = ? AND (kind IS NULL OR kind = '')",
            ["anthropic".into(), "anthropic".into()],
        ))
        .await?;
        db.execute(Statement::from_sql_and_values(
            backend,
            "UPDATE llm_providers SET kind = ? WHERE id = ? AND (kind IS NULL OR kind = '')",
            ["openai".into(), "openai".into()],
        ))
        .await?;
        db.execute(Statement::from_sql_and_values(
            backend,
            "UPDATE llm_providers SET kind = ? WHERE id = ? AND (kind IS NULL OR kind = '')",
            ["gemini".into(), "gemini".into()],
        ))
        .await?;
        db.execute(Statement::from_sql_and_values(
            backend,
            "UPDATE llm_providers SET kind = ? WHERE id = ? AND (kind IS NULL OR kind = '')",
            ["ollama".into(), "ollama".into()],
        ))
        .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(LlmProviders::Table)
                    .drop_column(LlmProviders::BaseUrl)
                    .to_owned(),
            )
            .await?;
        manager
            .alter_table(
                Table::alter()
                    .table(LlmProviders::Table)
                    .drop_column(LlmProviders::Kind)
                    .to_owned(),
            )
            .await?;
        Ok(())
    }
}

#[derive(Iden)]
enum LlmProviders {
    Table,
    Kind,
    BaseUrl,
}
