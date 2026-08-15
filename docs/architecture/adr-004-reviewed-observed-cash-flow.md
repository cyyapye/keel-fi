# ADR 004: Reviewed observed cash flow

- Status: Accepted
- Date: 2026-08-15

## Context

Keel's accepted runway plan records household and business monthly burn, but the
user previously had to compare those assumptions with bank activity elsewhere. A
useful comparison must preserve two boundaries:

1. transaction descriptions and provider identifiers are more sensitive than the
   monthly planning result; and
2. observed activity is evidence for a proposal, not permission to rewrite an
   accepted plan.

Plaid's [Transactions product](https://plaid.com/docs/transactions/) provides an
incremental `/transactions/sync` cursor with added, modified, and removed
events. Pending transactions may later disappear and return as posted
transactions, so Keel must apply the full mutation stream rather than treating
each response as a new ledger. Transactions is a
[monthly subscription product](https://plaid.com/docs/account/billing/) whose
applicable per-Item rate is deployment-specific. Billing is not prorated.

## Decision

### Activation and retrieval

Keel reuses an accepted `plaid-cash` Item that already received Transactions
consent in Link. The first Transactions call is blocked until the user confirms
the deployment's price for that institution. Each confirmation appends an
immutable `observed-cash-flow-v1` activation event.

Keel calls only `/transactions/sync`:

- the initial request asks for 125 days, enough to cover the last three whole
  calendar months at every point in the year, and subsequent requests use the
  saved cursor;
- each page asks for at most 500 mutations;
- one response is capped at 1.5 MB, one sync at 16 pages and 10 MB, and one sync
  at 5,000 mutations;
- pagination restarts from the original cursor at most twice when Plaid reports
  that the mutation set changed during pagination; and
- every response page is Zod-validated before normalization.

Keel explicitly requests Plaid's v2 personal-finance taxonomy and will not
advance the cursor until every page reports `HISTORICAL_UPDATE_COMPLETE`.
Partial or not-ready history remains retryable and cannot be labeled as three
complete months.

Keel never calls `/transactions/refresh`, configures a Transactions webhook,
schedules a sync, or enqueues transaction work. A user action is the only way to
cross the provider boundary. Each institution allows at most four user-triggered
sync runs per UTC day for provider readiness and transient failure, and at most
one successful data-bearing sync per UTC day. A running check or waiting review
blocks another check.

### Redaction and normalized facts

Raw transaction pages are Restricted source material. They exist only in bounded
Worker memory while the response is validated and normalized. Keel does not
write them to R2, D1, browser state, logs, test artifacts, or backups.

D1 stores only these Confidential normalized mutation facts:

- HMAC-derived transaction and Item-scoped account keys shared with reviewed
  cash balances;
- added, modified, or removed mutation kind;
- effective date and UTC calendar month;
- signed integer USD minor units when the currency is supported;
- pending state;
- Plaid primary personal-finance category; and
- retrieval and internal sync identifiers.

Merchant/name text, location, logo, website, payment-channel details, raw Item,
account and transaction IDs, request IDs, account numbers, and counterparties
are discarded. Unknown provider categories become `OTHER`; Keel does not infer a
merchant or tax category. The encrypted access credential remains in the
existing private R2 object used by reviewed cash accounts.

Normalized mutation revisions are append-only while retained. A successful sync
deletes revisions older than 24 months. Disconnect removes every retained
normalized transaction revision and the operational cursor for that institution
after Plaid confirms `/item/remove`; it also deletes the encrypted credential
and revokes the shared cash connection. Reviewed cash balances, activation
events, aggregate cash-flow proposals, review decisions, accepted plans, and
forecast versions remain audit records.

Each successful write remains one atomic D1 batch. Mutation revisions are
expanded from bounded JSON parameters in groups of 500, while the three monthly
rows and category rows each use one additional expansion statement. Even at the
5,000-mutation ceiling, the storage batch contains at most 16 statements. This
keeps the request below D1's current
[per-invocation query limit](https://developers.cloudflare.com/d1/platform/limits/)
without assuming a paid-only allowance; Cloudflare documents bound
[`json_each` expansion](https://developers.cloudflare.com/d1/sql-api/query-json/)
as the query-count reduction mechanism.

### Deterministic comparison

A proposal requires coverage from every active institution that has at least one
reviewed cash account. It also requires posted, supported-currency outflow in
each of the last three complete UTC calendar months. Missing coverage or a month
with no eligible outflow remains unknown and withholds a proposal.

Plaid-positive amounts are outflows. Zero, negative amounts, refunds, income,
pending entries, unsupported currency, and transactions from unreviewed cash
accounts do not enter burn. Their relevant exclusion counts remain visible.

Keel groups the remaining outflow by Plaid's primary category and assigns a
reviewable default:

| Category                                           | Default treatment |
| -------------------------------------------------- | ----------------- |
| `LOAN_PAYMENTS`                                    | Debt payment      |
| `INCOME`, `TRANSFER_IN`, `TRANSFER_OUT`            | Excluded          |
| Every other supported primary category and `OTHER` | Household burn    |

The user can change every aggregate category to household burn, business burn,
excluded, or debt payment. Individual transaction and merchant review is
intentionally unavailable. Loan payments stay outside observed burn by default.
Reviewed M7 payments marked **Already included in the plan** or **Add to
household burn** are added to the proposed household value so excluding observed
loan payments does not remove known debt context. If the reviewer explicitly
classifies observed loan payments as household or business burn, Keel omits that
separate debt context so the payment is not counted twice.

The three-month average uses integer minor units and deterministic half-up
rounding. A comparison is material when at least one condition is true:

- household or business burn differs by at least the greater of `$250` per month
  or 10% of that accepted component; or
- combined burn differs by at least the greater of `$500` per month or 10% of
  accepted combined burn.

### Review and plan application

A material default comparison creates one aggregate proposal containing three
monthly totals and category totals. It does not create or edit a plan. The user
reviews every category and supplies a review note. The review either records no
material change or prepares a plan suggestion against the exact accepted cash
plan and forecast version used by the comparison.

The suggestion reuses the Scenarios runway preview. Only the existing explicit
**Save plan** action appends a cash-flow plan and forecast version. That save
marks the proposal applied only when the base versions and suggested household
and business burn still match exactly. A stale plan or a user-edited suggestion
fails closed as an ordinary manual plan draft rather than silently attributing
the change to observed cash flow.

### Cost ceiling

The deployment must record its Transactions rate and Cloudflare plan before a
real Item is activated. The public repository cannot state the contract price.
The bounded maximum per active Item is:

| Resource                                                          | Maximum in a 31-day month          |
| ----------------------------------------------------------------- | ---------------------------------- |
| Transactions subscription                                         | `1 × deployment monthly Item rate` |
| User-triggered sync runs                                          | `4 × 31 = 124`                     |
| Provider page requests, including two bounded pagination restarts | `16 × 3 × 124 = 5,952`             |
| Successful syncs                                                  | `1 × 31 = 31`                      |
| Normalized mutation revisions written                             | `5,000 × 31 = 155,000`             |
| D1 statements in one successful storage batch                     | `≤ 16`                             |
| Raw transaction R2 writes and retained bytes                      | `0`                                |
| Transactions webhook, Queue, and scheduled requests               | `0`                                |

One user-triggered run makes at most 48 external provider requests, below the
current Workers Free
[50-subrequest limit](https://developers.cloudflare.com/workers/platform/limits/),
and accepts at most 10 MB across all pagination attempts. The rolling D1 ceiling
is `5,000 × the days in the retained 24-month window` revisions per continuously
active Item, plus small sync, activation, proposal, and review records. Normal
usage should be materially lower because incremental sync returns only changes.
The runbook requires a measured expected mutation volume and a dollar estimate
against the deployment's included Workers/D1 usage before production activation.

## Consequences

Positive:

- the user can reconcile runway assumptions without exposing transaction text;
- missing history, coverage, currency, and pending states remain explicit;
- debt payments and accepted burn are not silently counted twice;
- proposal review and plan acceptance remain separate actions; and
- provider calls, retained revisions, and subscription shutdown have bounded,
  testable paths.

Tradeoffs:

- three complete months delay the first useful comparison;
- category-level review cannot correct an individual miscategorized merchant;
- user-triggered sync may lag Plaid's background updates;
- disconnect removes the shared Plaid cash Item, not only Transactions access;
  and
- exact provider and D1 cost still depends on the private deployment contract
  and measured mutation volume.
