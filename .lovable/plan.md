

# HIVE v6 — Gap Analysis & Polish Plan

## What's Missing

### 1. Global State — Nothing is Connected
Every page manages its own isolated `useState`. The TopBar session state (pause/resume), budget, health score, and agent statuses don't sync across pages. Changing something on Dashboard has zero effect on TopBar or Hive Graph.

**Fix**: Create a React Context provider (`HiveContext`) that holds session state, agents, tasks, alerts, and budget. All pages read/write from this shared store. Pausing a session in TopBar pauses agents everywhere. Dismissing an alert on Dashboard removes it from notifications.

### 2. Missing Modals & Overlays (Spec'd but Not Built)
- **Wake Report Modal** — "View Wake Report" button on Dashboard `BackgroundSessionCard` just navigates to `/dashboard` (does nothing)
- **Pre-Session Cost Forecast Modal** — no way to see estimated costs before starting a session
- **Budget Extension Dialog** — "Extend Budget" alert action just shows a toast, no actual dialog with amount input
- **Loop Detection Alert Modal** — "Intervene" action just toasts, no modal showing the loop details
- **Outbound Prompt Warning** — referenced in Settings but no actual modal exists
- **API Risk Approval Drawer** — referenced in Settings but never built
- **Blocked Agent Alert** — no detailed view when clicking a blocked agent
- **Agent Spawn Dialog** — "Spawn Agent" button in Hive Graph has no dialog for configuring the new agent
- **Delete/Dangerous Action Confirmations** — "Delete All Data" in Settings has no confirmation dialog

### 3. Broken or Non-Functional Buttons
- **Projects page**: clicking any project always goes to `/dashboard` — no project selection/context
- **Onboarding wizard**: Step selections (scratch/template/import) don't persist across steps; budget slider values don't carry forward; "Interview Mode" chat in Step 3 is static; Plan Review step has no actual launch countdown
- **Settings**: Every toggle/switch/slider uses `defaultChecked`/`defaultValue` — changes aren't saved anywhere, refreshing loses everything
- **Settings > Appearance**: Theme toggle (Dark/Light/System) does nothing; accent color picker does nothing
- **Settings > File Protection**: "Add protected file" button does nothing; delete buttons have no confirmation
- **Settings > Integrations**: "Connect" buttons do nothing
- **Settings > Data & Privacy**: "Export" and "Delete" buttons do nothing
- **Code & Versioning**: File tree clicks don't load file content; PR list items aren't clickable; diff accept/reject buttons are missing
- **Insights > Session Replay**: Play/pause/speed controls are non-functional; scrubber doesn't work
- **Insights > Tech Debt**: Kanban cards aren't draggable
- **Insights > Hive Mind**: No way to add new notes
- **Spec & Plan > Sprint Plan**: No drag-to-reorder
- **Spec & Plan > Implementation Status**: No kanban view toggle (only table)
- **Chat Central**: File attachment button does nothing; @-mention doesn't actually filter agents; no real message sending feedback
- **Hive Graph**: Right-click context menu not implemented; double-click to message not implemented; "Lock Overlay" toggle shows nothing; agent search doesn't highlight/focus matched nodes
- **Command Palette**: No preview pane for selected items; selecting an agent doesn't open their detail drawer

### 4. Missing Pages & Features
- **Agent Forge** — referenced in spec, not built at all (conversation-based agent creation, Blueprint widget cards, DNA Viewer/Editor modal)
- **Module Marketplace** — Modules page has basic cards but no detail page, no publishing flow, no install confirmation dialog
- **LLM Router Dashboard** — Settings has a basic routing table but no bandit learning charts, reward/penalty feed, or interactive router visualization
- **User Profile / Account page** — no way to manage user info
- **Session History page** — no way to view past sessions (only current)

### 5. Visual Polish Issues
- **No loading states** — pages render instantly with no shimmer skeletons or loading indicators
- **No empty states** — if data were removed, pages would show blank space with no guidance
- **No error states** — no error boundaries or friendly error messages
- **No page transitions** — navigating between pages has no animation (just instant swap)
- **Notification dropdown**: clicking action buttons (Extend Budget, Intervene, Review) just toasts — doesn't navigate or open relevant modals
- **TopBar health ring and budget bar** are hardcoded values that never update
- **Sidebar has no collapse/expand** — it's always 48px with no way to see labels
- **No mobile/responsive layout** — sidebar and 5-column grid break on small screens
- **Dashboard summary tiles**: sub-text is hardcoded strings, not computed from actual data
- **Fonts**: Inter and JetBrains Mono may not be loading (not imported in index.html or CSS)

### 6. Mock Data Gaps
- No mock data for: session history, past wake reports, Langfuse trace details, Hive Mind notes content, PR diff content, file contents for code viewer, module detail pages, agent creation templates
- Activity feed items aren't tied to actual agent/task state
- Notification actions don't correlate with dashboard alerts

---

## Implementation Plan

### Phase A: Shared State Foundation
- Create `HiveContext` with providers for: session, agents, tasks, alerts, budget, notifications
- Migrate TopBar, Dashboard, HiveGraph, ChatCentral, Notifications to use shared context
- Session pause/resume syncs everywhere; alert dismissals sync; budget updates sync

### Phase B: Wire Up All Broken Buttons
- **Projects**: Add project selection context; clicking a project sets active project in context
- **Onboarding**: Wire step state forwarding; make budget/model selections persist; add launch countdown animation
- **Settings**: Convert all controls to controlled components with state; add toast confirmations for saves; make theme/accent toggles actually work (CSS variable swaps)
- **Code & Versioning**: Make file tree clicks show file content; make PRs clickable with detail view; add accept/reject to diff chunks
- **Chat Central**: Wire file attachment with a mock file picker; implement @-mention autocomplete dropdown; add typing indicator after sending
- **Hive Graph**: Implement right-click context menu; double-click opens chat with agent; search highlights/focuses nodes; lock overlay renders DLM lock indicators on nodes
- **Insights**: Wire replay controls; make tech debt cards draggable; add "New Note" to Hive Mind

### Phase C: Build Missing Modals
- Wake Report Modal (gate status, cost summary, tasks completed, approve/reject/rollback)
- Budget Extension Dialog (amount input, new limit preview)
- Agent Spawn Dialog (name, role, model selection, sovereignty tier)
- Confirmation dialogs for dangerous actions (delete data, deprecate agent, disconnect integration)
- Pre-Session Cost Forecast Modal

### Phase D: Missing Pages
- Agent Forge page (or section in Chat Central) with Blueprint cards and DNA Viewer modal
- Module detail page with install flow, dependency list, layer viewer
- Session History page accessible from Dashboard

### Phase E: Visual Polish
- Add Google Fonts import for Inter + JetBrains Mono to `index.html`
- Shimmer loading skeletons for each page section
- Empty state illustrations with CTAs for every list/grid
- Error boundary component with friendly messaging
- Page transition animations (fade + slide)
- Responsive breakpoints: stack sidebar on mobile, 2-col grid on tablet, 1-col on phone
- Sidebar collapse/expand with labels on hover or expanded state
- Compute summary tile values from actual mock data instead of hardcoded strings

### Phase F: Expanded Mock Data
- Session history (3-5 past sessions with timestamps, costs, agent counts)
- File contents for code viewer (realistic code snippets)
- PR diff content (actual diff hunks)
- Hive Mind notes with markdown content
- Module detail data (dependencies, changelogs, screenshots)
- Agent templates for Agent Forge

---

## Technical Approach
- `HiveContext` as a single React Context with `useReducer` for predictable state updates
- All modals built with shadcn `Dialog` / `Drawer` components
- Page transitions via `framer-motion` `AnimatePresence` wrapping `<Outlet />`
- Loading skeletons using shadcn `Skeleton` component
- Responsive layout using Tailwind breakpoints (`sm:`, `md:`, `lg:`)
- Controlled form components in Settings with local state + toast on change

