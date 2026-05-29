# HIVE roadmap

The forward plan. For *current* status of every feature see
[`FEATURE_STATUS.md`](FEATURE_STATUS.md); for how the built parts work see
[`architecture.md`](architecture.md). Actionable technical debt and remaining bugs are tracked in [`BACKLOG.md`](BACKLOG.md).

> **2026-05-27 → 2026-05-28 audit + remediation:** a six-track deep audit
> (security, runtime concurrency, API layer, DB layer, LLM clients,
> frontend) surfaced 81 findings (ZZ1–ZZ81 in [`BACKLOG.md`](BACKLOG.md)).
> **Four batches of remediation** (`cea2fe9` · `bb5b4be` · `558f283` ·
> `1c17673`) plus operator commit `9eb75a3` have **closed 30 of those
> items**, including every 🔴 except `pause()`-interrupts-current-turn
> (the pure-pause-vs-cancel signal, Z17 — `terminate` interrupts
> correctly via ZZ2). See [`BACKLOG.md`](BACKLOG.md) §ZZ "Fixed in this
> pass" for the canonical closure list. The items below describe the
> *forward* roadmap; outstanding audit items remain the higher-priority
> queue until burned down — see BACKLOG's "Revised next-sprint order".

Each item below is a multi-commit effort; rough descending priority.

## Recently delivered

These shipped since the last ROADMAP refresh; kept here so current open
items don't drift into old plans. Confirm in
[`FEATURE_STATUS.md`](FEATURE_STATUS.md) before acting on any of them.

**Audit-driven (2026-05-27 → 2026-05-28)** — see BACKLOG §ZZ "Fixed in this
pass" for the full chronological list (30 closures across four batches):

- **Drift hook on every exit path** (Z1) — moved from `run_turn_inner`
  (success-only) to outer `run_turn`; cancel/timeout/LLM-error/budget
  exits now score drift too. Runtime drift auto-detection is now `done`.
- **Cancel actually interrupts the LLM stream** (ZZ2) — `run_turn`
  bridges `executors.token_for(agent).cancelled()` into the chat-turn
  cancel flag, so `terminate` / `cancel_subtree` stop the stream within
  50 ms instead of "at the next inbox boundary".
- **`PermissionMatrix` enforced** (ZZ4) — `ToolRegistry::invoke` now
  calls `decide(name, action_class)` before every tool dispatch.
- **`fs_write` planted-parent-symlink escape closed** (ZZ1) plus the
  `fs_read` / `fs_write` size-cap / symlink TOCTOUs (ZZ10 / ZZ11)
  via `O_NOFOLLOW` + `File::take(cap+1)`.
- **`shell_exec` no longer leaks cached creds** (ZZ7) — HOME points at
  the protected `<root>/.hive/run-home/`.
- **Spawn pipeline idempotent under duplicate approval** (ZZ52 + B4b +
  B4c) — atomic `transition_status`, mpsc dedup `HashSet`, resume-from-
  approved.
- **`delete_project` reclaims executors + workspace + attachments**
  (ZZ53).
- **`seed_demo` claims sentinel up-front** (ZZ38) — concurrent first-boots
  can't both run the body.
- **Loop detector reads `arguments`** (ZZ3) — was always-Null `args`.
- **LLM streaming UTF-8 + ordering fixes** (ZZ25 / ZZ27 / ZZ29 / ZZ31 /
  ZZ32) — no more U+FFFD mid-codepoint, no more lost finish_reason,
  Gemini emits Complete on EOF, DeepSeek strips tools for R1, Anthropic
  picks model-aware `max_tokens` defaults.

**Pre-audit deliveries:**

- **B1 coordinator-led onboarding** (was §1): `POST /v1/coordinator/converse` +
  `StepCoordinatorChat`. Project is created on step-3 entry (not at Launch);
  `OnboardingDraft.{projectId, coordinatorThreadId}` thread it through.
  Brief auto-syncs from chat with an explicit "Save as brief" button.
- **B4 auto-MCP synthesis pipeline** (was §4): `request_capability` +
  `monitor_spawn_request` agent tools. mpsc-decoupled `spawn_pipeline_tx`
  on `AppState`; consumer rebuilds `BuildPipelineDeps` per spawn.
  Coordinator-only.
- **D1 eval leaderboard data source** (was §6 sub-bullet): `agent_eval_runs`
  table + `record_eval` runtime tool + `GET /v1/eval-runs`. UI consumes via
  `useEvalRunsData`.
- **D2 HiveGraph lock overlay** (was §6 sub-bullet): `SandboxLockRegistry` +
  RAII `LockGuard` in `hive-tools/src/locks.rs`. `GET /v1/sandbox-locks`,
  `useSandboxLocks` polls every 2s.
- **Pause/resume executor sync**: `PATCH /v1/agents/:id/status` and session
  toggle flip `ExecutorRegistry::{pause,resume,terminate}` alongside the
  DB row. Pause parks the inbox via `Notify`.
- **File Protection Zones uniform**: `ToolContext::check_path_allowed`
  protects `fs_read` / `fs_list` / `fs_write` / `shell_exec` against
  `.env*`, `.git/`, `.hive/`, and user-protected paths with
  component-wise + case/normalisation-aware checks.
- **Cost events on cancel / timeout / LLM-error**: partial spend hits
  the ledger so `budget_total_cents` stays enforceable.

## 1. Coordinator-led onboarding — remaining

The B1 groundwork shipped (see above). Still open:

- Auto-create the coordinator ("CEO") on `/launch` (or on first project open).
- Replace the single textarea + spec-upload with a merged "N documents +
  freeform messages" capture.
- Make `teamMode` toggleable mid-conversation without losing the in-flight
  request (currently fires-and-forgets the initial value).

## 2. Skill mounting

Make skills usable at runtime (today they're just rows + a Forge CRUD UI).

- New `agent_skill_bindings` table + REST (`POST/DELETE /v1/agents/:id/skills`,
  `GET /v1/agents/:id/skills`).
- Attach-skills section in the agent builder (`<AgentFormFields>`) and the
  config dialog.
- Runtime: a bound skill is **listed** in the agent's system prompt ("you have
  skill *X* — call `read_skill('X')` to load it"); new agent tools
  `list_skills` / `read_skill` / `read_skill_file` **lazily** pull the
  markdown + script contents (keeps the base prompt small).
- Skills should grow a real markdown body / attached files, not just a
  `system_prompt_fragment`.

## 3. Autonomous agent task loop

- The executor (or a per-project work scheduler) lets idle agents pull their
  next assigned `tasks` row / the next item in the sprint tree, work it, mark it
  done/blocked, emit `task.status`, and loop.
- `max parallel agents` bounds concurrent in-flight turns; overflow queues.
- The coordinator (or a parent agent) can re-assign tasks, change priorities,
  pause/resume, and steer mid-flight (`delegate_task`, `message_agent`,
  `set-status`, `pause`/`resume` already exist as the primitives).
- Pause/resume DB↔executor sync is wired (see "Recently delivered"); remaining
  edge cases tracked in [`BACKLOG.md`](BACKLOG.md): `let _` swallowing executor
  errors and `pause()` not interrupting the in-flight turn. The leaked
  cancellation token after `terminate` was fixed on 2026-05-27.

## 4. Auto-MCP synthesis — remaining UI surface

B4 (`request_capability`, `monitor_spawn_request`, mpsc-decoupled pipeline),
B4b (in-flight dedup), and B4c (resume-from-approved) are all shipped. The
only outstanding item is the frontend:

- **Spawn-requests review surface** — `api/spawn-requests.ts` client and a
  polling `useSpawnRequests` hook exist; `pages/SpawnRequests.tsx` exists
  as a stub. Still TODO: render the pipeline state machine
  (queued → planning-needs → … → completed), surface the approval gate,
  show the generated MCP manifest + handler code for operator review.

## 5. Drift auto-detection — **closed**

The drift hook now runs on every `run_turn` exit (success / cancel /
timeout / LLM-error / budget-refusal) via the outer-`run_turn`
hoist landed in batch 2 (Z1). Scoring lives in `drift.rs`; four bands
with auto-pause at ≥0.9 (see
[architecture §4.5](architecture.md#45-drift-hook-drift_hookrecord_after_turn)).
What's left is UI-side polish on Planning → Drift; the runtime side
is complete.

## 6. Smaller / cleanup

- **Modules tab honesty pass** — make clear modules are full-privilege app
  extensions; keep the local synthesis flow but label it a stub; wrap the
  marketplace download / publish-to-registry bits in `<DisabledFeature
  kind="server-only">`.
- **Agent skill/connector attachment UI** — fold into the agent builder once
  the binding tables exist (#2 + connectors already exist).
- **Eval leaderboard data feed** — D1 shipped `agent_eval_runs` + `record_eval`
  tool + endpoint. Still needs an eval harness that systematically scores
  agent outputs (and decides when to call `record_eval`).
- ~~**HiveGraph lock overlay**~~ — shipped (D2). See "Recently delivered".
- **No-effect Settings panels** — Adaptive Router, HCM Modules, Integrations,
  Security & Compliance, the keyboard-shortcuts list are local-state theatre.
  Either wire them (e.g. the keyboard shortcuts), hide them, or wrap in
  `<DisabledFeature>`.
- **Per-project SSE** — `GET /v1/projects/:id/events` (a filtered view of the
  global stream). Mostly redundant — the global `/v1/events` + `useSse`'s
  invalidation map already keeps dashboards live — but it'd let metrics
  *push-update* without query invalidation.
- **Interleaved persistence done; live-vs-reload separators** — the live stream
  concatenates per-round text without separators while the persisted body joins
  rounds with blank lines; emitting a `\n\n` token between rounds would make
  them identical (cosmetic).
- **Docker sandbox variant** in `hive-sandbox` (currently `LocalFsSandbox` only).
- **Drop the `*-legacy` routes** (`/spec-legacy`, `/modules-legacy`,
  `/agent-forge-legacy`) and the dead page components once nothing references
  them. `AgentForge` is currently double-duty (the Forge "Agents" tab + the
  legacy route).

## Server-only — blocked on the (not-yet-built) Hive central server

Template gallery, the Cloud sovereignty tier, marketplace agent/module download,
publish-to-public-registry, cross-org metrics/leaderboard aggregation, hosted
notification delivery. These stay visible-but-disabled with a "Requires Hive
central server" tooltip until that server exists; don't invest in the
integration hooks yet.
