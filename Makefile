SHELL := /bin/bash
.DEFAULT_GOAL := help

npm_config_cache ?= $(CURDIR)/.npm-cache
npm_config_prefer_offline ?= true
npm_config_update_notifier ?= false
PNPM ?= npx --yes pnpm@11.9.0
TEST_ARGS ?=
E2E_ARGS ?=
WRANGLER_LOG_PATH ?= $(CURDIR)/.wrangler/logs/wrangler.log

export npm_config_cache npm_config_prefer_offline npm_config_update_notifier WRANGLER_LOG_PATH

.PHONY: help bootstrap dev data-scan format format-check lint typecheck test build check db-migrate db-seed db-reset db-check db-verify e2e verify

help:
	@echo "Keel developer commands"
	@echo "  make bootstrap     Install dependencies, seed local D1, install Chromium"
	@echo "  make dev           Start the API and web app together"
	@echo "  make verify        Run the complete local verification suite"
	@echo "  make check         Run source checks, unit tests, and builds"
	@echo "  make lint          Run ESLint"
	@echo "  make typecheck     Run TypeScript checks"
	@echo "  make test          Run unit/API tests (optional TEST_ARGS=...)"
	@echo "  make db-verify     Apply migrations, seed, and check D1 invariants"
	@echo "  make e2e           Run browser tests (optional E2E_ARGS=...)"

bootstrap:
	node scripts/check-toolchain.mjs
	$(PNPM) install --frozen-lockfile
	$(PNPM) db:reset:local
	$(PNPM) exec playwright install chromium

dev:
	$(PNPM) dev

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

e2e:
	$(MAKE) db-reset
	$(PNPM) test:e2e $(E2E_ARGS)

verify:
	$(MAKE) check
	$(MAKE) db-verify
	$(MAKE) e2e
