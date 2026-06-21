# HIVE — Unified Backlog & Audit Register

> **Single source of truth for outstanding bugs, security holes, debt, and
> missing tests.** This file unifies every audit HIVE has accumulated into one
> deduplicated, code-verified register. Forward *feature* plans live in
> [`ROADMAP.md`](ROADMAP.md); shipped-vs-not status lives in
> [`FEATURE_STATUS.md`](FEATURE_STATUS.md); how the built parts work lives in
> [`architecture.md`](architecture.md). Start at [`README.md`](README.md) (the docs index).

**Last consolidation:** 2026-06-16
**Canonical audit:** the 2026-06-15 exhaustive multi-agent audit (C-IDs), verified
file-by-file in [`AUDIT_VERIFICATION.md`](../../AUDIT_VERIFICATION.md). Full
per-finding evidence (file:line, votes, suggested fix) lives in
[`MASTER_AUDIT_REPORT.md`](../../audit-out/MASTER_AUDIT_REPORT.md).

---

## 0. How this document is organised

Three separate audits were run over HIVE's life. They used **different ID
schemes for the same defects**, which is the root of the doc-rot this file
fixes:

| Scheme | Source | Date | Status |
|---|---|---|---|
| **A.1–A.36** | `HANDOFF_ISSUES.md` (now archived) | 2026-04-16 + 2026-05-25 | folded in below |
| **Z1–Z20 / ZZ1–ZZ81** | this file's former §Z/§ZZ | 2026-05-25 / 2026-05-27 | folded in below |
| **C001–C545** | `MASTER_AUDIT_REPORT.md` | 2026-06-15 | **canonical** |

The C-ID audit is the newest, the most rigorous (multi-agent, adversarially
verified), and the only one checked file-by-file against current code
(`AUDIT_VERIFICATION.md`, 2026-06-15). **It is the canonical scheme.** Where a
C-ID finding has an older A./Z/ZZ equivalent, that provenance is shown in the
*Legacy* column so historical references still resolve.

**Status legend**

- `OPEN` — present in current `main`, verified 2026-06-15.
- `OPEN (fix unmerged)` — a fix exists on a branch/PR but is not yet on `main`.
- `FIXED` — landed on `main` (see §6 fix log for the commit).
- `MITIGATED` — partially addressed; a narrower follow-up remains (cross-ref given).

**Severity** follows the audit: 🔴 critical · 🟠 high · 🟡 medium · 🟢 low.

> **De-duplication note.** The raw audit lists 218 confirmed findings, but
> `AUDIT_VERIFICATION.md` establishes that ~36 are the *same* endpoint flagged
> by different reviewer lenses and the 11-vote `Modules.tsx` EventSource cluster
> is a *single* defect. The **true unique-defect count is ~140.** This register
> lists the unique defects; duplicate C-IDs are noted inline so vote provenance
> survives.

---

## 1. Status snapshot

| Severity | Confirmed (audit) | Unique defects | OPEN | Fixed (on `main`) |
|---|---:|---:|---:|---:|
| 🔴 Critical | 29 | 18 | ~14 | 3 (C026/C074, C092, C202/C203) |
| 🟠 High | 150 | ~95 | ~92 | C094, C201/C204 + see §6 |
| 🟡 Medium | 39 | ~27 | ~27 | — |
| 🟢 Low | 0 | — | — | — |
| **Total** | **218** | **~140** | **~133** | — |

> Counts are approximate because the audit-coverage findings (missing
> `audit::append`) collapse to one middleware fix, and the test-coverage
> findings collapse to "stand up the suites." See §3.3 and §3.5.
>
> **2026-06-20 merge batch:** PRs #13–#18 landed on `main` (C026/C074, C092,
> C094, C201/C204, C202/C203 + the LLM tool-calling cluster) and backend CI is
> green again (fmt/audit). See §6.

**Verification verdict distribution** (from `AUDIT_VERIFICATION.md`, 218 findings):
115 CONFIRMED · 36 CONFIRMED-duplicate · 1 CONFIRMED-worse-than-stated (C402) ·
4 PARTIALLY-TRUE · 1 FALSIFIED (C471) · 61 not-deep-verified (test-gap cluster,
already true at directory level). **No finding was a hallucination.**

---

## 2. Fix-first order (do these in sequence)

This supersedes every earlier "next-sprint order". Ranked by blast-radius ×
ease, reconciled with the verification report's "what I'd ship first":

1. ~~**C026 / C074 — tool-allowlist kill-switch**~~ ✅ **DONE (PR #15)**. The
   operator's "disable shell_exec project-wide" now narrows per-agent loadouts. → §3.1
2. **C312 cluster / C477 — `Modules.tsx` duplicate EventSource** (~30 lines, one
   file). One bug away from app-wide freeze. → §4.1
3. **C169–C188 — `web_fetch` SSRF on hostname redirect / DNS rebinding**
   (`web.rs:129`). Source comment already admits the hole. → §3.2
4. ~~**C202 / C203 / C201 — Gemini provider**~~ ✅ **DONE (PR #16)** (key in URL,
   model-name injection, null `generationConfig`). → §3.2 / §3.4
5. **C247 / C256 — master-key hygiene** (no zeroize; Windows ACL). → §3.2
6. ~~**C092 — `DeleteAgent` `let _ =` executor swallow**~~ ✅ **DONE (PR #18)** (`agent_tools.rs:553`). → §3.4
7. **C543 — bump `vitest` to ≥3.2.6** (CVE, one line). → §4.4
8. **C402 — `useFormField` null-ref** (5 lines, real crash). → §4.1
9. **Audit middleware** — collapses the entire C001–C056 + medium batch into one
   fix. → §3.3
10. **Test foundation** — central hooks, realtime layer, backend state-machines,
    budget, SSRF, git parsing. → §3.5 / §4.5

---

## 3. Backend findings

### 3.1 🔴 Critical — security & correctness

| ID | Legacy | file:line | Defect | Status |
|---|---|---|---|---|
| **C026 / C074** | A.9, Z9 | `hive-api/src/main.rs:1508` | `effective_tool_names` returns `per_agent.to_vec()` directly when non-empty — **no intersection** with the global allowlist, so a per-agent loadout bypasses the operator kill-switch. Comment at 1528-1531 confirms it's intentional for the Coordinator. | **✅ RESOLVED** — PR #15 (merged): intersection + `is_authority_tool` carve-out so role-gated coordination tools still reach the Coordinator. |
| **C087** | — | `hive-runtime/src/spawn/llm_deps.rs:114` | Research-API whitelist uses `picked.url.contains(d)` — raw substring. `http://api.github.com.evil.com` passes; the unapproved-MCP approval gate is bypassable. | **OPEN** |
| **C092** | A.7, Z2 | `hive-runtime/src/agent_tools.rs:553` | `DeleteAgent` tool: `cancel_subtree` result dropped, `let _ = terminate`, `let _ = set_status`, returns `Ok`. A `NotFound` silently desyncs DB ↔ ExecutorRegistry while reporting success. | **✅ RESOLVED** — PR #18 (merged): tolerate `NotFound` on terminate (warn otherwise), propagate `set_status` failure via `?`. |
| **C186** | A.30 | `hive-tools/src/builtins/edit.rs:114` | `str_replace` binds the sandbox lock to `let _lock` then never references it. *Verification: the audit's "drops at end of map" mechanism is **wrong** (Rust extends the binding to end of block); the real issue is the unused `_`-style binding and lock-overlay visibility.* | **OPEN** (severity ↓; smell, not race) |
| **C202 / C203** | — | `hive-llm/src/providers/gemini.rs:222,242,311` | Gemini API key embedded as `?key={}` in all three method URLs — leaks into proxy/access logs and history. (C203: model id interpolated unencoded into the path.) | **✅ RESOLVED** — PR #16 (merged): key moved to `x-goog-api-key` header; model id `urlencoding::encode`d. |
| **C247** | ZZ18 | `hive-crypto/src/lib.rs:60` | Master key built as `Vec<u8>` across three paths and dropped without zeroize — the root secret lingers in heap, recoverable from a core dump / same-uid `/proc/pid/mem`. | **OPEN** |
| **C191** | A.1 | `hive-tools/src/builtins/web.rs:129` | The SSRF redirect policy (5-hop cap, http(s)-only, private-IP-literal reject) is **completely untested**; source comment admits the DNS-rebinding window (ZZ8) is uncovered. | **OPEN** (test gap) |

**Fixes.** C026/C074: `per_agent.iter().filter(|t| global.contains(t)).collect()`.
C087: parse with `url::Url`, suffix-match the host. C092: propagate via
`map_err`/`?`. C186: bind the guard to a named var referenced past the write.
C202: send `x-goog-api-key` header. C247: `zeroize::Zeroizing<Vec<u8>>`.

### 3.2 🟠 High — security (SSRF, traversal, injection, key hygiene)

| ID | Legacy | file:line | Defect | Status |
|---|---|---|---|---|
| **C169/C171/C173/C184/C188** | A.1, Z3, ZZ8 | `hive-tools/src/builtins/web.rs:129-184` | Redirect policy validates **only IP literals**; a hostname redirect resolving to `127.0.0.1`/`169.254.169.254` passes to reqwest's own DNS unchecked. Source comment confesses ZZ8. | **MITIGATED** (IP-literal hops blocked, batch 1; hostname/DNS-rebind still **OPEN**) |
| **C088** | — | `hive-runtime/src/chat.rs:893` | Chat-attachment **read** path joins `storage_path` with no canonicalize/bounds check (the download endpoint has the check; the read path doesn't). | **OPEN** |
| **C251** | — | `hive-git/src/lib.rs:123` | `Command::new("git").args(args)` blocks shell injection but not **git-option** injection (`checkout("--git-dir=/tmp/evil")`). | **OPEN** |
| **C256** | ZZ20 | `hive-crypto/src/lib.rs:193` | Windows master-key file written with default ACL; any local user on a shared host can read it. Only a `warn!` mitigates today. | **OPEN** |
| **C261** | — | `hive-sandbox/src/local.rs:424` | `exec()` runs **any** binary (`curl`, `nc`, `socat`); `check_path_allowed` filters file paths, not the command. | **OPEN** |
| **C151** | — | `hive-db/src/db.rs:77` | `repair_renamed_migrations` builds SQL via `format!` + `execute_unprepared` — safe today (compile-time const) but a latent injection precedent. | **OPEN** (latent) |
| **C203** | — | `hive-llm/src/providers/gemini.rs:241` | `request.model` interpolated into the URL path unencoded (lines 244, 313). | **OPEN** |
| **C134/C135/C136/C137/C140** | A.6 | `hive-db/src/repos/{agents,projects,connectors,llm_providers}.rs` | Repo-layer mutations (`update`/`set_status`/`set_connected`) change tools/status/credentials with **no audit** and **no allowlist validation**; direct callers (e.g. `seed.rs`) bypass handler-level checks. | **OPEN** |

### 3.3 🟠 High + 🟡 Medium — audit-coverage gap (one root cause)

**~30 state-changing endpoints write DB state without `audit::append`**, breaking
the "every mutation is auditable" guarantee. Verification grep found only **14**
`audit::append` sites in the 8.5k-line `main.rs`.

- **High batch:** C001 `send_chat_message`, C002 `create_chat_thread`, C003/C032
  `delete_chat_thread`, C004 `cancel_chat_message`, C048 `update_settings`, C051
  `toggle_project_session`, C052/C077 `create_agent_wire`, C053/C078
  `delete_agent_wire`, C056 `dispatch_to_agent`, C076 `cancel_agent_subtree`,
  C095 `DeleteAgent` tool, C008/C027 `delete_skill`, C010/C028 `delete_connector`,
  C025/C038 `update_skill`, C029 `create_connector`, C031 `delete_chat_attachment`,
  C034 `delete_note`, C035 `delete_tech_debt_item`, C040 `update_note`, C044
  `update_assignment`, C045 `update_drift_event_status`, C046 `create_spawn_request`,
  C050 `update_spec_document_markdown`, C015/C042 `move_tech_debt_item`.
- **Medium batch:** C005/C006 chat attachments, C007/C037 `create_skill`, C009
  `create_connector`, C011/C049 `create_spec_document`, C012/C039 `create_note`,
  C016/C041 `update_tech_debt_item`, C017 `delete_tech_debt_item`, C018/C019 wires,
  C020/C036 skill bindings, C022 `create_git_branch`, C023/C030
  `update_connector_status`, C024 `ensure_coordinator_inline`, C043
  `create_assignment`, C047 `update_spawn_request`.

**Legacy:** A.6, A.20, Z8 (partial — `pause/resume/terminate_agent` and
`set_agent_status` already audit, batch 2). **Status: OPEN.**
**Single fix:** a `ctx.mutation(entity, id, op, before, after, |db| …)` helper (or
tower middleware) that wraps audit + broadcast — collapses all ~40 findings.
Tracked historically as HANDOFF §4.5.

### 3.4 🟠 High — silent failures & provider correctness

| ID | Legacy | file:line | Defect | Status |
|---|---|---|---|---|
| **C094** | A.5, A.10, Z1, ZZ16 | `hive-runtime/src/drift_hook.rs:202` | Drift auto-pause: DB pause (203) and executor pause (217) are independent best-effort blocks — either can fail leaving DB ↔ executor split-brain. | **✅ MITIGATED** — PR #13 (merged): chat-path pause gate + drift-hook `ensure`-before-pause. Full two-write atomicity (ZZ16) still open. |
| **C141** | HANDOFF 3.4 | `hive-db/src/seed.rs:15` | `json_value()` `.expect()`s on parse — corrupt seed JSON hard-crashes boot. | **OPEN** |
| **C201/C204** | — | `hive-llm/src/providers/gemini.rs:122,150` | When temp+max_tokens both `None`, `generationConfig` is never created, then line 150 mutates `["generationConfig"]["candidateCount"]` on a `Null` → invalid streaming request. | **✅ RESOLVED** — PR #16 (merged): `generationConfig` materialised as an object when streaming (`!generation.is_empty() \|\| stream`). |
| **C211** | — | `hive-llm/src/lib.rs:284` | `client_for` `.expect("reqwest client builds")` and returns a non-`Result` — a build failure panics provider init. | **OPEN** |
| **C218** | — | `hive-llm/src/providers/anthropic.rs:280` | Tool-blocks `HashMap` never cleared on a truncated stream (unmatched `content_block_start`). | **OPEN** |

### 3.5 🟠 High — performance & test coverage

**Performance (N+1 & oversized):** C060 `list_projects` (1+2N), C061
`export_project` (1+N), C102 chat-attachments history loop, C143
`agents::ancestors` (query/level), C144 `agents::descendants` (BFS/level), C106
`run_turn_inner` (~784 LOC monolith). **Fix:** batch queries / recursive CTE;
split `run_turn_inner` into setup/reserve/loop/finalize. **Status: OPEN.**

**Concurrency:** C168 `todo.rs:53` `save_state` writes without a sandbox lock
(unlike `fs_write`/`str_replace`) — lost-update race + no overlay visibility.
Legacy A.30. **Status: OPEN.**

**Test coverage (backend, ~30 paths — all confirmed gaps).** Critical untested
paths: executor/registry state machine (C118, C119), agent tools (C120), drift
hook integration (C122, legacy A.5), Z10 budget reservation (C125), `agents`
tree-walk (C152), wire cycle detection (C153), cost reservation→final (C155),
**the entire `hive-git` crate — 521 LOC, zero tests** (C295–C298), SSRF guard +
extractor (C192, C193), `shell_exec` path protection (C194), sandbox
symlink-escape regression (C299), SSE UTF-8 boundary (C246, legacy ZZ25), LLM
client factory + aggregation (C235, C243), domain `FromStr` parsers (C286, C287,
C294), 34 repo files with zero inline tests (C165, *partially overstated —
`agents.rs` has tests*). **Fix:** stand up `#[cfg(test)]` per crate; prioritise
state-machine / allowlist / budget / SSRF / git-parsing. **Status: OPEN.**

**Code quality:** C187 `fresh_sandbox()` test helper duplicated across
fs/edit/meta/shell with inconsistent timestamp generation. **Status: OPEN.**

---

## 4. Frontend findings

### 4.1 🔴 Critical

| ID | Legacy | file:line | Defect | Status |
|---|---|---|---|---|
| **C312 cluster / C477** (11 votes) | A.2, Z4, ZZ72 | `front-end/src/pages/Modules.tsx:73` + `api/client.ts:75` | Page opens its **own** `EventSource` per `jobId`, bypassing the `RealtimeProvider` singleton — exhausts the browser's 6-conn/origin cap and freezes navigation. The `eventStreamUrl` export (C477) enables it. *One defect, not eleven.* | **OPEN** |
| **C402 / C393** | — | `front-end/src/components/ui/form.tsx:35` | `useFormField` reads `fieldContext.name` (line 40) before the null check (42), and `itemContext.id` (46) with **no check at all** — a real crash. *Verification: worse than the audit stated.* | **OPEN** |
| **C478** | — | `front-end/src/api/queries/useServerData.ts:24` | Settings PATCH `JSON.stringify({ settings })` ships the entire `SettingsState`, including secret-bearing fields (`tavilyApiKey`), in plaintext. *(Verification re-rated → high, not critical.)* | **OPEN** |
| **C543** | — | `front-end/package.json:94` | `vitest 3.2.4` — GHSA-5xrq-8626-4rwp (CVSS 9.8, arbitrary file read/exec) affects <3.2.6. | **OPEN** (one-line bump) |
| **C361/C400/C531/C532/C533** | — | `front-end/src` | Near-zero tests: 19 pages, ~47 UI components, `useHiveData`, `RealtimeProvider`, and `useSse` all untested; the only test asserts `expect(true).toBe(true)` (C538). | **OPEN** (see §4.5) |

**Fix (C312):** replace the inline `EventSource` with
`useRealtime().subscribe('synthesis.${jobId}.progress' | '.complete' | '.error', …)`
(handlers already exist in `useSse.ts`); cap the progress array `.slice(-200)`;
remove/JSDoc-restrict the `eventStreamUrl` export.

### 4.2 🟠 High — React correctness, a11y, credentials

**React correctness:** C313 `Onboarding.tsx:203` setTimeout-navigate with no
cleanup (legacy ZZ75), C316 `ChatCentral.tsx:451` thread-creation race, C371
`carousel.tsx:91` `reInit` listener leak, C508 `use-toast.ts:167` `[state]` dep
re-registers listener, C354 `StepCoordinatorChat.tsx:223` missing dep, C356
`HiveGraph.tsx:398` unsafe non-null assertion. *(C471 `RealtimeProvider`
useRealtimeEvent dep — **FALSIFIED** by verification: the `handlerRef` pattern is
correct. Do not "fix" it.)*

**Accessibility (WCAG 2.1 AA):** C414/C320/C326 hover-only controls hidden from
keyboard (`opacity-0`, no `focus:`), C322 `AgentDetailDrawer` no focus trap, C327
`Forge` modal missing `aria-labelledby`, C328 `SpecPlan` drag cards no keyboard
path, C378 `ToastViewport` no `aria-live`, C511/C512 `GitFileTree` clickable div
+ unlabeled icon button, C513/C514 dashboard `motion.div onClick` no role, C515
`CodeViewerDialog` `dangerouslySetInnerHTML` links. **Shared fix:** clickable
`div`→`button` (or `role`/`tabIndex`/`onKeyDown`/`aria-label`);
`focus:opacity-100`; Radix dialog primitives for focus-trap; `aria-live` on
toasts. **Status: OPEN.**

**Credentials & unsafe URLs:** C337/C338/C339 API keys/PATs in React state with
no unmount/error clear, C480 `chat.ts:308` unencoded `threadId`/`projectId` in
paths & SSE names, C481 `useServerData.ts:128` missing `encodeURIComponent`, C482
`llm.ts:68` provider key transmitted plaintext. **Shared fix:** `useRef` (not
state) for secret inputs + cleanup; `encodeURIComponent` every dynamic segment
(`git.ts` already does this correctly). **Status: OPEN.**

### 4.3 🟠 High — performance

C342 `ChatCentral.tsx:805` unbounded animated message list (no virtualization),
C347 `HiveGraph.tsx:121` `AgentNode` not `React.memo`'d, C422 `TopBar.tsx:27`
`resolveRouteName` O(n log n)/render, C423 `CommandPalette.tsx:183` O(n²)
`findIndex` in render, C424 `NotificationDropdown.tsx:42` sync
`getBoundingClientRect` (layout thrash), C524 `useHiveData.ts:113` 9-key
invalidation per mutation, **C411/C429/C486 `BackendDownBanner.tsx:47` keyless
`invalidateQueries()` nukes the whole cache** (legacy A.36). **Fix:** virtualize
(`react-window`); `React.memo`; memoize derived names; precompute index `Map`;
`requestAnimationFrame` for layout reads; scope every invalidate. **Status: OPEN.**

### 4.4 🟠 High — type-safety & dependencies

C394 `input-otp.tsx:28` missing null check on OTP context, C428
`ModelPicker.tsx:110` unsafe `as Error` cast, C492 `useServerData.ts:284` dead
duplicate `useAgentMessagesData` typed `any[]`. **Deps:** C544 `esbuild 0.21.5`
(via vite 5.4.19) dev-server CORS bypass, C545 `esbuild 0.25.0` (via
lovable-tagger) advisory (verifier: CVSS 8.1, Deno-binary vector). **Status: OPEN.**

### 4.5 🟠 High — frontend test coverage

All confirmed at directory level (only `src/test/example.test.ts` exists, and it
is tautological — C538). Highest-value targets: deletion/mutation flows on
`Projects`/`ChatCentral` (C362, C363), `SidebarProvider` + Cmd/Ctrl+B (C401,
C406), `ChartStyle` XSS sanitization (C408), `CommandPalette` fuzzy/keyboard
(C443, C444), `ErrorBoundary` (C454, C455), `RealtimeProvider`+`useSse`+chat
integration (C498, C499, C506), `api()` error/`requestId` paths (C501, C537).
**Status: OPEN.**

### 4.6 🟡 Medium

C318 non-semantic clickable card (`AgentForge.tsx:165`), C345 triple-filter in
`SpecPlan` kanban, C355 incomplete `ensureProjectForChat` deps
(`Onboarding.tsx:213`, legacy ZZ75), C377 `PaginationLink` raw anchor (unused),
C410 carousel keyboard untested (unused), C445 `CommandPalette` activate untested,
C521 `WorkspaceContext` localStorage no sensitivity safelist, C534 `mergeSettings`
array-merge bug (dead code). **Status: OPEN.**

---

## 5. Infra

| ID | file:line | Defect | Status |
|---|---|---|---|
| **C477** | `front-end/src/api/client.ts:75` | The exported bare `eventStreamUrl()` is what lets `Modules.tsx` open a second `EventSource`, violating the singleton architecture. Same root as C312. | **OPEN** |

---

## 6. Resolved — fix log (historical)

Reverse-chronological. These landed on `main`; the newer C-audit does **not**
re-flag them as broken (where it cites the same file it only flags a *test* gap).

**Durable-execution migration (2026-06-21)** — extends the `WorkflowBackend`
seam (built for the B4 spawn pipeline, PRs #26/#27) to a **second** job family,
proving the abstraction generalizes:
- Generalized `WorkflowService`/`WorkflowBackend` from a spawn-pipeline-specific
  API to a typed `WorkflowJob` dispatcher (`SpawnPipeline` | `DriftRemediation`),
  with namespaced dedup keys and a merged two-channel consumer loop.
- **Drift auto-remediation** (W3-B5 ≥0.9 pause) now routes through the seam:
  the drift hook submits the `drift_events` id instead of pausing inline, and
  `execute_drift_remediation` performs the same two-layer pause (DB + executor)
  exactly-once / crash-durably. Inline fallback preserved when no sender is
  wired or the Restate submit fails (safety must not depend on Restate).
- Feature-gated `DriftRemediationWorkflow` added alongside `SpawnPipelineWorkflow`
  in `restate_service.rs`, served on the same endpoint. See
  `docs/WORKFLOW_BACKENDS.md`.

**PR-batch 2026-06-20 (PRs #13–#18, all merged to `main`)** — a triage +
merge pass that cleared the open audit-fix branches:
- **#15** — C026/C074 tool-allowlist kill-switch: `effective_tool_names`
  intersects per-agent loadout with the global allowlist, with an
  `is_authority_tool` carve-out so role-gated coordination tools still reach the
  Coordinator.
- **#16** — C202/C203/C201/C204 Gemini hardening: key → `x-goog-api-key` header,
  model id `urlencoding::encode`d, `generationConfig` materialised when streaming.
- **#13** — C094 mitigation: `run_turn` pause gate on the direct chat path +
  drift-hook `ensure`-before-pause (full two-write atomicity ZZ16 still open).
- **#18** — C092 `DeleteAgent`: tolerate `NotFound` on terminate, propagate the
  `set_status("deprecated")` failure via `?` (no more silent DB↔executor desync).
- **#17** — LLM tool-calling round-trip (legacy ZZ82–87, ZZ26): Ollama tool
  results use `tool_name` not `name`; tool-calls-only turns omit empty `content`;
  native tool defs gated on `supports_tools`; XML-fallback hint disambiguated;
  expanded the Ollama tool-capable family list; default `LlmProvider::chat`
  accumulates streamed tool calls instead of dropping them.
- **#14** — docs unification (this register) + `docs/{README,SECURITY,TESTING}.md`.
- **CI hygiene** — `cargo fmt --all`, lockfile `urlencoding` sync, and two
  unmaintained-crate `cargo audit` ignores, so backend CI is green.

**Batch 4 (`1c17673`)** — ZZ7 `shell_exec` HOME → `.hive/run-home/`; ZZ10
`fs_read` size-cap TOCTOU (`File::take(cap+1)`); ZZ11 `fs_write` symlink TOCTOU
(`O_NOFOLLOW`); ZZ13 `rehydrate_from_db` honours `parent_agent_id`; ZZ27 OpenAI
`finish_reason` ordering; ZZ29 Gemini EOF `Complete` fallback; ZZ31 DeepSeek R1
`tools` strip; ZZ32 Anthropic model-aware `max_tokens`; Z11 `Projects.tsx` awaits
`setActiveProject`; Z15 `NotFound.tsx` uses `<Link>`.

**Operator `9eb75a3`** — ZZ4 `PermissionMatrix` enforced in `ToolRegistry::invoke`
(Plan/Build/Explore); ZZ5 `is_system_protected` component-scan; Z14 budget
zero-guard.

**Batch 3 (`558f283`)** — ZZ2 (partial) cancel-token bridge interrupts in-flight
turns; B4c `run_pipeline` resumes from `awaiting-approval`; Z2 (extended)
`set_agent_status`/`toggle_project_session` bubble executor errors.

**Batch 2 (`bb5b4be`)** — Z1 drift hook fires on every exit path; ZZ38
`seed_demo` in-progress sentinel; ZZ52 atomic `transition_status`; B4b mpsc
in-flight dedup; ZZ53 `delete_project` terminates executors + `remove_dir_all`;
Z8 (partial) lifecycle audit; Z2 (partial) `terminate_agent` propagates errors.

**Batch 1 (`cea2fe9`)** — ZZ1 `fs_write` parent-symlink escape; ZZ3 loop detector
reads `"arguments"`; ZZ25 SSE UTF-8 tail buffer; Z3/A9 (partial) redirect policy
rejects private IP-literal hops; ZZ57 attachment download canonicalise; ZZ60
status enum-validation; ZZ64 audit-purge tick ordering; ZZ65 `rehydrate_from_db`
error surfaced; ZZ66 secret-decrypt `map_err(|_| …)`.

**Earlier (HANDOFF baseline, 2026-04→05)** — SQLite-in-git removed; `seed_demo`
double-run guarded; OpenAPI stub returns 501; CI workflows added; repo layout
`hive-backend/`→`hive-code/back-end/`, `frontend/`→`hive-code/front-end/`.

**Retracted on verification:** ZZ37 (migration order — dependency-correct as-is);
C471 (RealtimeProvider dep — `handlerRef` pattern is correct).

---

## 7. Feature work (not bugs)

The pre-2026-06 backlog mixed *feature gaps* with *defects*. The feature items —
coordinator-led onboarding finish (B1), skill mounting UI (B2), autonomous loop
polish (B3), auto-MCP review surface (B4), drift UI panel (B5), Code & Versioning
history/PR-merge UI (C1–C3), keyboard shortcuts (C4), eval harness (D1),
export/import (D5), factory reset (D6), Docker/LICENSE/E2E (E) — now live in
[`ROADMAP.md`](ROADMAP.md). Current shipped-vs-not status is in
[`FEATURE_STATUS.md`](FEATURE_STATUS.md). This register is for **defects, debt,
security, and test coverage only.**

---

## 8. Evidence appendix

- **[`MASTER_AUDIT_REPORT.md`](../../audit-out/MASTER_AUDIT_REPORT.md)** — all 218
  findings with file:line, votes, confidence, evidence rationale, and a concrete
  suggested fix per finding.
- **[`AUDIT_VERIFICATION.md`](../../AUDIT_VERIFICATION.md)** — per-finding
  CONFIRMED/PARTIAL/FALSIFIED verdict from a file-by-file re-read (2026-06-15).
- **[`SECURITY.md`](SECURITY.md)** — consolidated security posture and the
  security subset of this register.
- **[`TESTING.md`](TESTING.md)** — testing strategy and the coverage-gap subset.

*This file replaces the former §A–§E / §Z / §ZZ structure and the standalone
`HANDOFF_ISSUES.md` open-issue tracker (now archived). Historical IDs remain
resolvable via the Legacy columns above.*
