# Hive Feature Status

Living matrix mapping every promised feature to its current implementation state and dependency profile. Update whenever a feature ships, gets disabled, or moves between local/server scopes. (How the built parts work → [`architecture.md`](architecture.md); the forward plan → [`ROADMAP.md`](ROADMAP.md); the outstanding-issues queue → [`BACKLOG.md`](BACKLOG.md).)

**Legend**
- **Status**: `done` · `partial` · `mock` (UI exists, no backend) · `planned` · `removed`
- **Dep**: `local` (works fully offline) · `server` (needs the Hive central server — planned, not built) · `cloud-llm` (needs a configured LLM provider) · `git-remote` (needs a GitHub/GitLab token)
- **Phase**: which redesign phase delivered/will deliver this

**Audit reference.** Closed audit items are cross-referenced in this doc; the canonical list of fixed items, open critical work, and the planned remediation order lives in [`BACKLOG.md`](BACKLOG.md). As of the latest sweep (2026-05-28), four batches of fixes have shipped against the 2026-05-27 audit — see BACKLOG §ZZ "Fixed in this pass".

## Onboarding

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Source: From Scratch | done | local | 1 | Default flow |
| Source: Template | planned | server | — | Disabled with explicit `Server-only` badge |
| Source: Import existing codebase | planned | local | later | Disabled with `Planned` badge |
| Budget slider | done | local | 0 | |
| Max parallel agents | done | local | 1 | Renamed from "max agents"; queueing of overflow agents not yet implemented |
| Sovereignty tier: Local | done | local | 0 | Forced default |
| Sovereignty tier: Cloud | planned | server | — | Disabled card |
| Sovereignty tier: Hybrid | removed | — | 1 | Removed entirely |
| Estimated cost | removed | — | 1 | Fake heuristic removed from onboarding and the agent-spawn modal; `lib/cost-estimate.ts` deleted. Real cost projection still planned |
| Connect LLMs | done | cloud-llm | 2 | Five provider clients (`anthropic`/`openai`/`gemini`/`ollama`/`deepseek`) — all implement live `list_models`. DeepSeek reuses the OpenAI wire format. `deepseek-reasoner` (R1) is gated `supports_tools=false`. Launch can continue without a connected provider via the deterministic planner fallback |
| Describe step (interview) | done | cloud-llm | 3 | B1: coordinator chat (`POST /v1/coordinator/converse`) via `StepCoordinatorChat`. Project is now created on step-3 entry (not at Launch) and threaded through via `OnboardingDraft.{projectId, coordinatorThreadId}`. Brief auto-syncs from chat; "Save as brief" button for explicit commit |
| Describe step (import spec) | partial | local | 3 | Spec text becomes the launch brief; uploaded checklist/numbered TODOs are preserved by the deterministic planner instead of being rewritten into generic tasks |
| Team mode toggle | partial | cloud-llm | 3 | Persisted; runtime side reads on `/coordinator/converse` (note: current teamMode is written at first request — toggling during a pending response loses the change) |
| Plan review | partial | local | 3 | Calls `/v1/projects/genesis/preview`; LLM preview is used when available, otherwise the deterministic planner previews phases from the brief. Phases shown but not editable yet |
| Real launch sequence (sandbox provision, git init, migrate ping, search probe) | done | local | 2 | `POST /v1/projects/:id/launch` runs the steps and returns a per-step report; onboarding shows it before navigating to the dashboard |

## Chat Central

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Sidebar threads grouped by agent | done | local | 3 | |
| Thread title from first user message | done | local | 3 | On the first user message the thread is renamed to a (single-spaced, 60-char) truncation of it; emits chat.thread.created so the sidebar updates live |
| Per-project thread scoping | done | local | 3 | Threads filtered by `projectId` |
| Delete thread | done | local | 3 | Trash icon on hover |
| Slash commands `/help /clear /new /model` | done | local | 3 | Implemented client-side |
| Slash command `/compact` | done | cloud-llm | 3 | `POST /v1/chat-threads/:id/compact` — summarises older messages into a synthetic `system` message via the configured cheap model (mechanical fallback if no LLM is reachable) |
| Streaming text **interleaved** with tool calls | done | local | 3 | `collect_response` emits `chat.<id>.token` SSE events per `StreamEvent::Delta` as the LLM streams, interleaved with `tool_call_start` / `tool_call_delta` / `tool_call_end` events between rounds. The runtime also emits a `\n\n` token between rounds so the live stream and the persisted body render identically (ROADMAP §6 closed). |
| Mention agent with `@name` | done | local | 1 | Routes message into that agent's thread |
| Model picker per-message override | done | cloud-llm | 1 | |
| File attachments (images / text) | done | local | 1 | Up to 5 files |
| Compact mode (UI density) | done | local | 1 | |
| Cancel in-flight generation | done | server | 1 | |

## Hive Graph

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Node graph view (ReactFlow) | done | local | 1 | |
| Org chart view | removed | — | 1 | Toggle and component deleted |
| Agent detail drawer | done | local | 1 | |
| Pause / Resume agent | done | server | 1 | DB row + in-process `ExecutorRegistry::{pause,resume,terminate}` are flipped together. Executor parks the inbox via `Notify` on `Paused`; terminated agents drop their cancellation token. `run_turn` spawns a bridge that awaits `executors.token_for(agent).cancelled()` and flips the chat-turn `cancel` flag, so `terminate` / `cancel_subtree` actually interrupt the in-flight LLM stream within 50 ms (ZZ2 batch 3). All canonical lifecycle endpoints (`pause_agent` / `resume_agent` / `terminate_agent` / `set_agent_status`) write audit entries (Z8 closed). `set_agent_status` validates against `{idle, working, paused, deprecated}` before any side effect (ZZ60). **Remaining nit:** `pause()` (vs. `terminate`) doesn't yet interrupt the current turn — it still parks at the next inbox boundary; tracked as Z17 (pure pause-vs-cancel semantics, separate per-turn signal). |
| Delete agent | done | server | 1 | Renamed from "Terminate", added confirm dialog |
| Spawn agent (modal) | done | local | 4 | Uses the shared `AgentFormFields` component (name, role + presets, model, system prompt, tool allowlist grouped by category) — identical to the Forge builder and the HiveGraph config dialog. POSTs `/v1/projects/:id/agents` |
| Wires (parent→child authority + comm) | done | local | 4 | `agent_wires` table + `GET/POST /v1/projects/:pid/wires`, `DELETE /v1/wires/:id`. `spawn_agent` records a wire automatically; agent visibility (`message_agent` / `list_visible_agents` / `request_relay`) walks this graph. **Caveats (audit 2026-05-27):** ZZ17 cycle-prevention is TOCTOU (safe on SQLite by accident, racy on Postgres); ZZ48 `agents.parent_agent_id` lineage and the `agent_wires` graph can disagree (nothing rejects a wire that contradicts lineage). |
| Wire creation by drag | done | local | 4 | Drag node→node in HiveGraph (`onConnect` → `POST …/wires`) |
| Wire deletion (left-click) | done | local | 4 | Click a wire edge → confirm → `DELETE /v1/wires/:id` (lineage edges are not deletable) |
| Cycle prevention | done | local | 4 | `agent_wires::create` BFS-rejects any edge that would close a loop |
| Lock-overlay toggle | done | local | 5 | D2: `SandboxLockRegistry` in `hive-tools` tracks active `fs_write` calls per project via RAII guards. `GET /v1/projects/:id/sandbox-locks` returns the live set; `useSandboxLocks` polls every 2 s and feeds the node + minimap overlay. |
| Filters (status) | done | local | 1 | |
| Search | done | local | 1 | |

## Planning / Spec

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Spec doc list | partial | local | 2 | Read-only; docs with no parsed sections still render their raw markdown so onboarding-created specs are visible |
| Import multiple spec docs | planned | local | 2 | Currently one-at-a-time via onboarding only |
| Spec → roadmap → per-agent tasks | done | local | 2 | Onboarding `/launch` decomposes the brief into `sprints` + `tasks` (per-task assignee role → matched to an existing agent when an LLM planner is used). If no planner model is reachable, or the brief is an explicit checklist, Hive preserves those TODOs with a deterministic local decomposition. Planning → Spec → "Decompose Spec" runs the same via `POST /v1/spec-documents/:id/auto-decompose`. Section-anchored decomposition (`/v1/spec-documents/:id/decompose`) is the alternate path |
| Tech debt board (Planning) | partial | local | 1 | Move + create supported; fine-grained edit/delete still missing |
| Hive Mind notes (Planning) | partial | local | 1 | Create + filter in the UI; agents read/write via `hive_mind_*` tools. UI edit/delete still missing |
| Drift visualization | partial | local | 5 | UI panel present; agents can write events via `record_drift`, but the runtime does not auto-detect drift yet |

## Stats / Insights

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Agent metrics | partial | local | 1 | React Query snapshot; refetched on `agent.status` / `cost.ingested` SSE events (not a dedicated per-project stream) |
| Project metrics | partial | local | 1 | Same — `spend-timeline` / `task-throughput` / `cost-timeline` queries are invalidated by `cost.ingested` / `task.status` events |
| Eval leaderboard | partial | local | 1 | D1: `agent_eval_runs` table + `record_eval` runtime tool + `GET /v1/eval-runs`; `LeaderboardTab` consumes via `useEvalRunsData`. UI is real; entries arrive only when agents call `record_eval` |
| Runtime feed (traces) | done | server | 1 | |
| Session replay | partial | server | 1 | Empty until runtime emits replay events |
| Live SSE updates on dashboards | partial | local | 5 | The global `/v1/events` stream already drives query invalidation for cost/task/agent changes (see `realtime/useSse.ts`). A dedicated `GET /v1/projects/:pid/events` multiplexed stream is still planned. **Caveats (audit 2026-05-27):** ZZ69 several backend event names have no handler in `useSse` (`agent_spawn_request.*`, `agent_task_assignment.*`, `chat.thread.cleared`, `drift_event.updated`, `spec_document.decomposed`); ZZ70 `sync.required` triggers an unscoped `invalidateQueries()` that stampedes on lag; Z4 / ZZ72 the Modules page still opens a duplicate `EventSource` defeating the singleton cap. |
| Runtime drift auto-detection | done | local | 5 | The outer `run_turn` reads persisted `chat_messages.tool_calls` after the inner returns and calls `drift_hook::record_after_turn` on **every** exit path — success, cancel, timeout, LLM-error, and budget-refusal alike (Z1 closed batch 2). Scoring lives in `drift.rs`; four bands (`<0.4` / `0.4-0.69` / `0.7-0.89` / `≥0.9`) with auto-pause at ≥0.9. Agents can still write events directly via the `record_drift` tool. UI panel on Planning → Drift is still partial. |
| Budget enforcement | done | local | 5 | `chat::run_turn` claims a `RESERVATION_CENTS` ($0.50) reservation row in a transaction up-front (Z10 closed) — the INSERT acquires the SQLite write lock so concurrent turns serialise on the budget gate. The reservation is updated in place at finalize / cancel / error so the cost-event count stays one-per-turn and the budget sum is always accurate. `<= 0` = unlimited. Partial spend on cancel / timeout / LLM-error is persisted via the same `update_to_final` path. **Remaining nit:** ZZ55 — `update_settings` writes the budget value via ~10 non-transactional `put_value` calls (separate concern). |
| Interleaved persistence of assistant narration | done | local | 3 | The full per-round transcript is persisted (rounds joined by blank lines), so a reload matches the live stream |

## Code & Versioning

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| GitHub Connect | done | git-remote | 1 | Lives in **Settings → GitHub Sync** (not under Code & Versioning) |
| Branch selector | done | local | 5 | Lists real branches (`GET …/git/branches`), checkout via `POST …/git/checkout` |
| Working tree status | done | local | 5 | File list comes from `GET …/git/status`; stage toggles are client-side until commit |
| File viewer | done | local | 5 | Read-only Monaco viewer fed by `GET …/git/file`; language inferred from extension |
| Restore | done | local | 5 | "Discard" reverts unstaged files via `POST …/git/restore` |
| Refresh button | done | local | 5 | Refetches status + branches + open file |
| Push / pull from this page | planned | git-remote | — | No `git push`/`git pull` endpoint yet; remote sync goes through Settings → GitHub Sync |

## Hive Mind & Agent Tools (backend `hive-tools` + `hive-runtime`)

| Tool | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| `fs_read` / `fs_write` / `fs_list` | done | local | 0 | Descriptions rewritten with "do NOT" exclusion boundaries (research-backed 30-50% mis-selection cut) |
| `str_replace` | done | local | 5 | Surgical file edit (oldString → newString). The single biggest accuracy + token-cost win for coding agents — no more full-file rewrites for one-line changes. `replaceAll` defaults to false; ambiguous matches return a structured error asking the LLM to add context. Honours File Protection Zones |
| `shell_exec` | done | local | 0 | |
| `think` | done | local | 5 | Silent scratchpad — writes to tracing, returns `{ok, noted}`. Gives smaller models (DeepSeek V3, Ollama-hosted, etc.) a working-memory step before committing to a tool call |
| `task_complete` | done | local | 5 | Clean turn-termination signal. Required `summary`, optional `workDone` + `issuesFound`. Stops the LLM from looping or over-elaborating once the user's request is satisfied |
| `web_search` | done | local | 0 | Three backends now — Tavily (BYOK, scored), SearXNG (self-hosted), and **DuckDuckGo HTML scraper as a zero-config fallback** (no key, no Docker). Provider selection ladder lives in `hive-api::build_tools_for_chat` |
| `todo` | done | local | 0 | Single tool with `action` ∈ {add, complete, remove, list} over `.hive/todo.json`. Not the richer `todo_create`/`todo_update`/… surface sketched in [`architecture.md`](architecture.md#6-future-design-richer-workspace-todo-tools) (still a design sketch) |
| `hive_mind_write` / `_read` / `_list` / `_delete` | done | local | 5 | `hive-runtime::db_tools`, backed by `hive_mind_notes` (topic = `category`). Enabled by default for every agent |
| `spawn_agent` / `message_agent` | done | local | 4 | `hive-runtime::agent_tools`. Coordinator-scoped (in `coordinator_tools`, not the global default) |
| `list_spec_docs` / `read_spec_doc` | done | local | 5 | `hive-runtime::db_tools` — read project spec docs + section anchors |
| `add_task` | done | local | 5 | `hive-runtime::db_tools` — file a backlog task (optionally agent-assigned) |
| `add_tech_debt` / `update_tech_debt` | done | local | 5 | `hive-runtime::db_tools` |
| `record_drift` | done | local | 5 | `hive-runtime::db_tools` — writes a `drift_events` row (the runtime does not auto-detect drift yet; this is the agent-driven path) |
| `git_status` / `git_diff` / `git_log` / `git_commit` | done | local | 5 | `hive-runtime::git_tools` — operate on the project workspace repo |
| `git_pull` / `git_push` | done | git-remote | 5 | `hive-runtime::git_tools` — rejected on `local`-tier projects |
| `message_agent` (wire-derived visibility) / `list_visible_agents` / `request_relay` | done | local | 4 | `message_agent` now enforces the visibility rule (self + direct parents + descendants; falls back to "same project" if the project has no wires). `list_visible_agents` lists reachable peers; `request_relay` routes a message through a parent that can see a more distant agent |
| `delete_agent` / `monitor_agent` / `delegate_task` | done | local | 5 | `hive-runtime::agent_tools`. `delete_agent` retires a direct sub-agent (cancel subtree + terminate + status=deprecated); `monitor_agent` reads status/runtime-state/recent inbox; `delegate_task` creates a tracked task assigned to a visible agent and dispatches it |
| `request_capability` / `monitor_spawn_request` | done | local | 4 | B4: coordinator asks for an MCP/connector it lacks; runtime tool writes an `agent_spawn_requests` row and sends the id over `spawn_pipeline_tx` (mpsc). `hive-api` consumer rebuilds `BuildPipelineDeps` and runs the synthesis pipeline; agent observes via `monitor_spawn_request` or the `/v1/spawn-requests` SSE stream. Coordinator-only |
| `record_eval` | done | local | 5 | D1: writes an `agent_eval_runs` row; surfaced on the Stats → Leaderboard tab |
| File Protection Zones | done | local | 5 | `ToolContext::check_path_allowed` centralises the deny list — `.env`, `.env.*`, `.git/`, `.hive/`, plus user-protected — scanned **per path component** so nested `apps/web/.env.production` and submodule `vendor/.git` are also blocked (ZZ5 closed). Called from `fs_read` / `fs_list` / `fs_write` / `str_replace` and from `shell_exec` for path-like argv tokens. `shell_exec`'s HOME points at the protected `<root>/.hive/run-home/` so cached creds that npm/cargo/git write don't leak into the next `fs_read` (ZZ7 closed). Path normalisation handles `./`, `\`, trailing `/`, and Windows case-folding. **Permission Matrix is now enforced** before tool invoke — `Plan` / `Build` / `Explore` profiles actually narrow behaviour (ZZ4 closed in 9eb75a3). **Remaining gap:** the `shell_exec` argv heuristic is best-effort against `sh -c 'cat .env'`, `awk '{print}' .env`, etc. (ZZ6) — proper containment is on the Docker-sandbox roadmap. |

## Forge

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Skills tab | partial | local | 3 | List + create (name/slug/description/system-prompt fragment) + delete; tool/path allowlists not editable from the UI yet |
| Modules tab | partial | server | 3 | Synthesis pipeline mocked |
| Connectors tab | done | local | 3 | List + create (HTTP API with auth kind + encrypted credential, or MCP server) + delete, via `/v1/projects/:id/connectors` / `DELETE /v1/connectors/:id` |
| Agents tab (custom builder) | done | local | 3 | Uses the shared `AgentFormFields` (name/role/model/system-prompt/tool-allowlist); the unused tier/autonomy inputs were removed; Blueprints sub-tab pre-fills the form |
| Marketplace download | planned | server | — | Disabled; needs Hive central server |
| Publish to public registry | planned | server | — | Same dependency |

## Settings

| Section | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| LLM providers | done | cloud-llm | 2 | |
| GitHub Sync | done | git-remote | 1 | Correctly placed here |
| Sovereignty | partial | local | 1 | Cloud option visible-but-disabled |
| Notifications | partial | local | 1 | Channel toggles work; central server delivery planned |
| Audit log export | planned | local | 6 | No export UI exists yet (only an "Audit Log Retention" dropdown that has no backend effect) |

## Command Palette

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Open with `⌘K` | done | local | 1 | |
| Routes | done | local | 6 | Static list, but routes are correct (no more stale `/insights` / `/spec` / `/modules`). Self-registration by feature modules still planned |
| Fuzzy search | done | local | 6 | Subsequence matching with scoring (contiguous runs + word starts weighted) |
| Action commands | partial | local | 6 | New project / new thread / connect-LLM navigations; agent-spawn-from-palette still planned |

---

## Server-only features (require Hive central server)

The following will stay disabled with a tooltip until the central server exists:
- Onboarding template gallery
- Cloud sovereignty tier
- Marketplace agent download / publish
- Public agent registry
- Cross-org metrics / leaderboards aggregation

## Removed for good

- Hybrid sovereignty tier (replaced by Local + Cloud only)
- Org Chart view in HiveGraph (Node graph is canonical)
- Duplicate Hive Mind / Tech Debt / Session Weekly sub-tabs under Stats (canonical home is Planning)
- Fake "estimated cost" heuristic (`front-end/src/lib/cost-estimate.ts`) — removed from onboarding and the agent-spawn modal
- Mock Code & Versioning fixtures — replaced with the real `git/*` endpoints
- Dead UI: `Index.tsx`, `CostForecastModal`, `BudgetExtensionModal`, `WakeReportModal`
- `m20260514_agent_skill_bindings`-out-of-order migration "fix" (ZZ37 retracted — the audit was wrong; the vector ordering is dependency-correct because the migration's FK references `Skills::Table` which is created later in `m20260606_redesign_foundations`)

## Recently closed audit findings (2026-05-27 → 2026-05-28)

Reverse-chronological. The full inventory + ranking lives in [`BACKLOG.md`](BACKLOG.md).

**Batch 4 (`1c17673`)** — sandbox security + LLM correctness + small frontend
- **ZZ7** `shell_exec` HOME → `<root>/.hive/run-home/` (no more cached-cred leak via `fs_read`)
- **ZZ10** `fs_read` size-cap TOCTOU closed via `File::take(cap+1)`
- **ZZ11** `fs_write` symlink TOCTOU closed via `O_NOFOLLOW` on Unix
- **ZZ13** `rehydrate_from_db` honours `parent_agent_id` so `cancel_subtree` cascades to rehydrated children
- **ZZ27** OpenAI `parse_event` processes `choices` first so finish_reason isn't dropped when a chunk carries both
- **ZZ29** Gemini chat stream emits a fallback `Complete` on EOF when no finish-reason / usage chunk arrived
- **ZZ31** DeepSeek strips `tools` from R1 requests defensively (in addition to the `supports_tools=false` gate)
- **ZZ32** Anthropic `max_tokens` picks model-aware defaults via `default_max_tokens_for` instead of the silent 4096 cap
- **Z11** `Projects.tsx` awaits `setActiveProject` before navigating to `/dashboard`
- **Z15** `NotFound.tsx` uses `<Link>` instead of `<a href>`

**Operator commit `9eb75a3`** — between batches 3 and 4
- **ZZ4** `PermissionMatrix` enforced in `ToolRegistry::invoke` with `Plan` / `Build` / `Explore` profile coverage tests
- **ZZ5** `is_system_protected` switched to a path-component scan (catches nested `.env` / `.git`)
- **Z14** `Projects.tsx` budget-percentage zero-guard

**Batch 3 (`558f283`)**
- **ZZ2** (partial) cancel-token bridge → in-flight chat turns actually cancel on `cancel_subtree` / `terminate`
- **B4c** `run_pipeline` resumes from `awaiting-approval` instead of re-running stages 0–2
- **Z2** (extended) `set_agent_status` + `toggle_project_session` bubble executor pause/resume/terminate failures

**Batch 2 (`bb5b4be`)**
- **Z1** drift hook hoisted to outer `run_turn`, fires on every exit
- **ZZ38** `seed_demo` claims `status: "in-progress"` sentinel up-front via new `settings::put_value_if_absent`
- **ZZ52** `approve_spawn_request` uses atomic `agent_spawn_requests::transition_status`
- **B4b** spawn-pipeline mpsc consumer dedups in-flight ids
- **ZZ53** `delete_project` terminates executors + `remove_dir_all`s the workspace before the DB cascade
- **Z8** (partial) `pause_agent` / `resume_agent` / `terminate_agent` write audit entries
- **Z2** (partial) `terminate_agent` propagates executor errors via `?`

**Batch 1 (`cea2fe9`)**
- **ZZ1** `fs_write` planted-parent-symlink escape closed via deepest-existing-ancestor canonicalise
- **ZZ3** Loop detector reads `"arguments"` instead of always-Null `"args"`
- **ZZ25** SSE stream keeps a `Vec<u8>` tail across chunks; no more U+FFFD on multi-byte boundaries
- **Z3 / A9** (partial) `WebFetchTool` redirect policy rejects IP-literal hops to private addresses
- **ZZ57** `download_chat_attachment` canonicalises + prefix-checks
- **ZZ60** `set_agent_status` enum-validates body.status
- **ZZ64** audit purge job awaits the tick before the body
- **ZZ65** `rehydrate_from_db` failures surface via `tracing::error!`
- **ZZ66** Four secret-decrypt sites use `.map_err(|_| ...)`
