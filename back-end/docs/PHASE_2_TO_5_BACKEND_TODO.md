# Backend TODO — Phases 2–5

Companion to `docs/FEATURE_STATUS.md`. Concrete Rust changes the frontend Phase work depends on. Group by crate.

## `hive-runtime`

### Streaming interleave (Phase 3 #19)
File: `crates/hive-runtime/src/chat.rs`

Today, `run_completion` collects `response.text` after each tool round and only emits a final assistant message when the model returns no tool calls. Symptom: in the UI, the text always appears after every tool call has finished, never between them.

Change:
1. After each round, if `response.text` is non-empty, immediately broadcast a `RuntimeEvent::AssistantTextChunk { message_id, delta, round_index }` over the `EventBus` and append to the persisted message body.
2. Frontend (`api/chat.ts` SSE handler) already merges `streaming[id].content`; the chunk handler must concatenate deltas with a `\n\n--- (round N tool calls) ---\n\n` separator (or similar) so the user sees:
   > "I'll first check the file…"
   > [tool: fs_read]
   > "Found three TODOs. Let me also grep for FIXME…"
   > [tool: shell_exec]
   > "Done — here's the summary."
3. Keep `MAX_TOOL_ROUNDS=30` and `MAX_TOTAL_TOOL_CALLS=60` as-is.
4. Add a feature flag `interleave_chat_text` (config or env) so the new behavior can be rolled back without redeploy.

### `/compact` summarization (Phase 3 #20)
New endpoint: `POST /v1/chat/threads/:id/compact`
- Take the full message history, ask the LLM (cheap model from settings) for a 200–400-token summary.
- Soft-delete messages older than the last N (e.g., 6) and prepend a synthetic `system` message with the summary.
- Frontend `/compact` slash command calls this endpoint instead of the warning toast it currently shows.

### A2A messaging (Phase 4 #25–27)
- New `agent_messages` table already exists (see `entities/agent_message.rs`).
- Add executor handlers in `crates/hive-runtime/src/executor.rs`:
  - `InboxItem::AgentMessage { from_agent_id, content, reply_to }` already routable; add tool wrappers.
- New tools in `crates/hive-tools/src/builtins/`:
  - `agent_send.rs` — `send_message_to_agent(target_agent_id, content)`. Validates target is in caller's visibility set (parent or descendants).
  - `agent_list.rs` — `list_visible_agents()`.
  - `agent_relay.rs` — `request_relay(via_agent_id, target_agent_id, content)`.
- Visibility resolution: walk wires from `agent_wires` table (new — see schema below).

### Wire schema (Phase 4)
New migration in `crates/hive-db/migration/`:
```sql
CREATE TABLE agent_wires (
    id           TEXT PRIMARY KEY,
    project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    child_agent_id  TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    UNIQUE (parent_agent_id, child_agent_id)
);
CREATE INDEX agent_wires_parent ON agent_wires(parent_agent_id);
CREATE INDEX agent_wires_child  ON agent_wires(child_agent_id);
```
Cycle prevention: on insert, run BFS from `child_agent_id` through existing wires; reject if `parent_agent_id` is reachable.

REST endpoints (in `hive-api`):
- `POST   /v1/projects/:pid/wires { parent, child }`
- `DELETE /v1/wires/:id`
- `GET    /v1/projects/:pid/wires`

## `hive-tools`

### Hive Mind tools (Phase 5 #28)
The `notes` table already exists. Add:
- `hive_mind_write(title, body, tags?)` — INSERT
- `hive_mind_read(id)` — SELECT
- `hive_mind_list(tags?, limit?)` — SELECT with filter
- `hive_mind_delete(id)` — DELETE (soft via `deleted_at`)

All scoped to the calling agent's `project_id` automatically (use `ToolContext`).

### Spec / tech-debt / drift tools (Phase 5 #30)
- `list_spec_docs()`, `read_spec_doc(id)`, `add_task(spec_doc_id, title, assignee_agent_id?, …)`
- `add_tech_debt`, `update_tech_debt`, `move_tech_debt`
- `record_drift(spec_doc_id, summary, severity)`

### Git tools (Phase 5 #31)
- `git_status()`, `git_diff(path?)`, `git_commit(message, paths)`, `git_pull()`, `git_push()`
- All call into `hive-git`. Push/pull gated by sovereignty tier (`tier == Local` → reject `git_push` with explanatory error).

## `hive-api`

### Live metrics SSE (Phase 5 #32)
New endpoint: `GET /v1/projects/:pid/events` (SSE stream).
- Multiplexes `cost_event`, `task_event`, `agent_state` from the existing `EventBus`.
- Frontend `useSse` hook subscribes; `useAgentMetrics` / `useProjectMetrics` queries swap from polling to push-on-change.

### Real launch sequence (Phase 2 #14)
- `POST /v1/projects/launch` body: `OnboardingDraft`. Server-side:
  1. `mkdir` per-project sandbox dir under `<data_dir>/sandboxes/<project_uuid>/` (fixes the shared-folder bug).
  2. Run pending DB migrations (already part of startup; just confirm OK).
  3. Probe SearXNG (if configured) and report status.
  4. Persist project, return draft + diagnostics.
- Frontend onboarding `launchProject` calls this and shows real per-step progress instead of an instant nav.

### Project genesis decomposition (Phase 2 #11)
Today `/v1/projects/genesis/preview` returns phases. Add `/v1/projects/genesis/decompose`:
- Input: `description`, `agentRoster`.
- Output: `tasks: { agentRole: string, tasks: TaskDraft[] }[]`.
- Persist into `tasks` table once user confirms on Plan Review.

### Connect LLMs model listing (Phase 2 #12)
- `GET /v1/llm/providers/:id/models` — call provider's list-models endpoint with the supplied API key.
- Frontend `StepConnectLlms` shows real model list per provider rather than a hardcoded one.

## Migrations summary

Add in order:
1. `agent_wires` table (Phase 4)
2. (Already done) `hive_notes` table for Hive Mind
3. Indexes on `chat_threads(project_id, agent_id)` if not present (Phase 3 thread scoping)

## Cleanup / dead code

- `tool_result_json` in `chat.rs` — already gated with `#[cfg_attr(not(test), allow(dead_code))]`; revisit if still unused after A2A tools land.
- Once interleave is shipped, drop the "I exhausted the available tool rounds…" fallback path in favor of always emitting whatever text was streamed.
