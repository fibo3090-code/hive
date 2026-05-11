# HIVE architecture, in one page

Two halves talking over `127.0.0.1:8787`:

```
┌─────────────────────────────────────┐         ┌──────────────────────────┐
│  front-end  (Vite + React, :8080)   │  HTTP   │  hive-api  (Axum, :8787) │
│                                     │ ◀────▶  │                          │
│  ModelPicker · ChatCentral ·        │   SSE   │  routes → handlers       │
│  HiveGraph · Onboarding · Settings  │ ◀────── │  ExecutorRegistry        │
└─────────────────────────────────────┘         └──────────────────────────┘
                                                            │
                              ┌─────────────────────────────┼──────────────┐
                              │                             │              │
                       ┌──────▼───────┐             ┌───────▼─────┐ ┌─────▼─────┐
                       │  hive-llm    │             │ hive-runtime│ │ hive-tools│
                       │ Anthropic /  │             │ chat turn,  │ │ web_search│
                       │ OpenAI /     │             │ tool loop,  │ │ fs_*      │
                       │ Gemini /     │             │ executors,  │ │ shell_exec│
                       │ Ollama       │             │ event bus   │ │ web_fetch │
                       └──────────────┘             └─────────────┘ └───────────┘
                                                            │
                                                    ┌───────▼──────┐
                                                    │ hive-sandbox │
                                                    │ Docker /     │
                                                    │ local-fs jail│
                                                    └──────────────┘
                                                            │
                                                    ┌───────▼──────┐
                                                    │   hive-db    │
                                                    │ SeaORM →     │
                                                    │ SQLite or    │
                                                    │ Postgres     │
                                                    └──────────────┘
```

## Crates

| Crate | Role |
|---|---|
| `hive-api` | Axum HTTP server, route handlers, SSE event bus, AppState wiring. |
| `hive-domain` | Shared domain types (currently a thin layer; will grow). |
| `hive-db` | SeaORM entities, repos, migrations. |
| `hive-llm` | Provider trait + Anthropic / OpenAI / Gemini / Ollama clients. Streaming, tool-use, pricing, family-keyed metadata, token-budget estimator. |
| `hive-runtime` | Per-agent executor (`AgentExecutor`), the streaming chat turn driver (`run_turn`), the event bus, the tool-call schema validator, registry. |
| `hive-tools` | Built-in tools (`fs_read`, `fs_write`, `fs_list`, `shell_exec`, `todo`, `web_fetch`, `web_search`). Each tool gets a JSON Schema manifest and runs through the per-tool timeout wrapper. The agent-coordination tools `spawn_agent` / `message_agent` live in `hive-runtime` (`agent_tools.rs`), not here. Other tools listed in `docs/FEATURE_STATUS.md` (`hive_mind_*`, git tools, A2A `send_message_to_agent` / `list_visible_agents` / `request_relay`, spec/tech-debt/drift tools) are still planned. |
| `hive-sandbox` | `LocalFsSandbox` (path-escape protection, symlink-safe canonicalisation, env-scrubbed exec). Docker variant ships in a follow-up. |
| `hive-search` | Tavily + SearxNG providers behind a `SearchProvider` trait. |
| `hive-git` | `git2` wrapper + optional `octocrab` for GitHub PRs. |
| `hive-crypto` | ChaCha20-Poly1305 master-key encryption for at-rest secrets. Opaque error variants — `Decrypt` is the only thing the caller ever sees, the real cause goes to `tracing::error!`. |
| `hive-seed` | Demo project + agent seeding for an empty DB. Idempotent via a sentinel row. |

## Request flow — a chat turn

1. Frontend POSTs `/v1/chat-threads/:id/messages`. The handler creates the
   `chat_messages` row in `pending`, generates an assistant message id,
   spawns a background task running `hive_runtime::chat::run_turn`, and
   returns the IDs to the client.
2. The frontend opens an `EventSource('/v1/events')` (one shared with the
   global SSE bus) and listens for `chat.<thread_id>.token`,
   `…tool_call`, `…tool_result`, `…complete`, `…cancelled`, `…error`,
   `…context_trim`.
3. `run_turn` is wrapped in a 180s wall-clock timeout. Inside:
    - Pre-flight token budgeting via `model_metadata::context_window_for`
      and `token_budget::trim_to_fit`. If history won't fit, drop oldest
      non-system messages (anchor on system + most recent user turn) and
      emit `context_trim`.
    - Loop up to `MAX_TOOL_ROUNDS = 30` times, capped at
      `MAX_TOTAL_TOOL_CALLS = 60` total dispatches:
        - Stream-collect the LLM response; the loop polls a shared cancel
          flag every 50ms so user-clicked cancel tears the upstream
          stream down within ~50ms.
        - If the response includes tool calls: validate against the
          schema, dispatch each through the per-tool 60s timeout wrapper,
          emit `tool_call` / `tool_result` SSE events, push the result
          back into the conversation, and loop.
    - On normal exit: persist the final assistant content with cumulative
      token counts and cost (i64 cents end-to-end), emit `complete`.

## SSE event taxonomy

Per-thread chat events (consumed by `useChatStream`):
- `chat.<thread_id>.token` — incremental assistant text (streamed live during
  every LLM round; synthetic fallback messages are streamed once at the end).
- `chat.<thread_id>.tool_call` / `…tool_result` — inline tool dispatch.
- `chat.<thread_id>.tool_validation_error` — a tool call failed schema
  validation before dispatch.
- `chat.<thread_id>.context_trim` — pre-flight history truncation.
- `chat.<thread_id>.message` — a freshly persisted chat message (user or
  assistant) is available; clients refetch the thread.
- `chat.<thread_id>.complete` / `…cancelled` / `…error` — terminal.
- `chat.<thread_id>.streaming` — fired once when the assistant starts.

> Note: assistant text is streamed live but only persisted to the DB once, at
> the end of the turn (the final tool-free round's text, or the last non-empty
> narration). Interleaved persistence of all rounds is still planned — see
> `docs/FEATURE_STATUS.md` → "Streaming text interleaved with tool calls".

Global events (consumed by `useSse` with payload-scoped invalidation):
- `project.updated`, `agent.status`, `agent.spawned`, `task.status`,
  `cost.ingested`, `git.changed`, `synthesis.progress|complete|error`,
  `llm_provider.updated|tested`, `workspace.updated`, `chat.thread.created`,
  `alert.created|dismissed`, `notification.created`,
  `session.toggled|closed`, `module.installed`.

## Data persistence

SeaORM. SQLite by default (`sqlite://./hive.db?mode=rwc`); Postgres
supported by the same migration set — every migration that uses raw
SQL dispatches on `DatabaseBackend` so SQLite, Postgres, and MySQL
syntax are all covered.

Cost columns (`cost_events.cost_cents`, `chat_messages.cost_cents`)
are i64 end-to-end. The widening migration is a no-op on SQLite
(dynamic typing) and an `ALTER COLUMN ... TYPE BIGINT` on Postgres.

## Security defaults

- Bind to `127.0.0.1` only. The API has no auth and tools execute
  shell commands.
- CORS allow-list restricted to the dev Vite origins; permissive CORS
  is never set.
- API errors collapse to opaque internal-error responses; the real
  detail goes to `tracing::error!` keyed by a per-request `request_id`
  surfaced in the response header `x-request-id`.
- Master key for at-rest secret encryption lives at
  `~/.hive/master.key` mode `0600` (Unix); on Windows the writer
  emits a `tracing::warn!` because we don't ship a Windows-ACL
  helper yet.
- Sandbox path resolution uses two-layer defence (string-level
  `..`/absolute reject, then FS canonicalisation + root-prefix
  re-check). Symlinks inside the workspace pointing outside are
  rejected; `fs_write` refuses if the target itself is a symlink.
- Shell exec scrubs the env via `env_clear()` before spawning the
  child, then re-adds a small allowlist (PATH, LANG, TZ, …) plus
  `HOME=<workspace_root>`.

## No-key fallbacks (per the design principle in the plan)

| Capability | BYOK | No-key fallback |
|---|---|---|
| LLM | Anthropic / OpenAI / Gemini | Ollama (auto-detected at startup) |
| Web search | Tavily | SearxNG (`http://localhost:8888`) |
| Sandbox | Docker | `LocalFsSandbox` |
| Git host | GitHub PAT | local `git2` only |
