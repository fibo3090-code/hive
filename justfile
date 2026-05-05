# HIVE one-command dev stack. Install `just` from https://just.systems
# (or use the parallel `Makefile` target shapes). Targets are intentionally
# thin wrappers — they exist so a new contributor never has to remember the
# right cargo/bun invocations and `cd` order.

set positional-arguments

default:
    @just --list

# First-time setup: copy example configs into place. Idempotent.
setup:
    @test -f back-end/config/local.toml \
        || cp back-end/config/local.example.toml back-end/config/local.toml
    @test -f back-end/.env || cp back-end/.env.example back-end/.env
    @test -f front-end/.env || cp front-end/.env.example front-end/.env
    @echo "✓ HIVE setup ready. Run 'just dev-back' and 'just dev-front' (in two terminals) — or 'just up' to launch both via tmux."

# Run only the backend.
dev-back:
    cd back-end && cargo run -p hive-api -- serve

# Run only the frontend.
dev-front:
    cd front-end && npm run dev

# Launch back + front in a tmux session called `hive`. Detach with
# Ctrl-b d; re-attach with `tmux attach -t hive`. Falls back to a
# helpful error if `tmux` isn't installed.
up: setup
    @command -v tmux >/dev/null || { \
        echo "✗ 'just up' needs tmux. Install it (apt: tmux, brew: tmux) or run 'just dev-back' and 'just dev-front' in two terminals."; \
        exit 1; \
    }
    tmux new-session -d -s hive 'cd back-end && cargo run -p hive-api -- serve' \; \
        split-window -h 'cd front-end && npm run dev' \; \
        attach

# Kill the tmux session if it's running.
down:
    -tmux kill-session -t hive 2>/dev/null || true

# Run every test in the workspace.
test:
    cd back-end && cargo test --workspace
    cd front-end && npm test --silent

# Lint + typecheck.
lint:
    cd back-end && cargo clippy --workspace --all-targets -- -D warnings
    cd front-end && npm run lint
    cd front-end && npm run typecheck

# Format the whole tree.
fmt:
    cd back-end && cargo fmt --all

# Dependency CVE audit. Fails on Critical/High advisories.
audit:
    cd back-end && cargo audit
    cd front-end && npm audit --audit-level=moderate

# Production build.
build:
    cd back-end && cargo build --release -p hive-api
    cd front-end && npm run build
