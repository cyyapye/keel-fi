# ADR 003: Reviewed obligation baseline

- Status: Accepted
- Date: 2026-08-14

## Context

Keel's reviewed FI baseline currently explains liquid assets and cash without
showing the debt payments that can constrain near-term runway. A useful debt
view must preserve two distinctions:

1. an outstanding principal is not necessarily due from usable liquidity now;
2. a payment already represented in accepted household burn must not be counted
   a second time.

Plaid's [Liabilities product](https://plaid.com/docs/liabilities/) reports
credit card, mortgage, and student-loan details for supported institutions.
Coverage is primarily US with limited Canadian support, while Keel's first
implementation is restricted to US accounts and USD values. Plaid generally
refreshes liability data about once per day and can emit `DEFAULT_UPDATE`, but
this milestone does not need background retrieval to produce a useful reviewed
baseline.

Liabilities is a
[monthly subscription product](https://plaid.com/docs/account/billing/). An Item
is billed for each UTC month in which an access token exists, even when no
Liabilities request is made or the request returns an error. Billing is not
prorated. The applicable rate is deployment-specific and must be read from the
Plaid contract or dashboard.

## Decision

### Classification and planning treatment

Every obligation is classified deterministically:

| Kinds                                        | Classification | Available treatment                      |
| -------------------------------------------- | -------------- | ---------------------------------------- |
| Credit card, other revolving debt            | Revolving      | Reserve next payment, or already in plan |
| Mortgage, student loan, other scheduled debt | Scheduled      | Add payment to burn, or already in plan  |

The accepted record retains outstanding balance, next required payment, rate,
due date, overdue state, value-effective date, retrieval date, and the reviewed
payment treatment. The planning preview then applies these rules using integer
minor units only:

- **Reserve next payment from liquidity:** subtract the reviewed next payment
  from FI-eligible liquid for the obligation view. Do not subtract principal or
  add the same payment to burn.
- **Add next payment to monthly burn:** add the reviewed payment to household
  monthly burn. Do not subtract principal or reserve the same payment from
  liquidity.
- **Already included in the plan:** retain the obligation as debt context while
  making no numeric change. This is the only accepted treatment when the next
  payment is unknown.

The resulting view shows obligation-adjusted net liquidity, household burn,
protected runway, and FI gap. It does not mutate the accepted cash-flow plan,
Portfolio Baseline, goal, or forecast snapshot. A later observed-cash-flow
milestone may propose a plan revision while using the treatment to prevent a
payment from being counted twice.

Deterministic examples:

1. A reviewed credit-card balance of `$2,400.00` with a `$125.00` minimum
   payment contributes `$2,400.00` to reported outstanding debt and reserves
   `$125.00` from the obligation view's liquid balance. It does not reduce
   liquidity by `$2,400.00`.
2. A reviewed student-loan balance of `$48,000.00` with a `$450.00` next payment
   contributes `$48,000.00` to reported outstanding debt and adds `$450.00` to
   household monthly burn.
3. A mortgage payment already present in accepted household burn uses **Already
   included in the plan**, so neither liquidity nor burn changes again.
4. A missing or unavailable balance remains unknown. A missing payment has no
   numeric effect and cannot use a treatment other than **Already included in
   the plan**. Missing data never means zero, closed, or repaid.

For a mortgage, Plaid may report both `next_monthly_payment` and
`past_due_amount`. Keel uses the larger non-negative amount as the bounded
near-term payment proxy rather than summing fields whose overlap is not stated.
For credit cards with several APR entries, Keel retains the highest reported APR
as context; the rate does not drive a payoff recommendation or forecast.

### Review and persistence

A Plaid response or manual entry creates an obligation proposal. It cannot
directly change an accepted obligation or any planning record. The user reviews
every row, chooses accepted or excluded, and selects a compatible payment
treatment for every accepted row. Excluding a new observation leaves the prior
accepted obligation in place.

Provider response bytes are capped at 5 MiB and validated with Zod. Money is
converted to integer USD minor units and rates to integer parts per million
without floating-point money arithmetic. Private R2 retains the encrypted access
credential and only raw responses that create a changed proposal. D1 retains
household-scoped connection metadata, HMAC-derived Item/account keys, normalized
proposals, and immutable review decisions. Raw Item IDs, Plaid account IDs,
access tokens, addresses, and account numbers do not enter D1, logs, or browser
responses.

Manual fallback uses the same proposal and review path but stores no source
object or provider identifier. Re-entering the same kind, institution, and
account label creates a proposed revision of that manual obligation instead of
double counting it; an existing draft must be reviewed first. Empty manual
amounts remain unknown.

Accepted values are current for 45 days after retrieval and then surface as
stale. A later provider response that omits a previously reviewed account
creates a `not_reported` proposal. The prior accepted value remains in force
until the user accepts or excludes that proposal; omission is never interpreted
as repayment.

### Retrieval, billing, and storage ceiling

Link is initialized with `products: ["liabilities"]` and filters to US credit
cards, PayPal credit, mortgages, and student loans. Keel makes one
`/liabilities/get` request after linking and at most four user-triggered
requests per institution per UTC month. An attempted request consumes the
allowance once it crosses the provider boundary. A waiting review or active
request blocks another retrieval.

Keel does not configure a Liabilities webhook, schedule a retrieval, or enqueue
Liabilities work. A signed non-Holdings Plaid webhook that reaches Keel's shared
endpoint is verified and ignored; it never triggers a Liabilities request.
Therefore the M7 webhook-triggered request and Queue volume is zero.

Worst-case retained raw response growth is bounded by the response limit:

- first connected UTC month: `1 initial + 4 explicit = 5 responses`, or at most
  25 MiB per institution;
- later UTC months: at most `4 responses`, or 20 MiB per institution; and
- unchanged normalized results are deleted immediately instead of retained.

Actual D1/R2 growth should be monitored before production retention is set. A
deployment-specific retention or redaction policy remains required before
provider-backed production use is enabled; accepted facts and review decisions
remain audit records. Shipping the connector disabled leaves the manual review
path available without retaining provider responses.

Disconnect calls Plaid `/item/remove` before revoking local access and deleting
the encrypted credential. This stops future subscription periods according to
Plaid's billing contract while preserving reviewed history. An active
institution cannot be silently replaced: it must be disconnected first, and a
newly exchanged duplicate Item is removed if connection creation is rejected.

## Consequences

Positive:

- debt context affects runway without subtracting all principal from cash;
- explicit treatment prevents known payment double counting;
- missing, stale, unsupported, and overdue states stay visible and reviewable;
- paid access and retained bytes have deterministic ceilings; and
- provider support is optional because manual review remains available.

Tradeoffs:

- the subscription continues while an Item remains connected, regardless of
  Keel's request cap;
- daily provider refresh does not become visible until the user requests a
  retrieval;
- the obligation view does not yet reconcile accepted burn with observed cash
  flow; and
- provider coverage and exact pricing must be confirmed for the deployment.
