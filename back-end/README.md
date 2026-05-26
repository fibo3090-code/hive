# HIVE backend

A Rust/Axum workspace: the HTTP + SSE API, the agent runtime, the LLM clients,
the tools, the sandbox, the DB layer, and the at-rest crypto. See
[`../docs/architecture.md`](../docs/architecture.md) for the design (topology,
core concepts, the chat-turn flow, the SSE taxonomy, the HTTP surface, the agent
tool catalog, security defaults) and [`../docs/FEATURE_STATUS.md`](../docs/FEATURE_STATUS.md)
for what's built vs planned. This file is the dev-setup reference.

## Prerequisites

- Rust (pinned by `rust-toolchain.toml`) + Cargo.
- That's it — SQLite is bundled via `sqlx`. Postgres/MySQL are supported but optional.
- Optional sidecars: a local **Ollama** (`localhost:11434`, no-key LLM fallback, auto-detected at startup) and a local **SearXNG** (`localhost:8888`, no-key web-search fallback).

## Run it

```sh
cargo run -p hive-api -- serve     # runs migrations, seeds an empty DB, then serves on 127.0.0.1:8787
cargo run -p hive-api -- migrate   # run pending migrations only (also seeds an empty DB)
cargo run -p hive-api -- seed      # (re)seed demo data
```

On first `serve`/`migrate` the API creates `back-end/data/` (the SQLite file +
per-project sandbox workspaces under `data/workspaces/<project_id>/`), runs all
migrations, generates `~/.hive/master.key` (ChaCha20-Poly1305 master key, mode
0600 on Unix — also where chat attachments live), probes Ollama, seeds three
demo projects + agents (idempotent — guarded by a `settings` sentinel row; force
a reseed with the `seed` subcommand or `POST /v1/setup/seed`), and runs
`seed::heal_enabled_tools` to detect and rewrite the stale 6-tool fingerprint
left by older seeds.

```sh
cargo build --release -p hive-api          # binary at target/release/hive-api
cargo test --workspace                     # all tests
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
cargo doc --open -p hive-api               # API docs
```

## Configuration

- **Database URL** — `config/local.toml` (`[database] url = …`; copy from
  `config/local.example.toml`). Defaults (when no `local.toml`) to
  `sqlite://<back-end>/data/hive.db?mode=rwc`. An *empty* url triggers the
  first-run setup flow. `config/default.toml` also holds `[server] host/port`
  (the `127.0.0.1:8787` bind).
- **Logging** — `HIVE_LOG` (same syntax as `RUST_LOG`, e.g.
  `info,hive_runtime=debug`) and `HIVE_LOG_JSON=1` (structured one-line JSON).
- **Ollama** — `HIVE_OLLAMA_URL` overrides the auto-detected
  `http://localhost:11434`.
- Most operational settings (search provider + SearXNG URL, the per-project
  enabled-tools allowlist, GitHub owner/repo/token, etc.) live in the DB
  (`settings` table, project-scoped) and are edited through the UI.
- `back-end/.env.example` documents some additional `HIVE_*` vars; the
  database/data-dir ones aren't currently honored by the bootstrap path — use
  `config/local.toml`.

## Crates

| Crate | Role |
|---|---|
| `hive-api` | Axum HTTP/SSE server: route handlers, `AppState` wiring, the global SSE `EventBus`, the `ApiTurnDriver` the runtime calls to drive a turn, onboarding `/launch` + brief decomposition, the LLM-provider / connector / git / GitHub endpoints, and the CLI (`serve` / `migrate` / `seed`). |
| `hive-domain` | Shared domain types — a thin layer of plain structs/enums (no service layer; that lives in `hive-api` handlers + `hive-db` repos). |
| `hive-db` | SeaORM entities, one repo module per table, and migrations (`migration/`). SQLite by default; Postgres/MySQL via the same set (raw SQL dispatches on `DatabaseBackend`). Also `seed::seed_demo`. New migration: `cargo run -p migration -- create <name>` (or `cargo run --package hive-db --bin migration create <name>`), then register it in `migration/src/lib.rs`. |
| `hive-runtime` | The agent runtime: `AgentExecutor` (per-agent inbox + cancel scope), `ExecutorRegistry`, the `TurnDriver` trait, the streaming chat turn loop (`chat::run_turn` — round loop, tool dispatch, schema validation, loop/repeat guards, budget enforcement, interleaved-transcript persistence, partial-cost persistence on cancel / timeout / LLM-error), the `EventBus`, the drift scorer (`drift.rs`) **and the post-turn `drift_hook::record_after_turn`** (wired on the success path; auto-pauses at score ≥ 0.9), the auto-MCP-synthesis pipeline (`spawn/`) with the `request_capability` / `monitor_spawn_request` agent tools (B4) plumbed over the `spawn_pipeline_tx` mpsc to the API consumer, and the DB-/executor-backed agent tools — `agent_tools.rs` (`spawn_agent`, `message_agent`, `list_visible_agents`, `request_relay`, `delete_agent`, `monitor_agent`, `delegate_task`, `request_capability`, `monitor_spawn_request`), `db_tools.rs` (`hive_mind_*`, `list_spec_docs`, `read_spec_doc`, `add_task`, `add_tech_debt`, `update_tech_debt`, `record_drift`, `record_eval`), `git_tools.rs` (`git_status`, `git_diff`, `git_log`, `git_commit`, `git_pull`, `git_push`). |
| `hive-tools` | The sandbox-only built-in tools: `fs_read`, `fs_write`, `fs_list`, `shell_exec`, `todo`, `web_fetch`, `web_search` (search needs a `SearchProvider`). Each declares a JSON-Schema manifest; the runtime validates calls against the `required` list and wraps each in a per-tool 60 s timeout. **File Protection Zones** (`.env*`, `.git/`, operator-provided `protected_files`) are uniformly enforced through `ToolContext::check_path_allowed` from `fs_read` / `fs_list` / `fs_write` / `shell_exec`. Hosts the `SandboxLockRegistry` (D2 — RAII `LockGuard`, exposed via `GET /v1/sandbox-locks`). (`hive-tools` can't depend on `hive-db`, so the DB-/executor-backed tools live in `hive-runtime`.) |
| `hive-sandbox` | `Sandbox` trait + `LocalFsSandbox`: two-layer path-escape protection (string-level `..`/absolute reject, then FS canonicalisation + root-prefix re-check), symlink-safe, `env_clear()`-then-allowlist exec. A Docker-backed variant is planned. |
| `hive-search` | `SearchProvider` trait with Tavily and SearXNG implementations. |
| `hive-git` | `GitRepo` — shells out to the `git` CLI in the project workspace (`status`/`branches`/`checkout`/`log`/`tree`/`file`/`diff`/`commit`/`restore`/`init`/`pull`/`push`) — plus `GitHubClient` (`octocrab`) for GitHub status/PRs. |
| `hive-crypto` | ChaCha20-Poly1305 secret-at-rest encryption. `Crypto::load_or_create` reads/creates `~/.hive/master.key` (0600 on Unix; a `tracing::warn!` on Windows since there's no ACL helper yet); `seal`/`open` for LLM keys, connector credentials, GitHub tokens; `mask_key` for UI previews (`sk-…abcd`). Opaque errors — callers only ever see `Decrypt`. |
| `hive-seed` | Demo-data helper used by `hive-db::seed`. Loads the JSON fixtures in `seed/` (`agent_blueprints.json`, `module_catalog.json`, `activity_feed.json`, `spend.json`, `task_throughput.json`, `session_history.json`, `requirements.json`, `user_stories.json`, `quality_over_time.json`, `settings_state.json`). |

## LLM providers API

CRUD + live model discovery for the four provider slots
(`anthropic` / `openai` / `gemini` / `ollama` — Ollama needs no key):

| Method | Route | Purpose |
|--------|-------|---------|
| GET    | `/v1/llm-providers`             | List providers (never returns ciphertext; `hasKey`/`connected` derived server-side) |
| PATCH  | `/v1/llm-providers/:id`         | Set/clear `apiKey` (encrypted at rest, masked for display) and/or `baseUrl` |
| POST   | `/v1/llm-providers/:id/test`    | Live connection test; persists the `connected` flag |
| GET    | `/v1/llm-providers/:id/models`  | Live model list from the provider (cached 5 min) |
| GET    | `/v1/llm-providers/:id/refresh-models` | Force-refresh that cache |

Empty-string `apiKey` clears the stored key; setting/changing a key invalidates
that provider's model cache. `client_for(ProviderConfig)` returns a boxed
`LlmProvider` (`list_models` / `test_connection` / `complete` / `chat_stream`).

## API documentation

The server serves its OpenAPI document at `GET /v1/openapi.json` (no bundled
Swagger UI); a static snapshot lives at `openapi/openapi.json`. The route groups
are listed in [`../docs/architecture.md`](../docs/architecture.md) §6;
the handlers are in `hive-api/src/main.rs`.

## Database connection strings

```
sqlite://./data/hive.db?mode=rwc          # local file (default; relative to back-end/)
sqlite://:memory:                         # in-memory (tests)
postgres://user:pass@host:5432/hive       # Postgres
mysql://user:pass@host:3306/hive          # MySQL
```

Cost columns (`cost_events.cost_cents`, `chat_messages.cost_cents`,
`projects.budget_total_cents`) are i64 end-to-end.

## Operator notes

- Chat-runner round limits, the empty-final-answer fallback, and small-model
  - Chat-runner operator notes (round limits, small-model tips): [`../docs/OPERATOR_NOTES.md`](../docs/OPERATOR_NOTES.md).
  - The exhaustive backlog of remaining issues: [`../docs/BACKLOG.md`](../docs/BACKLOG.md).
  - The forward plan: [`../docs/ROADMAP.md`](../docs/ROADMAP.md).

## Contributing

`cargo fmt --all` + `cargo clippy --workspace --all-targets -- -D warnings`
must pass; add tests for new behaviour; keep handlers thin and put DB logic in
`hive-db` repos. The API has **no auth** and tools run shell commands — keep the
bind on `127.0.0.1`.

## License

MIT.
