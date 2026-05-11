# HIVE

HIVE is a local-first multi-agent platform. The frontend is a React + Vite
application; the backend is a Rust workspace exposing an Axum HTTP/SSE API.
Agents are persistent: each one owns an inbox, can spawn children, call
tools, and stream responses through the shared event bus.

## Quickstart

```sh
just setup   # copy .env.example files into place; idempotent
just up      # launch back-end (127.0.0.1:8787) + front-end (127.0.0.1:8080) in tmux
```

If you don't have `just`, the `Makefile` mirrors every target:

```sh
make setup
make dev-back   # in one terminal
make dev-front  # in another
```

The first run creates a SQLite database under `~/.hive/`, generates a
master encryption key (chmod 0600), and seeds three demo projects so the
UI has something to render. To wipe state, delete `~/.hive/` and rerun.

## Layout

| Path | Purpose |
|---|---|
| `back-end/` | Cargo workspace: `hive-api`, `hive-db`, `hive-domain`, `hive-runtime`, `hive-llm`, `hive-tools`, `hive-sandbox`, `hive-search`, `hive-git`, `hive-crypto`, `hive-seed` |
| `front-end/` | React + TypeScript SPA (TanStack Query, shadcn/ui, Tailwind) |
| `docs/` | Architecture notes and the feature-status matrix |

## Configuration

Both halves read environment variables from their respective `.env`
files (created by `just setup`). The defaults bind `127.0.0.1` only and
expect to find each other at:

- back-end: `127.0.0.1:8787`
- front-end: `127.0.0.1:8080`

LLM provider keys are entered through Settings → LLM Providers and stored
encrypted at rest (ChaCha20-Poly1305 with the host master key).

## Tests

```sh
just test       # back-end + front-end
just lint       # clippy + eslint + tsc
just audit      # cargo audit + npm audit
```

## More

- [`back-end/README.md`](back-end/README.md) — Rust-side details.
- [`front-end/README.md`](front-end/README.md) — frontend-side details.
- [`docs/architecture.md`](docs/architecture.md) — agent loop, sandbox, SSE taxonomy.
- [`docs/FEATURE_STATUS.md`](docs/FEATURE_STATUS.md) — what's done / partial / mock / planned.
