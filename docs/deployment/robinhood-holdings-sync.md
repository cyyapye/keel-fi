# Robinhood holdings sync

Keel reads current Robinhood positions through Plaid Investments and stages each
snapshot as a holding import. The versioned holdings policy automatically
applies supported USD long positions with deterministic identities. Anything
uncertain is isolated from accepted holdings with an immutable policy decision
or quarantine record. A position omitted from a later snapshot keeps its last
accepted value and is never treated as sold or closed.

Robinhood's downloadable
[account-activity report](https://robinhood.com/us/en/support/articles/finding-your-account-documents/)
contains transactions rather than a canonical current-holdings snapshot. Do not
reconstruct accepted positions from that CSV. Plaid's Investments holdings
endpoint is the source for this first integration.

## Plaid setup

1. Create a Plaid application with the Investments product enabled and obtain
   the environment-specific client ID and secret.
2. Request the Plaid production access needed to connect Robinhood. Sandbox is
   suitable only for synthetic local testing.
3. Register the exact Keel Holdings URL as the OAuth redirect URI, for example
   `https://keel-preview.example.com/holdings`. The URI must use HTTPS outside
   local development and must match `PLAID_REDIRECT_URI` exactly.
4. Configure a dedicated webhook hostname on the web Worker. Preview derives it
   by adding `-webhooks` to the first hostname label, for example
   `https://keel-preview-webhooks.example.com/webhooks/plaid`. Set that exact
   HTTPS URL as `PLAID_WEBHOOK_URL` in local or private Worker configuration.
5. Generate an independent 32-byte connector-encryption key:

   ```sh
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
   ```

6. Configure all five Worker secrets together:

   - `CONNECTOR_CREDENTIAL_KEY`: the base64url key generated above;
   - `PLAID_CLIENT_ID`;
   - `PLAID_ENVIRONMENT`: `sandbox` or `production`;
   - `PLAID_REDIRECT_URI`; and
   - `PLAID_SECRET`.

For local Wrangler development, put these values in the ignored
`apps/api/.dev.vars` file. Never copy them into tracked configuration. The Plaid
access token is encrypted with AES-GCM before it is stored in the private R2
binding. D1 retains only an opaque object reference and an HMAC-derived account
key; it never stores Plaid's raw Item ID.

Changing `CONNECTOR_CREDENTIAL_KEY` makes existing encrypted connections
unreadable. Plan a Robinhood reconnect immediately after an intentional key
rotation.

For the automatic preview deployment, add the corresponding GitHub environment
secrets with the `KEEL_PREVIEW_` prefix:

- `KEEL_PREVIEW_CONNECTOR_CREDENTIAL_KEY`;
- `KEEL_PREVIEW_PLAID_CLIENT_ID`;
- `KEEL_PREVIEW_PLAID_ENVIRONMENT`;
- `KEEL_PREVIEW_PLAID_REDIRECT_URI`; and
- `KEEL_PREVIEW_PLAID_SECRET`.

The preview generator accepts either the complete group or none of it. When the
group is absent, the existing deployment remains healthy and Holdings shows a
bounded setup-required state.

## Sync contract

- Link is restricted to an institution whose Plaid identity is Robinhood and
  whose enabled products include Investments.
- Plaid responses are size-bounded and schema-validated before use.
- Money is converted from Plaid decimal strings to integer minor units without
  JavaScript floating-point arithmetic. Quantities use integer millionths.
- Raw brokerage responses and encrypted credentials stay in the private R2
  binding. Public API responses expose only normalized holdings and bounded
  exception details.
- Supported USD long positions are accepted by `robinhood-holdings-auto-v1`.
  Each decision records the policy version, evidence fingerprint, reason codes,
  and resulting snapshot application.
- Missing cost basis does not block an otherwise usable market value. It stays
  explicitly unavailable.
- Unsupported security types and possible identity changes are quarantined at
  the affected row. Non-USD, short, or malformed provider responses fail closed
  before any accepted holding changes.
- If a previously accepted position is absent, Keel preserves its latest
  snapshot and records a `position_not_reported` exception. If a new identity
  appears in the same snapshot, that new row is also isolated so a corporate
  action cannot silently double-count the portfolio.
- Consecutive identical normalized snapshots are deduplicated. A no-change sync
  creates no redundant review, while a later return to an older portfolio state
  still creates a new review.
- Link registers the exact webhook URL. Existing connections register it during
  their next manual check, after which Holdings reports automatic updates as
  enabled.
- Keel accepts only `HOLDINGS: DEFAULT_UPDATE` on the dedicated webhook host.
  The API verifies Plaid's `ES256` JWT, fetches the exact `kid`, rejects keys or
  deliveries outside their time bounds, and compares the signed SHA-256 claim
  with the exact bounded request body before parsing it.
- A valid delivery is replay-deduplicated by its signature hash and queued by an
  opaque delivery ID. Unknown Items are acknowledged without revealing whether a
  connection exists. Raw bodies, bearer values, Item IDs, and user IDs are
  absent from D1, Queue messages, and logs.
- Queue processing uses the same policy as a manual check. Clear rows are
  applied automatically; exceptions stay unchanged and visible in Holdings.
- A clean update refreshes an existing Portfolio Baseline, forecast, and FI goal
  with the already accepted other-liquid amount. Initial baselines, possible
  cross-provider overlaps, and any quarantined update still require the existing
  explicit baseline flow.
- Keel relies on Plaid's periodic Investments refresh and `DEFAULT_UPDATE`
  notification. The optional on-demand Investments Refresh add-on is not
  required for this flow; “Check now” remains a manual fallback.

Reference the official
[Plaid Investments overview](https://plaid.com/docs/investments/),
[Investments API](https://plaid.com/docs/api/products/investments/), and
[webhook verification guide](https://plaid.com/docs/api/webhooks/webhook-verification/)
when changing the integration.
