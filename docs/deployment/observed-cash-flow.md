# Reviewed observed cash flow

Keel can compare the last three complete months of activity from reviewed Plaid
cash accounts with the accepted runway plan. Transaction activity creates only a
review proposal. The accepted plan changes only through the existing Scenarios
preview and **Save plan** action.

This integration does not retain raw transactions, show merchants, classify
taxes, call `/transactions/refresh`, schedule checks, process Transactions
webhooks, initiate payments, or change burn automatically.

## Production activation gate

Complete this worksheet privately for every deployment before the first real
Transactions sync:

| Input                                    | Required record                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Plaid Transactions monthly rate per Item | Contract or dashboard amount and currency                                 |
| Number of Items to activate              | Approved institution count                                                |
| Expected user checks                     | Sync runs per Item per month, no more than 124                            |
| Expected provider page requests          | Include pagination and bounded restart behavior, no more than 5,952       |
| Expected successful syncs                | No more than 31 per Item in a 31-day month                                |
| Expected mutation revisions              | Measured Sandbox/pilot mutations, no more than 155,000 per Item per month |
| Workers and D1 plan                      | Included request, query, row-write, and storage allowances                |
| Expected incremental monthly cost        | Transactions total plus any Workers/D1 overage                            |
| Retention owner                          | Person responsible for the 24-month rule and disconnect verification      |
| Approval                                 | Owner, date, and approved monthly ceiling                                 |

Do not put contract rates, account labels, real mutation counts, screenshots, or
approval records in the public repository. If the worksheet is incomplete, leave
the UI confirmation unchecked and do not ingest real transactions.

Transactions is billed monthly per active Item after the product is first used,
without proration. Confirm the current terms in Plaid's
[billing documentation](https://plaid.com/docs/account/billing/) and deployment
contract. The consent checkbox records that this deployment-specific review
happened; it does not calculate or approve the price.

## Request and storage contract

- Keel reuses the existing cash-account access token and calls only
  `/transactions/sync`.
- Initial history is 125 days so the last three whole calendar months are
  covered at every point in the year. Later checks use the stored cursor.
- Keel requests Plaid's v2 personal-finance taxonomy and advances the cursor
  only after every page reports `HISTORICAL_UPDATE_COMPLETE`.
- A page is capped at 500 mutations and 1.5 MB. A complete check is capped at 16
  pages, 10 MB, and 5,000 mutations.
- Up to four user-triggered sync runs are available per institution per UTC day,
  but only one successful check is allowed that day.
- A waiting cash-flow review, prepared plan draft, cash-balance review, or
  active provider call blocks disconnect or another cash-flow check.
- Raw pages are discarded after bounded validation. R2 receives no transaction
  response object. D1 receives only the redacted normalized fields listed in
  [ADR 004](../architecture/adr-004-reviewed-observed-cash-flow.md).
- One atomic D1 storage batch uses at most 16 statements. Mutation revisions are
  inserted through bounded 500-row `json_each` expansions, keeping the complete
  request within the current 50-query Free-plan invocation limit.
- Successful checks purge normalized mutation revisions older than 24 months.
  Activation events, aggregate reviews, plans, and forecasts remain audit
  history.

The theoretical 31-day maximum per Item is 124 user-triggered sync runs, 5,952
provider page requests after bounded pagination restarts, 31 successful syncs,
155,000 normalized mutation revisions, and zero raw R2, webhook, Queue, or
scheduled-ingestion volume. A user-triggered run accepts at most 10 MB across
all pagination attempts and makes at most 48 external requests, below the
current Workers Free
[subrequest limit](https://developers.cloudflare.com/workers/platform/limits/).
Measure expected incremental mutation volume in Plaid Sandbox before approving
D1 cost; do not budget from the theoretical ceiling alone.

Use Plaid's official documentation for
[`/transactions/sync`](https://plaid.com/docs/api/products/transactions/),
[transaction mutation handling](https://plaid.com/docs/transactions/transactions-data/),
[Transactions webhooks](https://plaid.com/docs/transactions/webhooks/), and
[billing](https://plaid.com/docs/account/billing/) when changing this contract.
Use Cloudflare's current
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), and
[`json_each` guidance](https://developers.cloudflare.com/d1/sql-api/query-json/)
when changing the storage ceiling or budget.

## Review contract

- All reviewed cash institutions must have completed a sync.
- Each of the last three complete UTC months must contain at least one posted,
  supported-currency outflow from a reviewed account.
- Positive Plaid amounts count as outflow. Pending, non-USD, zero/negative,
  income, refund, and unreviewed-account activity does not enter burn.
- Primary categories are reviewed only as aggregates. Loan payments default to
  debt payment; income and transfers default to excluded; other categories
  default to household burn.
- Reviewed obligations marked already in-plan or add to household burn remain in
  the proposal unless observed loan payments are explicitly assigned to
  household or business burn, preventing double counting.
- The user may change an aggregate to household, business, excluded, or debt
  payment. The review note and every decision are required.
- Keel proposes only material changes. Review prepares a draft; saving the plan
  remains a separate explicit action and fails if the base plan changed.

## Disconnect and deletion

Use **Disconnect** from Observed cash flow when the deployment no longer needs
the bank connection or its Transactions subscription. Disconnect is blocked
while a cash-balance or cash-flow review/check is active.

On confirmation, Keel:

1. pauses local provider work;
2. decrypts the credential only in Worker memory;
3. calls Plaid `/item/remove`;
4. deletes the encrypted credential from private R2;
5. deletes the operational cursor and all normalized transaction revisions; and
6. revokes the shared cash connection.

If Plaid removal fails, Keel restores the active local connection and retains
the credential so the operation can be retried. Reviewed balance facts,
activation events, aggregate proposals, category decisions, accepted plans, and
forecast versions remain. Reconnecting the institution creates a fresh
activation boundary and requires pricing confirmation again.

If the response reports an error after Plaid confirms removal, verify privately
that the Item is gone, the encrypted R2 object is absent, the connector is
revoked, and normalized transaction revisions are empty. Follow the
[backup and recovery runbook](backup-and-recovery.md) before any manual D1
repair. Do not paste object keys, transaction facts, or provider responses into
issues or logs.

## Synthetic private acceptance

Use Plaid Sandbox and fabricated values only:

1. With Plaid settings absent, confirm Scenarios remains healthy and Observed
   cash flow shows setup required.
2. Connect and review a Sandbox cash account in Holdings. Confirm Observed cash
   flow requires the pricing checkbox before the first sync.
3. Start the comparison and verify the request uses `/transactions/sync`, asks
   for 125 days plus the v2 category taxonomy, waits for complete history, and
   writes no raw transaction R2 object.
4. Exercise added, modified, removed, pending, non-USD, negative, loan-payment,
   transfer, and unknown-category fixtures. Verify HMAC deduplication and the
   visible exclusion counts.
5. Confirm a missing complete month or unsynced reviewed institution withholds a
   proposal.
6. Review aggregate household/business/debt/excluded treatments. Verify no plan
   changes before **Save plan**, and a stale base fails closed.
7. Verify a second successful check that UTC day and a fifth failed attempt are
   rejected before credential access or a Plaid call.
8. Disconnect the Sandbox Item. Confirm the Item and encrypted credential are
   removed, normalized transaction revisions are deleted, and reviewed
   aggregate/plan history remains.

Never use real credentials merely to create release evidence. Never attach real
transaction descriptions, amounts, account labels, provider IDs, raw responses,
R2 keys, or authenticated screenshots to GitHub, CI, or release notes.
