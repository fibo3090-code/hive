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
- **DeepSeek provider** — `ProviderKind::DeepSeek`, OpenAI-compatible wire format, public endpoint at `https://api.deepseek.com`. Pricing + 64K context window + tool-support gating (R1 = no tools) all wired.
- **str_replace tool** — surgical file edit. Single biggest leverage point for coding-agent accuracy + token cost; no more full-file rewrites for one-line edits.
- **think + task_complete tools** — silent scratchpad (helps smaller models) and clean turn-termination signal (stops elaboration loops).
- **DuckDuckGo search fallback** — zero-config, no-key, no-Docker `web_search` backend. `web_search` is now universally available out of the box.
- **`web_fetch` semantic extraction** — `extract_readable` picks `<main>`/`<article>` and strips `script`/`style`/`nav`/`header`/`footer`/`aside`. Adds `mode` parameter (`"readable"` default | `"raw"` legacy). Exposes `extractionMode` in the result.
- **Tool descriptions rewritten** — every default builtin now ships 3-5 sentence descriptions with explicit "Do NOT use this for X" clauses (research-backed 30-50% mis-selection cut).
- **Streaming tool-call parsing** for Anthropic / OpenAI / Gemini — fixed the "model returned an empty response" bug.
- **Harmony tool-name normalisation** for gpt-oss models on Ollama.
- **B1 (partial)** — coordinator-led onboarding shipped via `POST /v1/coordinator/converse` + `StepCoordinatorChat`. Project is created on step-3 entry and threaded through `OnboardingDraft.{projectId, coordinatorThreadId}`. Brief auto-syncs with explicit "Save as brief" button. Auto-spawning the CEO on `/launch` and the merged multi-doc capture remain.
- **B4** — `request_capability` + `monitor_spawn_request` agent tools shipped; mpsc-decoupled launcher in `AppState`. Frontend review surface still TODO (see updated B4).
- **D1** — `agent_eval_runs` table + `record_eval` tool + `GET /v1/eval-runs`; `LeaderboardTab` consumes via `useEvalRunsData`. The systematic eval-harness that calls `record_eval` is still open.
- **D2** — `SandboxLockRegistry` + RAII `LockGuard` in `hive-tools`; `GET /v1/sandbox-locks`; HiveGraph overlay uses real set. **Closed**.
- **Pause/resume executor sync** — `set_agent_status` and `toggle_project_session` now flip `ExecutorRegistry::{pause,resume,terminate}` alongside `agents.status`.
- **A8 (partial)** — File Protection Zones now uniformly enforced (`ToolContext::check_path_allowed` for `fs_read`/`fs_list`/`fs_write`/`shell_exec`). Size caps in A8 are still TODO.
- **Cost events on cancel/timeout/error** — `finalize_cancelled` writes a `cost_events` row so budget enforcement stays accurate when turns fail or are interrupted.
- **Z7** — `ExecutorRegistry::terminate` now removes the agent cancellation token, and registry shutdown clears all tokens. Restarted executors receive a fresh token instead of reusing a cancelled one.

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

### Z7. `ExecutorRegistry::terminate` leaks the cancelled token ✅ Fixed 2026-05-27

`terminate` now removes the agent from both `inner` and `tokens`; `shutdown`
also clears all tokens. Regression coverage:
`cargo test -p hive-runtime registry::tests`.
**Files:** `crates/hive-runtime/src/registry.rs`.

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

---

## ZZ. 2026-05-27 deep audit — additional findings

Second deep-audit pass after the 2026-05-25 sweep. Spot-verifications confirm
the following prior items are **still open** (no fix landed since):
**Z1** (drift hook on error paths), **Z2** (`let _ = state.executors.*` — 16
call sites in `main.rs` at lines 1988, 2009, 2345, 2370, 2394, 2658, 2708,
2824, 2827, 2830, 2834, 3374, 3377, 3380, 4966, 4968), **Z3 / A9** (SSRF on
redirect chain), **Z4** (duplicate `EventSource` in `Modules.tsx:73`),
**Z6** (`subscribePrefix` registers no native listener), **Z10** (budget
TOCTOU), **Z11** (`setActiveProject` unawaited in `Projects.tsx:49`),
**Z14** (NaN% in `Projects.tsx:40`), **Z15** (raw `<a href>` in
`NotFound.tsx:16`), **Z17** (pause doesn't interrupt the in-flight turn),
**B4b** (spawn-pipeline mpsc dedup missing), **B4c** (`approve_spawn_request`
re-runs from stage 0 — double-bills the LLM).

New findings below. Severity tags match the rest of this doc. Items marked
🔴 belong on the same fast-lane as Z1-Z4.

### ZZ1. `fs_write` directory escape via planted parent symlink 🔴

**File:** `crates/hive-sandbox/src/local.rs:265-273`.

For paths that don't exist yet, the resolver skips Layer 2 canonicalisation,
and `refuse_symlink` only inspects the *leaf*. If any agent (or a previous
turn of the same agent) drops `workspace/foo -> /etc`, a later
`fs_write("foo/bar", …)` passes Layer 1 (no `..`, not absolute), passes
`refuse_symlink` (leaf `bar` doesn't exist yet), and
`create_dir_all(parent) + tokio::fs::write` traverses the symlinked parent
and writes into `/etc/bar`. The whole sandbox guarantee collapses on this
single path. **Fix:** canonicalise the *deepest existing ancestor* of the
resolved path and require it starts with `self.root` before any I/O.

### ZZ2. Cancel/terminate decoupled from the in-flight LLM stream 🔴

**Files:** `crates/hive-runtime/src/chat.rs:60` (cancel flag),
`executor.rs:170-177`, `registry.rs:80-93`, `hive-api/src/main.rs:6604,6727`.

The chat path polls an `Arc<Mutex<bool>>` `cancel_flag` every 50 ms in
`collect_response`. The executor's `CancellationToken` (used by `spawn_agent`
descendants) is **never** wired into that flag. Consequences:

1. `terminate_agent` aborts the executor task but the actual `run_turn` runs
   on a separate `tokio::spawn` in `main.rs` — the stream keeps running and
   keeps billing.
2. `cancel_subtree(parent)` cancels the parent's token but the child chat
   turns are oblivious.
3. The drift hook's auto-pause at score ≥ 0.9 (`drift_hook.rs:217`) cannot
   stop the very turn that scored it — by the time pause lands, the turn
   that caused the drift has already finished.

This is the deeper version of Z17. **Fix:** in `run_turn`, `tokio::select!`
against `executors.token_for(agent_id)`; have `pause()` and `terminate()`
flip the cancel flag (or cancel a per-turn token) instead of only the inbox
state.

### ZZ3. Loop detector reads the wrong JSON key — effectively dead code 🔴

**File:** `crates/hive-runtime/src/loop_detector.rs:91-107`.

`tool_fingerprint` reads `c.get("args")`, but `chat.rs:1108-1113` persists
tool calls under the key `"arguments"`. Every recorded call therefore
collapses to `{tool_name, Null}`, so the detector matches on tool name only
— guaranteed false positives on legitimate repeat work like a multi-file
`fs_write`, and the actual "agent stuck in a loop" signal is lost in the
noise. The loop modal Z18 references doesn't actually trigger correctly.
**Fix:** read `"arguments"` (with fallback to `"args"` for older rows).

### ZZ4. `PermissionMatrix` is dead code 🔴

**File:** `crates/hive-tools/src/permission.rs:231-235` plus every builtin
in `crates/hive-tools/src/builtins/*.rs`.

The Plan / Build / Explore profiles and their per-tool overrides are
fully implemented as data structures, but **no builtin calls
`ctx.permissions().decide(...)`**. The matrix narrows nothing. An operator
selecting "Explore" profile still gets `fs_write` and `shell_exec`. Comments
in `context.rs:27-29` confirm enforcement was deferred to "Phase 0c-bis"
and that phase never landed. **Fix:** enforce at the bottom of every
`Tool::invoke` (`Deny → Err`, `Ask → Err(ApprovalRequired)`, `Allow → run`)
and add a regression test asserting `explore` blocks `fs_write`.

### ZZ5. `is_system_protected` is root-anchored, breaks every monorepo 🟠

**File:** `crates/hive-tools/src/context.rs:144-150`.

The deny-list match is a prefix check against the path string, so it only
blocks top-level `.env`, `.env.*`, `.git/...`. In a monorepo,
`apps/web/.env`, `packages/server/.env.production`, nested `.git`
submodules holding credentials, are all freely readable by `fs_read` and
copyable by `shell_exec`. The File Protection Zones claim in
[`FEATURE_STATUS.md`](FEATURE_STATUS.md) and the
[`architecture.md`](architecture.md#51-security-defaults) §5.1 note are
overstating coverage. **Fix:** per-component scan:
`path.components().any(|c| c.as_os_str() == ".env" || …)`.

### ZZ6. `shell_exec` path-allow check is theatre 🟠

**File:** `crates/hive-tools/src/builtins/shell.rs:88-97`.

`path_like` flags only argv tokens containing `/`, `\`, or starting with
`.`. So `cat .env`, `xxd .env`, `awk '{print}' .env`, `sh -c 'cat .env'`,
`cat ./.e''nv`, `cat $(echo .env)` all bypass File Protection Zones. The
heuristic provides false assurance — it catches careless agents, not
malicious ones. **Fix:** drop the heuristic from this layer (it cannot be
made sound at the argv level — shell metaprogramming defeats it) and
either (a) move enforcement into the sandbox by removing `.env*` from the
workspace tree at exec time, or (b) require Docker/chroot containment for
`shell_exec`.

### ZZ7. `shell_exec` sets `HOME = workspace`, leaking creds into the tree 🟠

**File:** `crates/hive-sandbox/src/local.rs:367-368`.

With `HOME` pointed at `self.root`, every `git`, `npm`, `cargo`,
`gh`, `ssh-keygen` call writes `.gitconfig`, `.npmrc`,
`.cargo/credentials.toml`, `.ssh/`, etc. into the project tree. A later
`fs_list` shows those config files to the LLM (they're not on
`protected_files` — see ZZ5), and `git_commit` will happily stage them.
**Fix:** point `HOME` at a per-invocation `tempdir()` cleaned on drop, or
at `<data_dir>/run-home/<project_id>/` and add a top-level entry to the
File Protection Zone list.

### ZZ8. SSRF — DNS-rebinding race window 🟠

**File:** `crates/hive-tools/src/builtins/web.rs:66-101`.

`validate_url_destination` resolves the host via `tokio::net::lookup_host`;
`reqwest` then does its **own independent** resolution moments later. A
DNS-rebinding server that returns a public IP to the first lookup and
`127.0.0.1` (or `169.254.169.254`) to the second wins. The comment
acknowledges this is unhandled. **Fix:** resolve once, pin the chosen IP
via `reqwest::ClientBuilder::resolve(host, ip.into())`, then validate that
IP — or rewrite the URL host to the literal IP and set the `Host:` header
manually.

### ZZ9. `web_fetch` size cap applies *after* parse, `maxBytes` is char-count 🟠

**File:** `crates/hive-tools/src/builtins/web.rs:225-245`.

The 5 MiB body is buffered, then `String::from_utf8_lossy` allocates ~2×,
then `scraper` walks the DOM (allocating more), and only then does
`maxBytes` apply via `.chars().take(limit).collect()`. A malicious server
serving 5 MiB of `<div>` nesting can blow the runner's RSS. Separately,
the field is named `maxBytes` but counts *chars*, not bytes — agent prompts
that rely on the name silently mis-account. **Fix:** enforce the byte cap
during the streaming download (`limit_take`), reject early on suspicious
nesting depth, and rename the field `maxChars` (or actually count bytes).

### ZZ10. `fs_read` size cap is TOCTOU 🟠

**File:** `crates/hive-sandbox/src/local.rs:223-255`.

`metadata().len() <= 16 MiB` is checked, *then* `tokio::fs::read` re-opens
the file. A concurrent writer (peer agent, host process) can grow the file
between the two syscalls, blowing the cap and OOM-ing the runner. **Fix:**
open once, then `Read::take(FS_READ_HARD_CAP).read_to_end(&mut buf)`.

### ZZ11. `fs_write` symlink check is TOCTOU 🟠

**File:** `crates/hive-sandbox/src/local.rs:257-274`.

`refuse_symlink` calls `symlink_metadata`, then `tokio::fs::write` follows
the path again. An attacker (peer agent in another concurrent turn) can
swap the leaf for a symlink between the two calls. **Fix:** `OpenOptions`
with `custom_flags(libc::O_NOFOLLOW)` on Unix; write through that handle.
On Windows, use the equivalent reparse-point-refusing flag.

### ZZ12. EventBus drops events silently on broadcast lag 🟠

**File:** `crates/hive-runtime/src/events.rs:25-30`.

`let _ = self.sender.send(...)` swallows both "no receivers" and slow-lag
drops. No metric, no warn-log, no `sync.required` emit. A backgrounded
client tab on a flaky link sees truncated `chat.tokens` streams; the
assistant message looks half-written until the next persist round. The
A7 "increase buffer + emit sync.required" fix is partially addressed by
the 4096 buffer in `main.rs` but the producer-side observability is
still missing. **Fix:** check the `Err(SendError::Lagged(n))` variant on
the broadcast `send` (or rather on the receiver side — actually emit
`sync.required` from receivers that see `RecvError::Lagged(n)`).

### ZZ13. `cancel_subtree` orphans rehydrated children 🟠

**Files:** `crates/hive-runtime/src/registry.rs:80-93,188-194`.

`rehydrate_from_db` calls `ensure(...)` without `parent_agent_id`, so a
rehydrated child gets a fresh root `CancellationToken` rather than
`parent.child_token()`. After a server restart, the spawn-lineage cancel
tree is silently broken — cancelling the parent leaves the child running.
**Fix:** in `rehydrate_from_db`, read `agents.parent_agent_id` and call
`ensure_with_parent(id, project_id, parent_id)`.

### ZZ14. `rounds_used` increments before the cancel check 🟡

**File:** `crates/hive-runtime/src/chat.rs:826-1171`.

`rounds_used += 1` happens at the top of the round loop, before the cancel
check on the next line. A cancellation observed on the entry to round 30
finalizes with `rounds_used == 30` and emits the misleading "I exhausted
the available tool rounds" message instead of "cancelled". Cosmetic but
muddies telemetry and operator triage. **Fix:** move the increment after
the cancel check, or after a successful LLM call.

### ZZ15. `let _ = …await?` confusing footgun 🟡

**Files:** `crates/hive-runtime/src/chat.rs:467, 470, 777, 1191, 1225`
(at least).

Pattern is `let _ = chat_messages::set_status(...).await?;`. The `let _ =`
reads as "best-effort", but `?` still propagates `DbErr` to the caller and
aborts the turn. Several of these *should* be best-effort (transient DB
blip mid-turn shouldn't kill the SSE stream), and several others should
fail loud. Pick one per call site. **Fix:** sweep and either drop the
`?` (true best-effort, log a warn) or drop the `let _` (real error path).

### ZZ16. Drift hook DB-pause and executor-pause are not atomic 🟡

**File:** `crates/hive-runtime/src/drift_hook.rs:202-224`.

Order is `agents::set_status("paused")` then `reg.pause(agent_id)`.
Window between the two awaits is enough for an A2A `message_agent` to
land in the inbox before the executor parks. One extra item processed
post-pause. **Fix:** pause executor first, then flip the DB row (matches
the order in §4.4 of `architecture.md`).

### ZZ17. Wire-cycle prevention is TOCTOU on non-SQLite 🟡

**File:** `crates/hive-db/src/repos/agent_wires.rs:66-134` (called from
`agent_tools.rs:166`).

The BFS-cycle check + `INSERT` is not transactional. Two concurrent
`spawn_agent` calls under the same lineage that *together* would close a
cycle both pass their local BFS and both insert. SQLite serialises by
luck of its single writer; Postgres won't. **Fix:** wrap BFS + insert in a
`Serializable` transaction, or add a CHECK constraint / trigger that
walks the transitive closure server-side.

### ZZ18. Master key not zeroized; bytes linger in the heap 🟡

**File:** `crates/hive-crypto/src/lib.rs:60-95,167-179`.

The 32-byte key is read into a `Vec<u8>`, copied into the
`ChaCha20Poly1305` engine, then dropped without zeroization. The allocator
keeps the bytes recoverable until reuse. Any core dump or same-uid
`/proc/<pid>/mem` reader extracts the key that decrypts every stored
LLM/GitHub token. **Fix:** wrap in `zeroize::Zeroizing<Vec<u8>>` (or
`secrecy::SecretBox<[u8; 32]>`) end-to-end.

### ZZ19. Master key concurrent-first-init race 🟡

**File:** `crates/hive-crypto/src/lib.rs:60-100,182-191`.

`load_or_init` does `if !path.exists()` → `write_key_file` with
`create_new(true)`. Two HIVE processes pointed at the same `data_dir` (a
systemd restart-loop, an accidental double-spawn under tmux) both see
`!exists`, one wins `create_new`, the loser gets `EEXIST → CryptoError::Io`
and crashes instead of re-reading the winner's key. **Fix:** on
`ErrorKind::AlreadyExists`, retry the read once.

### ZZ20. Master key — Windows ACL still not enforced 🟠

**File:** `crates/hive-crypto/src/lib.rs:194-212`.

On Windows the master key is written with the directory's default ACL.
The only mitigation is a `tracing::warn!`. On a shared-tenant host (e.g.
a Windows dev box with multiple users), another local user can read the
symmetric key that decrypts every stored secret. The promised ACL helper
"until that ships" comment is still standing. **Fix:** call `icacls` or
`SetNamedSecurityInfo` to restrict the DACL to the current SID before
writing the key bytes; refuse to start without a successful restrict.

### ZZ21. No auth when `HIVE_BIND` widens off-loopback 🟠

**File:** `crates/hive-api/src/main.rs:981-988` plus `.env.example`.

The README/env-example invite the operator to set `HIVE_BIND=0.0.0.0:...`
to expose over LAN/Tailscale. The moment that happens, the entire API —
which can `shell_exec` arbitrary commands, decrypt LLM tokens, write
files in the workspace — is open to anyone on the network. CORS protects
browsers only; `curl` doesn't care. **Fix:** require `HIVE_API_TOKEN`
whenever bind ≠ `127.0.0.1`; refuse to start otherwise.

### ZZ22. Tool-result blob cloned three times per dispatch 🟢

**File:** `crates/hive-runtime/src/chat.rs:1108,1115,1137`.

Each tool's `result` is pushed into `executed_calls`, emitted on the
EventBus, and re-serialized into `result_text`. For a 2 MiB `fs_read`,
that's three clones plus one to-string per round. Memory spike on
tool-heavy turns; not a bug, but worth a comment. **Fix:** wrap in
`Arc<Value>` and clone the Arc.

### ZZ23. `token_budget::trim_to_fit` may drop the system prompt — needs verify 🟡

**File:** `crates/hive-runtime/src/chat.rs:752-756` ↔
`crates/hive-llm/src/token_budget.rs`.

`trim_to_fit` is called on the full `messages` vec which already contains
the composed PromptComposer system prompt as `messages[0]`. The contract
("preserve system messages") is in a comment, not a test. If it drops
index 0, the agent loses its identity + tool catalog mid-thread.
**Action:** add a regression test asserting `trim_to_fit` never drops a
`role: system` message even when the budget would force it.

### ZZ24. Coverage status

All four follow-up audits completed 2026-05-27: **LLM clients** (ZZ25–ZZ36),
**DB layer** (ZZ37–ZZ51), **API layer** (ZZ52–ZZ66), **frontend pages**
(ZZ67–ZZ81). Combined with the security + runtime-concurrency passes
above (ZZ1–ZZ23), this BACKLOG now reflects the full 2026-05-27 audit.

## LLM client / provider findings (ZZ25–ZZ36)

### ZZ25. Streaming UTF-8 split corrupts multi-byte text 🔴

**Files:** `crates/hive-llm/src/sse.rs:89-93`, `providers/ollama.rs:295-299`.

`String::from_utf8_lossy(&chunk)` substitutes U+FFFD whenever a TCP/HTTP
chunk boundary lands mid-codepoint, so emoji / CJK / accented characters
get rendered as `?` in the streamed assistant text. Every cloud provider
that streams is affected. **Fix:** keep a `Vec<u8>` SSE-buffer per
stream, decode complete UTF-8 prefixes via `std::str::from_utf8` (or
`encoding_rs`), retain the invalid tail for the next chunk.

### ZZ26. Default `LlmProvider::chat` impl drops tool calls 🟠

**File:** `crates/hive-llm/src/lib.rs:233-268`.

The fallback that consumes `chat_stream` ignores `ToolCallStart/Delta/End`
and returns `tool_calls: Vec::new()`. Every shipped provider overrides
`chat`, so this is latent — but any future provider relying on the
default silently loses tool calls and the bug will be invisible until
deployed. **Fix:** accumulate per-id args in the default impl, push into
`Vec<ToolCall>`.

### ZZ27. OpenAI: `usage` chunk early-returns before caching `finish_reason` 🟠

**File:** `crates/hive-llm/src/providers/openai.rs:347-368`.

If a single chunk carries both `usage` and `choices[].finish_reason`
(spec-allowed, rare), the early `return vec![Complete]` happens before
`s.finish_reason = Some(reason)`, so the emitted `Complete` has
`finish_reason: None`. Downstream consumers that branch on stop-reason
get the wrong signal. **Fix:** process `choices` first, cache the
reason, then handle `usage`.

### ZZ28. OpenAI emits *two* `Complete` events per stream by design 🟡

**File:** `providers/openai.rs:451-458` + `:362-366`.

A `Complete` fires on the `finish_reason` chunk, then a second `Complete`
fires on the trailing `usage` chunk. Consumers that wire "first Complete →
close pipeline" (the natural read) flush with `tokens_in=0, tokens_out=0`.
The runtime's default `chat()` merges via `max()` so it survives, but
anyone wiring custom Complete handling will hit this. **Fix:** drop the
pre-emit; emit `Complete` only once (on `usage` chunk, or on stream EOF
as a fallback).

### ZZ29. Gemini `Complete` may never fire on truncated streams 🟠

**File:** `providers/gemini.rs:378-385`.

`out.push(Complete)` is gated on `finish.is_some() || tokens_out > 0`.
A network-truncated stream with zero output tokens leaves consumers
waiting forever for a terminal event — the chat turn never finalizes.
**Fix:** always emit `Complete` on stream EOF (in the outer adapter),
or drop the gating entirely.

### ZZ30. Harmony channel tokens leak into streamed *content* 🟠

**File:** `providers/ollama.rs:408-420`.

`normalize_harmony_name` is only applied to **tool names** (lines 220,
376). gpt-oss / Harmony models also emit `<|channel|>...<|return|>`
markers inside message *content*, which streams verbatim to the UI.
Operators see literal Harmony control tokens in agent replies. **Fix:**
strip Harmony markers from `content` in `parse_line` and
`parse_chat_response` before emitting `Delta`.

### ZZ31. DeepSeek R1 forwards `tools` even though it doesn't support them 🟠

**File:** `crates/hive-llm/src/providers/deepseek.rs:77-83`.

`supports_tools` correctly returns `false` for `deepseek-reasoner`, but
`chat`/`chat_stream` forward the request as-is. If anything upstream
forgets to clear `tools` (or the runtime races a stale request), the R1
endpoint returns 400 — the operator sees a generic error, not "this
model can't use tools". **Fix:** in the provider, if `model.contains
("reasoner")`, clone the request and `tools.clear()` before forwarding;
log a `warn!`.

### ZZ32. Anthropic silently caps output at 4096 tokens 🟠

**File:** `providers/anthropic.rs:125`.

`max_tokens.unwrap_or(4096)` — wire-level requirement. Opus / Sonnet
4.x support 8k–64k output; this cap silently truncates long generations
whenever the caller forgets to override (which the runtime does, today).
Long planning turns and big code rewrites get cut off mid-stream.
**Fix:** pick the default from `model_metadata` (e.g. 8192 for Claude 4.x)
or compute `context_window - prompt_budget`.

### ZZ33. No 429 / 529 retry / back-off in any provider 🟠

**Files:** all `crates/hive-llm/src/providers/*.rs`.

A `grep` shows zero retry or backoff logic. Anthropic returns 529
"Overloaded" frequently at peak; OpenAI returns 429 with `retry-after`.
Every transient bubbles up as `LlmError::ProviderStatus` and aborts the
chat turn (which then writes a `cost_events: status=error` row and
notifies the operator). **Fix:** classify status (transient: 408 / 425 /
429 / 500 / 502 / 503 / 504 / 529; fatal: 4xx else) and retry transients
with exponential backoff + jitter; honour `retry-after`.

### ZZ34. Fresh `reqwest::Client` per request — no pool / TLS reuse 🟡

**File:** `crates/hive-llm/src/lib.rs:279-296` + 10 call sites in
`crates/hive-api/src/main.rs`.

`client_for(config)` builds a new `reqwest::Client` for every chat turn
→ new connection pool → TLS handshake on every Anthropic / OpenAI call.
Adds ~100-200 ms of latency per turn under TLS 1.2 (less under 1.3
session resumption, but still measurable). **Fix:** hold a
`OnceLock<reqwest::Client>` per `ProviderKind` and reuse.

### ZZ35. `test_connection` is a false-positive on Ollama 🟡

**Files:** `lib.rs:199-211`, `providers/ollama.rs:253-266`.

`test_connection` calls `list_models`. For Anthropic / OpenAI / Gemini
that's an auth-required endpoint, so it really verifies the key. For
**Ollama** (`/api/tags`) it's keyless — the test only proves
*reachability*, not that the configured model is actually downloaded.
**Fix:** for Ollama, additionally probe `/api/version` and verify the
selected `model_id` is in the `tags` list.

### ZZ36. `trim_to_fit` doesn't guarantee the last *user* message survives 🟡

**File:** `crates/hive-llm/src/token_budget.rs:90-135`.

The contract comment says "preserves the most recent user turn at the
back", but the implementation preserves whichever message happens to be
last in the vec — could be an assistant or tool result if the trim runs
mid-loop. (See related ZZ23: regression test for system-prompt
preservation.) **Fix:** scan from the back for the last `role: User`,
anchor on that index, drop the rest before it.

## DB layer findings (ZZ37–ZZ51)

### ZZ37. Migration vector order ≠ filename order 🔴

**File:** `crates/hive-db/migration/src/lib.rs:49`.

`m20260514_000001_agent_skill_bindings` is listed *after*
`m20260613_000001_agent_wires` in the `Migrator::migrations()` vector.
SeaORM applies in vector order, but rolling forwards on a DB that was
created on an older revision (no skill bindings yet, agent_wires
applied) replays the skill-bindings migration with a `version` newer
than its name suggests. Worse: any new migration filename inserted
alphabetically between 0514 and 0613 may be considered "applied" in
some envs and not others. **Fix:** restore chronological filename order
and add a unit test asserting the vector is sorted by name.

### ZZ38. `seed_demo` is not idempotent under concurrent first-boot and not transactional 🔴

**File:** `crates/hive-db/src/seed.rs:907-1092`.

The idempotency sentinel is written at the *end*. Two processes (or a
retried boot after a panic) both see no sentinel → both run the full
seed → duplicate audit rows, possibly duplicate notifications. There's
no `db.begin()` wrapping the seed, so a crash mid-seed leaves a
permanently half-seeded DB (the sentinel never lands, the
presence-checks pass for the half that ran). **Fix:** wrap in a
transaction *or* write the sentinel up front as `{status:"in-progress"}`
and overwrite to `"done"` at the end; treat `in-progress` as "do not
re-enter".

### ZZ39. `chat_threads.get_or_create_for_agent` races, creates duplicate threads 🟠

**File:** `crates/hive-db/src/repos/chat_threads.rs:30-53`.

Two concurrent SSE connects with the same `(project_id, agent_id)`
both find no row and both insert. The `m20260612` composite index is
non-unique, so duplicates appear silently. **Fix:** make the index
`UNIQUE` and use `INSERT … ON CONFLICT(project_id, agent_id) DO NOTHING
RETURNING id`; if no row returned, `SELECT` it.

### ZZ40. `settings::put_value` is pure last-write-wins 🟠

**File:** `crates/hive-db/src/repos/settings.rs:26-49`.

`OnConflict ... update_columns(Value, UpdatedAt)`. The global
`settingsState` blob is written by both the UI (whole-blob PUT) and
`heal_enabled_tools` (read-modify-write at startup). Two near-simultaneous
writes lose data silently. **Fix:** either add `updated_at` to the
`WHERE` clause (optimistic concurrency) or migrate hot read-modify-write
keys to per-field rows.

### ZZ41. `heal_enabled_tools` overwrites operator-customised lists 🟠

**File:** `crates/hive-db/src/seed.rs:863-905`.

The "is_stale" check passes if the user has *exactly* those six tool
slugs in any order with no extras. A power user who deliberately pruned
the catalog down to that set gets silently overwritten with the full
canonical catalog on every boot. **Fix:** write a one-shot
`settings(scope='system', key='tools.heal.version')` sentinel; only run
the heal if the stored version is older than the current heal version.

### ZZ42. `cost_events.tokens_in/out` are `i32` while `agents.tokens_used` is `i64` 🟠

**File:** `crates/hive-db/migration/src/m20260414_000001_init.rs:389,394`.

Inconsistent widths. At ~2.1 B tokens the `i32` saturates silently —
the project-spend math stays correct (i64) but per-row token tallies
truncate. **Fix:** widen via an `ALTER COLUMN TYPE BIGINT` migration
matching the prior `cost_cents` widening.

### ZZ43. JSON columns have no size cap or schema check 🟠

**File:** every entity carrying `*_json` / `payload` / `tool_calls` /
`enabled_tools` / `eval_scores` / `evidence_json` /
`generated_files_json` / `manifest_json` / `embedding_json` /
`discovered_api_json` columns.

Nothing enforces a max size. A buggy or hostile agent that writes a
500 MB `tool_calls` blob fills the DB. **Fix:** add a Postgres
`CHECK (length(value) < N)` (and runtime size-guards in repo writers
for SQLite, which lacks per-column CHECK on JSON length).

### ZZ44. `agents.slug` unique index doesn't filter soft-deleted rows 🟠

**File:** `crates/hive-db/migration/src/m20260414_000002_indexes.rs:25-35`.

`idx_agents_project_slug` is `UNIQUE (project_id, slug)` without a
partial `WHERE deleted_at IS NULL`. Soft-delete an agent, try to create
a fresh one with the same slug → unique-violation, surfaces in the UI
as "slug taken" against an invisible row. **Fix:** Postgres + SQLite
support partial indexes — recreate as
`UNIQUE (project_id, slug) WHERE deleted_at IS NULL`.

### ZZ45. Missing indexes on hot foreign keys 🟠

**Files:** `m20260414_000002_indexes.rs`, `m20260427_000001_agent_relations.rs`.

Indexes present: `agent_messages(to_agent_id, status)`,
`agent_messages(thread_id)`, `agents(parent_agent_id)`. Missing:
`agent_messages(project_id)` (filtered by `clear_for_project` and
`requeue_running`), `cost_events(agent_id)` (per-agent rollup),
`tasks(agent_id)` (agent-detail page). Add them.

### ZZ46. `chat_threads::clear_for_project` and `agent_task_assignments::list_for_project_via_tasks` are N+1 / param-bound risks 🟠

**File:** `chat_threads.rs:94-104`, `agent_task_assignments.rs:41-61`.

Per-thread `delete_for_thread` loop instead of one `DELETE … WHERE
thread_id IN (SELECT id FROM chat_threads WHERE project_id=?)`.
Worse, the assignments repo fetches every task id into a `Vec`, then
embeds the whole list in an `IN (…)`. SQLite caps bind params at
32766, Postgres at 65535 — a project with that many tasks crashes the
query. **Fix:** subqueries / JOINs.

### ZZ47. `agents.descendants` / `ancestors` silently truncate at depth caps 🟠

**File:** `crates/hive-db/src/repos/agents.rs:225-271`.

Hard-coded `depth ≤ 32` (`descendants`) / `depth ≤ 16` (`ancestors`).
No error, no log when the cap kicks in. Combined with the fact that
`agents.parent_agent_id` is *not* cycle-checked (only `agent_wires`
is), a planted lineage cycle terminates by accident and returns wrong
data. **Fix:** seen-set dedup; return `Err(GraphTooDeep)` when the cap
hits.

### ZZ48. `agents.parent_agent_id` lineage vs `agent_wires` graph can disagree 🟠

**Files:** `repos/agent_wires.rs:90-101,104-123`, `repos/agents.rs`.

An agent can have `parent_agent_id = X` *and* a wire `Y → self`,
yielding a UI conflict (HiveGraph draws both dashed lineage and solid
wire). Nothing rejects this. **Fix:** either treat lineage as the
canonical first wire (auto-insert on spawn — already done) AND reject
wires that contradict it, or drop `parent_agent_id` from `agents` and
rely solely on wires.

### ZZ49. `chat_messages` has no soft delete, inconsistent with rest of schema 🟡

**File:** `crates/hive-db/src/repos/chat_messages.rs:23-29` and the
init migration.

`projects`, `agents`, `tasks`, `agent_messages` carry `deleted_at`;
`chat_messages` is hard-deleted (`delete_for_thread`, `delete_ids`).
"Undo last send" and forensic audit are impossible. Pick one model
project-wide.

### ZZ50. `agent_messages::requeue_running` is project-global 🟡

**File:** `crates/hive-db/src/repos/agent_messages.rs:117-124`.

On startup recovery it re-queues every project's `running` messages.
Fine today (single process), but as soon as HIVE is ever sharded or
the operator wants a targeted recovery, this is the wrong granularity.
**Fix:** add a `project_id` filter param.

### ZZ51. `audit::list` accepts unbounded `limit`, offset pagination over an unbounded table 🟡

**File:** `crates/hive-db/src/repos/audit.rs:43-50`.

No max-limit clamp; caller passes raw `u64`. Combined with A2 (no
purge yet), offset pagination over a multi-million-row table degrades
to O(n). **Fix:** clamp `limit` to e.g. 1000; switch to keyset
pagination over `(created_at, id)` once the table is large.

## API-layer findings (ZZ52–ZZ66)

### ZZ52. `approve_spawn_request` races + double-spawns the pipeline 🔴

**File:** `crates/hive-api/src/main.rs:8201-8230`.

The handler reads the row, checks `status == "awaiting-approval"`, then
spawns `run_pipeline` *without* atomically transitioning the row to
`approved`. Two parallel approval clicks (or a double-tap) both pass the
status check and both spawn pipelines on the same `spawn_request_id`. No
`audit::append` either. Compounds the B4b "no in-flight dedup" issue
because dedup at the consumer doesn't help if the producer itself
duplicates the send. **Fix:** atomic
`UPDATE agent_spawn_requests SET status='approved' WHERE id=? AND status='awaiting-approval'`,
only spawn if `rows_affected == 1`; append audit.

### ZZ53. `delete_project` leaves running executors + workspace dir on disk 🔴

**File:** `crates/hive-api/src/main.rs:2052-2094`.

After `projects::delete` (which FK-cascades the rows away), the
per-agent executors keep ticking against vanished agent rows; the
sandbox workspace dir (`<data_dir>/workspaces/<project_id>/`) remains
on disk; chat attachments under `<data_dir>/attachments/<project_id>/`
also leak. Combined with A1 this means project deletion never reclaims
disk. **Fix:** before DB delete: enumerate `agents::list_by_project`,
`cancel_subtree` + `terminate` each, `executors.drop_for_project`,
`tokio::fs::remove_dir_all` both the workspace and the attachments
root.

### ZZ54. `delete_chat_thread` skips ownership check and audit 🟠

**File:** `crates/hive-api/src/main.rs:6289-6298`.

Any `thread_id` can be deleted by id alone; no `project_id` membership
check; no `audit::append`. The chat-history confidentiality model
assumes thread access is project-scoped, but this handler doesn't
enforce it. **Fix:** load the thread row, verify
`thread.project_id` matches the path/auth context, append audit, then
delete.

### ZZ55. `update_settings` is ~10 sequential writes with no transaction 🟠

**File:** `crates/hive-api/src/main.rs:5755-5920`.

The handler calls `put_value` for each touched section (defaultModel,
audit retention, GitHub creds, integrations, …) without `db.begin()`.
A partial failure halfway leaves the new `defaultModel` persisted but
the Tavily key never sealed, audit retention persisted but masked
token clobbered, etc. Concurrent PATCHes compound via the ZZ40
last-write-wins. **Fix:** wrap in `db.transaction()`, ideally also
add an etag/version column for optimistic concurrency.

### ZZ56. `upload_chat_attachment` buffers full field into RAM before size check 🟠

**File:** `crates/hive-api/src/main.rs:6940-6950`.

`field.bytes().await` allocates the whole field, then
`bytes.len() > ATTACHMENT_MAX_BYTES` is the check. An attacker streaming
a 10 GB field OOMs the server before the post-buffer check fires. No
`DefaultBodyLimit` / `RequestBodyLimitLayer` is installed globally
either. **Fix:** accumulate via `field.chunk().await` with a running
size guard, *or* install `DefaultBodyLimit::max(MAX + slack)` on the
multipart route.

### ZZ57. `download_chat_attachment` doesn't canonicalise the storage path 🟠

**File:** `crates/hive-api/src/main.rs:7000-7031,7048`.

The handler does
`data_dir.join("attachments").join(&row.storage_path)`
without a canonicalise-and-prefix-check. Today writes are sanitised so
storage_path is always a relative ULID-prefixed name — but a DB
corruption, future migration, or any future SQL flaw turns this into an
arbitrary-file-read endpoint. **Fix:** `canonicalize()` the joined path
and assert it starts with `canonical(attachments_root)`.

### ZZ58. `AppError::Internal` mints its own request-id, diverging from middleware 🟠

**File:** `crates/hive-api/src/main.rs:191-208` vs `:1040-1060`.

The middleware overwrites the response's `x-request-id` with its own
ULID after the handler returns. The body produced by `AppError::Internal`
contains a *different* ULID it minted locally. Operators cannot grep
logs by the id the client sees. **Fix:** thread the middleware's
request id through a request extension and have `IntoResponse` read it
instead of minting a new one.

### ZZ59. `pause/resume/terminate_agent` skip audit AND swallow executor errors 🟠

**File:** `crates/hive-api/src/main.rs:2362-2434`. Strict superset of
Z8 (audit gap) and Z2 (executor swallow). Each handler uses
`let _ = ... .map_err(...)` and never calls `audit::append`, so the
canonical lifecycle endpoints are invisible in the audit log AND
DB/executor desync silently. **Fix:** propagate via `?`; append audit
on success matching the shape of `set_agent_status`.

### ZZ60. `set_agent_status` accepts arbitrary status strings 🟠

**File:** `crates/hive-api/src/main.rs:2810-2857`.

The match has a `_ => {}` fallthrough. Unrecognised `body.status`
values are still persisted to the DB column and broadcast on the SSE
bus. Downstream (frontend, drift hook) all branches on these strings.
**Fix:** parse against the `AgentStatus` enum up front; return 400 on
unknown.

### ZZ61. `create_project` is non-atomic across project/audit/activate/coordinator 🟡

**File:** `crates/hive-api/src/main.rs:1932-1975`.

Four sequential writes (`projects::create`, `audit::append`,
`projects::activate`, coordinator-spawn). A failure mid-sequence leaves
an inconsistent state — e.g. project exists but no audit entry, or
activated but coordinator never spawned. Coordinator failure is
intentionally lenient; the first three should be transactional.

### ZZ62. Git endpoints don't gate on `sovereignty_tier` 🟡

**File:** `crates/hive-api/src/main.rs:800-823, 5146-5193`.

`/git/init`, `/git/commit`, `/git/push`, `/git/pull` operate regardless
of `project.sovereignty_tier`. A "local"-tier project paired with a
configured GitHub remote can still push outward, contradicting the
"local-only" promise. The runtime tools `git_pull`/`git_push` *do*
gate; the HTTP endpoints don't. **Fix:** match the runtime gate —
403 on `push`/`pull` for `local` tier.

### ZZ63. N+1 in `list_projects → project_payload` 🟡

**File:** `crates/hive-api/src/main.rs:1901-1907 → 1647-1670`.

Per project: `agents::count_by_project` + `cost_events::total_cost_cents_for_project`.
On a workspace with N projects that's 1 + 2N queries. **Fix:** add
batch repo methods `agents::counts_by_project_ids(&[…])` /
`cost_events::totals_by_project_ids(&[…])` and merge in memory.

### ZZ64. Audit purge job double-fires at startup 🟡

**File:** `crates/hive-api/src/main.rs:569-594`.

`tokio::time::interval` fires immediately on first tick; the loop body
runs before the await, so iteration 1 purges, iteration 2 awaits the
already-ready tick and purges again with no delay. Cheap (no-op the
second time) but signal-noise in the audit log of the audit-purge
itself. **Fix:** `tick.tick().await` *before* the body or use
`interval_at(Instant::now() + 24h, …)`.

### ZZ65. `executors.rehydrate_from_db()` failure silently swallowed at boot 🟡

**File:** `crates/hive-api/src/main.rs:489`.

`let _ = executors.rehydrate_from_db().await`. If rehydration fails
(e.g. partial DB corruption, schema mismatch from an interrupted
migration), agents that should have resumed silently don't. The
operator has no signal until they wonder why nobody's working. Not in
the documented Z2 set (which only covered per-agent calls). **Fix:**
`if let Err(e) = … { tracing::error!(...) }`; consider hard-exiting
non-zero if rehydration is essential.

### ZZ66. Decrypted GitHub token leaks into error logs via `FromUtf8Error::Display` 🟡

**File:** `crates/hive-api/src/main.rs:1435-1441`.

`String::from_utf8(opened).map_err(|e| AppError::Internal(e.to_string()))?`.
`FromUtf8Error::Display` includes the invalid byte sequence — i.e. the
decrypted plaintext token bytes — in the error message, which then
flows into the `tracing::error!(%detail, …)` log in `AppError::Internal`.
A torn or corrupted ciphertext therefore writes the token's plaintext
into the log file. **Fix:** drop the inner error:
`.map_err(|_| AppError::Internal("github token is not valid utf-8".into()))`.

## Frontend findings (ZZ67–ZZ81)

### ZZ67. Synthesis-complete navigates to a redirected route → NotFound 🟠

**File:** `front-end/src/pages/Modules.tsx:90,367`.

`navigate('/modules/${moduleId}')` runs on synthesis complete and on
the "View details" link, but `App.tsx:97` redirects `/modules` and all
descendants to `/forge?tab=modules` and no `/modules/:id` route is
registered. Users who actually complete a successful synthesis land on
NotFound. **Fix:** either register `/modules/:id` → `<ModuleDetail/>`
(also resolves ZZ68 partially) or navigate to
`/forge?tab=modules&moduleId=…`.

### ZZ68. Genuine orphan pages: `ModuleDetail.tsx`, `SpecPlan.tsx` 🟢

**Files:** `front-end/src/pages/{ModuleDetail,SpecPlan}.tsx`.

(Refines Z13: `Modules.tsx` and `AgentForge.tsx` are NOT orphans —
`Forge.tsx:31-32` lazy-imports both.) `ModuleDetail` and `SpecPlan`
have zero imports. **Fix:** delete them, or wire `ModuleDetail` into
the route that ZZ67 needs.

### ZZ69. `useSse` handler vocabulary gaps (refines Z20) 🟠

**File:** `front-end/src/realtime/useSse.ts`.

Backend emits these names with no handler: `agent_spawn_request.queued`,
`agent_spawn_request.updated`, `agent_task_assignment.created`,
`agent_task_assignment.updated`, `chat.thread.cleared`,
`drift_event.updated`, `spec_document.decomposed`. Result: the
`/spawn-requests` page, the drift cards in Planning, and the spec doc
list stay stale until manual refresh. **Fix:** add handlers
invalidating `['spawn-requests', projectId]`,
`['agent-task-assignments', …]`, `['chat-threads', projectId]` +
`['chat-messages', threadId]` (on cleared), `['drift-events',
projectId]`, and `['spec-documents', projectId]`.

### ZZ70. `sync.required` blanket-invalidates every active query → stampede 🟠

**File:** `front-end/src/realtime/useSse.ts:200`.

`qc.invalidateQueries()` with no key invalidates everything currently
mounted, including the 2 s-polled `useSandboxLocks`. On a stream that's
lagging hard enough to emit `sync.required` repeatedly, the client
issues a stampede of refetches that worsens the load. **Fix:** scope
to a coarse prefix (e.g. `['projects']`, `['agents']`) and/or
debounce with `setTimeout` 250 ms.

### ZZ71. `api()` fetch wrapper has no AbortController support 🟠

**File:** `front-end/src/api/client.ts:23`.

`fetch` is called without a `signal`. When TanStack cancels a query
(rapid nav, project switch), the in-flight request keeps running,
decodes JSON, and resolves into an unmounted consumer. Memory leak +
React "setState on unmounted" warning. **Fix:** accept `signal?:
AbortSignal`, pass it to `fetch`. TanStack's `queryFn` receives
`{ signal }` — thread it via `queryFn: ({ signal }) => api(path, {
signal })`.

### ZZ72. `Modules.tsx` opens a duplicate `EventSource` AND unbounds the progress array 🟠

**File:** `front-end/src/pages/Modules.tsx:71-111` (Z4 redux + new).

Z4 (duplicate `EventSource` defeating the singleton cap) is still open,
*plus* `setProgress((c) => [...c, …])` per token-level SSE event has no
cap — long synthesis runs balloon the array unbounded and re-render
gets O(n) per event. **Fix:** route through `useRealtime().subscribe(…)`
(resolves Z4) and `.slice(-200)` the progress array.

### ZZ73. `RealtimeProvider` first-cold-start undercounts as a reconnect 🟢

**File:** `front-end/src/realtime/RealtimeProvider.tsx:43,54`.

`connectionState` starts `"connecting"`; the `n === 0 ? 0 : n` no-op
in `onopen` is a correct *intent* but `onerror` *before* the first
open already incremented `reconnectCount`. The TopBar pill therefore
shows "reconnect #1" on a normal cold start when the backend isn't
quite ready yet. **Fix:** track `hasEverOpened` ref and skip the
`onerror`-side increment until it's true.

### ZZ74. `WorkspaceContext` settings effects run with defaults during pending query 🟠

**File:** `front-end/src/context/WorkspaceContext.tsx:330,348-369`.
Concrete location for Z12.

`appearance = settingsQuery.data?.appearance ?? defaultSettings.appearance`
means while `settingsQuery.isPending`, the effects at :348 (`setTheme`)
and :357 (CSS-var write to `documentElement`) run against
`defaultSettings.appearance`, then re-paint when real data arrives. The
classic amber-/theme-flash on every cold load. **Fix:** gate both
effects on `settingsQuery.isSuccess`.

### ZZ75. `Onboarding` un-cleared `setTimeout` + stale-closure project ensure 🟠

**File:** `front-end/src/pages/Onboarding.tsx:203,213-218`.

`:203` — `setTimeout(() => navigate('/dashboard'), 1500)` after launch
isn't ref-tracked or cleared. User navigates away within 1.5 s →
unmounted component still navigates. `:213-218` — the
`ensureProjectForChat` effect has deps `[step, onboardingDraft.projectId]`
but reads `onboardingDraft.{source,tier,budget}`. Disabled lint. If the
user steps back to Source/Budget then forward again, the project gets
created with the stale read. **Fix:** ref-track the timeout; either
include all read fields in deps or read from a `latestDraftRef`.

### ZZ76. `Onboarding` "Next" button has no per-step validation 🟡

**File:** `front-end/src/pages/Onboarding.tsx:357-364`.

Next is unconditionally enabled. Users can advance from step 0
without picking a source, from step 2 with no providers connected,
from step 3 with an empty description (then Launch fails late with a
generic error). **Fix:** `disabled={(step===0 && !source) || (step===2
&& connectedProviderIds.length===0) || (step===3 && !description.trim())}`.

### ZZ77. `ApiError` swallowed in pages, `requestId` correlation lost 🟢

**Files:** `front-end/src/pages/Projects.tsx:21`,
`front-end/src/pages/Modules.tsx:117,133,144`.

`console.error('Failed to delete project', error)` shows no user
toast and discards `error.supportSuffix`. Modules' toasts use
`error instanceof Error ? error.message : '…'` so they don't surface
the request-id either. **Fix:** ship a `toastApiError(error, fallback)`
helper that appends `supportSuffix` when `error instanceof ApiError`;
use everywhere.

### ZZ78. `useHiveData` mutations close over a stale `projectId` 🟠

**File:** `front-end/src/api/queries/useHiveData.ts:174,180,203`.

`toggleSessionMutation`, `extendBudgetMutation`, `createTaskMutation`
read `projectId` from the outer scope. When the user activates a
different project, the previous render's mutation hooks are not torn
down until the next commit — a click in that window POSTs to the old
project. **Fix:** pass `projectId` through `mutationFn` variables
instead of closing over it.

### ZZ79. `useChatStream` leaks per-message state across thread switches 🟠

**File:** `front-end/src/api/chat.ts:283-289,291-443`.

When the user switches threads mid-stream, the new thread's effect
runs before the old one's cleanup, briefly leaving both subscriptions
live. Messages from the previous thread land in `stateRef.current`
keyed by `messageId` and are never purged when `threadId` changes —
memory leak proportional to thread switches per session. **Fix:** on
`threadId` change reset `stateRef.current = {}` and `setStreaming({})`
in a fresh effect with `[threadId]` deps.

### ZZ80. `useCancelChatMessage` over-invalidates every thread 🟢

**File:** `front-end/src/api/chat.ts:131`.

`onSuccess: qc.invalidateQueries({ queryKey: ['chat-messages'] })` (no
threadId scope) refetches every loaded thread's messages. **Fix:**
pass threadId in the mutation input and scope the key.

### ZZ81. `Onboarding` query key includes raw `description` — cache bloat per keystroke 🟡

**File:** `front-end/src/pages/Onboarding.tsx:494-502`.

`queryKey: ['genesis-preview', description, agents]` — every keystroke
in the brief textarea allocates a new TanStack cache entry; entries
hang around until `staleTime` expires (60 s default). A long brief
caches dozens of intermediate strings in memory. **Fix:** debounce
`description` (e.g. 400 ms) before feeding it into the key, or hash
to a 64-bit fingerprint.

### Revised next-sprint order (supersedes the 2026-05-25 ordering and the earlier 2026-05-27 ordering above)

**🔴 floor** (every critical from both 2026-05-25 and 2026-05-27 sweeps):
`ZZ1 → ZZ2 → Z1 → ZZ3 → ZZ4 → ZZ25 → ZZ37 → ZZ38 → ZZ52 → ZZ53 → ZZ5
→ Z2 → Z3/A9 → B4b → B4c → Z10`.

**🟠 sweep** (high-impact correctness/security):
`ZZ6 → ZZ7 → ZZ8 → ZZ9 → ZZ10 → ZZ11 → ZZ12 → ZZ13 → ZZ20 → ZZ21 →
ZZ26 → ZZ27 → ZZ29 → ZZ30 → ZZ31 → ZZ32 → ZZ33 → ZZ39 → ZZ40 → ZZ41 →
ZZ42 → ZZ43 → ZZ44 → ZZ45 → ZZ46 → ZZ47 → ZZ48 → ZZ54 → ZZ55 → ZZ56 →
ZZ57 → ZZ58 → ZZ59 → ZZ60 → ZZ67 → ZZ69 → ZZ70 → ZZ71 → ZZ72 → ZZ74 →
ZZ75 → ZZ78 → ZZ79 → Z6 → Z9 → Z8 → Z11`.

🟡/🟢 cleanup after that.
