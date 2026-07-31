# Keel

Keel is an open-source, evidence-backed operating system for private holdings,
liquidity forecasting, entrepreneurial runway, and financial independence.

This repository is the first private-alpha implementation: a pnpm TypeScript
workspace with a React decision surface, a Hono API, deterministic financial
logic, and a normalized Cloudflare D1 record. All included people, companies,
documents, accounts, and financial values are fabricated.

The current interface includes versioned financial-independence, cash-runway,
major-purchase, and custom goals. One goal is primary on the Overview; every
save preserves the prior goal version and creates its matching forecast
snapshot.

> [!IMPORTANT] Keel is not financial, investment, legal, or tax advice.
> Private-company marks are estimates and do not imply liquidity. The app
> distinguishes paper value from realizable liquidity.

## Safety and responsibility

- Public code contains no user financial data. Never add real holdings,
  balances, names, account identifiers, source documents, messages, tax
  documents, credentials, or portfolio-derived values.
- Users are responsible for securing their deployments, Cloudflare accounts,
  secrets, exports, and backups.
- The database is canonical. External events create proposed changes and never
  silently rewrite holdings.
- Forecast calculations are deterministic and testable. This implementation has
  no AI dependency.

## What is included

- A responsive private-alpha product shell with Overview, Goals, Holdings,
  Evidence Inbox, Scenarios, and append-only Forecast History views.
- Separate administrator NAV, latest external mark, FI-underwriting value,
  thesis-weighted expected value, timing-adjusted liquidity, and actual
  distribution records.
- Annual P25, P50, P75, expected-liquidity, and zero-liquidity probability
  curves.
- Evidence provenance, confidence, effective/retrieval dates, and explicit
  review decisions that preserve prior and replacement values.
- Cloudflare Access JWT validation that fails closed outside explicit local
  mode.
- D1 migrations, private R2/Queues interfaces, synthetic seed data, CI,
  Dependabot, and secret scanning.

## Workspace

```text
apps/
  api/          Hono Cloudflare Worker
  web/          React + Vite private-alpha interface
packages/
  connectors/   queue-compatible ingestion contracts
  database/     Drizzle schema, D1 migration, repository, synthetic seed
  domain/       deterministic money and projection logic
  evidence/     evidence and review state model
  ui/           shared React primitives
connectors/     connector-specific implementation boundaries
docs/           product, architecture, security, and deployment decisions
```

See [the architecture overview](docs/architecture/overview.md) and
[Cloudflare ADR](docs/architecture/adr-001-cloudflare-private-alpha.md).

## Local development

Prerequisites:

- Node.js 22.13 or newer
- Corepack
- GNU Make

From a fresh clone:

```sh
make bootstrap
```

This installs the pinned pnpm dependencies, prepares the synthetic local D1
database, and installs Playwright's Chromium browser. Codex runs the same
bootstrap automatically when it creates a worktree through the checked-in local
environment configuration.

Start the frontend and backend together with one command:

```sh
make dev
```

The command prints both URLs. The primary checkout uses web port 4177 and API
port 8789. Linked worktrees derive stable alternate ports from their paths so
several Codex worktrees can run concurrently. Override either port when needed:

```sh
KEEL_WEB_PORT=4300 KEEL_API_PORT=8900 make dev
```

Vite proxies `/api` to the matching local Worker. Local authentication bypass is
enabled only by Wrangler's explicit `local` environment; production defaults to
fail-closed Access validation.

Local database commands:

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm db:check:local
```

Run the complete local PR-equivalent verification with:

```sh
make verify
```

Focused targets are available while iterating:

| Command          | Scope                                                      |
| ---------------- | ---------------------------------------------------------- |
| `make check`     | Data scan, formatting, lint, types, unit tests, and builds |
| `make lint`      | ESLint only                                                |
| `make typecheck` | TypeScript only                                            |
| `make test`      | Unit and API tests only                                    |
| `make db-verify` | Migrations, synthetic seed, and D1 invariants              |
| `make e2e`       | Desktop and mobile Chromium flows                          |

Use `TEST_ARGS` or `E2E_ARGS` for narrower runs, for example
`make test TEST_ARGS=packages/domain` or
`make e2e E2E_ARGS='--project=chromium'`.

## Deployment

The target is Cloudflare Workers, D1, private R2, Access, and Queues-compatible
processing. No infrastructure is deployed by this repository's bootstrap. Follow
[the Cloudflare deployment runbook](docs/deployment/cloudflare.md) only after
reviewing the [deployment checklist](docs/deployment/checklist.md).

## License

Keel is licensed under the [Mozilla Public License 2.0](LICENSE). Changes to
MPL-covered source files must remain available under the MPL; see the license
for the complete terms.
