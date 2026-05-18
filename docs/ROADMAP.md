# HIVE roadmap

The forward plan. For *current* status of every feature see
[`FEATURE_STATUS.md`](FEATURE_STATUS.md); for how the built parts work see
[`architecture.md`](architecture.md). The original 6-phase cleanup plan (mostly
delivered) is preserved at [`../back-end/docs/plan fix evything.md`](../back-end/docs/plan%20fix%20evything.md);
the original backend-dependency list (mostly delivered) at
[`../back-end/docs/PHASE_2_TO_5_BACKEND_TODO.md`](../back-end/docs/PHASE_2_TO_5_BACKEND_TODO.md).

Each item below is a multi-commit effort; rough descending priority.

## 1. Coordinator-led onboarding

Make "create a project" actually do something end-to-end.

- Recent groundwork: `/launch` now indexes the created spec document into
  sections, persists a local deterministic task plan when no LLM planner is
  reachable, and preserves uploaded checklist/numbered TODO items instead of
  forcing them into a generic 3-phase plan.
- Auto-create the coordinator ("CEO") on `/launch` (or on first project open).
- Turn the onboarding **Describe** step into a back-and-forth chat with the
  coordinator (`POST /v1/projects/:id/coordinator/converse`) instead of a plain
  textarea; the conversation ends in a `spec_documents` row + the initial agent
  roster (which feeds the existing `/launch` decompose step that writes
  `sprints` + `tasks`).
- Honour `team_mode` in the conversation (already wired into `coordinator_tools`).
- Replace the single textarea + spec-upload with the merged "N documents +
  freeform messages" capture the original plan called for.

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
- Wire pause/resume to actual executor state everywhere (currently best-effort).

## 4. Finish the auto-MCP-synthesis pipeline

`hive-runtime/src/spawn/` has the state machine and REST endpoints; finish it
and expose it as an **agent-triggered** tool (keep the human-approval step).

- Complete `run_pipeline` (it has an `unimplemented!()` in a test mock; verify
  the real `LlmPipelineDeps` path is fully implemented) and invoke it from the
  `spawn-requests` create handler.
- New agent tool, e.g. `request_capability(description)` → creates a
  `spawn_request`, runs the pipeline (research API → synthesize a
  `custom_mcp_servers` row → compose a prompt → await approval → materialize a
  sub-agent bound to the new MCP server).
- Frontend: a spawn-requests review surface (the `api/spawn-requests.ts` client
  already exists but is unused) — show the pipeline state machine, the approval
  step, the generated manifest/handler.

## 5. Drift auto-detection

- Call `drift.rs`'s scorers from the turn loop (after each turn and/or each
  `turn_driver` cycle) for the three drift kinds.
- **Graduated response by severity**: low → log a `drift_events` row only;
  medium → also raise an `alert`/`notification`; high → pause the agent (or its
  subtree) so a human must intervene; surface all of it on Planning → Drift.

## 6. Smaller / cleanup

- **Modules tab honesty pass** — make clear modules are full-privilege app
  extensions; keep the local synthesis flow but label it a stub; wrap the
  marketplace download / publish-to-registry bits in `<DisabledFeature
  kind="server-only">`.
- **Agent skill/connector attachment UI** — fold into the agent builder once
  the binding tables exist (#2 + connectors already exist).
- **Eval leaderboard** — needs a real source for `agents.evalScores` /
  `qualityScore` (an eval harness that scores agent outputs); UI is ready.
- **HiveGraph lock overlay** — needs the runtime to expose which agents hold
  sandbox file locks; UI is ready (the locked-agent set is currently a
  hardcoded empty `Set`).
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
