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

/// Redact credentials from the database URL for logging.
fn redact_url(url: &str) -> String {
    if let Some(at_pos) = url.find('@') {
        if let Some(proto_end) = url.find("://") {
            return format!("{}://***@{}", &url[..proto_end], &url[at_pos + 1..]);
        }
    }
    url.to_owned()
}
