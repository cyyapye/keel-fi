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

## Investment identity and terms

`investment-review-auto-v1` completes clear investment reviews after source
acceptance. It also recovers existing accepted positions through authenticated
`POST /api/legal-entities/resolve`. Opening Legal entities renders its
projection first, then starts this bounded operation. Neither read endpoint
performs it.

An exact, unambiguous legal vehicle name can establish a new entity. Matching
names never merge existing entities. A company mapping requires a clean,
strongly associated agreement citation; multiple mappings or conflicting
companies remain exceptions. Provider participation status needs no extra
confirmation. Ownership percentages and trust or tax conclusions are never
inferred.

Fee acceptance requires explicit management rate and prepaid term, setup rate,
carry, currency, and gross capital evidence. All fees must reconcile to the
source amount using integer money and ppm. Missing is not zero. A net import
keeps its imported amount and records the evidenced gross amount separately;
carry only applies to exit gains. Incomplete, conflicting, unsupported, blocked,
or ambiguously associated evidence stays in the review queue. Clear fields are
prefilled so the user supplies only the missing information.

Each automatic decision records its policy, source revision, accepted sections,
exceptions and supporting evidence. Manual identity, participation, company and
fee decisions take precedence. A later source amount can require a new fee
decision, but cannot silently replace a manual one. Every accepted record stays
editable through the existing versioned review forms.

The transaction checks the current source, review heads, entity version, mapping
set, incoming document assignments and scan state before any acceptance. Racing
manual edits win; duplicate recovery converges without new writes. The operation
processes 120 positions per batch, with at most three transaction attempts for a
stale race. Import recovery covers its existing 500-row maximum; page recovery
stops after five batches or a 30-second client deadline, with an explicit
continuation or retry. It performs no provider, PDF or object read and adds no
polling loop.

Migration `0059` must precede the API/web release. Extraction v6 adds explicit
fee citations; older extraction versions remain valid evidence but do not gain
invented fee terms. Existing agents need the verified revision and their normal
bounded capture to obtain new citations. Tests do not establish that a live
backlog has been recaptured or automatically accepted.

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

## Reviewed company names

Company names share one household-scoped identity after an explicit review in
**Legal entities → Company names**. Case and surrounding spaces support exact
matching; punctuation and legal suffixes only suggest possible duplicates. Names
with unrelated wording can also be reviewed. No company-specific names or rules
are embedded in the application.

The reviewer chooses the alternative name and the existing company, previews all
affected investments, and records why they belong together. Existing company
duplicates receive redirects to that company. The operation appends replacement
exposure mappings, preserving each legal position, financial snapshot, source
citation and prior decision. Original legal names remain in agreement evidence
and legal-entity records. Aliases do not assert that distinct legal entities are
legally identical. Subsequent position reviews supersede the grouping receipt
for that position.

Manual review, exact private-company import matching and automatic agreement
review all use the same canonical company choices and approved aliases. An
unfamiliar legal suffix that resembles an existing company remains an identity
exception. An alias never makes a provider deal label or an unscanned or
ambiguously associated document sufficient evidence. Search matches approved
aliases while displaying one current company choice.

`GET /api/companies/identity` is a projection-only read: three database round
trips for up to 5,000 current companies and 10,000 alternative names. Candidate
formation runs over that bounded set and the browser renders at most 100 search
options or 20 suggested groups initially. Preview is an explicit POST, with four
reads. A review handles up to 500 affected positions, at most 10,000 current
source/target mapping heads and 1.5 MB per evidence binding, in one atomic
batch. It rejects changed catalogs or mappings and replays identical request IDs
without additional writes. Neither endpoint reads source objects or providers.

Migrations `0062` and `0063` precede the API/web release. Alias decisions are
append-only; names, redirects and current receipt tables are projections. The
current exposure-head projection also keeps allocation checks and Portfolio
Watch target maintenance independent of mapping history. The 120-position D1
holdout measures actual reads/writes with repeated tied-date history and an
unrelated household, checks empty results and retries, and enforces at most six
review round trips, 18,000 rows read and 5,000 rows written. In that holdout,
the catalog and preview budgets are 1,000 and 4,000 rows read respectively;
reads write nothing.
