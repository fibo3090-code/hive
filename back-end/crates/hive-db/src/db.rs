use sea_orm::{ConnectOptions, Database, DatabaseConnection, DbErr};
use sea_orm_migration::MigratorTrait;
use tracing::info;

/// Wrapper around a SeaORM DatabaseConnection with convenience helpers.
#[derive(Clone)]
pub struct Db {
    conn: DatabaseConnection,
}

impl Db {
    /// Connect to the database and optionally run migrations.
    pub async fn connect(url: &str, auto_migrate: bool) -> Result<Self, DbErr> {
        let mut opts = ConnectOptions::new(url.to_owned());
        opts.sqlx_logging(false);

        if url.starts_with("sqlite:") {
            opts.max_connections(5);
        } else {
            opts.max_connections(20);
        }

        info!(url = %redact_url(url), "Connecting to database");
        let conn = Database::connect(opts).await?;

        // Enable WAL mode for SQLite
        if url.starts_with("sqlite:") {
            use sea_orm::ConnectionTrait;
            conn.execute_unprepared("PRAGMA journal_mode=WAL").await?;
            conn.execute_unprepared("PRAGMA synchronous=NORMAL").await?;
            conn.execute_unprepared("PRAGMA busy_timeout=5000").await?;
        }

        if auto_migrate {
            repair_renamed_migrations(&conn).await?;
            info!("Running migrations");
            migration::Migrator::up(&conn, None).await?;
            info!("Migrations complete");
        }

        Ok(Self { conn })
    }

    /// Get the underlying connection.
    pub fn conn(&self) -> &DatabaseConnection {
        &self.conn
    }
}

/// Rename rows in `seaql_migrations` whose version no longer matches a
/// migration file on disk. We only patch known renames — never anything
/// the user might have authored. Without this, SeaORM aborts startup with
/// "Migration file of version 'X' is missing" on any DB created before
/// the rename landed.
async fn repair_renamed_migrations(conn: &DatabaseConnection) -> Result<(), DbErr> {
    use sea_orm::ConnectionTrait;

    // (old_name, new_name) pairs. Add an entry every time a migration is
    // renamed in `migration/src/lib.rs`.
    const RENAMES: &[(&str, &str)] = &[(
        "m20260606_000001_repair_chat_attachments",
        "m20260606_000002_repair_chat_attachments",
    )];

    // No-op when seaql_migrations doesn't exist yet (first boot).
    let probe = conn
        .execute_unprepared(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='seaql_migrations' \
             UNION ALL SELECT 1 FROM information_schema.tables WHERE table_name='seaql_migrations'",
        )
        .await;
    if probe.is_err() {
        return Ok(());
    }

    for (old, new) in RENAMES {
        // C151: values are compile-time consts today, but bind them anyway so
        // this never becomes the template someone copies for runtime input.
        // Placeholder syntax is backend-specific ($N on Postgres, ? elsewhere).
        let backend = conn.get_database_backend();
        let sql = match backend {
            sea_orm::DatabaseBackend::Postgres => {
                "UPDATE seaql_migrations SET version = $1 WHERE version = $2"
            }
            _ => "UPDATE seaql_migrations SET version = ? WHERE version = ?",
        };
        let stmt =
            sea_orm::Statement::from_sql_and_values(backend, sql, [(*new).into(), (*old).into()]);
        if let Ok(res) = conn.execute(stmt).await {
            if res.rows_affected() > 0 {
                info!(
                    rows = res.rows_affected(),
                    from = old,
                    to = new,
                    "Repaired renamed migration row"
                );
            }
        }
    }
    Ok(())
}

/// Redact credentials from the database URL for logging.
fn redact_url(url: &str) -> String {
    if let Some(at_pos) = url.find('@') {
        if let Some(proto_end) = url.find("://") {
            return format!("{}://***@{}", &url[..proto_end], &url[at_pos + 1..]);
        }
    }
    url.to_owned()
}
