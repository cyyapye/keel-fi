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

From a fresh clone:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm db:reset:local
```

The documented local-development command is:

```sh
pnpm dev
```

Open `http://127.0.0.1:4177`. Vite proxies `/api` to the local Worker on
port 8789. Local authentication bypass is enabled only by Wrangler's explicit
`local` environment; production defaults to fail-closed Access validation.

Local database commands:

```sh
pnpm db:migrate:local
pnpm db:seed:local
pnpm db:check:local
```

The documented test command is:

```sh
pnpm check
```

Critical browser coverage can be run separately with `pnpm test:e2e`; the first
run may require `pnpm exec playwright install chromium`.

## Deployment

The target is Cloudflare Workers, D1, private R2, Access, and Queues-compatible
processing. No infrastructure is deployed by this repository's bootstrap. Follow
[the Cloudflare deployment runbook](docs/deployment/cloudflare.md) only after
reviewing the [deployment checklist](docs/deployment/checklist.md).

## License

Keel is licensed under the [Mozilla Public License 2.0](LICENSE). Changes to
MPL-covered source files must remain available under the MPL; see the license
for the complete terms.
