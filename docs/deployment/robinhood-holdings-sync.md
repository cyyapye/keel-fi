# Robinhood holdings sync

Keel reads current Robinhood positions through Plaid Investments and stages each
snapshot as a holding import. A sync never changes accepted holdings until the
user reviews and applies the import. A position omitted from a later snapshot is
not treated as sold or closed.

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
  binding. Public API responses expose only normalized review rows.
- Unsupported security types, non-USD values, short positions, and missing cost
  basis are surfaced for attention and cannot be silently applied.
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
- Queue processing reads the latest holdings snapshot and stages the same
  review-gated import as a manual check. It never applies holdings, infers a
  sale from a missing position, confirms a Portfolio Baseline, or changes a
  goal.
- Keel relies on Plaid's periodic Investments refresh and `DEFAULT_UPDATE`
  notification. The optional on-demand Investments Refresh add-on is not
  required for this flow; “Check now” remains a manual fallback.

Reference the official
[Plaid Investments overview](https://plaid.com/docs/investments/),
[Investments API](https://plaid.com/docs/api/products/investments/), and
[webhook verification guide](https://plaid.com/docs/api/webhooks/webhook-verification/)
when changing the integration.
