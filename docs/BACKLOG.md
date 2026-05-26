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

**Recently delivered since this BACKLOG was last refreshed**:
- **B1 (partial)** — coordinator-led onboarding shipped via `POST /v1/coordinator/converse` + `StepCoordinatorChat`. Project is created on step-3 entry and threaded through `OnboardingDraft.{projectId, coordinatorThreadId}`. Brief auto-syncs with explicit "Save as brief" button. Auto-spawning the CEO on `/launch` and the merged multi-doc capture remain.
- **B4** — `request_capability` + `monitor_spawn_request` agent tools shipped; mpsc-decoupled launcher in `AppState`. Frontend review surface still TODO (see updated B4).
- **D1** — `agent_eval_runs` table + `record_eval` tool + `GET /v1/eval-runs`; `LeaderboardTab` consumes via `useEvalRunsData`. The systematic eval-harness that calls `record_eval` is still open.
- **D2** — `SandboxLockRegistry` + RAII `LockGuard` in `hive-tools`; `GET /v1/sandbox-locks`; HiveGraph overlay uses real set. **Closed**.
- **Pause/resume executor sync** — `set_agent_status` and `toggle_project_session` now flip `ExecutorRegistry::{pause,resume,terminate}` alongside `agents.status`.
- **A8 (partial)** — File Protection Zones now uniformly enforced (`ToolContext::check_path_allowed` for `fs_read`/`fs_list`/`fs_write`/`shell_exec`). Size caps in A8 are still TODO.
- **Cost events on cancel/timeout/error** — `finalize_cancelled` writes a `cost_events` row so budget enforcement stays accurate when turns fail or are interrupted.

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

**Partly shipped.** File Protection Zones (`.env*`, `.git/`, user-protected)
now uniformly enforced via `ToolContext::check_path_allowed` from `fs_read`,
`fs_list`, `fs_write`, and `shell_exec`. Size/runtime caps still open.

**Problem.** Massive files can OOM the process or fill disk; fork bombs can
kill the machine.

**Solution (remaining).**
1. `fs_read`: 1MB default cap (`tools.fs_read_max_bytes`).
2. `fs_write`: 10MB default cap (`tools.fs_write_max_bytes`).
3. `shell_exec`: Use `setrlimit` on Unix (CPU, RAM, files, procs). Truncate
   output to 256KB.

**Files.** `crates/hive-tools/src/builtins/{fs,shell}.rs`;
`crates/hive-sandbox/src/local.rs`.

### A9. `web_fetch` without allow-list / SSRF 🔴

**Problem.** Agents can hit internal IPs (metadata, loopback RCE).
**Sub-issue (still open as of 2026-05-25):** the existing `validate_url_destination`
guard checks only the URL the agent passed; `reqwest` follows up to 10 redirects
without re-validating, so a public host that 30x's to
`http://169.254.169.254/latest/meta-data/iam/security-credentials/` exfiltrates
cloud credentials.

**Solution.**
1. Block private IPs by default (RFC1918, etc.). Resolve DNS and check IP.
2. **Build the `reqwest::Client` with `.redirect(Policy::custom(...))` and re-run `validate_url_destination` on every hop.** Or use `.redirect(Policy::none())` and follow manually.
3. `tools.web_fetch_allowed_hosts` setting.
4. Respect `robots.txt`.
5. Rate-limit: 30 fetch / min / agent.

**Files.** `crates/hive-tools/src/builtins/web.rs`.

### A10. CORS hardcoded to dev origins 🟠

**Problem.** Breaks if frontend is served elsewhere.

**Solution.** Read `HIVE_CORS_ORIGINS` (CSV).

**Files.** `crates/hive-api/src/main.rs`.

---

## 3. Section B — Roadmap : Core Product 🟠

### B1. Coordinator-led onboarding chat 🟠

**Largely shipped.** `POST /v1/coordinator/converse` exists; `StepCoordinatorChat`
replaced `StepDescribe`; project created on step-3 entry; brief auto-syncs.
**Remaining:** (a) auto-spawn the CEO on `/launch`; (b) merged multi-doc capture
to replace single-textarea + spec-upload; (c) make `teamMode` toggleable
mid-conversation (currently the initial value is fire-and-forgot).

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

**Largely shipped.** `request_capability` + `monitor_spawn_request` runtime
tools live; the API consumer task receives the spawn-request id over an mpsc
channel and runs `run_pipeline` with fresh `BuildPipelineDeps`. Coordinator-only.
**Remaining:** (a) the Spawn-Requests review surface in the frontend
(`api/spawn-requests.ts` client exists, `useSpawnRequests` hook polls every 2s,
page UI is missing); (b) **the mpsc consumer has no in-flight dedup** — the same
`spawn_request_id` can be processed twice (re-bill the LLM, double-bind MCPs).
Track in-flight ids in an `Arc<Mutex<HashSet<String>>>` and skip if present;
(c) `approve_spawn_request` re-runs the synthesis from stage 0 instead of
resuming from `awaiting-approval`, double-billing the LLM.

### B5. Drift auto-detection 🟠

**Partly shipped.** The turn loop calls `record_after_turn`; the four bands
(<0.4 / 0.4-0.69 / 0.7-0.89 / ≥0.9) and auto-pause are wired.
**Open bugs / remaining:**
1. **Drift hook skipped on early-return paths** — cancel / timeout / LLM-error /
   budget exits all `return` before `record_after_turn` runs. Exactly the
   moments drift is most likely. Wrap `run_turn_inner` in a defer-style guard.
2. Auto-pause at ≥0.9 uses `let _ = registry.pause(...)` and only `warn!`s on
   `NotFound`; if the executor wasn't pre-`ensure`d, DB and executor diverge.
3. Planning → Drift dedicated UI panel still TODO.
4. `runtime.drift_thresholds` setting still TODO.

**Files.** `hive-runtime/src/chat.rs`; `drift_hook.rs`; `Planning.tsx`.

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
**Data source shipped** (`agent_eval_runs` + `record_eval` + `GET /v1/eval-runs`).
**Remaining:** an eval-harness that systematically scores agent outputs and
decides when to call `record_eval`.

### D2. Lock overlay HiveGraph 🟡
**Shipped.** `SandboxLockRegistry` + RAII `LockGuard` in
`hive-tools/src/locks.rs`; exposed via `GET /v1/sandbox-locks`;
`useSandboxLocks` polls every 2s; HiveGraph node + minimap overlay reads
the real set.

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

---

## Z. Newly surfaced bugs (2026-05-25 deep audit)

Catalogued from two parallel bug-hunt subagent reports + an integration sweep.
Severity tags use the same scale as Section A. Items marked 🔴 should jump the
queue ahead of W2.

### Z1. Drift hook never fires on the riskiest exit paths 🔴

`record_after_turn` is only called on the success path. Cancellation, timeout,
LLM error, and budget-exceeded all `return` before the hook runs. Wrap
`run_turn_inner` in an outer function that calls the hook regardless of how
the inner returns. **Files:** `crates/hive-runtime/src/chat.rs`.

### Z2. `set_agent_status` and `terminate_agent` swallow executor sync via `let _` 🔴

The pause/resume sync fix (2026-05-25) added `state.executors.{ensure,pause,resume,terminate}`
calls before `agents::set_status`, but each is `let _`. If any executor call
returns `Err`, the DB still flips — recreating the very drift the fix was
meant to prevent. **Fix:** bubble via `?` and 5xx on failure, or roll back the
DB write. **Files:** `crates/hive-api/src/main.rs:2412-2418, 2850-2862`.

### Z3. `web_fetch` SSRF bypass on redirect chain 🔴

See updated **A9**. The fix is mechanically straightforward but security-critical.

### Z4. `Modules.tsx` opens a duplicate `EventSource` 🔴

Defeats the singleton `RealtimeProvider` and risks exhausting the 6-conn
browser cap. **Fix:** use `useRealtime().subscribe('synthesis.<jobId>.progress', ...)`.
**Files:** `front-end/src/pages/Modules.tsx:71-111`.

### Z5. Dead `/modules/:id` route 🟠

`Modules.tsx` navigates `/modules/${id}` on synthesis complete and on row
click; `App.tsx` has no such route → `NotFound`. **Fix:** either add the
route (wire `ModuleDetail.tsx`) or change navigations to
`/forge?tab=modules&moduleId=…`.

### Z6. `RealtimeProvider.subscribePrefix` doesn't register native listeners 🟠

Prefix subscribers are stored but never fanned out to the underlying
`EventSource` unless an exact-name `subscribe` for the same name happens to
exist. **Fix:** enumerate candidate names and call `ensureNativeListener`,
or accept an explicit `names: string[]`.

### Z7. `ExecutorRegistry::terminate` leaks the cancelled token 🟠

Removes from `inner` but leaves the token in `tokens`; the next `ensure`
returns a token that's already in `cancelled` state, so the first turn of the
recreated agent aborts instantly. **Fix:** also remove from `tokens` on
terminate, or reset if cancelled in `ensure`.
**Files:** `crates/hive-runtime/src/registry.rs:166-178, 81-93`.

### Z8. `pause_agent` / `resume_agent` / `terminate_agent` / `cancel_agent_subtree` bypass `audit::append` 🟠

Only `set_agent_status` audits. The canonical lifecycle endpoints don't.
**Files:** `crates/hive-api/src/main.rs:2353-2440`.

### Z9. Per-agent `enabled_tools` overrides global allowlist 🟠

If `per_agent` is non-empty, the global list is ignored entirely. An operator
can't enforce "no shell_exec project-wide" if any agent carries shell_exec in
its loadout. **Fix:** intersect rather than override.
**Files:** `crates/hive-api/src/main.rs:1464-1470`.

### Z10. TOCTOU on budget check vs `cost_events` insert 🟠

N concurrent turns all see "we're under budget" and proceed; total can
exceed `budget_total_cents` by N × per-turn cost. **Fix:** insert a pending
`cost_events` row up-front with 0 cost, finalize at end of turn.

### Z11. `setActiveProject` not awaited in `Projects.tsx` 🟠

`setActiveProject(id); navigate('/dashboard');` — mutation is async; the
dashboard renders against the previous active project until the invalidation
round-trips. **Fix:** `await` and show a loader.

### Z12. `WorkspaceProvider` repaints UI to defaults during pending settings query 🟡

Until `useSettingsData()` resolves, the CSS-variable effect runs with
`defaultSettings.appearance`. A single network blip overwrites the user's
accent. **Fix:** `staleTime: Infinity` and skip the effect until
`settingsQuery.isSuccess`.

### Z13. Orphan pages (Modules, ModuleDetail, AgentForge, SpecPlan) 🟡

Not imported anywhere yet still call backend endpoints. **Fix:** wire into
the Forge tabs or delete.

### Z14. `Projects.tsx` divides by `budget.total` without zero guard 🟡

Renders `NaN%` for a `budget.total === 0` project. **Fix:**
`total > 0 ? ... : 0`.

### Z15. `NotFound` uses raw `<a href="/">` causing full page reload 🟡

Drops React state, refetches the bundle, kills SSE. **Fix:** React Router `<Link>`.

### Z16. Sandbox locks are visibility-only, not mutex 🟢

Two writers race at the FS layer. Promote to a `tokio::sync::Mutex` per
`(project, path)` if mutual-exclusion is wanted.

### Z17. `executor.pause()` doesn't interrupt the in-flight turn 🟢

State is only checked between inbox items; a 3-minute turn keeps running
after pause. **Fix:** plumb the cancel token through the active driver.

### Z18. `parse_tool_invocations` requires exact-trim 🟢

Small Ollama models that prepend "Sure! " before `<tool_call>` produce no
invocation and no error. **Fix:** scan for substrings instead.

### Z19. CORS `Any` methods + `Any` headers 🟢

Fine for loopback; risky if `HIVE_BIND` widens. **Fix:** restrict to the
methods the frontend actually uses (overlaps with A10).

### Z20. `useSse` missing handlers for `agent.terminated` / `wire.deleted` / `task.created` 🟢

Backend emits more events than the handler map covers. **Fix:** enumerate
against backend vocabulary or use `subscribePrefix` once Z6 is fixed.

### Suggested next-sprint order

`Z1 → Z2 → Z3 → Z4 → Z9 → Z7 → Z6 → Z8 → Z11` covers every 🔴 plus the
high-leverage 🟠s. Then sweep the 🟡/🟢 list as cleanup.
