# Hive Fix Plan

Your request covers ~40 distinct issues spanning UI, navigation, onboarding, chat behavior, graph semantics, agent tools, and local-vs-server scoping. Tackling all in one shot would be unsafe (high regression risk, no way to verify each change). I'll batch them into 5 phases. After each phase you confirm before I move on.

I'll apply the following defaults (override now if wrong):

- **Edges in HiveGraph** = both authority + communication (one-way wire = parent→child).
- **Threads** belong to `(project, agent)` with title = first user task.
- **Server-only features** stay visible but disabled with a tooltip "Requires Hive central server (not yet available)".
- **Stats vs Insights** = merge stale Stats sub-tabs into Planning/Insights; delete duplicates.
- **Imported specs** → roadmap → per-agent task tree (sprint plan in V2).
- **Unimplemented features**: visible+disabled with badge ("planned" / "server-only"); fully removed only if obsolete.
- **Terminate agent** → renamed to **Delete agent** (hard delete + confirm).

## Phase 1 — Cleanup & truthful UI (no new logic)

Goal: stop the app from lying. Every button either works or is clearly labeled disabled.

1. Remove orphan Stats sub-tabs (HiveMind, TechDebt, SessionWeekly) now duplicated in Planning. Keep the richer TechDebt editor; move it to Planning.
2. Move GitHub Connect from Code & Versioning → Settings.
3. Delete "Org Chart View" toggle in HiveGraph (keep node graph only).
4. Delete "Lock overlay" button (or wire it — confirm).
5. Replace fake 3s onboarding launch animation with real init steps (DB migrate ping, search engine probe, sandbox check) or remove it.
6. Add `<DisabledFeature reason="…">` wrapper component; apply to: template onboarding, import-project onboarding, marketplace agent download, hybrid tier, estimated cost, etc.
7. Remove hybrid tier from onboarding; force local; add disabled "Cloud" tier card.
8. Polish Forge buttons (consistent variants, spacing).
9. Rename "Terminate agent" → "Delete agent".

## Phase 2 — Onboarding & Spec→Plan pipeline

10. Merge "Import spec" + "Interview mode" into single chat-style capture step; allow N documents + freeform messages.
11. Wire describe step → backend spec ingestion → roadmap generation → per-agent task tree.
12. Connect LLM step: add model picker per provider (list models from provider API).
13. Configure-resources step: replace "max agents" with "max parallel agents" (queue overflow). Remove cap on total agents. Remove fake estimated cost.
14. Real launch sequence: provision sandbox dir per project (UUID-scoped to fix shared-folder bug), run migrations, probe search, seed.

## Phase 3 — Chat Central rework

15. Move thread tabs from top bar → left sidebar grouped by agent (ChatGPT-style: agent name = section header, threads underneath, "+" to start new thread per agent).
16. Scope threads to `(project_id, agent_id)` — fix cross-project leakage (DB query + index).
17. Thread title = first user message (truncated), not agent name.
18. Add delete thread + slash commands (`/compact`, `/clear`, `/help`).
19. **Streaming behavior**: switch chat runner to interleaved mode — assistant emits text chunks between tool calls, not a single final block. (Requires backend `chat.rs` change: stream `response.text` deltas live via SSE between tool rounds; frontend renders them in order.)
20. Implement `/compact` (summarize history, replace older messages with summary).

## Phase 4 — HiveGraph interactivity & agent comms

21. Spawn-agent button → opens same modal as Forge create-agent; result is added to graph + Chat Central sidebar.
22. Wire creation: drag from one agent to another = parent→child authority + comm channel.
23. Wire deletion: left-click on edge.
24. Cycle prevention: reject wires that create loops in the directed graph.
25. Agent visibility rule: parents can message any descendant; children can only message direct parent + their own descendants. Each agent gets a `list_agents` tool returning visible peers.
26. Wire pause/resume to actual executor state (or disable + tooltip if executor doesn't support yet).
27. Backend tools: `send_message_to_agent`, `list_visible_agents`, `request_relay` (for child→non-ancestor messages).

## Phase 5 — Hive Mind, missing tools, metrics live updates

28. Hive Mind: add `hive_mind_read`, `hive_mind_write`, `hive_mind_list`, `hive_mind_delete` tools backed by a `hive_notes` table, scoped per project.
29. Agent management tools: `spawn_agent`, `delete_agent`, `monitor_agent`, `delegate_task`.
30. Spec/tech-debt/drift tools: `list_spec_docs`, `add_task`, `add_tech_debt`, `update_tech_debt`, `record_drift`.
31. Git tools for agents: `git_status`, `git_diff`, `git_commit`, `git_pull`, `git_push` (gated by sovereignty tier).
32. Stats live updates: switch dashboards from polled snapshot to SSE subscription on `cost_event`, `task_event`, `agent_state` channels.
33. Code & Versioning: real branch list (gitoxide), real working tree from `git status`, real file viewer from `git show :path`, working restore.

## Phase 6 — Cleanup of dead/promised settings & docs

34. Audit Settings page — remove options with no effect; mark "planned" ones explicitly.
35. Update `back-end/docs/` and `docs/architecture.md` to reflect: which features are local-only, which need central server, which are pending.
36. Add a `FEATURE_STATUS.md` table (feature × status × dependency) so this never drifts again.
37. Command palette: make modular, auto-register routes/commands, add fuzzy search.

## Risk notes

- Phase 3 #19 (streaming interleave) is the deepest change — touches `hive-runtime/src/chat.rs`, SSE schema, and frontend renderer. I'll do it last in its phase and behind a feature flag first.
- Phases 4–5 introduce new DB columns/tables → migrations.
- Backend changes can't be tested in the Lovable preview (Rust runs locally), so I'll rely on `cargo check`/`cargo test` + your manual run.

## What I need from you before starting

Confirm or override:

a) The 7 defaults at the top.
b) Phase order (1→6) — or reshuffle.
c) Whether to start Phase 1 immediately and you'll review after each phase, or you want me to draft Phase 1 in more detail first.
d) Any feature in the list you actually want **deleted entirely** (not disabled): name them.

Once you say "go", I start Phase 1 in the next turn.
