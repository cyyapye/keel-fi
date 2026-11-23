# Cash accounts and balance history

The Cash view answers how much accepted cash is held and where. Bank cash and
brokerage cash have separate account groups and subtotals. Use account names,
currency and reported dates; do not substitute a currency security code for the
account's identity. Preserve source distinctions when no recorded identity
establishes that two balances belong to the same account. Names and equal
amounts are not matching evidence. Do not invent account masks that the source
does not provide.

Show compact amounts on Holdings and exact amounts in full account history.
Calculate each currency total from the original minor units before rounding for
display. Count each accepted balance once in its own currency and keep different
currencies separate. Unknown balances are excluded with a visible qualification
and the total is labeled Known cash. An evidenced zero remains zero. Missing
balances are not zero.

Show all balances in a short list. Fold eligible USD balances under $100 only
when the list exceeds ten rows and at least five balances can be folded. Unknown
or explicitly stale balances stay visible. The quiet control follows the cash
groups, shows the folded count and amount, and states that the amount is
included in the total. Expanding it preserves focus. Search includes folded
balances without changing portfolio totals. Large lists retain manual collection
limits.

An expanded account shows its latest five recorded balance-history entries. View
full history opens the account's read-only history, ten entries per page, with
Newer and Older actions. Return preserves the account disclosure, small balance
setting and keyboard target. The first entry is the recorded starting balance;
later entries show prior and new amounts. Count these as entries. Checks with
unchanged balances do not add entries. History reaches the first actually
accepted observation or import, with no invented observations before that date.
Loading and failure preserve current accepted totals; retrying history never
repeats a financial decision.

For a reviewed override, keep its basis visible and qualify the total as
including reviewed values. Its accepted cash value and reported balance history
are separately labeled; source reports are not a history of manual corrections.
Show an effective date only when that review supplies one. A recorded linked
value source uses that source's accepted reports and snapshot, without inferring
that other accounts are the same from their labels.

The proposal `keel-cash-accounts-v3`, SHA-256
`4dd7f71a4614a15d62f9a6878cc71bfe083d022c0d9d8fd7a4d1b2c88dd98923`, was approved
for implementation and shipping on November 8, 2026. It uses entirely synthetic
data. The application reuses the existing disclosure, section header, statistic,
record group and quiet action patterns; no new shared control is introduced. The
aggregate Holdings welcome continues to own a completely empty portfolio.

History is fetched only when requested. Reads project accepted decisions and
snapshots without provider requests, object-storage reads, reconciliation or
writes. Bank identity projection uses three fixed reads scoped to its
connection; its cost grows linearly with that connection's accepted history.
Brokerage history uses two reads and forces family-first indexed application
lookups. Responses are limited to five or ten entries; page cursors identify
accepted entries instead of shifting offsets. The requested accepted revision
bounds history so a later update cannot mix new entries with an older on-screen
balance. Scale checks use the bank maximum of 100 accounts, 120 brokerage
positions, repeated observation dates, independently grown history and an
unrelated household, with real D1 counters and query plans. These reads do not
change acceptance or reconciliation policy.
