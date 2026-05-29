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
| `hive-llm` | `LlmProvider` trait (`list_models` / `test_connection` / `complete` / `chat_stream`) with **five** clients: Anthropic, OpenAI, Gemini, Ollama, and DeepSeek (OpenAI-compatible wire format; `deepseek-reasoner` is `supports_tools=false` and the provider strips `tools` defensively — ZZ31). Streaming + provider-native tool-use, family-keyed model metadata + context windows (`model_metadata.rs`), token-budget estimator (`token_budget.rs`), per-provider pricing → i64 cents (`pricing.rs`). `default_max_tokens_for` picks Claude-family-aware defaults so Anthropic long generations aren't silently truncated at 4096 (ZZ32). |
| `hive-runtime` | The agent runtime: `AgentExecutor` (per-agent inbox + cancel scope), `ExecutorRegistry` (now lineage-aware on rehydrate — ZZ13), `TurnDriver` trait, the streaming chat turn loop (`chat::run_turn`), the `EventBus`, the tool-call schema validator, loop/repeat guards (`loop_detector.rs` now reads `"arguments"` — ZZ3), the drift scorer (`drift.rs`) + the **post-turn `drift_hook::record_after_turn`** wired into *every* `run_turn` exit (success / cancel / timeout / LLM-error / budget exit — Z1; see §4.5), the auto-MCP-synthesis pipeline (`spawn/`) with the `request_capability` / `monitor_spawn_request` agent tools (B4) plumbed over an mpsc `spawn_pipeline_tx` to the API consumer + in-flight dedup via `Arc<Mutex<HashSet>>` (B4b) + resumable from `awaiting-approval` (B4c), the D1 eval surface (`record_eval` tool + `agent_eval_runs`), and the DB-/registry-backed agent tools (`agent_tools.rs`, `db_tools.rs`, `git_tools.rs`). |
| `hive-tools` | Sandbox-only built-in tools: `fs_read`, `fs_write`, `fs_list`, `str_replace`, `shell_exec`, `todo`, `web_fetch`, `web_search`, `think`, `task_complete`. Each declares a JSON-Schema manifest and runs through a per-tool 60 s timeout wrapper. `ToolRegistry::invoke` gates each call on `PermissionMatrix::decide(name, action_class)` so the Plan / Build / Explore profiles actually narrow behaviour (ZZ4); `ToolContext::check_path_allowed` centralises the File Protection Zones deny list — `.env*`, `.git/`, `.hive/`, and operator-provided `protected_files` — scanned per path component so nested `apps/web/.env` is also blocked (ZZ5). Hosts the `SandboxLockRegistry` (D2 — RAII guards exposed via `GET /v1/sandbox-locks`). `hive-tools` can't depend on `hive-db`, so DB-/executor-backed tools live in `hive-runtime`. |
| `hive-sandbox` | `Sandbox` trait + `LocalFsSandbox`: three-layer path-escape protection (string-level `..`/absolute reject → component normalisation → FS canonicalisation of the deepest existing ancestor and root-prefix re-check — ZZ1). `fs_read` opens once and bounds via `Read::take(cap+1)` so a concurrent writer can't beat the cap check (ZZ10); `fs_write` opens with `O_NOFOLLOW` on Unix so a swap-the-leaf-for-a-symlink TOCTOU can't redirect the write (ZZ11). `shell_exec` runs `env_clear()`-then-allowlist with HOME pointed at the protected `<root>/.hive/run-home/` so npm/cargo/git's cached creds don't leak back into the next `fs_read` (ZZ7). On Unix the child gets `setrlimit` caps (CPU 300 s, AS 1 GiB, NOFILE 1024, NPROC 64). A Docker-backed variant is planned. |
| `hive-search` | `SearchProvider` trait with three implementations: Tavily (BYOK), SearXNG (self-hosted), and **DuckDuckGo** (HTML scraper, zero-config fallback so `web_search` always works). |
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

The unique chokepoint for all LLM work. `run_turn` is the outer wrapper; `run_turn_inner` is the round-loop body that's wrapped in a wall-clock timeout (`DEFAULT_TURN_TIMEOUT`).

1. **Cancel-token bridge** *(outer only)*: when the call has an `agent_id` and a registry, spawn a bridge task that awaits `executors.token_for(agent_id).cancelled()` and flips the chat-turn `cancel` flag. `cancel_subtree(agent)` / `terminate(agent)` therefore actually interrupt the in-flight LLM stream within 50 ms (the cancel-flag poll tick) — not "at the next inbox item" (ZZ2). The handle is aborted before returning.
2. **Budget check** *(inner)*: refuse the turn if `cost_events::total_cost_cents_for_project >= projects.budget_total_cents`. *Known gap:* the check + insert is not transactional; N concurrent turns can overshoot the cap by ~N × per-turn cost (Z10).
3. **Prompt composition** *(inner)*: deterministic **five-layer** composer in `prompt.rs` — Layer 1 agent identity → Layer 2 tool catalog → Layer 3 `HIVE.md` snippets → Layer 4 skill index (empty today, scaffolded for §2 of ROADMAP) → Layer 5 turn-local reminders. Layers 1–2 are byte-identical across turns so provider prompt caching is effective.
4. **Pre-flight token budgeting** *(inner)*: `token_budget::trim_to_fit` truncates oldest non-system messages if the composed prompt would overrun the model's context window. *Known gap:* the contract "preserve the most recent user turn" isn't enforced by a test (ZZ36).
5. **Round loop** *(inner, max 30 rounds, max 60 total tool calls per turn)*:
   - Stream-collect LLM response (text + tool calls); tool-call SSE-byte parser keeps a UTF-8 tail across chunks so emoji/CJK never corrupt (ZZ25).
   - Dispatch tool calls in order. JSON-Schema validation against each tool's manifest. Repeat guard rejects 3 identical `(tool, arguments)` fingerprints. Per-tool 60 s timeout. Loop detector reads `arguments` (ZZ3 — was the wrong key).
   - 50 ms cancel-flag poll between each stream chunk.
6. **Finalization** *(inner)*: persist the transcript (rounds joined by `\n\n`), write a `cost_events` row, emit `chat.<thread>.complete`. **On cancel / timeout / LLM-error / budget-refusal**, `finalize_cancelled` writes a `cost_events` row tagged `status=cancelled` / `status=error` so partial spend still counts against `budget_total_cents`.
7. **Drift hook** *(outer, runs on every exit path)*: read the persisted `chat_messages.tool_calls` for the assistant message and run `drift_hook::record_after_turn`. Hoisted out of `run_turn_inner` so cancel / timeout / LLM-error / budget exits also score drift (Z1) — previously this only ran on the success path.

### 4.4 Agent Execution & Visibility Model

- **Lineage:** `agents.parent_agent_id` (immutable).
- **Wires:** `agent_wires` table (editable parent→child edges).
- **Visibility:** `visible(A) = {A} ∪ direct_parents(A) ∪ descendants(A)`.
- **Relay:** `request_relay(via, target)` where `via` is a direct parent and
  `target` is visible to `via`.
- **DB ↔ Executor sync:** every path that writes `agents.status` *must* also
  call `ExecutorRegistry::{pause,resume,terminate}`. The executor parks its
  inbox via a `Notify` on `Paused`. `PATCH /v1/agents/:id/status` and
  `POST /v1/projects/:id/session/toggle` do this; the drift autopause also
  does (best-effort, see §4.5). The `terminate_agent` endpoint first calls
  `cancel_subtree` (which cascades via `parent_token.child_token()`), then
  drains the executor, then flips the DB.

### 4.5 Drift Hook (`drift_hook::record_after_turn`)

After **every** turn (success / cancel / timeout / LLM-error / budget-refusal — Z1 closed), the runtime scores how much the turn's tool calls covered the active task's expected artifacts. The hook lives in the outer `run_turn`, not the inner round loop, so it reads the persisted `chat_messages.tool_calls` after the inner returns. Four bands:

| score    | side effects                                                       |
|----------|--------------------------------------------------------------------|
| <0.4     | update `assignment.drift_score` only                               |
| 0.4–0.69 | + insert a `drift_events` row (severity=medium)                    |
| 0.7–0.89 | + raise an `alert` + `notification` (severity=high)                |
| ≥0.9     | + `agents::set_status("paused")` AND `ExecutorRegistry::pause()`   |

The hook is best-effort — any DB error is logged but never propagates to fail
a turn the operator already saw complete.

### 4.6 Auto-MCP Synthesis Pipeline (B4)

When the **coordinator** calls the `request_capability` runtime tool:
1. The tool writes an `agent_spawn_requests` row (`status: queued`).
2. It sends the row id through `AppState::spawn_pipeline_tx` (mpsc).

The API server owns the receiver and a consumer task; the consumer dedups
in-flight ids via an `Arc<Mutex<HashSet<String>>>` (B4b — a duplicate send
from a retry or a race no longer spawns two concurrent pipelines on the
same row), rebuilds `BuildPipelineDeps` fresh per id, and runs
`spawn::driver::run_pipeline`. The agent observes progress by polling
`monitor_spawn_request` or via the `/v1/spawn-requests` SSE family.

The pipeline is a state machine: `queued → planning-needs →
matching-existing-mcp → researching-api → (awaiting-approval) →
synthesizing-mcp → composing-prompt → materializing-agent → completed`
(or `failed`). The operator gate sits at `awaiting-approval` when a
discovered API isn't on the safety allowlist; `POST
/v1/spawn-requests/:id/approve` atomically transitions
`awaiting-approval → approved` (ZZ52 — uses `transition_status` so two
parallel clicks can't both succeed), audits the action, and sends the
id back through the mpsc — the dedup HashSet covers operator approvals
too. The pipeline then *resumes from stage 3* using the
`matched_existing_mcp_ids_json` and the discovered APIs (including
`spec`) persisted at the `awaiting-approval` transition — no re-billing
of stages 0–2 (B4c).

The runtime / API decoupling matters: `hive-runtime` cannot depend on
`hive-api`, so the mpsc is the only crate boundary the tool crosses.

---

## 5. Security & Fallbacks

### 5.1 Security Defaults

**Network**
- Bind to `127.0.0.1` only (no auth). *Known gap:* if the operator widens
  the bind (e.g. via tailnet exposure), there is no token gate today —
  see BACKLOG ZZ21.
- CORS origins are restricted to the configured frontend; methods / headers
  are still `Any` (ZZ19/A10 — tighten when frontend stabilises).

**Secrets**
- Master key at `~/.hive/master.key` (`0600` on Unix; ACL-restricted on
  Windows is still planned — ZZ20) drives ChaCha20-Poly1305 sealing for
  every at-rest secret (LLM API keys, GitHub PAT, Tavily key, connector
  credentials).
- Decrypted-secret error paths use `.map_err(|_| ...)` so
  `FromUtf8Error::Display` can't drag the plaintext into log lines
  (ZZ66 — fixed at the GitHub-token, Tavily-key, and LLM-provider-key
  decrypt sites).

**Sandbox limits** (`hive-sandbox::LocalFsSandbox`)
- `fs_read`: hard cap 16 MiB — enforced via `File::take(cap+1)` on a single
  open, eliminating the prior stat-then-read TOCTOU (ZZ10).
- `fs_write`: hard cap 32 MiB — opens with `O_NOFOLLOW` on Unix so a
  swap-the-leaf-for-a-symlink TOCTOU can't redirect the write (ZZ11).
- `shell_exec`: wall-clock timeout per call; `setrlimit` caps on Unix
  (CPU 300 s, AS 1 GiB, NOFILE 1024, NPROC 64); stdout/stderr truncated
  to 256 KiB / 64 KiB; `env_clear()` then a fixed allowlist
  (`PATH, LANG, LC_ALL, TZ, TERM, USER, LOGNAME`); HOME set to
  `<root>/.hive/run-home/` so cached credentials never leak into the
  workspace tree (ZZ7).
- Sandbox creation pre-creates `<root>/.hive/run-home/` so the protected
  zone is ready before the first shell_exec lands.

**Path Resolution Defense** (`LocalFsSandbox::resolve`)
1. String-level reject: absolute paths and any `..` chain that walks
   above root.
2. Component-level normalisation: collapse `./`, validate each
   `Component`, push only onto a fresh stack — never leave root
   lexically.
3. FS canonicalisation: for existing paths, `canonicalize` and re-verify
   the prefix; for not-yet-existing paths, walk up to the **deepest
   existing ancestor**, canonicalise *that*, and verify (ZZ1 — closes
   the planted-parent-symlink escape where `workspace/foo -> /etc`
   would otherwise let `fs_write("foo/bar")` traverse outside).
- The leaf-symlink check is now redundant on Unix (`O_NOFOLLOW`
  handles it at the kernel) but kept as a Windows fallback.

**File Protection Zones** (`ToolContext::check_path_allowed`,
[`context.rs`](../back-end/crates/hive-tools/src/context.rs))
- Centralised path-component scan denies: `.env`, anything starting with
  `.env.`, `.git/`, `.hive/` (HIVE-internal data — todo.json, run-home),
  and any operator-provided `protected_files`.
- Scanned per *component* (not as a prefix), so nested
  `apps/web/.env.production` and submodule `vendor/.git` are also blocked
  (ZZ5).
- Called from every `fs_read` / `fs_list` / `fs_write` / `str_replace`
  invocation, and from `shell_exec` against path-like argv tokens. The
  argv heuristic is best-effort — `sh -c 'cat .env'` bypasses it
  (ZZ6 — tracked for a proper sandbox-containment fix).

**Permission Matrix** (`PermissionMatrix`,
[`permission.rs`](../back-end/crates/hive-tools/src/permission.rs))
- Profiles: `Plan` (read-only), `Build` (write but ask for shell),
  `Explore` (write/shell deny), plus operator-supplied per-tool
  overrides.
- Enforced in `ToolRegistry::invoke`: lookup the action class for the
  tool name, call `decide(name, class)`, and short-circuit with
  `ToolError::Permission` on `Deny` / `Ask` (ZZ4 — previously the
  matrix was data-only and never consulted).

**Sandbox locks** (`SandboxLockRegistry` in `hive-tools/src/locks.rs`)
- Hands out RAII `LockHandle`s on `fs_write`; release on `Drop`.
- Exposed via `GET /v1/sandbox-locks` for the HiveGraph lock overlay.
- Currently visibility-only, not mutual-exclusion (Z16).

### 5.2 No-Key Fallbacks
- **LLM:** Ollama auto-detected at `:11434`.
- **Search:** SearXNG at `:8888`, with a **DuckDuckGo HTML-scraper**
  fallback (no key, no Docker) so `web_search` is universally available
  out of the box.
- **Git:** Local `git` CLI.

### 5.3 SSRF Defense (`hive-tools/src/builtins/web.rs`)
- `validate_url_destination` rejects every IP a remote-fetching tool
  shouldn't touch: loopback, RFC1918, link-local (incl.
  `169.254.169.254`), unspecified, broadcast, multicast, IPv6
  unique-local / link-local / documentation, and IPv4-mapped variants
  of all of the above.
- `WebFetchTool` installs a custom `reqwest::redirect::Policy` that
  re-validates IP-literal hops, caps the chain at 5, and refuses
  non-http(s) schemes — closes the redirect-chain bypass where a public
  host could `302 → 169.254.169.254` (Z3/A9 — partial; the DNS-rebinding
  hostname window is still open, tracked as ZZ8).

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
