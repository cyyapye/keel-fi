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
  Obligations, Evidence Inbox, Scenarios, and append-only Forecast History
  views.
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
- Automatic Plaid Investments holdings checks, currently operated with
  Robinhood, that apply deterministic USD long positions and isolate only
  unsupported or identity-ambiguous records. Every Item, account, sync, and
  webhook stays on its exact connection lineage. Holdings runs a deferred due
  check after first paint, while a daily Cloudflare Worker Cron provides a
  bounded backstop on the same 24-hour cooldown. Missing positions keep their
  last accepted values and never imply sales. A clean update versions an
  existing Portfolio Baseline, forecast, and matching FI goal with the already
  accepted other-liquid amount; initial baselines, unavailable values, and
  possible overlaps remain explicit.
- User-initiated Plaid cash-balance checks. Checking, savings, money-market, and
  cash-management observations remain dated proposals until reviewed; missing,
  non-USD, and unavailable balances stay explicit.
- Reviewed obligations from Plaid Liabilities or manual entry. Credit cards,
  mortgages, and student loans remain proposals until review; explicit payment
  treatment previews net liquidity, household burn, runway, and FI gap without
  subtracting every debt balance from cash or counting a payment twice.
- Reviewed observed cash flow from incremental Plaid transaction mutations. Raw
  transaction pages and descriptions are discarded; three complete months become
  aggregate household/business/debt/excluded categories that can prepare a
  runway-plan draft without changing the accepted plan.
- Deterministic plan-versus-actual monitoring on Overview. Reviewed cash, debt,
  burn, and derived runway produce at most one decision per metric; freshness,
  exact-source review-later, clear, and limited states never change the saved
  plan or forecast.
- A Portfolio Baseline step combines accepted public-market holdings, reviewed
  cash accounts, and a manual residual without double counting. Private paper
  remains outside current liquidity. Confirmation versions the FI plan,
  forecast, and matching FI goal together. Cash changes wait for a separate
  baseline review; unavailable values stay unknown and possible overlaps require
  acknowledgment.
- An editable runway plan in Scenarios for household burn, business burn, and
  the protected cash floor. The editor previews the impact without changing the
  accepted plan; saving appends an attributed cash plan and forecast version.
- Cloudflare Access JWT validation that fails closed outside explicit local
  mode.
- D1 migrations, private R2/Queues interfaces, synthetic seed data, CI,
  Dependabot, and secret scanning.

The [product delivery roadmap](docs/product/roadmap.md) records shipped evidence
and the ordered, checkable milestones for the private alpha. Its first unchecked
milestone is the active product slice.

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
[Cloudflare ADR](docs/architecture/adr-001-cloudflare-private-alpha.md). Plaid
cash-account policy is captured in
[ADR 002](docs/architecture/adr-002-reviewed-cash-accounts.md) and its
[deployment runbook](docs/deployment/cash-accounts.md). The optional AngelList
workflow is documented in the
[Mac agent runbook](docs/deployment/angellist-browser-import.md). Reviewed
obligation policy is captured in
[ADR 003](docs/architecture/adr-003-reviewed-liabilities.md) and its
[deployment runbook](docs/deployment/liabilities.md). Observed cash-flow policy
is captured in
[ADR 004](docs/architecture/adr-004-reviewed-observed-cash-flow.md) and its
[deployment runbook](docs/deployment/observed-cash-flow.md). The released model
for Fidelity and other investment institutions, multiple accounts holding the
same security, and multiple SPVs sharing a company exposure is
[ADR 005](docs/architecture/adr-005-multi-source-holdings-identity.md). Its
canonical persistence, pre-live reset boundary, and cost model are documented in
the [multi-source holdings runbook](docs/deployment/multi-source-holdings.md);
container-scoped ingestion, canonical position and exposure views, the
provider-neutral Investments cutover, and multi-institution operations shipped
in M9. Additional-institution authorization remains fail-closed until private
provider coverage, pricing, and owner acceptance are recorded. The released
plan-versus-actual policy is captured in
[ADR 006](docs/architecture/adr-006-plan-actual-monitoring.md) and its
[deployment runbook](docs/deployment/plan-actual-monitoring.md). The in-app
decision queue shipped in M10 without a monitoring schedule, provider request,
or external notification channel.

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

`make dev` migrates and prepares the populated `default` synthetic D1 scenario
before it starts either service. The scenario persists between runs. Use a
different isolated verification state without disturbing it by naming the
scenario:

```sh
make dev SCENARIO=empty-holdings
```

For the legal-entity review walkthrough, use `make dev SCENARIO=entity-review`
and open `/holdings/entities` on the printed web URL. This isolated scenario
seeds native D1 records and downloadable, clearly marked synthetic PDFs into
local R2; it never imports a real portfolio or uses browser-test API mocks.

- Demo Orchard: read a PDF whose name was not extracted.
- Demo Meridian: compare different vehicle names or assign agreements to
  separate investments.
- Demo Growth III / IV: compare a user-confirmed company without a supporting
  citation against an agreement-backed mapping.
- Demo Existing Vehicle: explicitly choose an exact saved entity to link.
- Demo Cancelled Subscription: inspect a separate cancelled interest with no
  copied investment amount, fee, or carry.
- Demo Reviewed Vehicle: inspect optional K-1 ownership shares.

Additional fabricated sources exercise progressive loading. Changes persist
between starts. Stop the server before `make db-reset SCENARIO=entity-review` if
you want to restore this demo; resetting discards only that scenario's local
practice changes.

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

The native `make db-*` commands operate on host-side scenario profiles, not the
Docker-managed database. The Compose API prepares the populated `default`
scenario automatically when it starts.

The native `make dev` workflow remains available for isolated worktrees and
custom `KEEL_WEB_PORT` or `KEEL_API_PORT` overrides.

Local database commands use `SCENARIO=default` unless another registered
scenario is selected:

```sh
make db-seed
make db-reset SCENARIO=empty-holdings
make db-check
make db-scenarios
```

`db-seed` is non-destructive: it migrates an existing current-version profile
and seeds a missing or outdated one. `db-reset` recreates only the named
disposable scenario, which is the deterministic choice for verification. Run
`make db-scenarios` to see each scenario and its purpose. Scenario state lives
under the ignored `.keel-local/scenarios/` directory.

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
| `make db-verify` | Fresh selected seed scenario and D1 invariants             |
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
