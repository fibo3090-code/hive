# HIVE one-command dev stack. Install `just` from https://just.systems
# (or use the parallel `Makefile` target shapes). Targets are intentionally
# thin wrappers — they exist so a new contributor never has to remember the
# right cargo/bun invocations and `cd` order.

set windows-shell := ["powershell.exe", "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command"]

default:
    @just --list

# First-time setup: copy example configs into place. Idempotent.
[windows]
setup:
    @if (!(Test-Path -LiteralPath 'back-end/config/local.toml')) { Copy-Item -LiteralPath 'back-end/config/local.example.toml' -Destination 'back-end/config/local.toml' }
    @if (!(Test-Path -LiteralPath 'back-end/.env')) { Copy-Item -LiteralPath 'back-end/.env.example' -Destination 'back-end/.env' }
    @if (!(Test-Path -LiteralPath 'front-end/.env')) { Copy-Item -LiteralPath 'front-end/.env.example' -Destination 'front-end/.env' }
    @Write-Host "HIVE setup ready. Run 'just dev-back' and 'just dev-front' in two terminals."

[unix]
setup:
    @test -f back-end/config/local.toml \
        || cp back-end/config/local.example.toml back-end/config/local.toml
    @test -f back-end/.env || cp back-end/.env.example back-end/.env
    @test -f front-end/.env || cp front-end/.env.example front-end/.env
    @echo "✓ HIVE setup ready. Run 'just dev-back' and 'just dev-front' (in two terminals) — or 'just up' to launch both via tmux."

# Run only the backend.
[windows]
dev-back:
    Set-Location back-end; cargo run -p hive-api -- serve; exit $LASTEXITCODE

[unix]
dev-back:
    cd back-end && cargo run -p hive-api -- serve

# Run only the frontend.
[windows]
dev-front:
    Set-Location front-end; npm run dev; exit $LASTEXITCODE

[unix]
dev-front:
    cd front-end && npm run dev

# Launch back + front in a tmux session called `hive`. Detach with
# Ctrl-b d; re-attach with `tmux attach -t hive`. Falls back to a
# helpful error if `tmux` isn't installed.
[windows]
up: setup
    @powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/dev-up.ps1

[unix]
up: setup
    @command -v tmux >/dev/null || { \
        echo "✗ 'just up' needs tmux. Install it (apt: tmux, brew: tmux) or run 'just dev-back' and 'just dev-front' in two terminals."; \
        exit 1; \
    }
    tmux new-session -d -s hive 'cd back-end && cargo run -p hive-api -- serve' \; \
        split-window -h 'cd front-end && npm run dev' \; \
        attach

# Kill the tmux session if it's running.
[windows]
down:
    @powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File scripts/dev-down.ps1

[unix]
down:
    -tmux kill-session -t hive 2>/dev/null || true

# Run every test in the workspace.
[windows]
test:
    Set-Location back-end; cargo test --workspace; exit $LASTEXITCODE
    Set-Location front-end; npm test --silent; exit $LASTEXITCODE

[unix]
test:
    cd back-end && cargo test --workspace
    cd front-end && npm test --silent

# Lint + typecheck.
[windows]
lint:
    Set-Location back-end; cargo clippy --workspace --all-targets -- -D warnings; exit $LASTEXITCODE
    Set-Location front-end; npm run lint; exit $LASTEXITCODE
    Set-Location front-end; npm run typecheck; exit $LASTEXITCODE

[unix]
lint:
    cd back-end && cargo clippy --workspace --all-targets -- -D warnings
    cd front-end && npm run lint
    cd front-end && npm run typecheck

# Format the whole tree.
[windows]
fmt:
    Set-Location back-end; cargo fmt --all; exit $LASTEXITCODE

[unix]
fmt:
    cd back-end && cargo fmt --all

# Dependency CVE audit. Fails on Critical/High advisories.
[windows]
audit:
    Set-Location back-end; cargo audit; exit $LASTEXITCODE
    Set-Location front-end; npm audit --audit-level=moderate; exit $LASTEXITCODE

[unix]
audit:
    cd back-end && cargo audit
    cd front-end && npm audit --audit-level=moderate

# Production build.
[windows]
build:
    Set-Location back-end; cargo build --release -p hive-api; exit $LASTEXITCODE
    Set-Location front-end; npm run build; exit $LASTEXITCODE

[unix]
build:
    cd back-end && cargo build --release -p hive-api
    cd front-end && npm run build
