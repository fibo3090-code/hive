# Hive Feature Status

Living matrix mapping every promised feature to its current implementation state and dependency profile. Update whenever a feature ships, gets disabled, or moves between local/server scopes.

Legend
- **Status**: `done` · `partial` · `mock` (UI exists, no backend) · `planned` · `removed`
- **Dep**: `local` (works fully offline) · `server` (needs Hive central server, not yet built) · `cloud-llm` (needs configured LLM provider) · `git-remote` (needs GitHub/GitLab token)
- **Phase**: which redesign phase delivered/will deliver this

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
| Connect LLMs | done | cloud-llm | 2 | All four provider clients (`anthropic`/`openai`/`gemini`/`ollama`) implement live `list_models`; the onboarding step shows them per provider |
| Describe step (interview) | partial | cloud-llm | 3 | Single textarea + spec upload; merged chat-style capture is planned |
| Describe step (import spec) | partial | local | 3 | Spec text becomes description; not yet decomposed into per-agent task tree |
| Team mode toggle | partial | cloud-llm | 3 | Persisted; runtime side reads on `/coordinator/converse` |
| Plan review | partial | cloud-llm | 3 | Calls `/v1/projects/genesis/preview`; phases shown but not editable yet |
| Real launch sequence (DB migrate ping, search probe, sandbox provision) | planned | local | 2 | Currently navigates straight to dashboard after `addProject` |

## Chat Central

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Sidebar threads grouped by agent | done | local | 3 | |
| Thread title from first user message | partial | local | 3 | Defaults to "Thread N" or agent name; auto-rename pending |
| Per-project thread scoping | done | local | 3 | Threads filtered by `projectId` |
| Delete thread | done | local | 3 | Trash icon on hover |
| Slash commands `/help /clear /new /model` | done | local | 3 | Implemented client-side |
| Slash command `/compact` | done | cloud-llm | 3 | `POST /v1/chat-threads/:id/compact` — summarises older messages into a synthetic `system` message via the configured cheap model (mechanical fallback if no LLM is reachable) |
| Streaming text **interleaved** with tool calls | planned | server | 3 | Backend currently emits text only after all tool rounds complete; `chat.rs` needs to flush `response.text` deltas between rounds |
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
| Pause / Resume agent | partial | server | 1 | Wired to backend; executor support varies |
| Delete agent | done | server | 1 | Renamed from "Terminate", added confirm dialog |
| Spawn agent (modal) | partial | server | 4 | Modal now actually creates the agent (`POST /v1/projects/:id/agents`) with name/role/model/provider/system-prompt; hybrid tier removed, Cloud tier disabled. Still thinner than the Forge `AgentConfigDialog` (no tool allowlist) |
| Wires (parent→child authority + comm) | done | local | 4 | `agent_wires` table + `GET/POST /v1/projects/:pid/wires`, `DELETE /v1/wires/:id`. `spawn_agent` records a wire automatically; agent visibility (`message_agent` / `list_visible_agents` / `request_relay`) walks this graph |
| Wire creation by drag | done | local | 4 | Drag node→node in HiveGraph (`onConnect` → `POST …/wires`) |
| Wire deletion (left-click) | done | local | 4 | Click a wire edge → confirm → `DELETE /v1/wires/:id` (lineage edges are not deletable) |
| Cycle prevention | done | local | 4 | `agent_wires::create` BFS-rejects any edge that would close a loop |
| Lock-overlay toggle | mock | server | 1 | Toggle renders, but the locked-agent set in `HiveGraph.tsx` is a hardcoded empty `Set` — the runtime doesn't expose held sandbox locks yet, so the overlay is always empty |
| Filters (status) | done | local | 1 | |
| Search | done | local | 1 | |

## Planning / Spec

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Spec doc list | partial | local | 2 | Read-only |
| Import multiple spec docs | planned | local | 2 | Currently one-at-a-time via onboarding only |
| Spec → roadmap → per-agent tasks | planned | cloud-llm | 2 | Spec decomposition pipeline missing |
| Tech debt board (Planning) | partial | local | 1 | Move + create supported; fine-grained edit/delete still missing |
| Hive Mind notes (Planning) | partial | local | 1 | Create + filter in the UI; agents read/write via `hive_mind_*` tools. UI edit/delete still missing |
| Drift visualization | partial | local | 5 | UI panel present; agents can write events via `record_drift`, but the runtime does not auto-detect drift yet |

## Stats / Insights

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Agent metrics | partial | local | 1 | React Query snapshot; refetched on `agent.status` / `cost.ingested` SSE events (not a dedicated per-project stream) |
| Project metrics | partial | local | 1 | Same — `spend-timeline` / `task-throughput` / `cost-timeline` queries are invalidated by `cost.ingested` / `task.status` events |
| Eval leaderboard | mock | local | 1 | Static seed |
| Runtime feed (traces) | done | server | 1 | |
| Session replay | partial | server | 1 | Empty until runtime emits replay events |
| Live SSE updates on dashboards | partial | local | 5 | The global `/v1/events` stream already drives query invalidation for cost/task/agent changes (see `realtime/useSse.ts`). A dedicated `GET /v1/projects/:pid/events` multiplexed stream is still planned, as is the eval-leaderboard data source |
| Runtime drift auto-detection | planned | local | 5 | `hive-runtime/src/drift.rs` has scoring fns but the turn loop doesn't call them yet; agents can write events via the `record_drift` tool |
| Interleaved persistence of assistant narration | planned | local | 3 | Intra-round text is streamed live over SSE but only the final round's text is persisted; persisting the full transcript is pending |

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
| `fs_read` / `fs_write` | done | local | 0 | |
| `shell_exec` | done | local | 0 | |
| `web_search` | done | server | 0 | |
| `todo` | done | local | 0 | Single tool with `action` ∈ {add, complete, remove, list} over `.hive/todo.json`. Not the richer `todo_create`/`todo_update`/… surface sketched in `back-end/docs/TODO_TOOL_SPEC.md` (still a design sketch) |
| `hive_mind_write` / `_read` / `_list` / `_delete` | done | local | 5 | `hive-runtime::db_tools`, backed by `hive_mind_notes` (topic = `category`). Enabled by default for every agent |
| `spawn_agent` / `message_agent` | done | local | 4 | `hive-runtime::agent_tools`. Coordinator-scoped (in `coordinator_tools`, not the global default) |
| `list_spec_docs` / `read_spec_doc` | done | local | 5 | `hive-runtime::db_tools` — read project spec docs + section anchors |
| `add_task` | done | local | 5 | `hive-runtime::db_tools` — file a backlog task (optionally agent-assigned) |
| `add_tech_debt` / `update_tech_debt` | done | local | 5 | `hive-runtime::db_tools` |
| `record_drift` | done | local | 5 | `hive-runtime::db_tools` — writes a `drift_events` row (the runtime does not auto-detect drift yet; this is the agent-driven path) |
| `git_status` / `git_diff` / `git_log` / `git_commit` | done | local | 5 | `hive-runtime::git_tools` — operate on the project workspace repo |
| `git_pull` / `git_push` | done | git-remote | 5 | `hive-runtime::git_tools` — rejected on `local`-tier projects |
| `message_agent` (wire-derived visibility) / `list_visible_agents` / `request_relay` | done | local | 4 | `message_agent` now enforces the visibility rule (self + direct parents + descendants; falls back to "same project" if the project has no wires). `list_visible_agents` lists reachable peers; `request_relay` routes a message through a parent that can see a more distant agent |
| `delete_agent` / `monitor_agent` / `delegate_task` | planned | local | 5 | Agent-management primitives beyond `spawn_agent` |

## Forge

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Skills tab | partial | local | 3 | List works; create/edit minimal |
| Modules tab | partial | server | 3 | Synthesis pipeline mocked |
| Connectors tab | partial | local | 3 | List works; encrypted credential editor minimal |
| Agents tab (custom builder) | partial | local | 3 | Currently exposes role/model/tier/autonomy only — needs alignment with HiveGraph spawn |
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
