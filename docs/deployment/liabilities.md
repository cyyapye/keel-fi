# Reviewed obligations

Keel can retrieve supported credit-card, mortgage, and student-loan details
through Plaid Liabilities or accept a manual entry. Both paths create proposals.
The user must review every row and choose how the next payment affects the
obligation planning view.

The integration does not initiate payments, recommend payoff or refinancing,
schedule background retrievals, subtract all principal from liquidity, or mark a
missing account as repaid.

## Plaid setup

1. Enable Liabilities for the Plaid application and confirm institution coverage
   for the private deployment. Keel's Link request uses
   `products: ["liabilities"]` and US account filters for credit cards, PayPal
   credit, mortgages, and student loans.
2. Keep the existing Plaid secret group configured:

   - `CONNECTOR_CREDENTIAL_KEY`, an independent 32-byte base64url key;
   - `PLAID_CLIENT_ID`;
   - `PLAID_ENVIRONMENT`, set to `sandbox` or `production`;
   - `PLAID_REDIRECT_URI`; and
   - `PLAID_SECRET`.

3. Register both the existing Holdings redirect and the same origin's
   `/obligations` path in Plaid. Keel derives `/obligations` from the configured
   `PLAID_REDIRECT_URI`, so no second environment variable is needed.
4. Record the deployment's Liabilities subscription rate from the Plaid
   dashboard or contract. The public documentation describes the billing model
   but does not publish the applicable contract rate.
5. Confirm a provider-retention owner and ceiling for private R2 before enabling
   production use.

For local Wrangler development, use the ignored `apps/api/.dev.vars`. For the
automated preview deployment, use the existing `KEEL_PREVIEW_` secret names in
the GitHub `preview` environment. The secret group is all-or-nothing. When it is
absent, the app remains healthy, reports import setup is required, and leaves
manual obligation review available.

Rotating `CONNECTOR_CREDENTIAL_KEY` makes existing encrypted Plaid credentials
unreadable. Remove Items at Plaid before rotation or reconnect each affected
institution afterward; do not assume deleting an unreadable local object stops
provider billing.

## Retrieval and cost contract

- Linking makes one `/liabilities/get` request and prepares a dated proposal.
- **Check obligations** is the only UI action that makes another Liabilities
  request.
- Each institution is capped at four attempted user-triggered requests per UTC
  calendar month. Failed attempts after the provider boundary count toward the
  cap.
- A waiting proposal or active request blocks another retrieval.
- M7 configures no Liabilities webhook and no scheduled or Queue-driven
  retrieval. Plaid's daily data-refresh cadence therefore does not create Keel
  calls by itself.
- Liabilities is billed monthly per connected Item while an access token exists,
  with no proration. The request cap bounds retrieval and storage, not the
  subscription rate.
- **Disconnect** calls `/item/remove` first. Only after Plaid confirms removal
  does Keel revoke the connection and delete its encrypted credential.

At the 5 MiB response limit, retained raw bytes are capped at 25 MiB per
institution in the first connected UTC month and 20 MiB in a later month.
Unchanged normalized results are deleted immediately. D1 can add at most 100
proposal rows per retained result. Monitor actual R2/D1 growth and rejected
provider responses without logging payloads or financial values.

Use Plaid's official documentation for the
[Liabilities overview](https://plaid.com/docs/liabilities/),
[Liabilities API](https://plaid.com/docs/api/products/liabilities/),
[product initialization](https://plaid.com/docs/link/initializing-products/),
and [billing behavior](https://plaid.com/docs/account/billing/) when changing
this contract.

## Data and review contract

- The API rejects response bodies larger than 5 MiB and Zod-validates every
  provider boundary.
- USD money becomes integer minor units; APR percentages become integer parts
  per million. Negative, non-USD, absent, and unsupported values never become a
  numeric planning input.
- The encrypted credential and retained raw response stay under opaque keys in
  private R2. D1 and browser output use only HMAC-derived or internal IDs.
- Provider observations and manual entries both become proposals. Every row
  needs an accepted or excluded decision, and every accepted row needs a
  compatible payment treatment.
- Revolving next payments may reserve liquidity. Scheduled next payments may add
  household burn. **Already included in the plan** makes no numeric change and
  is required when the payment is unknown.
- Accepted data becomes stale after 45 days. Missing provider data becomes
  `not_reported`; it never becomes zero, repaid, or closed automatically.
- Applying an obligation review changes only the reviewed obligation baseline
  and its derived view. It does not write the accepted cash-flow plan, Portfolio
  Baseline, goal, or forecast.

## Private acceptance

Use Plaid Sandbox and synthetic values for release evidence:

1. Confirm the authenticated Obligations page loads when the Plaid secret group
   is absent and that manual entry still opens.
2. With the secret group present, select **Connect institution** and verify Link
   opens for the eligible account types. Opening Link is sufficient for a
   provider-boundary check; do not enter real credentials for release evidence.
3. Complete a Sandbox connection. Confirm a dated proposal appears and that no
   accepted plan, goal, forecast, or Portfolio Baseline changes before review.
4. Review one revolving payment, one scheduled payment, and one unsupported or
   unknown value. Confirm the preview changes liquidity and burn only according
   to the selected treatments.
5. Verify a fifth user-triggered request fails before a provider call and a
   waiting proposal blocks another request.
6. Select **Disconnect**, confirm reviewed history remains, and verify the
   provider Item is removed before the local encrypted credential disappears.

Never attach real account labels, balances, due dates, raw responses, tokens,
provider request logs, or screenshots of real institutions to GitHub, CI, or
release notes.
