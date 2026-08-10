SHELL := /bin/bash
.DEFAULT_GOAL := help

npm_config_cache ?= $(CURDIR)/.npm-cache
npm_config_prefer_offline ?= true
npm_config_update_notifier ?= false
PNPM ?= npx --yes pnpm@11.9.0
COMPOSE ?= docker compose
TEST_ARGS ?=
E2E_ARGS ?=
WRANGLER_LOG_PATH ?= $(CURDIR)/.wrangler/logs/wrangler.log

export npm_config_cache npm_config_prefer_offline npm_config_update_notifier WRANGLER_LOG_PATH

.PHONY: help bootstrap dev dev-up dev-down dev-clean dev-status dev-logs dev-build data-scan format format-check lint typecheck test build check db-migrate db-seed db-reset db-check db-verify local-acceptance-apply local-acceptance-dev local-acceptance-restore local-acceptance-clean angellist-setup angellist-run e2e verify

help:
	@echo "Keel developer commands"
	@echo "  make bootstrap     Install dependencies, seed local D1, install Chromium"
	@echo "  make dev           Start the API and web app together"
	@echo "  make dev-up        Build and start the Docker development stack"
	@echo "  make dev-down      Stop the Docker development stack (preserves data)"
	@echo "  make dev-clean     Remove the Docker development stack and synthetic data"
	@echo "  make dev-status    Show Docker development service status"
	@echo "  make dev-logs      Follow Docker development service logs"
	@echo "  make dev-build     Rebuild Docker development images"
	@echo "  make verify        Run the complete local verification suite"
	@echo "  make check         Run source checks, unit tests, and builds"
	@echo "  make lint          Run ESLint"
	@echo "  make typecheck     Run TypeScript checks"
	@echo "  make test          Run unit/API tests (optional TEST_ARGS=...)"
	@echo "  make db-verify     Apply migrations, seed, and check D1 invariants"
	@echo "  make local-acceptance-apply   Apply a runtime-only real-company source profile to local D1"
	@echo "  make local-acceptance-dev     Start the disposable real-company local profile"
	@echo "  make local-acceptance-restore Remove the disposable real-company local state"
	@echo "  make angellist-setup KEEL_URL=https://...   Install the Mac update agent"
	@echo "  make angellist-run KEEL_URL=https://...     Download and stage an update now"
	@echo "  make e2e           Run browser tests (optional E2E_ARGS=...)"

bootstrap:
	node scripts/check-toolchain.mjs
	$(PNPM) install --frozen-lockfile
	$(PNPM) db:reset:local
	$(PNPM) exec playwright install chromium

dev:
	$(PNPM) dev

dev-up:
	$(COMPOSE) up --detach --build --wait --wait-timeout 120

dev-down:
	$(COMPOSE) down

dev-clean:
	$(COMPOSE) down --volumes --remove-orphans

dev-status:
	$(COMPOSE) ps

dev-logs:
	$(COMPOSE) logs --follow --tail=100

dev-build:
	$(COMPOSE) build

data-scan:
	$(PNPM) data:scan

format:
	$(PNPM) format

format-check:
	$(PNPM) format:check

lint:
	$(PNPM) lint

typecheck:
	$(PNPM) typecheck

test:
	$(PNPM) test $(TEST_ARGS)

build:
	$(PNPM) build

check:
	$(PNPM) check

db-migrate:
	$(PNPM) db:migrate:local

db-seed:
	$(PNPM) db:seed:local

db-reset:
	$(PNPM) db:reset:local

db-check:
	$(PNPM) db:check:local

db-verify:
	$(MAKE) db-reset
	$(MAKE) db-check

local-acceptance-apply:
	$(PNPM) local:acceptance:apply

local-acceptance-dev:
	KEEL_LOCAL_PERSIST_TO=.keel-local/acceptance $(PNPM) dev

local-acceptance-restore:
	$(PNPM) local:acceptance:restore

local-acceptance-clean:
	$(PNPM) local:acceptance:clean

angellist-setup:
	@test -n "$(KEEL_URL)" || { echo "KEEL_URL is required."; exit 2; }
	$(PNPM) angellist:setup -- --keel-url "$(KEEL_URL)"

angellist-run:
	@test -n "$(KEEL_URL)" || { echo "KEEL_URL is required."; exit 2; }
	$(PNPM) angellist:run -- --keel-url "$(KEEL_URL)"

e2e:
	$(MAKE) db-reset
	$(PNPM) test:e2e $(E2E_ARGS)

verify:
	$(MAKE) check
	$(MAKE) db-verify
	$(MAKE) e2e
