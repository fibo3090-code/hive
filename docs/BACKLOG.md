# HIVE — Backlog & Remaining Issues

> Exhaustive plan of remaining work on HIVE after multiple sessions of fixes
> and features. Consolidates everything identified (bugs, leaks, hazards,
> missing features, UI debt, ops debt) with a concrete solution per item.

## 0. Context

**HIVE** is a local-first multi-agent execution platform. A coordinator ("CEO")
decomposes a brief into sprints/tasks, spawns sub-agents, who work in a
per-project sandbox (files, shell, web, git, A2A) under the operator's eye.
Backend Rust/Axum, frontend React/Vite, local SQLite by default, Ollama +
SearXNG fallbacks, ChaCha20-Poly1305 encryption for secrets.

**Already Delivered** (on `main`): `tsc`/`clippy`/`cargo test` passing;
concrete bugs fixed (FileCode import, demo seed, chat turn double-emit,
duration parsing, migration names); features wired (real Git tools, `/compact`,
`add_task`, `auto-decompose`, real AgentSpawnModal, Forge Connectors/Skills);
runtime (interleave persistence, budget enforcement, agent-mgmt tools, thread
auto-rename); real onboarding `/launch` + LLM decomposition; agent tools
(`hive_mind_*`, spec/task/drift/git tools, full A2A, agent_wires + cycle
prevention + visibility); documentation rewritten ([`architecture.md`](architecture.md),
[`ROADMAP.md`](ROADMAP.md), component READMEs, [`FEATURE_STATUS.md`](FEATURE_STATUS.md)).

**Remaining Work**: This document. It is organized into **5 waves** (recommended
sequencing) and details each item with its solution, files to touch, and
verification notes. Severities: 🔴 critical (bug, leak, hazard) · 🟠 important ·
🟡 useful · 🟢 cosmetic/ops.

## 1. Recommended Sequencing (TL;DR)

| Wave | What | Why first |
|---|---|---|
| **W1** | Section A — bugs/leaks/safety | Prevents demo usage from blowing up disk, leaking, or crashing. ~3-4 commits. |
| **W2** | Section B1-B2 — coordinator-led onboarding + skill mounting | Unblocks the *product loop* (project creation → CEO planning → agents working with skills). |
| **W3** | Section B3-B5 — autonomous loop + auto-MCP + drift | Transforms manual steering into supervision. Real autonomy. |
| **W4** | Section C + D — UI completeness + observability | Polish, accessibility, dark mode, mobile, error boundary, lock overlay, eval. |
| **W5** | Section E — DX/ops | Dockerfile, LICENSE, CONTRIBUTING, e2e, backup/restore, audit retention. |

---

## 2. Section A — Bugs, leaks, safety hazards 🔴

### A1. Attachment leak on thread/project deletion 🔴

**Problem.** `chat_threads::delete` / `clear_for_project` calls
`chat_messages::delete_for_thread`, **but** neither the `chat_message_attachments`
rows nor the files on disk under `<data_dir>/attachments/<project_id>/` are
cleaned up. Disk fills up silently.

**Solution.**
1. `crates/hive-db/src/repos/chat_attachments.rs`: add `list_for_thread`,
   `delete_for_thread` (returns deleted `storage_path`s), `delete_for_project`.
2. `chat_messages::delete_for_thread` (or a wrapper in hive-api) calls
   `chat_attachments::delete_for_thread` first and `unlink`s each file.
3. `delete_chat_thread` handler and project deletion (`DELETE /v1/projects/:id`)
   call this path.
4. Soft migration: a startup cleanup job that scans `attachments_root` and
   deletes files whose `id` is no longer in the table.

**Files.** `crates/hive-db/src/repos/{chat_attachments,chat_messages,chat_threads}.rs`;
`crates/hive-api/src/main.rs`.

### A2. Unbounded `audit_log` 🔴

**Problem.** Almost all mutations write to `audit_log`. No purge, no export UI,
no retention. Table grows linearly with usage.

**Solution.**
1. Add global `audit.retention_days` setting (default 90); a Tokio job at
   startup and every 24h deletes older rows.
2. CSV Export UI: `GET /v1/audit-log?since=…&until=…&format=csv` streaming CSV,
   plus button in Settings → Data & Privacy.
3. Inspection UI: Paginated table in Settings → Audit Log.

**Files.** `crates/hive-db/src/repos/audit.rs`; `crates/hive-api/src/main.rs`;
`front-end/src/pages/Settings.tsx`.

### A3. Global `enabled_tools` instead of per-project 🔴

**Problem.** Tool allow-list is shared across ALL projects. Cannot have a
restricted sandbox project next to a full agent-coding project.

**Solution.**
1. Read tool settings in `project:<project_id>` scope first, fallback to global.
2. `GET/PATCH /v1/projects/:id/tools-sandbox` handler; UI Settings → Tools &
   Sandbox reads/writes active project scope with "Inherit from global" toggle.
3. `enabled_tools_for_turn(state)` → `enabled_tools_for_turn(state, project_id)`.

**Files.** `crates/hive-api/src/main.rs`; `front-end/src/pages/Settings.tsx`.

### A4. `spawn_agent` slug collision 🔴

**Problem.** `agent_tools.rs:103-107` uses `role[..2]` + `timestamp % 1000`.
High collision risk for same-role agents spawned in the same second.

**Solution.** Slug = `role_prefix` + 8 chars of a ULID.

**Files.** `crates/hive-runtime/src/agent_tools.rs`; `crates/hive-api/src/main.rs`.

### A5. `back-end/.env.example` partially misleading 🔴

**Problem.** Documents `HIVE_BIND` / `HIVE_DATABASE_URL` / etc. but only logs are read.

**Solution.** Wire the env vars in `bootstrap_runtime`. Precedence: env var >
`local.toml` > `default.toml`.

**Files.** `crates/hive-api/src/main.rs` (`bootstrap_runtime`).

### A6. Split Master-key and DB folders 🟠

**Problem.** Master key in `~/.hive/`, DB in `back-end/data/`. Hard to move
instances.

**Solution.** Use `HIVE_DATA_DIR` as unique root for DB, workspaces,
attachments, and master key (with soft migration/fallback for the key).

**Files.** `crates/hive-crypto/src/lib.rs`; `crates/hive-api/src/main.rs`.

### A7. SSE `tokio::broadcast` Lag 🟠

**Problem.** Slow clients (background tabs) can miss events due to broadcast
buffer limits.

**Solution.**
1. On Lag, send `sync.required` event → frontend invalidates all query keys.
2. Increase buffer (1024 → 4096).
3. "Reconnecting…" toast in `useSse`.

**Files.** `crates/hive-runtime/src/events.rs`; `crates/hive-api/src/main.rs`;
`front-end/src/realtime/useSse.ts`.

### A8. No caps on `fs_read` / `fs_write` / `shell_exec` 🔴

**Problem.** Massive files can OOM the process or fill disk; fork bombs can
kill the machine.

**Solution.**
1. `fs_read`: 1MB default cap (`tools.fs_read_max_bytes`).
2. `fs_write`: 10MB default cap (`tools.fs_write_max_bytes`).
3. `shell_exec`: Use `setrlimit` on Unix (CPU, RAM, files, procs). Truncate
   output to 256KB.

**Files.** `crates/hive-tools/src/builtins/{fs,shell}.rs`;
`crates/hive-sandbox/src/local.rs`.

### A9. `web_fetch` without allow-list / SSRF 🔴

**Problem.** Agents can hit internal IPs (metadata, loopback RCE).

**Solution.**
1. Block private IPs by default (RFC1918, etc.). Resolve DNS and check IP.
2. `tools.web_fetch_allowed_hosts` setting.
3. Respect `robots.txt`.
4. Rate-limit: 30 fetch / min / agent.

**Files.** `crates/hive-tools/src/builtins/web.rs`.

### A10. CORS hardcoded to dev origins 🟠

**Problem.** Breaks if frontend is served elsewhere.

**Solution.** Read `HIVE_CORS_ORIGINS` (CSV).

**Files.** `crates/hive-api/src/main.rs`.

---

## 3. Section B — Roadmap : Core Product 🟠

### B1. Coordinator-led onboarding chat 🟠

**Problem.** "Describe" step is a textarea, not a chat with the CEO.

**Solution.**
1. Backend: Finish `/coordinator/converse` streaming SSE. CEO auto-spawned
   at project creation.
2. Frontend: Replace `StepDescribe` with a minimal chat UI. Conversation
   ends in spec creation + roster proposal.

**Files.** `crates/hive-api/src/main.rs`; `front-end/src/pages/Onboarding.tsx`.

### B2. Skill mounting : bindings + `list_skills`/`read_skill` 🟠

**Problem.** Skills exist but agents can't use them.

**Solution.**
1. `agent_skill_bindings` migration and repo.
2. `list_skills()` / `read_skill(slug)` agent tools.
3. `PromptComposer` 5th layer: list bound skills (lazy-load).
4. UI: Section in agent builder to check/uncheck skills.

**Files.** Migration; repo; `hive-api`; `hive-runtime`; `AgentFormFields.tsx`.

### B3. Autonomous agent task loop 🟠

**Problem.** Agents only run when messaged manually.

**Solution.**
1. `TaskScheduler` in `hive-runtime` loops on `pending` tasks and dispatches
   to idle agents.
2. `complete_task` tool for agents to signal completion.
3. Pause/resume loop via project "Session" toggle.

**Files.** `crates/hive-runtime/src/scheduler.rs`; `hive-api`; `hive-db`.

### B4. Finish auto-MCP-synthesis pipeline + agent tool 🟠

**Problem.** Pipeline is incomplete and not exposed as a tool.

**Solution.**
1. Complete `run_pipeline`.
2. `request_capability(description)` agent tool → creates request, runs
   pipeline, awaits human approval.
3. UI: "Spawn Requests" page to review/approve generated handlers.

**Files.** `hive-runtime/src/spawn/`; `agent_tools.rs`; `SpawnRequests.tsx`.

### B5. Drift auto-detection 🟠

**Problem.** Scorers exist but aren't called.

**Solution.**
1. Post-turn hook in `chat::run_turn` to calculate scores.
2. Graduated response: log row (low) → alert (medium) → pause agent (high).
3. `runtime.drift_thresholds` setting.

**Files.** `hive-runtime/src/chat.rs`; `drift.rs`; `Planning.tsx`.

---

## 4. Section C — UI Completeness 🟠

### C1. Code & Versioning — Missing features 🟠
History panel, branch creation, per-file restore, inline diff.

### C2. GitHub PR merge / review UI 🟡
Merge/Comment/Approve buttons using `octocrab`.

### C3. Agent builder — attach skills + connectors 🟠
Checklists for bound skills/connectors in `AgentFormFields`.

### C4. Keyboard shortcuts 🟡
⌘1-8 nav, ⌘⇧P pause all, ⌘B toggle tree, ⌘/ search.

### C5. Settings — Honesty pass 🟡
Wrap unused panels (Adaptive Router, etc.) in `<DisabledFeature>`.

### C6. ErrorBoundary 🟠
Per-route boundary with "Reload" button.

### C7. Code-splitting 🟡
`React.lazy` + `manualChunks`.

---

## 5. Section D — Data / Observability 🟡

### D1. Eval pipeline + leaderboard 🟡
Agent scoring after sprints; leaderboard UI update.

### D2. Lock overlay HiveGraph 🟡
Expose sandbox file locks to UI.

### D5. Project export/import 🟡
Zip containing DB rows + workspace + attachments.

### D6. Factory reset UI 🟢
Settings → Data & Privacy button to wipe state.

---

## 6. Section E — DX / Ops 🟢

Dockerfile, CONTRIBUTING.md, LICENSE, Playwright E2E, CI badges, codegen.

---

*This plan is the consolidated output of all HIVE work sessions.
State: [`FEATURE_STATUS.md`](FEATURE_STATUS.md). Forward plan: [`ROADMAP.md`](ROADMAP.md).*
