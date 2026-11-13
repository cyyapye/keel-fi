# Investment activity and reported lots

The holding detail answers three separate questions: what is owned now, what the
broker reported happening, and which purchase lots the broker still reports.
Activity never adds an asset to the current holdings total. Remaining lots are
source observations, not a reconstruction from purchases and sales.

The approved synthetic proposal is `investment-history-v1`, SHA-256
`4b5191c0375789bac9310b2bcb400779a7bda4d60b4a6e5d2d3e8a67a58d4d74`. The task
approval covers the holding-detail Activity and Tax lots views, account-wide
activity, source disclosures, filtering and pagination. It does not introduce a
trading, order-editing or lot-election workflow.

## Ordinary task and ownership

For a fictional security, inspect purchases, open their original source details,
compare the recorded inclusion status, then sort remaining reported lots by
highest adjusted basis per share. Posting dates, initiation timestamps and
purchase prices keep their provider meaning. A broker's refresh or price date
does not establish the effective time of a position's quantity. The present
Plaid capture therefore reports inclusion as unestablished when that timing is
missing. It never manufactures an opening quantity, purchase or cash balance.

The existing holdings sync owns ingestion and recorded deterministic acceptance.
Immutable capture and transaction observations own provenance and correction
history. D1 projections own every UI, owner API and MCP read. The holding detail
owns inspection; the existing Sources flow owns checks. No background UI timer,
new primary navigation, editable record or separate planning allocation is
added.

The effort budget is an initial status/activity read, explicit filter or tab
changes and at most fifty displayed rows per page. Opening source details adds
no request. Keyboard users can reach the tabs, filters, disclosure and paging
controls through normal navigation. Mobile controls retain the shared touch
target contract. Existing RecordItem, Tabs, Collapsible, Input, Select and
Button contracts are reused without a shared-library API change.

## Incomplete and changed evidence

- Unknown and absent lot reports are not zero lots. Invalid reports have a
  different disclosure from a report the broker did not supply.
- Partial lot quantities and unknown basis stay visible, with incomplete
  coverage disclosed before using the highest-basis ordering.
- A failed activity request retains the last successful history and its source
  window. Its failure is separate from the latest holdings/lot observation.
- Corrections replace the current transaction projection while retaining the
  predecessor. Repeated unchanged facts do not create new financial revisions.
- A transaction absent from a later complete report remains as previously
  reported evidence with unconfirmed current status. Absence alone is not a
  cancellation, reversal or additional cash movement.
- An expired read context requires an explicit reload. Pagination and related
  reads cannot silently mix source revisions. A newer accepted holding snapshot
  invalidates an older lot comparison.

The first capture is bounded: two provider pages of 250 transactions, at most
250 normalized transactions subject to the daily write reservation, and the
first 120 holdings with at most 120 reported lots across them. Original bounded
transaction pages and the original holdings response remain private evidence.
Excess coverage is partial; positions outside a captured lot report show not yet
synced. Imported historical observations remain after they age out of the
provider window. This release does not provide a resumable deep-history
importer, CSV/statement backfill editor, estimated lots, order tracking, cash
reconciliation or a reserve-allocation planner.

## Verification

The browser contract includes ordinary activity, source correction details,
account-only events, date/type filters, highest-basis/oldest ordering, missing
and partial lots, expired-context recovery, keyboard navigation and mobile
geometry. Real D1 ingestion verifies recorded acceptance, failure retention,
source limits and atomic daily admission. Separate HTTP/MCP tests exercise
120-item ownership, 12/24 captures per item, repeated dates, corrections,
foreign households, pagination, zero-write reads and indexed plans. See
[recurring-work budgets](../engineering/recurring-work-budgets.md) and
[the API reference](../api/reference.md).
