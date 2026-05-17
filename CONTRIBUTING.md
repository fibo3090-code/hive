# Contributing to HIVE

Short, opinionated guide. Goal: keep `main` shippable and let new contributors
land their first PR in an afternoon.

## Repo layout (quick recap)

- `back-end/` — Rust workspace. Crates: `hive-api`, `hive-runtime`,
  `hive-db`, `hive-domain`, `hive-tools`, `hive-llm`, `hive-search`,
  `hive-git`, `hive-sandbox`, `hive-crypto`, `hive-seed`, plus
  `hive-db/migration`.
- `front-end/` — Vite + React + TypeScript app (port 8080 in dev).
- `docs/` — long-form docs (architecture, roadmap, feature status).

## Prereqs

- Rust toolchain pinned in `back-end/rust-toolchain.toml` (currently 1.94.1).
  `rustup` will install the right channel automatically on first build.
- Node 20+ and npm. Bun is supported (`bun.lockb` is committed) but
  not required.
- Playwright Chromium for E2E (`cd front-end && npx playwright install
  chromium`) — only needed if you touch browser tests.

## Branches and commits

- Branch from `main`. Naming: `claude/<short-topic>` for AI-assisted work,
  `<your-handle>/<short-topic>` otherwise. Avoid spaces and ALL-CAPS.
- Commit style: Conventional Commits prefix.
  - `feat(<scope>):` new feature
  - `fix(<scope>):` bug fix
  - `refactor(<scope>):` no behaviour change
  - `docs:` docs only
  - `chore:` deps, infra, tooling
  - `test:` tests only
  - `<scope>` is the crate or page name (`back-end`, `front-end`,
    `hive-runtime`, `Dashboard`, …). Keep messages tight; the body is
    where you justify *why*.
- Prefer **a new commit** over `--amend` once a branch has been pushed.
- Never `--no-verify` past a pre-commit hook — fix the underlying issue.

## Pre-PR checklist

Run these locally; CI runs the same. If something fails, fix it before
opening the PR.

**Backend:**

```bash
cd back-end
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

**Frontend:**

```bash
cd front-end
npm install              # or `bun install`
npm run typecheck
npm run lint
npm run test
npm run build
```

## How to add a database migration

1. Create a file in `back-end/crates/hive-db/migration/src/` named
   `m<YYYYMMDD>_<NNNNNN>_<short_snake_name>.rs` (date prefix keeps
   ordering stable; six-digit counter resolves same-day collisions).
2. Implement `MigrationName` + `MigrationTrait` (look at any existing
   file as a template). Use `if_not_exists()` on `create_table`.
3. Append the new module + `Box::new(...)` entry to
   `migration/src/lib.rs`.
4. **Never** rename or edit a merged migration — write a follow-up
   migration that achieves the same end state. If you *must* rename one,
   add the old→new mapping to `RENAMES` in `hive-db/src/db.rs::repair_renamed_migrations`
   so existing dev databases auto-heal at startup.
5. Test: `rm back-end/data/hive.db && cargo run -p hive-api` should
   boot cleanly with the seed loaded.

## How to add a route or handler

Backend routes all live in `back-end/crates/hive-api/src/main.rs`
(yes, it is big — splitting is on the roadmap). The shape:

1. Define request/response DTO structs near the handler.
2. Write the handler `async fn name(State, Path, Json) -> Result<Json<…>, AppError>`.
3. Register the route in the `Router::new()` chain inside `serve()`.
4. If the handler mutates state, append an `audit::append(...)` call
   inside the same transaction so the audit log stays complete.
5. Mirror the route in the frontend: add a hook in
   `front-end/src/api/<resource>.ts` using TanStack Query. Use the
   established `useResource(...)` / `useUpdateResource(...)` pattern.

## How to add an agent tool

1. Pick the right crate:
   - Stateless / sandbox-only (`fs_*`, `shell_exec`, `web_*`, `todo`)
     → `back-end/crates/hive-tools/src/builtins/`.
   - DB-backed (`add_task`, `hive_mind_*`, `record_drift`, …) →
     `back-end/crates/hive-runtime/src/db_tools.rs`.
   - Agent-management (`spawn_agent`, `monitor_agent`, …) →
     `back-end/crates/hive-runtime/src/agent_tools.rs`.
   - Git → `back-end/crates/hive-runtime/src/git_tools.rs`.
2. Implement `Tool` (manifest with name + JSON schema, `invoke` with
   the actual work). Side-effecting tools must set `side_effects: true`.
3. Register in the matching `register_*` function and add the name to
   `RUNTIME_TOOL_NAMES` (and `RUNTIME_DEFAULT_TOOL_NAMES` if it should
   be on by default for every agent).
4. Add the tool to the `tool_category` match in `hive-api::main.rs`
   so the UI categorises it.
5. If the tool's output should refresh a frontend cache, add a SSE
   handler in `front-end/src/realtime/useSse.ts`.

## How to run the app end-to-end locally

```bash
# terminal 1 — backend
cd back-end
cargo run -p hive-api
# listening on http://127.0.0.1:8787

# terminal 2 — frontend
cd front-end
npm run dev -- --host 127.0.0.1
# http://127.0.0.1:8080
```

First run seeds 3+ demo projects. Pick `HIVE Dashboard` to land on the
main app. The autonomous task scheduler only dispatches when the session
toggle is ON for the project.

## Out of scope for first-time PRs

- Renaming public crates or shifting the workspace layout.
- Schema changes to the audit_log table.
- The Hive Mind RAG embedding pipeline (parked).
- The custom-MCP synthesis pipeline (in progress under W3-B4).

If your idea touches any of the above, open a short issue first so we
can scope it together.

## Questions?

Open a draft PR and ask in the description, or file an issue. Reviewers
are happier with a partial PR + clear question than a perfect surprise.
