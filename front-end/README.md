# HIVE frontend

A React + TypeScript single-page app (Vite) — the UI for the HIVE multi-agent
platform: spin up projects, watch and steer the agent graph, chat with agents,
manage the spec/sprint/task plan, build skills/connectors/agents in the Forge,
and configure LLM providers. It talks to the [`back-end`](../back-end) over
HTTP + a single SSE stream. Tooling is plain **npm** (no Bun).

For the product/design picture see [`../docs/architecture.md`](../docs/architecture.md);
for what's done vs planned see [`../docs/FEATURE_STATUS.md`](../docs/FEATURE_STATUS.md).

## Pages

Canonical routes:

| Route | Page | What it is |
|---|---|---|
| `/` | **Projects** | Project list / picker (the app entry point). |
| `/onboarding` | **Onboarding** | New-project wizard: source → resources → connect LLMs → describe → plan review → **launch** (which calls `POST /v1/projects/:id/launch` and shows the real provision-workspace / migrate / probe-search / spec-doc / decompose-plan steps before navigating to the dashboard). |
| `/dashboard` | **Dashboard** | Alerts, active tasks, agent cards, sprint timeline, cost/throughput charts, background-session card. |
| `/hive-graph` | **HiveGraph** | ReactFlow agent graph: wire edges (drag to create, click to delete; cycles rejected) vs dashed spawn-lineage edges; agent detail drawer; spawn modal; status filters/search; pause/resume/delete. |
| `/chat` | **ChatCentral** | Threads grouped by agent in the sidebar; per-message model override; file attachments; slash commands (`/help`, `/clear`, `/new`, `/model`, `/compact`); `@mention` routing. |
| `/code` | **CodeVersioning** | Real git working tree from the project repo: status, file viewer (`git show`), commit, checkout, discard. |
| `/planning` | **Planning** | Spec docs (+ "Decompose Spec" → `auto-decompose`), Skill Sprint (+ add manual task), Tech Debt board, Hive Mind notes, Drift. |
| `/forge` | **Forge** | Skills (create/delete), Modules, Connectors (create HTTP-API/MCP, delete), Agents (the custom builder + Blueprints) — `?tab=` selects the tab. |
| `/stats` | **Stats** | Agent/project metrics, runtime feed, eval leaderboard, session replay; project-metrics tab has a working CSV export. |
| `/settings` | **Settings** | LLM Providers (encrypted keys, base URLs, connection tests), Default Model, GitHub Sync, Tools & Sandbox, Data & Privacy — plus several preview-only panels (Adaptive Router, HCM Modules, Integrations, Security, keyboard shortcuts) that don't yet affect backend behaviour. |
| `/session-history` | **SessionHistory** | Past sessions and outcomes. |

`/insights → /stats`, `/spec → /planning`, `/modules → /forge?tab=modules`,
`/agent-forge → /forge?tab=agents` are redirects. The old `SpecPlan`, `Modules`,
`ModuleDetail`, and `AgentForge` page components are still mounted at `*-legacy`
routes pending removal (`AgentForge` is also lazy-loaded *inside* the Forge
"Agents" tab) — prefer the canonical pages. The Command Palette (`⌘K`) does
fuzzy-matched navigation + a few action commands.

## Tech stack

React 18 + TypeScript · Vite 5 (`@vitejs/plugin-react-swc`) · npm · Tailwind CSS +
shadcn/ui (Radix primitives) · TanStack Query · ReactFlow (HiveGraph) ·
Monaco (file viewer) · Recharts (dashboards) · `cmdk` (command palette) ·
Server-Sent Events for live updates · Vitest (Playwright is a devDependency but
not wired to an npm script) · ESLint.

## Develop

```bash
npm install          # (or `npm install` at the repo root — installs both halves)
cp .env.example .env # set VITE_API_BASE_URL if the backend isn't on 127.0.0.1:8787
npm run dev          # Vite dev server on http://localhost:8080  (expects the backend running)

npm run build        # production build into dist/   (repo-root `npm run build` also runs scripts/sync-dist.mjs)
npm run build:dev    # build with mode=development
npm run preview      # preview the production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit -p tsconfig.app.json
npm run test         # Vitest (one-shot)   ·   npm run test:watch
```

`VITE_API_BASE_URL` (default `http://127.0.0.1:8787`) is the only env var — the
backend's HTTP + SSE base URL.

## Project structure

```
src/
├── api/                 # backend access
│   ├── client.ts        # fetch wrapper, base URL, eventStreamUrl() helper
│   ├── generated.ts     # hand-maintained TS mirror of the OpenAPI schemas (NOT codegen — keep in sync by hand)
│   ├── agents.ts chat.ts git.ts llm.ts connectors.ts skills.ts spec-documents.ts drift.ts tools.ts …   # per-domain hooks
│   └── queries/          # cross-cutting hooks: useHiveData (project/agents/tasks/alerts/session + mutations), useServerData (insights/seed-backed)
├── components/
│   ├── layout/           # AppLayout, TopBar, HiveSidebar, per-page panels (dashboard/, code-versioning/, …)
│   ├── modals/           # AgentSpawnModal, AgentConfigDialog, LoopDetectionModal, PublishModuleDialog, CodeViewerDialog, …
│   ├── shared/           # AgentFormFields (the one agent form, used by the spawn modal + config dialog + Forge builder), ModelPicker, DisabledFeature (tooltip+badge for parked features), EmptyState, StatusDot, badges, …
│   └── ui/               # shadcn/ui primitives
├── context/              # WorkspaceContext (active project, onboarding draft, default model, …)
├── hooks/                # useToast, useMobile
├── lib/                  # utils
├── pages/                # one component per route (above)
├── realtime/             # useSse — subscribes to /v1/events and invalidates TanStack Query keys per event name; useChatStream lives in api/chat.ts
└── types/                # domain.ts — re-exports `components['schemas'][...]` from generated.ts
```

## Backend access

- **`api/client.ts`** — `api<T>(path, init?)` (throws `ApiError` on non-2xx), `API_BASE_URL`, `eventStreamUrl(path)`.
- **Per-domain hooks** in `api/*.ts` (queries + mutations, TanStack Query).
- **Cross-cutting** in `api/queries/`: `useHiveData()` (the everything-about-the-active-project hook + its mutations — `addProject`, `setActiveProject`, `createTask`, `updateTaskStatus`, `setAgentStatus`, …) and `useServerData()` (insights timelines, seed-backed activity/spend/throughput/blueprints/modules).
- **Realtime**: `useSse()` opens one `EventSource('/v1/events')` and, for each event name, invalidates the relevant query keys (see the `EVENT_MAP` in `realtime/useSse.ts`). `useChatStream(threadId)` (in `api/chat.ts`) accumulates `chat.<id>.token` deltas + tool-call events into a per-message streaming state and refetches the thread on `complete`/`cancelled`/`error`/`message`.
- **LLM providers**: `useLlmProviders()` / `useProviderModels(id)` / `useSetProviderKey()` / `useTestProvider()` (in `api/llm.ts`); `<ModelPicker />` (cascading provider → model, auto-selects the first connected provider, empty state when none).
- **Types**: `api/generated.ts` mirrors the OpenAPI schemas by hand (`sonar-project.properties` excludes it from analysis); re-exported via `types/domain.ts`. Update it when the API changes.

## Conventions

TypeScript for all code; keep components focused and lift shared logic into
hooks; reuse `<AgentFormFields>` / `<ModelPicker>` / `<DisabledFeature>` / the
shadcn `ui/` primitives rather than re-rolling them; run `npm run typecheck` and
`npm run lint` before committing. New `pages/*` get a route in `src/App.tsx`.

## License

MIT.
