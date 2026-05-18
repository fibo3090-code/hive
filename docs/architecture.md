# HIVE architecture

HIVE is a **local-first multi-agent project-execution platform**. You give it a
project brief; a *coordinator* agent (the "CEO") turns the brief into a spec
document and a roadmap, spawns specialist sub-agents, and the agents work
through the resulting tasks/sprints — editing files in a per-project sandbox,
running shell commands, searching the web, talking to each other, and writing
shared notes — while you watch the graph, read the threads, and steer.

It runs entirely on your machine by default (SQLite, `127.0.0.1`, no auth, a
local Ollama fallback for LLMs). Some features are explicitly **server-only**
and stay disabled until a "Hive central server" exists (template gallery,
marketplace, public agent registry, the *Cloud* sovereignty tier, cross-org
metrics, hosted notification delivery) — that server is planned but not built.

For the live "is feature X done?" matrix see [`FEATURE_STATUS.md`](FEATURE_STATUS.md);
for the forward plan see [`ROADMAP.md`](ROADMAP.md). This document is the design /
"how it actually works" reference.

---

## 1. Topology

```
┌─────────────────────────────────────┐         ┌──────────────────────────┐
│  front-end  (Vite + React, :8080)   │  HTTP   │  hive-api  (Axum, :8787) │
│  Projects · Onboarding · Dashboard  │ ◀────▶  │  routes → handlers       │
│  HiveGraph · ChatCentral · Planning │   SSE   │  ExecutorRegistry        │
│  Forge · Stats · CodeVersioning ·   │ ◀────── │  global EventBus         │
│  Settings · CommandPalette          │         │                          │
└─────────────────────────────────────┘         └────────────┬─────────────┘
                                                             │
                ┌────────────────────────┬───────────────────┼────────────────┐
                │                        │                   │                │
         ┌──────▼───────┐        ┌───────▼────────┐   ┌───────▼──────┐  ┌──────▼──────┐
         │  hive-llm    │        │  hive-runtime  │   │  hive-tools  │  │  hive-search│
         │ Anthropic /  │        │ chat turn loop │   │ fs_* shell_  │  │ Tavily /    │
         │ OpenAI /     │◀──────▶│ AgentExecutor  │──▶│ exec todo    │  │ SearXNG     │
         │ Gemini /     │        │ EventBus       │   │ web_fetch/   │  └─────────────┘
         │ Ollama       │        │ TurnDriver     │   │ search       │  ┌─────────────┐
         └──────────────┘        │ agent_tools    │   └──────────────┘  │  hive-git   │
                                 │ db_tools       │   ┌──────────────┐  │ git CLI +   │
                                 │ git_tools      │──▶│ hive-sandbox │  │ octocrab PR │
                                 │ spawn pipeline │   │ LocalFsSandbox│ └─────────────┘
                                 └───────┬────────┘   └──────────────┘  ┌─────────────┐
                                         │                              │ hive-crypto │
                                 ┌───────▼──────┐                       │ ChaCha20-   │
                                 │   hive-db    │                       │ ChaCha20-   │
                                 │ SeaORM →     │                       │ Poly1305    │
                                 │ SQLite / PG  │                       └─────────────┘
                                 └──────────────┘
```

The front-end is a single React app. The back-end is one Axum process; long
work (chat turns, agent turns, module synthesis) runs as background Tokio tasks
that stream progress over a single shared SSE stream (`GET /v1/events`).

---

## 2. Crates

| Crate | Role |
|---|---|
| `hive-api` | Axum HTTP server: route handlers, `AppState` wiring, the global SSE `EventBus`, the `ApiTurnDriver` that the runtime calls to drive a turn, the LLM-provider/connector/git/GitHub endpoints, onboarding `/launch` + decomposition, CLI subcommands (`migrate`, `seed`, `serve`). |
| `hive-domain` | Shared domain types — thin today (plain structs/enums); not a service layer. |
| `hive-db` | SeaORM entities, repos (one module per table), and migrations (`crates/hive-db/migration/`). SQLite by default, Postgres/MySQL via the same migration set. Also `seed::seed_demo` (idempotent demo data). |
| `hive-llm` | `LlmProvider` trait (`list_models` / `test_connection` / `complete` / `chat_stream`) with Anthropic / OpenAI / Gemini / Ollama clients. Streaming + provider-native tool-use, family-keyed model metadata + context windows, token-budget estimator, per-provider pricing → i64 cents. |
| `hive-runtime` | The agent runtime: `AgentExecutor` (per-agent inbox + cancel scope), `ExecutorRegistry`, `TurnDriver` trait, the streaming chat turn loop (`chat::run_turn`), the `EventBus`, the tool-call schema validator, loop/repeat guards, the drift scorer (`drift.rs`, not yet wired into the loop), the auto-MCP-synthesis pipeline (`spawn/`), and the DB-/registry-backed agent tools (`agent_tools.rs`, `db_tools.rs`, `git_tools.rs`). |
| `hive-tools` | The sandbox-only built-in tools: `fs_read`, `fs_write`, `fs_list`, `shell_exec`, `todo`, `web_fetch`, `web_search`. Each declares a JSON-Schema manifest and runs through a per-tool 60 s timeout wrapper. `hive-tools` can't depend on `hive-db`, so DB-/executor-backed tools live in `hive-runtime` (see above). |
| `hive-sandbox` | `Sandbox` trait + `LocalFsSandbox`: two-layer path-escape protection (string-level `..`/absolute reject, then FS canonicalisation + root-prefix re-check), symlink-safe, `env_clear()`-then-allowlist exec. A Docker-backed variant is planned. |
| `hive-search` | `SearchProvider` trait with Tavily and SearXNG implementations. |
| `hive-git` | `GitRepo` — a thin wrapper that shells out to the `git` CLI in the project workspace (status / branches / checkout / log / tree / file / diff / commit / restore / init / pull / push) — plus `GitHubClient` (`octocrab`) for GitHub status/PRs. |
| `hive-crypto` | ChaCha20-Poly1305 master-key encryption for secrets at rest (LLM keys, connector credentials, GitHub tokens). Opaque errors — callers only ever see `Decrypt`; the real cause goes to `tracing::error!`. `mask_key` for UI-safe previews. |
| `hive-seed` | Demo seeding helper used by `hive-db::seed`. |

---

## 3. Core concepts

### Project
The top-level unit. Has a name/description, a `sovereignty_tier` (`local` —
the only enabled tier today — or `cloud`, which is server-only), a
`budget_total_cents`, and health/spec-completion/test-coverage gauges. Each
project gets a sandbox/workspace directory at `<data_dir>/workspaces/<project_id>/`
(with a `project_workspaces` row recording the path/status) and, after onboarding,
a git repo there.

### Agent
A persistent worker scoped to a project: `slug`, `name`, `role`, `model`
(friendly id) + `model_provider_id`/`model_id` (the runtime's actual target),
an optional `system_prompt` override, an optional `enabled_tools` allowlist
(empty = inherit the project default), a `status`, and `parent_agent_id` (set
when spawned via `spawn_agent`). Each agent has an `AgentExecutor`: an inbox
(`agent_messages` rows) and a cancel scope; cancelling an agent cascades to its
descendants.

### The Coordinator ("CEO")
The agent that *runs* a project. The onboarding "describe" step is intended to
become a back-and-forth chat with it (`POST /v1/projects/:id/coordinator/converse`,
`/coordinator/ensure`) that produces the spec document and the initial agent
roster. The `team_mode` toggle changes the coordinator's tool loadout
(`coordinator_tools`): team-mode drops direct `web_search` to push it toward
delegating research to specialists; solo keeps it.

### Skills vs Modules vs Connectors
- **Skill** — a markdown document plus optional scripts that an agent can pull
  in *on demand*. A skill row carries a `system_prompt_fragment`, `allowed_tools`,
  `allowed_paths`, `requires_connector_ids`, and `capabilities`.
- **Module** ("HCM module") — *custom code that changes how the whole app
  behaves*. Full privileges; a superpower and a serious risk.
- **Connector** — an external integration: an HTTP API or an **MCP server**.
  `agent_mcp_bindings` links agents to connectors.

### HiveGraph wires & agent visibility
`agents.parent_agent_id` is the immutable *spawn lineage*. `agent_wires` is an
editable directed graph of parent→child *authority/communication* edges.
An agent's **visibility set** — who it may `message_agent` — is *itself + its direct
parents + all of its descendants* (walked over the wires).

### Spec docs, sprints, tasks
A project has `spec_documents`. Onboarding `/launch` asks the planner LLM to
break the brief into 3-5 phases, then persist `sprints` and `tasks`.

---

## 4. Detailed Implementation Schema (Technical Deep-Dive)

### 4.1 Process Topology & Disk Layout

HIVE runs as a single Axum process. All background tasks (turns, loop detector,
audit purge, spawn pipeline) run as Tokio tasks within the same process.

**Disk Layout:**
```
<data_dir>  (default: back-end/data/)
├── hive.db                          ← SQLite (entities + audit + settings + …)
├── workspaces/
│   └── <project_id>/                ← cwd for shell_exec, project fs root
│       ├── .git/                    ← initialized at /launch
│       ├── .hive/
│       │   └── todo.json            ← tool `todo` persistence
│       └── HIVE.md                  ← project shared memory
└── attachments/
    └── <project_id>/
        └── <ulid>-<original_name>   ← chat uploads (images / text)
```

**Path Resolution Defense:**
1. Reject if path contains `..` or starts with `/` or `\`.
2. Join with root, then `canonicalize`.
3. Verify result is still under root (anti-symlink-escape).

### 4.2 Request Lifecycle

- **Synchronous:** standard REST endpoints (list, create, patch).
- **Asynchronous:** returns immediately, streams results via SSE (LLM turns,
  MCP synthesis, export).

The **single shared SSE stream** (`/v1/events`) covers all events. The frontend
maps event names to TanStack Query keys for invalidation.

### 4.3 The Chat Turn Loop (`chat::run_turn`)

The unique chokepoint for all LLM work.

1. **Budget Check:** Refuse turn if cumulative spend ≥ `budget_total_cents`.
2. **Prompt Composition:** 4-layer deterministic prompt (Agent → Tools →
   Project Memory → Live reminders).
3. **Pre-flight Token Budgeting:** Truncate history if it exceeds context window.
4. **Round Loop (max 30 rounds):**
   - Stream-collect LLM response.
   - Dispatch tool calls (max 60 per turn).
   - Validation against JSON Schema.
   - Repeat guard (max 3 identical calls).
   - 60s timeout per tool.
5. **Finalization:** Persist transcript (rounds joined by `\n\n`), write
   `cost_events`, emit `complete`.

### 4.4 Agent Execution & Visibility Model

- **Lineage:** `agents.parent_agent_id` (immutable).
- **Wires:** `agent_wires` table (editable parent→child edges).
- **Visibility:** `visible(A) = {A} ∪ direct_parents(A) ∪ descendants(A)`.
- **Relay:** `request_relay(via, target)` where `via` is a direct parent and
  `target` is visible to `via`.

---

## 5. Security & Fallbacks

### 5.1 Security Defaults
- Bind to `127.0.0.1` only (no auth).
- Master key at `~/.hive/master.key` (0600 on Unix) for secret encryption
  (ChaCha20-Poly1305).
- Sandbox limits: `fs_read` (16MB), `fs_write` (32MB), `shell_exec`
  (CPU 300s, 1GB RAM, truncated output).

### 5.2 No-Key Fallbacks
- **LLM:** Ollama auto-detected at `:11434`.
- **Search:** SearXNG at `:8888`.
- **Git:** Local `git` CLI.

---

## 6. Future Design: Richer Workspace Todo Tools

*Status: A simpler `todo` tool currently ships. This is the design sketch for
the planned multi-tool surface.*

### Goals
- Structured operational memory across long turns.
- Persistence in project/thread store.

### Proposed Tool Surface
| Tool | Purpose |
| ------ | --------- |
| `todo_create` | Add item with `title`, `description`, `priority`, `depends_on` |
| `todo_update` | Change status, title, description, priority, or dependencies |
| `todo_complete` | Mark completed |
| `todo_delete` | Remove item |
| `todo_list` | List with filters |

---

## 7. Operational Reference

For chat-runner operator notes (round limits, small-model tips), see
[`OPERATOR_NOTES.md`](OPERATOR_NOTES.md).
For feature status, see [`FEATURE_STATUS.md`](FEATURE_STATUS.md).
