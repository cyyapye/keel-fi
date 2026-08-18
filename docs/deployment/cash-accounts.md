# Reviewed cash accounts

Keel links checking, savings, money-market, and cash-management accounts through
Plaid, stages dated balance proposals, and stops. Applying a cash review creates
accepted source facts; it does not change the FI plan. A separate Portfolio
Baseline confirmation combines those facts with reviewed public holdings and a
manual residual.

This integration never requests routing or account numbers, calls `/auth/get`,
ingests transactions, runs a background balance schedule, or interprets a
missing account as closed or empty.

## Plaid setup

1. Enable Auth for the Plaid application and confirm the production institution
   coverage needed by the private deployment. Keel initializes Link with
   `products: ["auth"]`.
2. Enable Transactions only as an additional consented product. Keel sends
   `additional_consented_products: ["transactions"]`; the balance path never
   requests transaction data. Observed cash flow activates Transactions only
   after a separate deployment-price confirmation. See the
   [observed cash-flow runbook](observed-cash-flow.md).
3. Register the exact HTTPS Holdings URL as an OAuth redirect, for example
   `https://keel-preview.example.com/holdings`, and set it as
   `PLAID_REDIRECT_URI`.
4. Before production use, record the account-specific Auth and Balance prices
   from the Plaid dashboard or contract. Plaid does not publish the applicable
   contract rate publicly.
5. Configure the shared Plaid Worker secret group:

   - `CONNECTOR_CREDENTIAL_KEY`, an independent 32-byte base64url key;
   - `PLAID_CLIENT_ID`;
   - `PLAID_ENVIRONMENT`, set to `sandbox` or `production`;
   - `PLAID_REDIRECT_URI`; and
   - `PLAID_SECRET`.

For local Wrangler development, put the values in the ignored
`apps/api/.dev.vars` file. For automatic preview deployment, configure the same
names with the `KEEL_PREVIEW_` prefix in the GitHub `preview` environment. The
group is all-or-nothing; if it is absent, the app remains healthy and shows a
setup-required state.

The same keys can support Robinhood holdings and cash accounts. Rotating
`CONNECTOR_CREDENTIAL_KEY` makes every existing encrypted Plaid connection
unreadable and requires reconnecting it.

## Retrieval and cost contract

- Initial linking uses the cached `/accounts/get` response and consumes no live
  balance-check allowance.
- Opening Holdings attempts `/accounts/balance/get` only when the institution
  has no live attempt in the preceding seven days.
- A failed automatic check exposes a bounded manual retry; healthy connections
  do not repeat a routine **Check balances** action.
- Each institution is capped at four attempted live checks per UTC calendar
  month. There is no background schedule or webhook-triggered cash refresh, so a
  page reload inside the cooldown makes no provider request.
- Keel permits only one active check or waiting proposal per connection, so an
  older review cannot be overtaken by another paid result.
- An exact no-change result completes the check without creating another review
  or changing the last accepted cash fact. New, changed, missing, and
  unsupported rows remain review proposals.
- The maximum live-balance cost is therefore
  `4 × the deployment's Plaid contract rate` per institution each month, plus
  any one-time Auth charge for linking.
- Plaid Trial is free and limits Production to 10 live Items; Plaid does not
  publish a separate monthly allowance of Balance calls. The four-attempt limit
  is Keel's own maximum-cost guard.

Use Plaid's official documentation for
[Link product initialization](https://plaid.com/docs/link/initializing-products/),
[Link token options](https://plaid.com/docs/api/link/),
[Accounts](https://plaid.com/docs/api/accounts/),
[Balance](https://plaid.com/docs/balance/), and
[billing behavior](https://plaid.com/docs/account/billing/), including Trial
limits, when changing this contract.

## Data and review contract

- Link is limited to US depository checking, savings, money-market, and
  cash-management subtypes.
- Provider payloads are byte-bounded and Zod-validated before use. Decimal USD
  strings become integer minor units without JavaScript floating-point money
  arithmetic.
- A non-negative available balance is preferred; otherwise Keel uses a
  non-negative current balance. Negative, non-USD, absent, and unsupported
  values stay unavailable or unsupported and cannot be accepted as usable cash.
- The encrypted access token and raw provider response stay under opaque keys in
  private R2. D1 stores an opaque object reference, HMAC-derived account key,
  normalized proposal rows, and append-only review decisions. Routing numbers,
  account numbers, raw Item IDs, and raw Plaid account IDs do not enter D1,
  logs, or browser responses.
- Keel reconciles an account's protected provider key with its protected
  Item-scoped key. If the provider rotates one key while preserving the other,
  the account keeps one reviewed lineage; matching institution or account names
  alone never merge accounts.
- If Plaid rotates both keys and supplies no persistent account ID, Keel shows a
  possible duplicate only for an unambiguous one-reported/one-missing pair with
  the same label and subtype in one reviewed proposal. **Same account** appends
  a protected-key link; **Keep separate** appends the opposite decision. Neither
  choice rewrites the accepted observations, and names alone never decide it.
- A missing previously accepted account becomes an explicit `not_reported` row.
  The user may accept that state to clear the stale balance, but Keel never
  infers closure, withdrawal, or a zero balance.
- Portfolio Baseline confirmation includes reviewed public holdings and linked
  cash once and keeps a separate manual residual. Exact bank-account and
  brokerage-position identities are counted together automatically. A positive
  manual residual alongside either sourced cash category requires explicit
  confirmation because the residual has no source identity.

## Private acceptance

Verify the provider boundary without recording private data in repository or CI
artifacts:

1. Confirm the Plaid secret group is complete and the authenticated Holdings
   page reports cash accounts as enabled.
2. Select **Add bank** and verify Plaid Link opens with eligible bank
   institutions. This proves token creation and the Link boundary; do not enter
   real credentials merely for release evidence.
3. In a disposable Sandbox profile, complete Link with Plaid's synthetic user,
   confirm a dated proposal appears, and verify no FI value changes before the
   cash review and subsequent Portfolio Baseline confirmation.
4. Apply a synthetic review containing a supported USD balance and an
   unsupported or missing balance. Confirm only the supported decision enters
   the baseline preview and that the manual-cash overlap checkbox is required.
5. Verify the first due Holdings visit starts one live check, another visit
   inside seven days makes no provider call, and a fifth monthly attempt fails
   closed with no provider call.

Keep account names, balances, tokens, screenshots of real institutions, raw
responses, and provider request logs out of GitHub issues, CI artifacts, and
release notes.

Disconnecting from Observed cash flow removes the shared Plaid Item, so cash
balance access also ends. Reviewed cash facts remain available for audit and a
future connection requires a fresh review.
