# ADR 002: Reviewed cash-account balances

- Status: Accepted
- Date: 2026-08-14

## Context

Keel's FI baseline currently combines reviewed public holdings with a manually
entered residual for other liquid assets. Checking, savings, money-market, and
cash-management balances should become dated source facts without granting a
provider permission to change the plan or creating an unbounded paid refresh
loop.

Plaid requires Link to be initialized with at least one product. `Auth` supports
the depository accounts Keel needs, while
[`additional_consented_products`](https://plaid.com/docs/link/initializing-products/)
can collect consent for a later product without fetching it or starting its
billing. Cached balances from
[`/accounts/get`](https://plaid.com/docs/api/accounts/) are free but can be old
for an Auth-only Item. A call to
[`/accounts/balance/get`](https://plaid.com/docs/balance/) requests a live
balance and is billed per successful request at the account-specific contract
rate. Plaid's Trial access is free and limits Production to 10 live Items; it
does not publish a separate monthly allowance of live Balance requests. Keel's
request ceiling below is therefore its own cost guard, not a Plaid Trial quota.

## Decision

Use Plaid for cash-account observations with these boundaries:

- initialize Link with `products: ["auth"]` and
  `additional_consented_products: ["transactions"]`;
- limit Link to US checking, savings, money-market, and cash-management
  accounts;
- do not call `/auth/get`, request routing data, or store account or routing
  numbers;
- use the free `/accounts/get` response immediately after a new Item is linked;
- when Holdings loads, call `/accounts/balance/get` only when the institution
  has no pending review or active refresh and no live attempt in the preceding
  seven days;
- offer a manual retry only after a failed automatic check;
- allow at most four live balance requests per connected institution per UTC
  calendar month, including an attempted request once it crosses Keel's provider
  boundary; and
- do not run a background schedule or subscribe to Transactions in this
  milestone.

The fixed request ceiling makes the maximum live-balance cost per institution
`4 × the Plaid contract rate` each month. Plaid does not publish the exact
account-specific rate, so the operator must verify it in the Plaid dashboard or
contract before enabling production. Initial linking uses the free cached
endpoint and does not consume this ceiling.

Every provider response is validated at the API boundary and retained under an
opaque key in private R2. D1 stores only household-scoped connection metadata,
HMAC-derived account keys, normalized integer USD minor units, proposal rows,
and append-only review decisions. Keel prefers a non-negative available balance
when Plaid reports one, otherwise a non-negative current balance. Missing,
non-USD, or negative values remain explicit and cannot be accepted as usable
cash.

A provider fetch with a new, changed, missing, or unsupported account creates a
proposal. An exact no-change result completes the checked connection without a
proposal and without mutating accepted cash facts. Neither path directly changes
the portfolio baseline, a cash-flow plan, a goal, or a forecast. The user must
review each material account result and apply the proposal. A later Portfolio
Baseline review then combines accepted cash with reviewed public holdings, keeps
a separate manual residual, and identifies reviewed brokerage cash positions
separately. Linked bank accounts and brokerage cash positions have exact
accepted source identities and are counted together automatically. Only a
positive manual residual alongside either sourced cash category requires an
explicit overlap acknowledgment because the manual amount has no source
identity. The review previews the FI and runway effects, then appends the
resulting plan, forecast, and goal versions.

Plaid may omit `persistent_account_id` and may rotate `account_id`. When that
happens, protected provider keys cannot prove whether a newly reported record
and a missing prior record are the same account. Keel may suggest a possible
match only when one reported record and one missing record form an unambiguous
same-label and same-subtype pair in one reviewed proposal. The labels are
candidate evidence, not identity. The user must choose **Same account** or
**Keep separate**. That append-only decision either links the protected keys in
the read projection or records that they remain distinct; accepted source rows
are never rewritten.

## Consequences

Positive:

- provider access is narrower than enabling transaction ingestion early;
- paid calls are visible and bounded;
- due balances refresh on a Holdings visit without another routine click;
- missing accounts cannot be interpreted as withdrawals or spending; and
- complete provider-identity rotation remains visible until explicitly reviewed;
  and
- cash facts pass through the same review-first trust boundary as holdings.

Tradeoffs:

- Auth itself is billed when an Item is created;
- a Holdings visit may use one paid live check after the seven-day cooldown,
  while the monthly ceiling still bounds the total;
- transaction history remains unavailable until its own reviewed milestone; and
- liabilities and negative balances remain out of scope rather than being
  silently netted against cash.
