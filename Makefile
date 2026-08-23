SHELL := /bin/bash
.DEFAULT_GOAL := help

npm_config_cache ?= $(CURDIR)/.npm-cache
npm_config_prefer_offline ?= true
npm_config_update_notifier ?= false
PNPM ?= npx --yes pnpm@11.9.0
COMPOSE ?= docker compose
TEST_ARGS ?=
E2E_ARGS ?=
override E2E_PERSIST_TO := $(CURDIR)/.keel-local/e2e
WRANGLER_LOG_PATH ?= $(CURDIR)/.wrangler/logs/wrangler.log
AGENT_PLATFORM ?= $(shell uname -s)

export npm_config_cache npm_config_prefer_offline npm_config_update_notifier WRANGLER_LOG_PATH

.PHONY: help bootstrap dev dev-up dev-down dev-clean dev-status dev-logs dev-build data-scan format format-check lint typecheck test build check db-migrate db-seed db-reset db-check db-verify db-reset-e2e db-check-e2e db-verify-e2e local-acceptance-apply local-acceptance-dev local-acceptance-restore local-acceptance-clean provider-agent-setup provider-agent-run e2e verify

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
	@echo "  make provider-agent-setup PROVIDER=angellist|tokenfolio|sydecar KEEL_URL=https://..."
	@echo "  make provider-agent-run PROVIDER=angellist|tokenfolio|sydecar KEEL_URL=https://..."
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

db-reset-e2e:
	node scripts/reset-e2e-state.mjs
	$(PNPM) exec wrangler d1 migrations apply keel-local --env local --local --config apps/api/wrangler.jsonc --persist-to "$(E2E_PERSIST_TO)"
	$(PNPM) exec wrangler d1 execute keel-local --env local --local --config apps/api/wrangler.jsonc --persist-to "$(E2E_PERSIST_TO)" --file packages/database/seed/synthetic.sql

db-check-e2e:
	$(PNPM) exec wrangler d1 execute keel-local --env local --local --config apps/api/wrangler.jsonc --persist-to "$(E2E_PERSIST_TO)" --command "SELECT COUNT(*) AS households FROM households; SELECT COUNT(*) AS snapshots FROM forecast_snapshots; SELECT COUNT(*) AS goals FROM goals; SELECT COUNT(*) AS primary_goals FROM goals WHERE is_primary = 1 AND archived_at IS NULL; SELECT COUNT(*) AS goal_versions_without_snapshot FROM goal_versions version LEFT JOIN goal_forecast_snapshots snapshot ON snapshot.goal_version_id = version.id WHERE snapshot.id IS NULL;"

db-verify-e2e:
	$(MAKE) db-reset-e2e
	$(MAKE) db-check-e2e

local-acceptance-apply:
	$(PNPM) local:acceptance:apply

local-acceptance-dev:
	KEEL_LOCAL_PERSIST_TO=.keel-local/acceptance $(PNPM) dev

local-acceptance-restore:
	$(PNPM) local:acceptance:restore

local-acceptance-clean:
	$(PNPM) local:acceptance:clean

provider-agent-setup:
	@test -n "$(PROVIDER)" || { echo "PROVIDER is required."; exit 2; }
	@test -n "$(KEEL_URL)" || { echo "KEEL_URL is required."; exit 2; }
	@case "$(PROVIDER)" in angellist|tokenfolio|sydecar) ;; *) echo "PROVIDER must be angellist, tokenfolio, or sydecar."; exit 2 ;; esac
	@if [ "$(AGENT_PLATFORM)" = "Linux" ] && [ -z "$${DISPLAY:-}" ]; then \
		$(PNPM) exec tsx scripts/linux-agent-setup-session.ts --provider "$(PROVIDER)" --keel-url "$(KEEL_URL)"; \
	else \
		case "$(PROVIDER)" in \
			angellist) $(PNPM) angellist:setup -- --keel-url "$(KEEL_URL)" ;; \
			tokenfolio|sydecar) $(PNPM) provider:setup -- --provider "$(PROVIDER)" --keel-url "$(KEEL_URL)" ;; \
		esac; \
	fi

provider-agent-run:
	@test -n "$(PROVIDER)" || { echo "PROVIDER is required."; exit 2; }
	@test -n "$(KEEL_URL)" || { echo "KEEL_URL is required."; exit 2; }
	@case "$(PROVIDER)" in \
		angellist) $(PNPM) angellist:run -- --keel-url "$(KEEL_URL)" ;; \
		tokenfolio|sydecar) $(PNPM) provider:run -- --provider "$(PROVIDER)" --keel-url "$(KEEL_URL)" ;; \
		*) echo "PROVIDER must be angellist, tokenfolio, or sydecar."; exit 2 ;; \
	esac
e2e:
	$(MAKE) db-verify-e2e
	KEEL_E2E_ISOLATED=1 KEEL_LOCAL_PERSIST_TO="$(E2E_PERSIST_TO)" $(PNPM) test:e2e $(E2E_ARGS)

verify:
	$(MAKE) check
	$(MAKE) e2e
