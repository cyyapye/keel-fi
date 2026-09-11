# Source updates and planning decisions

Routine source updates do not need a human approval. Importing still records the
original evidence first, then applies a recorded deterministic decision. These
operations run during ingestion or an authenticated POST, never a GET.

## Holdings

Plaid retains its existing automatic policy. AngelList, Tokenfolio, and Sydecar
use `private-holdings-auto-v1`. It accepts normalized USD rows with a valid
source and ownership scope, including clearly identified new legal positions.
Partial templates can update reported positions but cannot establish omissions.

Duplicate keys, invalid scope or currency, instrument changes, and possible
identity replacements remain exceptions. A newly reported key is not assumed to
be a new asset when a prior position disappears in the same complete account
snapshot, or the same legal vehicle appears under a different owner or key.
Separate vehicles investing in the same company remain separate positions.
Missing positions retain their prior accepted values; absence is never a sale.

Older dated observations are recorded as ignored policy decisions. Unchanged
facts reuse their snapshot. Unique row decisions and atomic application batches
make identical retries converge, including a retry after projection failure. The
database also rejects a stale automatic acceptance at insertion time. Exceptions
can be explicitly accepted when their identity is confirmed, or dismissed while
preserving prior holdings. Invalid source rows require a corrected import.
Accepted keys are reused by later imports.

Source updates are limited to 500 rows. Reconciliation reads whole sets, with no
database calls inside a position loop. A synthetic 120-position case asserts a
fixed round-trip budget and an indexed latest-observation query plan. Opening
Holdings can recover its bounded pending queue of at most 20 imports through
separate authenticated POSTs, after the initial read has rendered.

## Cash accounts

`cash-balances-auto-v1` accepts a newer valid live balance for a previously
accepted account, using its protected identity or an explicitly resolved match.
A normal balance movement, including a reported zero, needs no human approval.
Unchanged and older observations receive no new accepted fact. A policy decision
records its rule, reason, and prior accepted decision; source evidence and both
human and automatic decisions remain append-only.

First-time account inclusion, unsupported or missing values, changed account
types, conflicting same-date values, and cached replacements stay in review.
Missing accounts keep their last accepted value until the user explicitly marks
it unavailable. Repeated values respect the user's previous exclusion; a changed
value can be considered again. Unresolved rows do not block other accounts or
later checks. New complete checks supersede older waiting rows without rewriting
their evidence. Review submissions contain only remaining exceptions; obsolete
submissions fail closed.

Possible identifier rotations can be matched before the new record is accepted.
**Same account** records the link and applies the valid balance once; **Keep
separate** leaves the new account's inclusion as a user decision. Names only
suggest a match. They never merge accounts automatically.

The existing authenticated `POST /api/cash-accounts/auto-refresh` first
processes waiting observations from D1, without fetching their objects or
calling Plaid. This also recovers reviews created before the policy shipped.
Ingestion uses the same operation after recording evidence. Atomic batches and
unique row decisions make repeated recovery converge. SQL guards reject an
obsolete acceptance. GETs only project state, in five round trips independent of
the account count. The regression uses the documented maximum of 100 accepted
accounts, and a policy batch needs six round trips. One observation can contain
100 reported accounts plus 100 missing prior accounts; recovery processes at
most 20 current proposals and 20 superseded proposals per call, using set-based
decisions. Current exceptions cannot starve the cleanup of old observations. The
existing weekly and monthly provider limits apply even when exceptions are
waiting.

After an accepted cash change, the browser invokes the existing baseline refresh
POST and reloads Holdings and planning values. The initial baseline and genuine
planning exceptions keep their existing review boundary.

## Planning baseline

The initial baseline is a user decision. Later accepted-source updates use
`accepted-sources-auto-v1`, preserving the established manual cash amount,
inclusion treatment, goals, burn, and other planning assumptions. The same
atomic confirmation transaction records the baseline and forecast history; an
additional append-only policy record identifies the prior baseline and rule.

New cash that may overlap a manual amount, uncertain values used by the FI plan,
possible holding overlaps, and removed baseline sources require review. Routine
price and balance changes do not. Private paper remains outside FI liquid, so
its value updates do not require another planning approval. The existing
source-revision and forecast-version checks reject stale work. Repeating a
completed refresh is a no-op.

`POST /api/portfolio-baseline/refresh` is the bounded refresh and recovery path
for accepted cash or holding changes, including updates accepted before this
policy shipped. GETs remain projections. Failures leave a retry action visible;
they do not imply that an automatic update succeeded.
