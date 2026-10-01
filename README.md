# HIVE

> [!WARNING]
> **Paused — shared as-is.** Development is on hold. Parts of HIVE may be
> incomplete, broken or out of date, and it is not actively maintained. You are
> free to use, fork or adapt it under the MIT licence, but review it carefully
> before relying on it, especially the sandbox and anything that runs commands.

HIVE is a **local-first multi-agent project-execution platform**. You give it a
project brief; a *coordinator* agent (the "CEO") turns it into a spec document
and a roadmap of sprints/tasks, spawns specialist sub-agents, and the agents
work through the tasks — editing files in a per-project sandbox, running shell
commands, searching the web, talking to each other, committing to git, writing
shared notes — while you watch the agent graph, read the threads, and steer.

It runs entirely on your machine by default: SQLite, `127.0.0.1` only, no auth,
a local Ollama fallback when no cloud LLM key is set, a zero-config
DuckDuckGo HTML-scraper fallback for web search (with SearXNG and Tavily as
upgrades), and a path-jailed local-filesystem sandbox with three-layer escape
defense (`..` reject → component normalisation → FS canonicalisation of the
deepest existing ancestor) plus `O_NOFOLLOW` on writes. Bring your own keys
(Anthropic / OpenAI / Gemini / DeepSeek / Tavily / a GitHub PAT) to use the
cloud variants; they're sealed with ChaCha20-Poly1305 at rest. A few features
are explicitly **server-only** and stay disabled with a tooltip until a
"Hive central server" exists (template gallery, marketplace, public agent
registry, the *Cloud* sovereignty tier) — that server is planned, not built.

- **Backend**: a Rust/Axum workspace (~38 k LOC across 11 crates) exposing an HTTP + SSE API on `:8787`.
- **Frontend**: a React + TypeScript SPA (~21 k LOC; Vite, TanStack Query, ReactFlow, Monaco, shadcn/ui, Tailwind) on `:8080`.

The two halves never share a process; long work (chat turns, agent turns,
module synthesis) runs as background Tokio tasks that stream progress over a
single shared `GET /v1/events` SSE stream.

## Quickstart

```sh
just setup   # copy .env.example files into place; idempotent
just up      # launch back-end (:8787) + front-end (:8080) in a tmux session
```

No `just`? The `Makefile` mirrors every target, or run the halves directly:

```sh
make setup
make dev-back    # one terminal — cargo run -p hive-api -- serve
make dev-front   # another     — npm run dev (in front-end/)
```

The first backend start:
1. Creates `back-end/data/` — SQLite database (`hive.db`), per-project sandbox workspaces at `data/workspaces/<project_id>/`, and per-project chat-attachment storage at `data/attachments/<project_id>/`.
2. Runs all 21 migrations.
3. Generates a master encryption key at `~/.hive/master.key` (`0600` on Unix) for ChaCha20-Poly1305 sealing of LLM / Tavily / GitHub credentials.
4. Probes Ollama at `localhost:11434` so `web_search` and a local-model fallback work without keys.
5. Seeds three demo projects + agents (idempotently — a `settings(scope='system', key='seed.demo.completed')` sentinel is claimed up-front via `ON CONFLICT DO NOTHING`, so two concurrent first-boots can't double-seed).
6. Heals any agent rows stuck on the legacy six-tool list via `seed::heal_enabled_tools`.

Override the database URL in `back-end/config/local.toml` (`[database] url = …`).
To wipe state, delete `back-end/data/` and `~/.hive/master.key` and rerun.

## Layout

| Path | Purpose |
|---|---|
| `back-end/` | Cargo workspace: `hive-api`, `hive-domain`, `hive-db` (+ `migration/`), `hive-runtime`, `hive-llm`, `hive-tools`, `hive-sandbox`, `hive-search`, `hive-git`, `hive-crypto`, `hive-seed`. See [`back-end/README.md`](back-end/README.md). |
| `front-end/` | React + TypeScript SPA. See [`front-end/README.md`](front-end/README.md). |
| `docs/` | Start at the index — [`docs/README.md`](docs/README.md). Holds [`architecture.md`](docs/architecture.md) (design reference), [`FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) (the living feature matrix), [`ROADMAP.md`](docs/ROADMAP.md) (the forward plan), [`BACKLOG.md`](docs/BACKLOG.md) (the unified bug/debt/audit register), [`SECURITY.md`](docs/SECURITY.md), [`TESTING.md`](docs/TESTING.md), and [`OPERATOR_NOTES.md`](docs/OPERATOR_NOTES.md) (runtime tips). |

## Configuration

Each half reads env vars from its own `.env` (created by `just setup` from
`.env.example`):

- **back-end**: logging via `HIVE_LOG` (same syntax as `RUST_LOG`) and
  `HIVE_LOG_JSON`; the database URL via `back-end/config/local.toml`
  (`[database] url = …`; copy from `config/local.example.toml` — defaults to
  SQLite at `back-end/data/hive.db`); Ollama via `HIVE_OLLAMA_URL`. Bind
  address is `127.0.0.1:8787` (`[server]` in `config/default.toml`).
  Project-scoped settings (search provider, enabled tools, GitHub creds, etc.)
  live in the DB; LLM-provider keys are entered in **Settings → LLM Providers**
  and stored encrypted at rest. (`back-end/.env.example` documents some
  additional `HIVE_*` vars; the database/data-dir ones aren't currently honored
  — use `config/local.toml`.)
- **front-end** (`front-end/.env`): `VITE_API_BASE_URL` (default
  `http://127.0.0.1:8787`) — the backend's HTTP + SSE base URL.

## Common commands

```sh
just test    # cargo test --workspace + npm test
just lint    # cargo clippy --workspace --all-targets -D warnings + eslint + tsc --noEmit
just audit   # cargo audit + npm audit
just build   # release build of hive-api + production build of the frontend
```

Backend CLI (in `back-end/`): `cargo run -p hive-api -- serve` (runs migrations
+ seeds an empty DB, then serves), `… -- migrate`, `… -- seed`.

## More

- [`docs/README.md`](docs/README.md) — **the documentation index** (start here).
- [`docs/architecture.md`](docs/architecture.md) — topology, crates, core concepts, the chat-turn flow, technical schema, and future design sketches.
- [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) — what's `done` / `partial` / `mock` / `planned` / `removed`, with dependency profile.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — the high-level forward plan (features).
- [`docs/BACKLOG.md`](docs/BACKLOG.md) — the unified, code-verified register of remaining bugs, debt, security holes, and test gaps.
- [`docs/SECURITY.md`](docs/SECURITY.md) — security posture and known holes (read before exposing off-loopback).
- [`docs/TESTING.md`](docs/TESTING.md) — testing strategy and coverage gaps.
- [`docs/OPERATOR_NOTES.md`](docs/OPERATOR_NOTES.md) — technical notes for running the chat runner and small-model tips.
- [`back-end/README.md`](back-end/README.md) · [`front-end/README.md`](front-end/README.md) — dev setup per half.
