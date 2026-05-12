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
                                 │   hive-db    │                       │ Poly1305    │
                                 │ SeaORM →     │                       └─────────────┘
                                 │ SQLite / PG  │
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
delegating research to specialists; solo keeps it. *(The conversational
onboarding flow is partially built — see ROADMAP.)*

### Skills vs Modules vs Connectors — three different things
- **Skill** — a markdown document plus optional scripts that an agent can pull
  in *on demand* (the Anthropic-Skills pattern). A skill row carries a
  `system_prompt_fragment`, `allowed_tools`, `allowed_paths`,
  `requires_connector_ids`, and `capabilities`. Forge → Skills creates/deletes
  them. *(Agent↔skill bindings and `list_skills`/`read_skill` tools are planned —
  see ROADMAP.)*
- **Module** ("HCM module") — *custom code that changes how the whole app
  behaves*. Full privileges; a superpower and a serious risk. Modules can be
  hand-authored or *synthesized* (the `synthesis_jobs` pipeline; the backend
  side is currently a stub). Marketplace download and publish-to-registry are
  server-only.
- **Connector** — an external integration the runtime can mount on an agent: an
  HTTP API (with an encrypted credential) or an **MCP server**. There are
  *custom* MCP servers (auto-generated by the auto-spawn pipeline for a specific
  agent, optionally `reusable`), *official* ones (a catalog — planned), and
  planned Docker-MCP support. `agent_mcp_bindings` links agents to connectors /
  custom MCP servers. Forge → Connectors creates/lists/deletes them; credentials
  encrypt at rest like LLM keys.
- **Agent** (Forge → Agents) — composes an agent out of a model, a system
  prompt, a tool allowlist, and (planned) skills + connectors. The same form
  (`<AgentFormFields>`) is used by the HiveGraph "Spawn" modal and the agent
  "Configure" dialog, so spawning ≈ editing ≈ forging.

### HiveGraph wires & agent visibility
`agents.parent_agent_id` is the immutable *spawn lineage*. `agent_wires` is an
editable directed graph of parent→child *authority/communication* edges drawn in
HiveGraph (drag node→node to create, click an edge to delete; cycles are
BFS-rejected on insert; `spawn_agent` records a wire automatically). An agent's
**visibility set** — who it may `message_agent` — is *itself + its direct
parents + all of its descendants* (walked over the wires). If a project has no
wires at all, messaging falls back to "same project". `request_relay` lets a
child route a message through a parent that can see a more distant agent;
`list_visible_agents` lists the reachable peers.

### Spec docs, sprints, tasks
A project can have `spec_documents` (markdown, optionally split into anchored
`spec_document_sections`). Onboarding `/launch` (and Planning → "Decompose Spec")
ask the planner LLM to break the brief into 3-5 phases, then persist one
`sprints` row per phase and one `tasks` row per task (a per-task assignee *role*
is matched to an existing agent). Agents are meant to work through their
assigned tasks / the sprint tree autonomously, and the coordinator (or a parent
agent) can re-assign or steer them. Tech-debt items (`tech_debt_items`) and
Hive-Mind notes (`hive_mind_notes` — shared project memory, `topic` = category)
round out the planning surface.

### Drift
Three kinds — `agent-vs-task`, `code-vs-spec`, `agent-vs-system-prompt`.
`drift_events` rows can be written by the `record_drift` agent tool today.
`hive-runtime/src/drift.rs` has scoring functions for auto-detection but the
turn loop doesn't call them yet; when it does, the response is meant to be
graduated by severity (log → alert → pause the agent).

### Budget
Cost events (`cost_events`, i64 cents) accumulate per project. `chat::run_turn`
(the single chokepoint for both chat turns and agent-to-agent dispatch turns)
**refuses to start a turn once cumulative spend reaches `budget_total_cents`** —
the assistant message is finalised with a `[budget] …` body and a
`chat.<thread>.error` event tagged `budget_exceeded`. `budget_total_cents <= 0`
means unlimited.

### Sessions
A project has a `sessions` row representing an active work session (toggleable);
`SessionInfo` (tokens used, budget used/total, elapsed) drives the dashboard's
"background session" card.

---

## 4. Request flow — a chat / agent turn

1. **Kick-off.** Frontend `POST /v1/chat-threads/:id/messages` (or an agent
   `POST /v1/agents/:id/dispatch`, or an inbox item delivered by the executor).
   The handler persists the user/source message, auto-names the thread from the
   first user message, inserts the *pending* assistant `chat_messages` row,
   resolves the provider+model (explicit → project default → first connected
   provider's first model), builds the tool registry + `ToolContext` for the
   turn (sandbox rooted at the project workspace, agent's tool allowlist ∩
   global allowlist), and spawns a background task running
   `hive_runtime::chat::run_turn`.
2. **Stream.** The frontend's `useChatStream` listens on the shared
   `EventSource('/v1/events')` for `chat.<thread_id>.*` events (below).
3. **`run_turn`** (wrapped in a 180 s wall-clock timeout):
   - **Budget check** — if the project is over budget, finalise the assistant
     message as a `budget_exceeded` error and stop.
   - **Prompt composition** — a deterministic four-layer system prompt
     (`crate::prompt::PromptComposer`): agent prompt → tool catalog → project
     memory (`HIVE.md` walked from `<workspace>/`) → live-state reminders. The
     stable prefix lets provider prompt-caching hit.
   - **Pre-flight token budgeting** — `model_metadata::context_window_for` +
     `token_budget::trim_to_fit`; if history won't fit, drop oldest non-system
     messages (anchor on system + most recent user turn) and emit `context_trim`.
   - **Round loop** — up to `MAX_TOOL_ROUNDS = 30`, capped at
     `MAX_TOTAL_TOOL_CALLS = 60` dispatches, with a repeat guard on identical
     `(tool, args)` fingerprints. Each round: stream-collect the LLM response
     (polling a shared cancel flag every 50 ms so cancel tears the upstream
     stream down within ~50 ms; text deltas are emitted live as `token`
     events). If the response has tool calls: validate each against its
     manifest's `required` list (emit `tool_validation_error` on failure),
     dispatch through the per-tool 60 s timeout wrapper, emit `tool_call` /
     `tool_result`, push the result into the conversation, loop.
   - **Finish.** Accumulate every round's narration into a transcript; persist
     *that* (rounds joined by blank lines, plus any synthetic fallback line) as
     the assistant message body with cumulative token counts + cost; write a
     `cost_events` row; emit `complete`. Synthetic fallback messages
     (tool-budget / loop-guard / "empty response") are also re-streamed as
     `token` events since they weren't streamed live.

---

## 5. SSE event taxonomy

One stream: `GET /v1/events` (text/event-stream). Per-event-name listeners.

**Per-thread chat events** (consumed by `useChatStream`):
- `chat.<thread_id>.streaming` — fired once when the assistant starts.
- `chat.<thread_id>.token` — incremental assistant text.
- `chat.<thread_id>.tool_call` / `…tool_result` — inline tool dispatch.
- `chat.<thread_id>.tool_validation_error` — a tool call failed schema validation before dispatch.
- `chat.<thread_id>.context_trim` — pre-flight history truncation.
- `chat.<thread_id>.message` — a freshly persisted chat message; clients refetch the thread.
- `chat.<thread_id>.complete` / `…cancelled` / `…error` — terminal (`error` may carry `kind: "budget_exceeded"`).

**Global events** (consumed by `useSse`, which maps each to a set of TanStack
Query keys to invalidate — see `front-end/src/realtime/useSse.ts`):
`project.updated`, `agent.status`, `agent.spawned`, `wire.changed`,
`task.status`, `cost.ingested`, `git.changed`, `synthesis.<jobId>.progress|complete|error`,
`spec_document.decomposed`, `llm_provider.updated|tested`, `workspace.updated`,
`chat.thread.created`, `alert.created|dismissed`, `notification.created`,
`session.toggled|closed`, `module.installed`.

---

## 6. HTTP surface

Served under `/v1/...`; the OpenAPI document is at `GET /v1/openapi.json` (a
static snapshot also lives at `back-end/openapi/openapi.json`). Major groups:

- **Projects** — `GET/POST /v1/projects`, `GET/PATCH/DELETE /v1/projects/:id`, `POST /v1/projects/:id/activate`, `POST /v1/projects/:id/launch` (real launch sequence + brief decomposition), `POST /v1/projects/genesis/preview`.
- **Agents** — `GET/POST /v1/projects/:id/agents`, `PATCH /v1/agents/:id`, `POST /v1/agents/:id/{set-status,pause,resume,terminate,cancel-subtree,dispatch}`, `GET /v1/agents/:id/{messages,lineage,mcp-bindings}`.
- **Wires** — `GET/POST /v1/projects/:id/wires`, `DELETE /v1/wires/:id`.
- **Coordinator** — `POST /v1/projects/:id/coordinator/{ensure,converse}`.
- **Spawn requests** (auto-MCP pipeline) — `GET/POST /v1/projects/:id/spawn-requests`, `GET/PATCH /v1/spawn-requests/:id`, `POST /v1/spawn-requests/:id/approve`.
- **Chat** — `POST /v1/chat-threads`, `GET/DELETE /v1/chat-threads/:id`, `GET/POST /v1/chat-threads/:id/messages`, `POST /v1/chat-threads/:id/compact`, `POST /v1/chat-messages/:id/{cancel,process}`, `GET/POST /v1/chat-messages/:id/attachments`.
- **Planning** — `GET /v1/projects/:id/{tasks,notes,tech-debt,sprints,drift-events,assignments}` (+ `POST` on `tasks`, `notes`, `tech-debt`), `POST /v1/tasks/:id/set-status`, `PATCH /v1/tech-debt/:id`, `GET/POST /v1/projects/:id/spec-documents`, `GET /v1/spec-documents/:id/sections`, `POST /v1/spec-documents/:id/{decompose,auto-decompose}`.
- **Forge** — `GET/POST /v1/projects/:id/skills`, `PATCH/DELETE /v1/skills/:id`; `GET/POST /v1/projects/:id/connectors`, `PATCH/DELETE /v1/connectors/:id`; `GET /v1/projects/:id/{modules,custom-mcp-servers}`, `POST .../modules/:id/install`; synthesis endpoints; `GET /v1/agent-blueprints`.
- **LLM providers** — `GET /v1/llm-providers`, `PATCH /v1/llm-providers/:id`, `POST /v1/llm-providers/:id/test`, `GET /v1/llm-providers/:id/{models,refresh-models}`.
- **Git** — `GET /v1/projects/:id/git/{status,branches,tree,file,log,diff/:ref}`, `POST /v1/projects/:id/git/{init,branches,checkout,commit,restore}`; **GitHub** — `GET/POST /v1/projects/:id/github/{status,connect,pulls}`.
- **Insights/Stats** — `GET /v1/projects/:id/insights/{cost-timeline,agent-token-usage,task-distribution}` + the seed-backed activity/spend/throughput/session-history endpoints.
- **Tools** — `GET /v1/tools` (the full registered tool catalog with categories).
- **Misc** — `GET /v1/events` (SSE), `GET /v1/openapi.json`, `POST /v1/setup/seed`, alerts/notifications endpoints.

---

## 7. Agent tools

Every tool declares a JSON-Schema manifest the LLM sees; `chat::run_turn`
validates calls against the `required` list before dispatch and wraps each in a
60 s timeout. `GET /v1/tools` returns the live catalog. Per-agent allowlists are
the intersection of the agent's `enabled_tools` and the project-global
`enabledTools` (a typed-out default that includes everything below except the
coordination tools, which are coordinator-scoped via `coordinator_tools`).

| Category | Tools | Crate |
|---|---|---|
| filesystem | `fs_read`, `fs_write`, `fs_list` | `hive-tools` |
| execution | `shell_exec` | `hive-tools` |
| research | `web_search`, `web_fetch` | `hive-tools` |
| planning | `todo` (a `.hive/todo.json` checklist), `list_spec_docs`, `read_spec_doc`, `add_task`, `add_tech_debt`, `update_tech_debt`, `record_drift` | `hive-tools` / `hive-runtime::db_tools` |
| memory | `hive_mind_write`, `hive_mind_read`, `hive_mind_list`, `hive_mind_delete` | `hive-runtime::db_tools` |
| git | `git_status`, `git_diff`, `git_log`, `git_commit`, `git_pull`, `git_push` (pull/push rejected on `local`-tier projects) | `hive-runtime::git_tools` |
| coordination | `spawn_agent`, `message_agent`, `list_visible_agents`, `request_relay`, `delete_agent`, `monitor_agent`, `delegate_task` | `hive-runtime::agent_tools` |

Round limits and the empty-final-answer fallback are documented in
[`back-end/docs/CHAT_OPERATOR.md`](../back-end/docs/CHAT_OPERATOR.md).

---

## 8. Agent execution & the auto-MCP pipeline

- **Executor.** `ExecutorRegistry` holds one `AgentExecutor` per agent.
  `spawn_agent` brings a child up under the parent's cancel scope; `message_agent`
  / `delegate_task` / `request_relay` enqueue an `agent_messages` row and dispatch
  it. When an inbox item arrives, the executor asks the registered `TurnDriver`
  (`hive-api::ApiTurnDriver`) to run a turn — which goes through the same
  `chat::run_turn` as a human chat turn.
- **Autonomous work** (planned) — agents are meant to poll their assigned
  `tasks` / the sprint tree, work the next one, mark it done, and loop, with the
  coordinator (or a parent) able to re-assign or steer; `max parallel agents`
  bounds concurrent in-flight turns and the rest queue. Today turns are
  reactive (chat / dispatch / inbox).
- **Auto-MCP-synthesis pipeline** (`hive-runtime/src/spawn/`) — a state machine
  `queued → planning-needs → matching-existing-mcp → researching-api →
  synthesizing-mcp → composing-prompt → awaiting-approval → materializing-agent →
  completed`, with REST endpoints for `spawn_requests`. The vision: an agent
  says "I need a Stripe integration", the pipeline researches the API,
  synthesizes a `custom_mcp_servers` row (manifest + handler code), and spawns a
  sub-agent bound to it; a human approves before materialisation. Partly built —
  see ROADMAP.

---

## 9. Data persistence

SeaORM. SQLite by default (`sqlite://./hive.db?mode=rwc`, file under
`<data_dir>` which defaults to `~/.hive/`). Postgres and MySQL are supported by
the same migration set — every migration that uses raw SQL dispatches on
`DatabaseBackend`. Cost columns (`cost_events.cost_cents`,
`chat_messages.cost_cents`, `projects.budget_total_cents`) are i64 end-to-end;
the widening migrations are no-ops on SQLite (dynamic typing) and
`ALTER COLUMN … TYPE BIGINT` on Postgres. Migrations live in
`crates/hive-db/migration/src/` and run automatically on `serve`; `cargo run -p
hive-api -- migrate` runs them standalone (and seeds an empty DB).

Key tables: `projects`, `project_workspaces`, `agents`, `agent_wires`,
`agent_messages`, `agent_task_assignments`, `agent_spawn_requests`, `agent_mcp_bindings`,
`chat_threads`, `chat_messages`, `chat_message_attachments`, `tasks`, `sprints`,
`spec_documents`, `spec_document_sections`, `tech_debt_items`, `hive_mind_notes`,
`drift_events`, `cost_events`, `sessions`, `alerts`, `notifications`,
`llm_providers`, `connectors`, `custom_mcp_servers`, `skills`, `synthesis_jobs`,
`audit_log`, `settings` (a generic scoped key→JSON store used for project-scoped
config, the seed sentinel, etc.).

---

## 10. Security defaults

- Bind to `127.0.0.1` only. The API has **no auth** and tools execute shell
  commands — this is a single-operator localhost design (audit-log entries are
  attributed to `"local_operator"`).
- CORS allow-list restricted to the dev Vite origins; permissive CORS is never set.
- API errors collapse to opaque internal-error responses; the real detail goes
  to `tracing::error!` keyed by a per-request `request_id` echoed in the
  `x-request-id` response header.
- The master key for at-rest secret encryption lives at `~/.hive/master.key`,
  mode `0600` on Unix; on Windows the writer logs a `tracing::warn!` (no
  Windows-ACL helper yet). LLM keys, connector credentials, and GitHub tokens
  are sealed with it (ChaCha20-Poly1305) and only ever surface masked.
- Sandbox path resolution uses two-layer defence (string-level `..`/absolute
  reject, then FS canonicalisation + root-prefix re-check). Symlinks inside the
  workspace pointing outside are rejected; `fs_write` refuses if the target
  itself is a symlink. `shell_exec` does `env_clear()` then re-adds a small
  allowlist (`PATH`, `LANG`, `TZ`, …) plus `HOME=<workspace_root>`.
- The per-tool 60 s timeout and the per-turn 180 s wall-clock timeout bound
  runaway tool calls / turns; the round-count, total-call, and repeat-fingerprint
  guards bound runaway loops; budget enforcement bounds runaway *spend*.
- **Modules are full-privilege app extensions** — treat installing one like
  installing a plugin you trust completely.

---

## 11. No-key fallbacks (the "works offline by default" principle)

| Capability | BYOK | No-key fallback |
|---|---|---|
| LLM | Anthropic / OpenAI / Gemini | Ollama, auto-detected at `http://localhost:11434` on startup |
| Web search | Tavily (API key in Settings) | SearXNG at `http://localhost:8888` |
| Sandbox | Docker (planned) | `LocalFsSandbox` |
| Git host | GitHub PAT (Settings → GitHub Sync) | local `git` only |
| Compaction (`/compact`) | configured cheap model | mechanical head-of-transcript summary |

---

## 12. Where to look next

- **What's done / partial / mocked / planned** → [`FEATURE_STATUS.md`](FEATURE_STATUS.md).
- **The forward plan** → [`ROADMAP.md`](ROADMAP.md).
- **Chat-runner operator notes** (round limits, small-model tips) → [`back-end/docs/CHAT_OPERATOR.md`](../back-end/docs/CHAT_OPERATOR.md).
- **Backend dev** → [`back-end/README.md`](../back-end/README.md). **Frontend dev** → [`front-end/README.md`](../front-end/README.md).
