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
- Synthetic Portfolio Watch monitoring that retains public observations,
  separates directly reported facts from valuation inference, and sends every
  proposal through the existing review boundary.
- Optional macOS-assisted AngelList CSV download and staging with a dedicated
  local Chrome profile. Automatic checks run daily, an immediate local command
  is available, and every import still requires review.
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
[Cloudflare ADR](docs/architecture/adr-001-cloudflare-private-alpha.md). The
optional AngelList workflow is documented in the
[Mac agent runbook](docs/deployment/angellist-browser-import.md).

## Local development

Prerequisites:

- Node.js 22.13 or newer
- GNU Make

From a fresh clone:

```sh
make bootstrap
```

This installs the pinned pnpm dependencies, prepares the synthetic local D1
database, and installs Playwright's Chromium browser. Codex runs the same
bootstrap automatically when it creates a worktree through the checked-in local
environment configuration. Make invokes the repository-pinned pnpm through npm,
so a global pnpm shim and `corepack enable` are not required.

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

### Persistent Docker development

Docker Compose is the convenient option when the app should keep running after
the terminal or Codex session that started it closes. It requires a
Docker-compatible engine such as Docker Desktop or Colima to be installed and
running.

```sh
make dev-up
```

The Docker development stack uses stable local URLs:

- Web: <http://127.0.0.1:13247>
- API: <http://127.0.0.1:13246>

The services run in the background and restart unless explicitly stopped. Run
the stack from a stable checkout or permanent Codex worktree because the source
directories are mounted into the containers. Dependencies are built into the
development images, while the synthetic local D1 database lives in a
Docker-managed volume. Inspect the stack or follow its logs with:

```sh
make dev-status
make dev-logs
```

Stop it with `make dev-down`. This preserves the Docker volumes, including the
local database, so the next `make dev-up` resumes the same synthetic state. To
rebuild the development images explicitly, run `make dev-build`.

Run `make dev-clean` when you want to remove the containers, network, and
Docker-managed local D1 volume. The next `make dev-up` recreates and seeds a
fresh synthetic database. `make dev-down` never removes volumes.

The native `make db-*` commands operate on the host-side local D1, not the
Docker-managed database. The Compose API applies migrations and the idempotent
synthetic seed automatically when it starts.

The native `make dev` workflow remains available for isolated worktrees and
custom `KEEL_WEB_PORT` or `KEEL_API_PORT` overrides.

Local database commands:

```sh
make db-migrate
make db-seed
make db-check
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
