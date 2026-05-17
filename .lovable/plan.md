# HIVE — Frontend execution plan for the mega-plan

Scope: **frontend only**. Build the UI surfaces the mega-plan requires, and rewrite the existing parts that were called out as trash. Backend work (Rust/SQL) is tracked separately in `back-end/docs/PHASE_2_TO_5_BACKEND_TODO.md` and is **not** part of this plan — but where a feature needs a backend endpoint that doesn't exist yet, the UI is shipped behind `<DisabledFeature kind="planned">` so it's visible, honest, and ready to wire.

## 0. Design principles applied to every screen

1. **Causal honesty** — UI state comes from real events or queries, never `setTimeout`.
2. **Disabled, not hidden** — missing backend → visibly disabled card with tooltip *why* and *what to do*.
3. **One pattern per concern** — single `EmptyState`, `LoadingSkeleton`, `ConfirmDeleteModal`, `StatusDot`, `DisabledFeature` across the app. No page reinvents these.
4. **Single SSE source** — one shared `EventSource` consumed by all hooks (kills the 6-connection cap bug).
5. **Per-message metadata everywhere** in chat (tokens / cost / model / duration).
6. **Toasts ≠ logs** — a toast plus a re-openable trace entry, never just a toast.
7. **Connection health surfaced in TopBar** — backend down = one banner with backoff, not 4 toasts/s.

## 1. What gets rebuilt (because the current version is trash)

| Page / piece | Why it's bad now | Rewrite |
|---|---|---|
| **ChatCentral message rendering** | Tool calls are dumped under the text, breaking causal order. Tool result JSON is raw and unreadable. No tokens/cost/model footer. No in-flight spinner or Stop. No `tool_validation_error` surfacing. | Rebuild `Message`, `ToolCallList`, and `useChatStream` around a `segments: Array<{kind: 'text'\|'tool', …}>` model. Append on each `chat.<tid>.token` / `tool_call` / `tool_result` / `tool_validation_error` in arrival order. Tool segments get: status pill (running/ok/error/validation), pretty JSON viewer with collapse + truncation + copy, inline error block. Add a footer row under every assistant bubble: model · tokens-in/out · cost · duration. Add a Stop button while streaming. |
| **HiveGraph** | `window.confirm()` for delete. Authority and communication wires render identically. Lock overlay is hardcoded `new Set()`. No live agent inbox. Pause/Resume not optimistic. | Replace `confirm()` with `ConfirmDeleteModal`. Two edge styles (solid arrow for authority, dashed dotted for comms) with a legend overlay. Lock overlay reads from `useSandboxLocks(projectId)` (hook exists/added; ships disabled if endpoint missing). Subscribe to `agent.<id>.inbox` and `agent.<id>.status` via the new shared realtime context. Pause/Resume use TanStack `onMutate` optimistic flip. |
| **Onboarding StepDescribe** | A textarea pretending to be a CEO chat. | Build `StepCoordinatorChat` — a minimal chat UI that calls `/v1/projects/:id/coordinator/converse` (SSE). Header badge for team mode. Sticky "Skip — paste a brief" link that drops to the legacy textarea. Final step swaps to a Plan Review panel (spec + proposed roster) before Launch. If the endpoint isn't live yet, the chat surface is wrapped in `<DisabledFeature kind="planned">` with the textarea as the active fallback so the page still works. |
| **Modules tab** | Doesn't tell the user that modules are full-privilege code; lets them tap Publish / Community Download as if they worked. | Top banner explaining what modules are and the synthesis stub state. Wrap Publish + Community Download in `<DisabledFeature kind="server-only">`. Mark Synthesis as "Local synthesis (stub)". |
| **Settings — decorative panels** | "Adaptive Router", "HCM Modules", "Integrations", "Security & Compliance", "Audit Log Retention" are local state with no backend. | Adaptive Router & HCM Modules → `<DisabledFeature kind="planned">`. Integrations → redirect link to the Forge → Connectors tab and remove the duplicate. Security & Compliance → split into the four real toggles (outbound prompt warning, API risk approval mapped to `tools.always_require_approval`, secret scanning planned, IP allowlist live). Audit Log Retention becomes the real `audit.retention_days` setting + an Export CSV button + a paginated Audit Log inspector. Add an Appearance section with theme toggle + density. |
| **Stats empty states** | Charts show flat zero lines instead of "no data". | Detect all-zero series and render `EmptyState` with "Eval pipeline not wired yet — see FEATURE_STATUS". |
| **AgentFormFields / AgentConfigDialog / AgentSpawnModal** | Claims skills + connectors, only renders system prompt + tool allowlist. | Add Skills (multi-select of project skills) and Connectors (multi-select of project connectors). On submit, fan out bind/unbind calls. Hide whichever section's backend route doesn't exist yet using `<DisabledFeature kind="planned">`. |
| **CodeVersioning page** | No commit history viewer, no per-file discard, no inline diff, no branch creation, all-or-nothing discard. | Add a `CommitHistoryPanel` (uses `useGitLog`, click → diff via `useGitDiff(ref)`). Per-row "↺" in `GitFileTree` calls `useRestoreGit([path])`. Inline diff view next to HEAD content. "Create branch" dropdown next to `BranchSelector`. PR list page behind `<DisabledFeature kind="planned">` until backend ships merge/comment. |
| **Notification & alert surfacing** | `task.autoDispatched` and `drift.detected` are silent; users miss what the agents are doing. | Wire both into NotificationDropdown + the dashboard ActivityFeed. High-severity drift raises a dismissable TopBar banner. |
| **Empty states & skeletons** | Every page invented its own. | Replace all ad-hoc empty states with the shared `EmptyState`. Replace ad-hoc spinners with `LoadingSkeleton`. |
| **TopBar** | No connection health, no global "backend unreachable" banner, no theme toggle entry point. | Add a `ConnectionStatusPill` (driven by SSE state + a healthcheck query against `/v1/projects` with exponential backoff). Suppress per-query "Failed to fetch" toasts when the pill is red. Add theme toggle. |

## 2. New UI surfaces required by the mega-plan

| Plan ref | Page / component | Behaviour |
|---|---|---|
| A2 | `pages/Settings.tsx` → Data & Privacy | Real `audit.retention_days` control + paginated audit log table (filter actor/action/entity/date) + Export CSV button (downloads `/v1/audit-log?format=csv`). |
| A3 | `pages/Settings.tsx` → Tools & Sandbox | Scope picker: "This project" vs "Global". "Inherit from global" toggle deletes the project override. Writes against `project:<id>` scope when the active project is selected. |
| A7 | `realtime/RealtimeProvider.tsx` (new) | One shared `EventSource`. Exposes `subscribe(eventName, handler)`. `useSse`, `useChatStream`, synthesis listener, agent inbox listener all become `subscribe` calls. Handles the new `sync.required` event → blanket `qc.invalidateQueries()` + a one-line "Reconnecting…" pill in TopBar. |
| A8/A9 | Settings → Tools & Sandbox (extension) | Numeric inputs for `tools.fs_read_max_bytes`, `tools.fs_write_max_bytes`, `tools.shell_exec_*` rlimits, `tools.web_fetch_max_bytes`, `tools.web_fetch_allowed_hosts` textarea, `tools.web_fetch_rate_limit_per_min`. Each control writes the right settings key. |
| B1 | `pages/Onboarding.tsx` → `StepCoordinatorChat` | See §1. |
| B2 | `components/shared/AgentFormFields.tsx`, `pages/Forge.tsx` Skills tab | Skill body markdown editor (new textarea + preview). Bind/unbind UI on the agent dialog. |
| B3 | `pages/Dashboard.tsx` "Active tasks" + `pages/HiveGraph.tsx` | Show "next task to pick up" per agent. Animate wire edges when traffic flows (CSS keyframe on edges currently emitting a `task.autoDispatched` payload that names them). Per-project "Session running / paused" pill in TopBar near the connection pill — controlled by the existing BackgroundSessionCard but visible everywhere. |
| B4 | `pages/SpawnRequests.tsx` (new) | List view of `useSpawnRequests`. Detail drawer shows the state machine (steps with status), generated manifest (JSON viewer), generated handler code (Monaco read-only), Approve/Reject buttons at `awaiting-approval`. Route added to `App.tsx` + entry in HiveSidebar and Command Palette. |
| B5 | `pages/Planning.tsx` Drift tab + Settings → Runtime Behavior | Verify Drift tab shows subject agent, score, action taken, Resume button when paused. New Runtime Behavior section in Settings exposes `runtime.drift_thresholds` (3 sliders with live preview of which response would fire). |
| C1/C2 | `pages/CodeVersioning.tsx`, new `pages/PullRequests.tsx` | See §1. PR page is gated. |
| C4 | new `hooks/useKeyboardShortcuts.ts` + `?` overlay | ⌘1-8 nav, ⌘⇧P pause all, ⌘B toggle file tree, ⌘/ focus file search. Help overlay listing all shortcuts (press `?`). Updates Settings shortcut list to truth. |
| C6 | `components/shared/ErrorBoundary.tsx` (rewrite) | Wrap every `<Route>` (or `<Outlet />`). Stack trace in dev, friendly message + Reload + Copy diagnostics in prod. |
| C7 | `App.tsx` + `vite.config.ts` | Lazy-load every page via `React.lazy`. `manualChunks` for `react`, `recharts`, `monaco`, `reactflow`, `framer-motion`. Suspense fallback uses `LoadingSkeleton`. |
| C8 | `api/queries/*` | `onMutate` optimistic + rollback on `updateTaskStatus`, `setAgentStatus`, `moveTechDebt`, `dismiss/markNotification`, `createNote`, `pause/resume`. |
| C9 | All `console.*` | Replace with `lib/logger.ts` (`if (import.meta.env.DEV)`). |
| C10 | `lib/utils.ts` | `formatDate(iso, mode)`. Sweep every `toLocaleString` / `toLocaleDateString`. |
| C11 | All pages | Theme toggle in Settings → Appearance + TopBar. Sweep `bg-(slate|gray|zinc|neutral|stone)-*` and `text-(black|white)` → tokens (`bg-card`, `bg-surface-1/2`, `text-foreground`, `text-muted-foreground`). |
| C12 | All pages | Sweep: `aria-label` on icon buttons; StatusDot gets a glyph (✓ ! ⏸ ●) layered on the colored dot; `:focus-visible` ring tokenized. |
| C13 | `AppLayout` | Drawer-ify HiveSidebar < 768 px. TopBar compacts. Pages that aren't usable on mobile (HiveGraph, Code) show "Best on desktop — show anyway". |
| C15 | `App.tsx` | Drop `/spec-legacy`, `/modules-legacy`, `/agent-forge-legacy`. Delete `pages/SpecPlan.tsx`, `pages/ModuleDetail.tsx` if unreferenced after the cut. |
| C16 | `pages/Stats.tsx` | All-zero detector → `EmptyState`. |
| D2 | `pages/HiveGraph.tsx` + new `api/locks.ts` | `useSandboxLocks(projectId)` driven Lock Overlay; gated by `<DisabledFeature>` if endpoint absent. |
| D5/D6 | Settings → Data & Privacy | Export project ZIP / Import project ZIP / Factory reset (type-the-word confirmation). All three call existing or planned endpoints; gated where missing. |

## 3. Shared components to add or harden

- `components/shared/EmptyState.tsx` — already exists, ensure: optional icon, title, description, primary action, secondary link. Use it everywhere.
- `components/shared/LoadingSkeleton.tsx` — already exists, add `Skeleton.Row` / `Skeleton.Card` presets used by every list/grid.
- `components/shared/DisabledFeature.tsx` — already exists, accept `kind: 'server' | 'planned' | 'cloud-llm' | 'git-remote' | 'mock'` and render a tooltip explaining the dependency. Replace ad-hoc tooltips across Onboarding, Modules, Settings, Forge.
- `components/shared/ConnectionStatusPill.tsx` (new) — green/yellow/red driven by realtime connection state.
- `components/shared/SessionStatePill.tsx` (new) — running/paused per active project.
- `components/shared/MetadataFooter.tsx` (new) — model · tokens · cost · duration row reused by chat bubbles and agent task views.
- `components/shared/JsonViewer.tsx` (new) — collapsible, truncated-by-default JSON with copy. Used by tool-call args/results and audit-log entry diffs.
- `components/modals/ConfirmDeleteModal.tsx` — already exists, route HiveGraph delete through it.

## 4. Execution order (5 frontend sprints)

**S1 — Foundations (1–2 days work).** RealtimeProvider; ConnectionStatusPill; backend-down banner + toast suppression; ErrorBoundary per route; lazy routes + `manualChunks`; `lib/logger.ts`; `formatDate`; drop `*-legacy` routes; rebuild ChatCentral message rendering (segments + per-message metadata + Stop button + tool validation surface + JsonViewer).

**S2 — Honesty pass.** DisabledFeature sweep across Onboarding (StepCoordinatorChat scaffold + fallback), Modules, Settings (Adaptive Router/HCM/Integrations), Stats empty states, Forge skills section. Replace `window.confirm` in HiveGraph with ConfirmDeleteModal. Two wire styles + legend.

**S3 — Live signals.** Wire `agent.<id>.inbox`, `agent.<id>.status`, `task.autoDispatched`, `drift.detected` through RealtimeProvider into HiveGraph, NotificationDropdown, dashboard ActivityFeed, and the new TopBar drift banner. Optimistic mutations (C8) for pause/resume + task status. SessionStatePill.

**S4 — New pages & deep flows.** SpawnRequests page + route + sidebar entry. CodeVersioning rebuild (commit history, per-file restore, inline diff, branch creation). Audit Log inspector + Export. Settings → Tools & Sandbox per-project scope + safety caps controls. AgentFormFields skills + connectors fan-out. Drift thresholds sliders.

**S5 — Polish.** Theme audit (tokens sweep + toggle). A11y sweep (aria-labels, StatusDot glyphs, focus rings). Mobile drawer + responsive grids + "Best on desktop" stubs. Keyboard shortcuts + `?` overlay. Date format sweep. console.* cleanup. EmptyState/LoadingSkeleton last-mile replacement.

## 5. Verification per sprint

Each sprint ends with: `npm run typecheck && npm run lint && npm run build` clean; a manual click-through of the rebuilt pages against the running backend (or against `<DisabledFeature>` stubs when the endpoint is planned); and a screenshot/QA pass on the rebuilt surfaces at 1280×800 and 390×844.

## 6. Out of scope here

All backend work in Sections A (safety caps, audit retention, attachment cleanup, project-scoped tools, slug ULID, env vars, master-key relocation, broadcast Lag, web_fetch SSRF, CORS env) and Sections B-backend (coordinator converse SSE, agent_skill_bindings migration, autonomous scheduler, spawn pipeline, drift hook, eval tables), plus DX/ops (Docker, LICENSE, CONTRIBUTING, Playwright wiring, codegen, pre-commit). They're already enumerated in `back-end/docs/PHASE_2_TO_5_BACKEND_TODO.md`. The frontend in this plan ships the surfaces; the backend plan ships the endpoints; the two meet at the wire format.
