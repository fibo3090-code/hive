use std::{fs, path::PathBuf};

use clap::Parser;
use hive_db::{seed::seed_demo, Db};

#[derive(Parser)]
#[command(author, version, about)]
struct Cli {
    #[arg(long)]
    url: Option<String>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter("info").init();
    dotenvy::dotenv().ok();

    let cli = Cli::parse();
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()?;
    let data_dir = workspace_root.join("data");
    fs::create_dir_all(&data_dir)?;

    let database_url = cli
        .url
        .unwrap_or_else(|| format!("sqlite://{}?mode=rwc", data_dir.join("hive.db").display()));

    let db = Db::connect(&database_url, true).await?;
    seed_demo(db.conn()).await?;
    Ok(())
}
