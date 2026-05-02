# HIVE one-command dev stack. Identical surface to the `justfile` for
# folks who don't have `just` installed. Prefer `just <target>` if you do.

.PHONY: help setup dev-back dev-front up down test lint fmt audit build

help:
	@echo "make setup     — copy example configs into place"
	@echo "make dev-back  — run hive-api"
	@echo "make dev-front — run vite dev server"
	@echo "make up        — launch both in a tmux session"
	@echo "make down      — kill the tmux session"
	@echo "make test      — cargo test --workspace + npm test"
	@echo "make lint      — clippy -D warnings + eslint + tsc --noEmit"
	@echo "make fmt       — cargo fmt --all"
	@echo "make audit     — cargo audit + npm audit"
	@echo "make build     — release builds for both halves"

setup:
	@test -f back-end/config/local.toml \
	    || cp back-end/config/local.example.toml back-end/config/local.toml
	@test -f back-end/.env || cp back-end/.env.example back-end/.env
	@test -f front-end/.env || cp front-end/.env.example front-end/.env
	@echo "✓ HIVE setup ready. 'make dev-back' and 'make dev-front' in two terminals — or 'make up'."

dev-back:
	cd back-end && cargo run -p hive-api -- serve

dev-front:
	cd front-end && npm run dev

up: setup
	tmux new-session -d -s hive 'cd back-end && cargo run -p hive-api -- serve' \; \
	    split-window -h 'cd front-end && npm run dev' \; \
	    attach

down:
	-tmux kill-session -t hive 2>/dev/null || true

test:
	cd back-end && cargo test --workspace
	cd front-end && npm test --silent

lint:
	cd back-end && cargo clippy --workspace --all-targets -- -D warnings
	cd front-end && npm run lint
	cd front-end && npm run typecheck

fmt:
	cd back-end && cargo fmt --all

audit:
	cd back-end && cargo audit
	cd front-end && npm audit --audit-level=moderate

build:
	cd back-end && cargo build --release -p hive-api
	cd front-end && npm run build
