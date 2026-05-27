# HIVE roadmap

The forward plan. For *current* status of every feature see
[`FEATURE_STATUS.md`](FEATURE_STATUS.md); for how the built parts work see
[`architecture.md`](architecture.md). Actionable technical debt and remaining bugs are tracked in [`BACKLOG.md`](BACKLOG.md).

> **2026-05-27 audit pass:** a six-track deep audit (security, runtime
> concurrency, API layer, DB layer, LLM clients, frontend) surfaced 81
> additional findings (ZZ1–ZZ81 in [`BACKLOG.md`](BACKLOG.md)), including
> several 🔴 items — `fs_write` directory-escape via planted symlink
> (ZZ1), cancel/pause decoupled from the in-flight LLM stream (ZZ2),
> the loop detector reading the wrong JSON key and never matching (ZZ3),
> the `PermissionMatrix` being dead code (ZZ4), UTF-8 corruption on
> stream chunk boundaries (ZZ25), the SeaORM migration vector being out
> of filename order (ZZ37), non-transactional `seed_demo` (ZZ38),
> `approve_spawn_request` double-spawning the synthesis pipeline (ZZ52),
> and `delete_project` not stopping executors or cleaning the workspace
> (ZZ53). The revised sprint ordering is at the bottom of
> [`BACKLOG.md`](BACKLOG.md). The items below predate that audit; treat
> the audit findings as the higher-priority queue until they're worked
> through.

Each item below is a multi-commit effort; rough descending priority.

## Recently delivered

These shipped since the last ROADMAP refresh; kept here so the current open
items don't drift into old plans. Confirm in
[`FEATURE_STATUS.md`](FEATURE_STATUS.md) before acting on any of them.

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
  toggle now flip `ExecutorRegistry::{pause,resume,terminate}` alongside
  the DB row. Pause actually parks the inbox via `Notify`.
- **File Protection Zones uniform**: `ToolContext::check_path_allowed`
  protects `fs_read` / `fs_list` / `fs_write` / `shell_exec` against `.env*`,
  `.git/`, and user-protected paths with case/normalisation-aware checks.
- **Cost events on cancel / timeout / LLM-error**: partial spend now hits
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

B4 (`request_capability`, `monitor_spawn_request`, mpsc-decoupled pipeline) is
shipped. What's left:

- Frontend spawn-requests review surface: `api/spawn-requests.ts` client exists
  and a polling hook `useSpawnRequests` is wired — page UI to show the pipeline
  state machine, surface the approval gate, and render the generated manifest /
  handler is still TODO.
- Pipeline mpsc consumer has no in-flight dedup (same `spawn_request_id` can be
  processed twice — see BACKLOG).
- `approve_spawn_request` re-runs the synthesis from stage 0, double-billing
  the LLM — should resume from `awaiting-approval` (see BACKLOG).

## 5. Drift auto-detection — wired, has gaps

The turn loop now calls `record_after_turn` after each successful turn, scores
via `drift.rs`, and auto-pauses at score ≥ 0.9 (see
[`architecture.md`](architecture.md#drift-hook) and CLAUDE.md §3b.5). Bands are
the graduated response originally specified.

What's left:

- **The hook is skipped on cancel / timeout / LLM-error / budget exits** —
  precisely the moments drift is most likely. Wrap `run_turn_inner` in a
  defer-style guard so `record_after_turn` runs regardless of exit path.
- Auto-pause uses `let _ = registry.pause(...)` and only `tracing::warn!`s on
  `NotFound` — if the executor wasn't pre-`ensure`d, the DB and executor
  diverge silently (same bug class as in `set_agent_status`).
- UI surface on Planning → Drift is partial; the alerts/notifications side
  works but the dedicated panel still says "planned".

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
