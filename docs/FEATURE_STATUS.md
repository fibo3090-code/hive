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
| Estimated cost | partial | local | — | Heuristic only; will be removed once real cost projection lands |
| Connect LLMs | done | cloud-llm | 2 | Per-provider model picker partial — only some providers list models live |
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
| Slash command `/compact` | mock | server | 3 | Toast warning; needs runtime summarization endpoint |
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
| Spawn agent (modal) | partial | server | 4 | Modal exists; needs alignment with Forge agent builder so config is not stripped down |
| Wires (parent→child authority + comm) | planned | server | 4 | Visual edges exist; semantic graph + cycle prevention not implemented |
| Wire creation by drag | planned | local | 4 | |
| Wire deletion (left-click) | planned | local | 4 | |
| Cycle prevention | planned | local | 4 | |
| Lock-overlay toggle | done | server | 1 | Shows agents holding sandbox file locks (often empty) |
| Filters (status) | done | local | 1 | |
| Search | done | local | 1 | |

## Planning / Spec

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Spec doc list | partial | local | 2 | Read-only |
| Import multiple spec docs | planned | local | 2 | Currently one-at-a-time via onboarding only |
| Spec → roadmap → per-agent tasks | planned | cloud-llm | 2 | Spec decomposition pipeline missing |
| Tech debt board (Planning) | partial | local | 1 | Move + create supported; fine-grained edit/delete still missing |
| Hive Mind notes (Planning) | partial | local | 1 | Create + filter; agent-side read/write tools missing |
| Drift visualization | mock | server | 5 | UI panel present; drift events not yet emitted by runtime |

## Stats / Insights

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Agent metrics | partial | local | 1 | Polled snapshot, not live SSE |
| Project metrics | partial | local | 1 | Same as above |
| Eval leaderboard | mock | local | 1 | Static seed |
| Runtime feed (traces) | done | server | 1 | |
| Session replay | partial | server | 1 | Empty until runtime emits replay events |
| Live SSE updates on dashboards | planned | server | 5 | Subscribe to `cost_event`, `task_event`, `agent_state` channels |

## Code & Versioning

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| GitHub Connect | done | git-remote | 1 | Lives in **Settings → GitHub Sync** (not under Code & Versioning) |
| Branch selector | mock | git-remote | 5 | UI exists; cannot actually switch branches |
| Working tree status | mock | local | 5 | Folders clickable but state not refreshed from `git status` |
| File viewer | mock | local | 5 | No real file content yet |
| Restore | mock | local | 5 | No-op until file viewer is wired |
| Refresh button | partial | local | 5 | Refetches list; underlying data still mocked |

## Hive Mind & Agent Tools (backend `hive-tools`)

| Tool | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| `fs_read` / `fs_write` | done | local | 0 | |
| `shell_exec` | done | local | 0 | |
| `web_search` | done | server | 0 | |
| `todo_*` | done | local | 0 | |
| `hive_mind_read` / `_write` / `_list` / `_delete` | planned | local | 5 | Backed by `hive_notes` table (table exists) |
| `send_message_to_agent` | planned | local | 4 | A2A messaging |
| `list_visible_agents` | planned | local | 4 | Respects wire-derived visibility |
| `request_relay` | planned | local | 4 | Child→non-ancestor message relay through parent |
| `spawn_agent` / `delete_agent` / `monitor_agent` / `delegate_task` | planned | local | 5 | Agent management primitives |
| `list_spec_docs` / `add_task` / `add_tech_debt` / `update_tech_debt` / `record_drift` | planned | local | 5 | Spec & quality tools |
| `git_status` / `git_diff` / `git_commit` / `git_pull` / `git_push` | planned | git-remote | 5 | Gated by sovereignty tier |

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
| Audit log export | mock | local | 6 | UI present, no exporter yet |

## Command Palette

| Feature | Status | Dep | Phase | Notes |
|---|---|---|---|---|
| Open with `⌘K` | done | local | 1 | |
| Hard-coded routes | partial | local | 6 | Modular auto-registration planned (commands should subscribe themselves) |
| Fuzzy search | partial | local | 6 | Substring match only today |
| Action commands (spawn agent, new thread, …) | planned | local | 6 | |

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
