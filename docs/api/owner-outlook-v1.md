# Owner outlook API v1

An agent can compare household targets with the wealth Keel has recorded, test a
liquidity reserve through a chosen date, and cite the underlying baseline, plan,
goal versions and price evidence. Every operation reads a single authorized
household. The OpenAPI 3.1 document is generated from the response validators at
`GET /api/v1/openapi.json`.

| Operation                        | Use                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/outlook`            | Read saved goal gaps, the accepted portfolio baseline and reviewed debt, and a 365-day reserve scenario. |
| `POST /api/v1/outlook/preview`   | Supply dated targets, a through date, and optional assumptions for an unsaved scenario.                  |
| `GET /api/v1/marks?baselineId=…` | Inspect the immutable membership and values used in that baseline alongside newer recorded evidence.     |

## Try the synthetic portfolio

Run `make dev` from a bootstrapped checkout. Set `KEEL_ORIGIN` to the API origin
it prints. The reference client uses Node's built-in HTTP client.

```sh
node examples/api/outlook.mjs "$KEEL_ORIGIN"
curl --fail-with-body "$KEEL_ORIGIN/api/v1/openapi.json"
```

For an example with two target dates, supply a hypothetical **annual change in
net worth after spending** and an immediate cash outflow for the liquidity
stress. Use future dates and fabricated inputs in local tests.

```sh
node examples/api/outlook.mjs "$KEEL_ORIGIN" --preview <<'JSON'
{
  "through": "2027-11-08",
  "targets": [
    {"date": "2027-11-08", "amountMinor": 150000000},
    {"date": "2036-11-08", "amountMinor": 250000000}
  ],
  "annualNetWorthChangeMinor": 8000000,
  "immediateCashOutflowMinor": 500000
}
JSON
```

Confirm an initial Portfolio Baseline through Holdings to include portfolio
wealth. When there are no reviewed liabilities, v1 returns a missing-debt
reason. An owner who explicitly wants a zero-debt scenario can supply
`"assumeNoDebt": true`. It cannot override an existing reviewed debt. A scenario
uses the supplied targets for this request only. To persist a dated wealth
target, save a custom monetary goal with metric key `net_worth` through the
existing goal workflow. Its saved progress and the calculation from tracked
assets have distinct evidence.

For a reproducible example with a populated portfolio, run
`pnpm exec vitest run apps/api/src/agent-api/outlook.test.ts scripts/agent-outlook-d1-cost.test.ts`.
The arithmetic example starts with $2,000 of tracked net worth against a
$2,060
one-year target. At $30 of assumed net growth per year, the gap is $60 today and
$30 at the target date. A subsequent $60 private mark closes today's gap while
leaving the cash reserve unchanged. The D1 case exercises the same distinction
through the actual import, baseline confirmation and HTTP routes.

## Interpret the answer

- **Wealth.** USD integer cents. Start with FI-eligible liquid assets and
  private paper from one accepted baseline. Subtract each reviewed obligation's
  most recently accepted outstanding balance once. The result covers that
  recorded portfolio. Off-platform assets and liabilities require separate
  coverage. Quote the baseline ID, source observation time and debt decisions. A
  missing baseline, incomplete values, unresolved overlap, unknown debt or
  ambiguous baseline ordering leaves the tracked figure null with a reason.
- **Goal gaps.** Saved goals retain their own metric and unit. A saved forecast
  supplies a target-date shortfall only if its horizon matches the target date.
  For tracked wealth, `currentShortfallMinor` measures the gap today.
  `requiredAnnualNetIncreaseMinor` gives the minimum annual improvement needed
  over the remaining days. A caller-supplied annual change produces a straight
  line scenario using actual days divided by 365. The agent can compare two
  assumptions and explain the difference. These are nominal amounts, with no
  implicit inflation, investment return or probability assumption.
- **Liquidity.** Start on `evaluatedOn` assuming the saved FI liquid balance and
  burn still apply. Inspect the cash plan's effective date. Deduct any one-time
  stress and reviewed debt payments reserved from liquidity. Add separately
  classified recurring debt payments to burn. Payments already in the plan are
  counted once. Prorate the monthly burn at 12 months per 365 days and round
  total outflow up to a cent. The lowest balance is the ending balance in this
  constant-burn scenario. The response includes any first day below the reserve,
  the shortfall and the monthly burn reduction needed. Include known capital
  calls as explicit outflows. No future private exits, new income or unrecorded
  payments are assumed. No debt reviews means only saved plan spending is
  modeled. Private mark changes never fund this runway.
- **Valuations.** Pass the outlook's `baseline.id` to the marks operation. Each
  row identifies the baseline snapshot and its value, the latest provider
  snapshot and source document, and the effective reviewed valuation when
  available. Quotes use integer millionths of USD per share. Check effective
  dates, share class, carry status and whether the source has changed. A public
  signal is the latest recorded observation for a single reviewed company
  mapping; it does not establish the price of the SPV interest. A capture date
  does not establish a mark date. Report email coverage as unavailable.
- **Limits.** Each outlook reads one D1 batch after authorization. Request more
  saved goals with `afterGoal=nextAfterGoal`; an archive can make a page sparse.
  Marks use `after=nextAfter` within the same baseline (50 rows per page). The
  baseline remains pinned while newer evidence can change between calls. Up to
  512 liability decisions can be reconciled in this on-demand read. A larger
  history produces `debt_history_limit` and suppresses the affected results.
  Scenario input is limited to 8 KiB, eight extra targets and dates up to 50
  years ahead. All reads are on demand, with zero scheduled requests,
  application writes, provider calls or object reads.

## Enable an agent in protected preview

Use the normal Access-protected web origin. Create a dedicated Cloudflare Access
service token for the owner agent and admit it with a Service Auth policy on
that application. Keep the credential pair with the client. The Worker verifies
Access's signed assertion, checks the service identity and uses the household
from the deployment grant. Ordinary provider agents and the deployment smoke
identity retain their own access boundaries.

Set the protected preview environment secrets
`KEEL_PREVIEW_AGENT_READ_SERVICE_SUBJECT` (the service token's client ID, ending
in `.access`) and `KEEL_PREVIEW_AGENT_READ_HOUSEHOLD_ID` (the canonical D1
household ID). The release workflow configures both on the API Worker. Supplying
neither disables agent access. Signed-in owners with one provisioned household
can also use v1. Self-hosted deployments use the corresponding
`AGENT_READ_SERVICE_SUBJECT` and `AGENT_READ_HOUSEHOLD_ID` Worker bindings.

Set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in the client's private
environment. Run the same reference client against the HTTPS web origin. Read
back the contract, check the outlook and follow one marks page. Check that a
call to an existing mutation route is denied using this token. Do not record
financial responses in public release evidence. Remove the deployment grant and
redeploy to withdraw Worker access, or revoke the service token at Access. See
[Cloudflare service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/).

The Worker returns structured error codes for invalid input (400), missing
authentication (401), authorization failure (403), a missing or foreign baseline
(404), an oversized preview (413) and unavailable data (503). Cloudflare Access
can reject a request before it reaches the Worker.
