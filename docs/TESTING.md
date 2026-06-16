# HIVE Testing Guide

> How testing works in HIVE, the **honest current state** of coverage, and the
> priority order for closing the gap. The per-path coverage findings are tracked
> by ID in [`BACKLOG.md`](BACKLOG.md) §3.5 (backend) and §4.5 (frontend); this
> doc is the strategy + how-to, not a second tracker.

**Last reviewed:** 2026-06-16.

---

## 1. How to run the suites

```sh
just test                     # cargo test --workspace + npm test (both halves)
just lint                     # clippy -D warnings + eslint + tsc --noEmit
```

Backend (from `back-end/`):

```sh
cargo test --workspace                          # all crates
cargo nextest run                               # faster runner (preferred)
cargo test -p hive-runtime drift_hook           # one module
cargo test -p hive-db --test redesign_foundations   # one integration file
cargo test -- --nocapture <name>                # show stdout
```

Frontend (from `front-end/`):

```sh
npm run test         # vitest one-shot (jsdom)
npm run test:watch   # watch mode
npx playwright test  # E2E (config via lovable-agent-playwright-config)
```

**Gate before commit:** `cargo clippy --workspace --all-targets -- -D warnings`
must pass; `cargo test --workspace` must be green.

## 2. Current state (honest)

| Area | State |
|---|---|
| **Backend — runtime/db/llm/tools** | Real coverage exists: drift scoring, executor/registry lifecycle (regression tests), chat schema/tool-parsing, sandbox escape, seed, provider parsing. ~245+ workspace tests. |
| **Backend — `hive-git`** | **Zero tests** (521 LOC) — C295–C298. Parsing of `log`/`tree`/`commit` can silently drop data. |
| **Backend — repo layer** | Mixed: `agents.rs` has tests; ~34 repo files have none (C165, partially overstated). |
| **Backend — critical state machines** | Executor/registry, agent tools, drift-hook *integration*, budget reservation, wire cycle detection, SSRF guard, domain `FromStr` — confirmed gaps (C118–C299). |
| **Frontend** | **Effectively untested.** The only test file is `src/test/example.test.ts`, which asserts `expect(true).toBe(true)` (C538). 19 pages, ~47 UI components, `useHiveData`, `RealtimeProvider`, `useSse` — all uncovered (C361/C400/C531–C533). |
| **E2E** | Playwright is wired but there is no meaningful suite. |
| **CI** | Workflows exist (added in the HANDOFF-era remediation); verify they still run on push. |

**Bottom line:** the backend has a credible (if uneven) test base; the frontend
has essentially none. This is the highest-leverage debt in the repo.

## 3. Conventions

- **Backend:** inline `#[cfg(test)] mod tests` next to the code; integration
  tests under `crates/<crate>/tests/`. Use in-memory SQLite
  (`Db::connect("sqlite::memory:", true)`) for DB-touching tests — see
  `hive-runtime/src/registry.rs` tests for the canonical harness. Extract a
  shared `test_utils` instead of copying `fresh_sandbox()` (C187).
- **Frontend:** vitest + jsdom; setup at `src/test/setup.ts`. Mock `EventSource`
  for realtime tests; mock `fetch`/the `api()` client for hook tests. Test query
  keys, dependent-query enablement, and `onSuccess` invalidations for
  `useHiveData`.

## 4. Priority order for closing the gap

Reconciled with the audit's "test foundation" recommendation. Write tests in
this order — each protects a guarantee, not just a line:

**Backend**
1. **Allowlist intersection** (C082, C085) — guards the operator kill-switch
   (and pins the C026/C074 fix once it lands).
2. **Executor/registry + agent-tool state machine** (C118, C119, C120) —
   pause/resume/terminate/dispatch and DB↔executor sync (the recurring
   split-brain class, C092/C094).
3. **Budget reservation → final** (C125, C155) — the money path.
4. **SSRF guard + redirect policy** (C191, C192) — security guarantee; mock a
   server redirecting to `127.0.0.1` / `169.254.169.254` / `ftp://` / 6+ hops.
5. **`hive-git` parsing** (C295–C298) — the whole crate; silent data loss today.
6. **Domain `FromStr` + SSE UTF-8 boundary** (C286/C287/C294, C246).

**Frontend**
1. **`api()` client** error/`requestId` paths (C501, C537) — every call goes
   through it.
2. **`RealtimeProvider` + `useSse`** subscription lifecycle and event→key mapping
   (C498, C499, C506) — mock `EventSource`.
3. **`useHiveData`** queries + mutations + invalidations (C531).
4. **`ErrorBoundary`** capture + reset (C454, C455).
5. **Deletion/mutation flows** on `Projects` / `ChatCentral` (C362, C363).
6. **`CommandPalette`** fuzzy match + keyboard bounds (C443, C444).

## 5. Dependency safety

`vitest` must be ≥3.2.6 (C543, GHSA-5xrq-8626-4rwp) — the test runner itself
currently carries a critical CVE. Bump it before relying on the frontend suite.
