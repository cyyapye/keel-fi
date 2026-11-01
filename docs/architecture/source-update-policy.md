# Source updates and planning decisions

Routine source updates do not need a human approval. Importing still records the
original evidence first, then applies a recorded deterministic decision. These
operations run during ingestion or an authenticated POST, never a GET.

## Holdings

Plaid retains its existing automatic policy. AngelList, Tokenfolio, Sydecar, and
Wefunder use `private-holdings-auto-v1`. It accepts normalized USD rows with a
valid source and ownership scope, including clearly identified new legal
positions. Partial templates can update reported positions but cannot establish
omissions.

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

### Manual Wefunder template

Use **Holdings → Sources → Import holdings → Wefunder** to download Keel’s CSV
template. Copy one row per legal position, retaining the first two lines. Enter
the actual legal position separately from its company and owner; choose Direct,
SPV, or Fund to match the investment. Enter funded cash in Invested USD, and
leave unknown current values and investment dates blank. Supply the dated source
observation as As Of Date; do not substitute an unknown valuation date. This is
a manually completed Keel template, not a native Wefunder export or automated
connector.

The upload retains private evidence before the existing deterministic policy
accepts clear rows. Duplicate and identity exceptions remain reviewable. Company
grouping and legal identity retain their existing review boundaries; creating a
legal entity alone does not create a financial holding. Re-uploading the same
file converges on the same records. Template coverage is partial and never
removes an omitted position. Migration `0087` must precede the API/web release;
it preserves baseline history and its immutable guards.

The accepted **Legal Position** field is available as legal-name evidence,
labelled as a manually completed Wefunder template rather than an agreement or
provider-verified name. The **Investment** and **Held Through** columns do not
identify the legal vehicle. `wefunder-legal-entity-exact-v1` automatically links
a position when exactly one current entity in the household has the identical
legal name and a compatible reviewed type. This applies to Direct, SPV and Fund
positions and needs no separate PDF. The receipt pins the accepted CSV row,
entity version, policy and source-link decision in one transaction. It does not
create or merge entity profiles, change ownership or tax details, or merge
financial positions. Duplicate names, historical names that have been renamed,
conflicting evidence/types and existing manual identity decisions retain their
review boundaries. Company grouping remains a separate decision.

The bounded explicit resolver also recovers previously accepted Wefunder rows;
no re-import or GET-side repair is required. Migration `0088` maintains an
indexed current-name projection from append-only entity versions and verifies
that the match is still unique when the link is committed. It must precede the
API/web release. Existing new-entity, evidence, revision and financial guards
remain enforced.

## Investment identity and terms

`investment-review-auto-v1` completes clear investment reviews after source
acceptance. It also recovers existing accepted positions through authenticated
`POST /api/legal-entities/resolve`. Opening Legal entities renders its
projection first, then starts this bounded operation. Neither read endpoint
performs it.

An exact, unambiguous legal vehicle name can establish a new entity. Matching
names never merge existing entities. A company mapping requires a clean,
strongly associated agreement citation. An existing unique, full-position
mapping accepted by `private-company-exact-reviewed-v1` also remains confirmed
when the latest source still exactly names that reviewed company or an approved
alias. This reuses the recorded decision; a provider label alone never creates a
new company decision in the legal review resolver. A later contradictory clean
agreement still reopens company review. Multiple mappings or conflicting
companies remain exceptions. Provider participation status needs no extra
confirmation. Ownership percentages and trust or tax conclusions are never
inferred.

Fee acceptance requires explicit management rate and prepaid term (zero annual
management needs no term), setup rate, carry, currency, and gross capital
evidence. All fees must reconcile to the source amount using integer money and
ppm. Missing is not zero. A net import keeps its imported amount and records the
evidenced gross amount separately; carry only applies to exit gains. Incomplete,
conflicting, unsupported, blocked, or ambiguously associated evidence stays in
the position's financial evidence as unresolved. Missing optional fee terms do
not create a Legal entities review task or imply zero fees. Genuine identity,
participation and document exceptions remain in the legal queue. Investment
inputs, fees, refunds, shares, carry and valuation are edited in the existing
Holdings position workspace; Legal entities links to that exact position. Source
commitment corrections remain a distinct secondary action because they do not
change cash paid or funded capital.

A company or owner label alone does not create a legal-entity review task when
only its legal name or company citation is missing. Named vehicles, existing
legal decisions, agreements, specific document failures and other legal
exceptions remain eligible. This triage filter preserves the source, stored
policy issues, position classification and export; it never accepts a company
name as a vehicle or links investments by company alone.

Until a position has a unified Investment details review, current
single-purchase notices can supply management and carry evidence. Disagreement
with provider or agreement terms remains an exception. Underlying purchase fees
retain their rate, basis and receipt; they apply once to capital after SPV fees.
Multiple purchases or stale purchase evidence require review. The transaction
checks the purchase receipt head before accepting these terms.

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

## Renamed investment records

A reviewed same-investment link can keep one current or historical SPV while
preserving both dated source records, fee evidence, documents, purchases and
events. Historical records cannot supply a current valuation. A replacement
requires a current surviving SPV; a company rename requires the same reviewed
company, provider account, legal vehicle, owner and investment date. Neither a
rename nor an underlying stock disposal establishes an investor distribution or
vehicle winding-up. Tax basis is not a cash contribution.

Opening a duplicate-record review prefills a unique matching pair and its
same-investment or rename relationship. The suggestion requires the same
provider account, legal vehicle, owner, investment date, reviewed company,
currency and participation. It prefers a reviewed cash receipt, then reviewed
terms or participation; otherwise it keeps the earlier source. Multiple matches,
missing identity evidence or conflicting identity fields remain manual choices.
Opening or reloading the form does not accept a link, and reloading after a
failed save does not replace the user's selected draft.

The linking workspace also includes private-provider records from reviewed
history. A unique historical record with the same provider, legal vehicle,
owner, investment date, currency and participation can prefill a proposed pair
with a source-account record, even when the older account or company identity
has not been confirmed. The source-account record stays selected to keep;
historical fallback containers never establish account equivalence. The rename
acceptance guard still requires the same confirmed account and reviewed company,
and the form explains the outstanding identity review before allowing Apply.

The review shows the surviving contribution, ownership, status, source dates and
fee terms before applying. For duplicate records, the single exact saved
legal-entity match is preselected for its separate identity decision; no entity
is created or linked just by opening the review. Missing or conflicting terms
keep their own acceptance boundary.

Migration `0080` extends the existing `0078` link ledger with source-backed old
and new company names. A later rotated import key can reuse the reviewed
provider/account/SPV/date/instrument identity only for those known names and
matching contribution amounts and participation. Unknown names, ambiguous
groups, changed cash amounts and a live report for a historical survivor require
review. Each reused alias records its governing link decision; concurrent
reversal fails closed. Unlinking appends a reversal, restores separate counting
and removes the rename display and future alias reuse. It does not undo
subsequent source updates or delete their evidence.

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
existing provider limits apply even when exceptions are waiting: a configured
free plan checks at most daily with 31 monthly attempts, while the default paid
plan checks weekly with four monthly attempts. Once Plaid actually reports a
Balance rate limit, D1 enforces seven days between subsequent attempts for that
institution. Exhausted free credits suspend automatic checks.

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
possible holding overlaps, and unexplained removed baseline sources require
review. Routine price and balance changes do not. `accepted-sources-auto-v2`
refreshes eligible sources even when other sources need a decision. Each
unresolved source keeps its exact prior baseline snapshot or cash decision; an
uncertain new source stays outside the baseline. A new source appearing
alongside a missing source in the same ownership scope or cash connection is
held too, preventing double counting a possible replacement. It can be reviewed
as separate, or become eligible after the missing source is explicitly removed.
Retained values remain dated and visible in the exception review. A user reviews
one source at a time, previews its FI-liquid effect, and explicitly includes the
cash, excludes an unavailable value, or removes the missing source from the
plan. Removing a source never records a sale. Other unresolved sources remain
unchanged. No eligible changes means no new baseline or forecast, including
repeated refresh requests. Private paper remains outside FI liquid, so its value
updates do not require another planning approval. Positions excluded because
their accepted provider status is realized or their recorded participation is
historical or cancelled also refresh automatically, including baselines created
before those exclusions were projected. The baseline reads the latest accepted
snapshot and participation review for its prior sources, including records
hidden by a recorded continuity link, so it can distinguish an accepted closure
from a missing source. These closures do not create possible-replacement
warnings for other positions in the same ownership scope. Original holdings,
source evidence, and participation decisions remain unchanged; the existing
append-only baseline policy receipt records the refresh. A later participation
change invalidates the source revision. The existing batched read resolves this
evidence with indexed lookups; no additional database round trips or polling are
needed. The existing source-revision and forecast-version checks reject stale
work. Repeating a completed refresh is a no-op.

Migration `0068` allows an explicitly reviewed empty baseline and adds the
selective policy version without rewriting prior decisions. It must precede the
API/web release. Reads remain 14 D1 round trips; a refresh including
confirmation uses at most 46, independent of source count. The 120-source
holdout covers retained exceptions, repeated observation dates, growing history,
retries and an unrelated household; budgets are 18,000 rows read and 1,000 rows
written per refresh, and 6,000 rows read with no writes for projection or no-op
recovery. Existing refresh triggers and schedules are unchanged; no polling is
added.

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

### Investment amount corrections

AngelList's personal investment amount comes from `Invested`; `Allocation`
remains source deal metadata. Other private sources retain their reported
commitment semantics. Both original source fields remain unchanged.

A reviewed amount correction overrides only the investment amount used for
commitment and fee calculations. It records the original source amount,
snapshot, reason and time in the investment review history. Later imports and
unrelated review decisions preserve it. Returning to the source amount records a
new decision and uses the latest source amount. Funded capital, distributions,
reported values and earlier decisions are not rewritten. Fee terms whose
accepted amount no longer matches require review.

### Historical private-position continuity

Migration `0069` and subsequent successful import reconciliation automatically
link a retained-history position to its newer provider position when provider,
adapter, owner, legal vehicle, reported company, investment date, instrument and
currency uniquely match on both sides. Source export dates describe
observations, not separate investments. Realized positions qualify, and a known
matching investment date allows amounts to change without breaking identity.
Undated legacy pairs still require matching invested and allocation amounts.
Different owners, vehicles, investment dates and ambiguous lots stay separate.
Public-security reconnect requirements remain unchanged.

The deployment backfills existing matches; later ingestion uses the same rule.
The existing continuity receipt records both position and snapshot IDs. Original
snapshots, documents and review decisions remain unchanged. Only the successor
appears in the position inventory; historical successors remain excluded from
current holdings. Reads perform no reconciliation.

### Unified investment details

USD SPV positions use one Investment details editor in Holdings detail and
Investment review. A single explicit Save records up to 20 purchases, canonical
reviewed economic terms and a review of the provider mark. Partial data and
carry-only terms are valid. This optional workflow never gates source
acceptance. The separate shares view shows saved calculations and links to this
editor.

Cash paid, total upfront deductions and net capital invested are exact integer
money per purchase. A received allocation refund is recorded separately from
fees, with its receipt date when known. An unknown date does not prevent
recording an already received refund; the date remains null and is never
inferred from a scheduled payout. Cash paid minus received refunds is the
capital available before upfront deductions; any two capital amounts determine
the third after that refund. Conflicting or negative totals cannot be saved.
Optional fee component rates do not determine or need to add up to the entered
total deductions. When final net capital and deductions are unknown, a one-time
rate with an explicit gross/net basis previews estimated fees and net capital
after the allocation refund. Expected refunds affect this preview only. The
estimate never becomes accepted invested capital, an underlying share count, or
a provider valuation. Entered allocation amounts take precedence over rate
estimates. Nominal SPV units are separate from underlying shares; no conversion
is inferred. Whole-position cash coverage is an explicit decision separate from
remaining-share coverage. Reviewed cash drives return cost basis, regardless of
whether the unchanged imported amount is gross, net or unknown. An already-net
import is never reduced by the fees again.

A received allocation refund preserves the original cash contribution. The
review records whether that refund is already included in provider-reported
distributions. Excluded refunds are added once to return proceeds; included
refunds are not added again. Unknown inclusion withholds gain and return rather
than assuming either treatment. That decision is bound to the receipt's source
snapshot; a new source requires renewed review. Carry above cash uses cash
retained after received allocation refunds. Allocation-refund capture does not
change cash-account balances or automatically refresh the FI baseline, and does
not replace the actual-liquidity and forecast-reconciliation ledger.

Annual management fees and carry have independently nullable rates and explicit
cash/net/unknown bases. Blank is unknown; zero is an evidenced absence of a fee.
Annual fees are not multiplied by a prepaid term or folded into upfront totals.
Carry applies to positive gains above the chosen capital basis. The provider
mark records source snapshot, source label, optional valuation date and
before-carry/after-carry/unknown classification. Capture date is not valuation
date. Classification only applies to that exact source snapshot and amount. A
carry-only proceeds illustration never replaces the provider mark, charges an
after-carry mark again or claims to model annual fees, distributions, taxes and
exit expenses. Unknown inputs are visible and prevent reliable net estimates.

Executed evidence, historical deal snapshots, source dates and disagreement
notes are retained as provenance. Paste GP notice extracts only explicit bounded
facts and keeps the source text. It prefills blank reviewed rates only when
explicit and unopposed by provider observations; it never fabricates a rate or
basis. Source observations stay read-only. An explicit choice can adopt a notice
rate into the one canonical reviewed record. PDF extraction remains separate.

Legacy receipts and fee reviews remain immutable. Opening an old receipt can
prefill missing exact cash from current, fully funded legacy economics, but the
new draft needs review and Save. Migration `0079` binds the unified receipt to
the current legacy fee review and prevents parallel fee writers or a downgrade
to a legacy receipt. Automatic reviews retain the unified manual terms; a later
source snapshot requires fresh review. No import or historical review is
rewritten.

Each purchase can retain a share class, integer micro-unit share price, entry
reference price, gross cash, net share capital, one-time fee and its gross/net
basis, source reference, and remaining attributable shares with their date.
Calculated original shares require explicit confirmation that there have been no
sales, splits or conversions. A dated price and source for the identical share
class must cover every purchase for a matching-share estimate. An explicit proxy
decision can instead retain a class mismatch or unknown price date as described
below. The reviewer must also confirm that the purchases cover the entire
remaining position. A mismatch or incomplete evidence leaves the existing
valuation fallback intact. A new source snapshot retains purchase history but
requires a fresh review before using its share estimate. Reported or manually
accepted marks retain precedence; the share estimate is shown separately, before
carry and remaining expenses.

Accepted purchase records are append-only and atomically advance an indexed
current head. The POST checks household ownership, position, snapshot and prior
review in the write transaction. Stale submissions fail without overwriting
newer work. GETs join current heads and perform no writes or source reads.
Migrations `0070` and `0079` must precede the API and web release. The
120-position holdout covers empty heads, repeated reviews and
unrelated-household lookups, with fixed three-round-trip position reads and
two-round-trip purchase writes. Saving sends one POST per explicit confirmation,
with the action disabled while saving. It adds no polling, automatic retry or
idle request; the existing holdings reload follows success. It counts actual D1
rows and index writes. Historical fee reviews remain available as evidence.
Current summaries use the same saved cash and terms; reported return keeps the
mark's reviewed carry status separate from estimated proceeds.

### Public issuer grouping recommendations

Opening **Holdings → Group with company** shows one focused issuer review. Keel
proposes a unique match from accepted company names or aliases, ignoring
recognized share-class labels and legal suffixes. A ticker or partial name alone
is insufficient. If saved names do not identify a match, one bounded public
issuer search uses Wikidata when no optional Brave credential is configured.
Wikidata candidates require exact normalized matches for both the public issuer
and an accepted company name/alias on the same entity, using structured labels
and matched aliases rather than description text. The proposal links to that
record and explicitly identifies Wikidata as its evidence; it never accepts the
identity automatically. Brave results require issuer identity evidence on an
accepted official company domain, or an explicit alias statement in a regulatory
source. Conflicting matches remain unresolved. The recommendation shows its
reason and source. **Approve grouping** records the human decision; **Change
company** opens the manual correction form.

An authenticated POST atomically admits one lookup per security,
company-identity revision, current link, lookup version/availability and UTC
day. Reopening reuses that result, including empty and failed results; there is
no idle polling or automatic retry. One lookup requests at most five results,
has a ten-second deadline and a 256 KiB response limit, and fetches no candidate
pages. Fetch uses Workers-supported manual redirects and rejects non-success
responses before parsing; redirect destinations are never fetched. Only the
public issuer name is sent to search. An interrupted lookup stays visible as
pending for that daily key; **Check again** reads its completion, and manual
correction remains available. Lookup version and availability are part of the
cache key so fixing a missing provider does not preserve an unavailable result
until tomorrow. Existing observations remain immutable; the household daily
admission cap still applies across versions.

Migration `0073` records the observation and proposed match before acceptance.
Completed evidence is immutable. Approval checks the identity revision, issuer,
current link and one-day evidence age inside the database transaction; repeated
approval converges on the same receipt. GETs project accepted state and never
search. The catalog uses three queries over current mapping heads. The synthetic
120-security holdout covers tied mapping history, unrelated households, empty
results, recommendation reuse and acceptance with real D1 read/write counters.
Grouping preserves each position and its existing valuation method.

### Reusing per-share valuation evidence

Tokenfolio version 4 captures retain the explicitly labelled entry and marked
share prices at millionth-dollar precision. A missing mark date or share class
stays unknown; retrieval time is not a valuation date. These source observations
are immutable and become selectable only through accepted position snapshots.
The valuation editor finds prices through reviewed company/exposure links within
the household, alongside Portfolio Watch news as company-level context. News and
company valuations never become per-share prices automatically.

For a single fully funded purchase, missing share capital can be prefilled from
current accepted economics. Existing capital and actual remaining-share counts
are preserved. The user confirms unchanged shares and comparable securities,
provides missing price evidence, and saves a purchase review. The server rejects
changed source prices and class mismatches. Estimates remain before carry and
separate from reported values; returns use the position's reviewed net capital,
or a separately identified estimate from complete reviewed fee terms. Received
capital refunds reduce that basis and are excluded from return distributions;
unknown inclusion keeps return pending. Source investment amounts with an
unknown gross/net basis never become net capital automatically.

### Legacy one-time proxy share estimates

A reviewer can choose **Use as proxy estimate** on imported per-share evidence
when it is the closest available price. The purchase review records the source
revision, captured timestamp, source share class (or unknown), actual mark date
(or unknown), a required rationale, and the explicit proxy decision. Capture
time never substitutes for a mark date. Proxy use does not assert matching
securities. Original-share and whole-position coverage confirmations still
apply. The price, reported date, known source class, capture time and latest
source revision are checked on acceptance; the transaction rejects obsolete
source evidence.

Proxy estimates are labeled separately in Holdings and valuation details, before
carry and remaining expenses. Their assumptions remain expandable after saving.
An unknown price date stays unknown throughout projection. Reported and accepted
manual values retain precedence. Later source evidence does not silently reprice
the proxy; changing it requires another recorded purchase decision. Migration
`0076` must precede the API/web release. Read and write query budgets are
unchanged.

### Linked price proxy method

The valuation editor can explicitly select a persistent source with
`linked-price-proxy-v1`. Migration `0086` projects accepted import prices and
reviewed GP price corrections into an immutable quote ledger keyed by the stable
provider position. A reviewed link resolves a visible holding back to that
source; unrelated company labels never establish comparability. Reported
balance, price, quantity and observation dates remain independent. A price
correction never updates or re-dates the source holding's reported dollar
balance.

The user's source selection authorizes subsequent deterministic calculations,
not changes to accepted cash, refunds, fees, carry or investment identity. Each
calculation appends a purchase receipt with the quote and quantity receipt IDs,
policy, normalized quantity and integer minor-unit value. It preserves manual
valuation records but the selected proxy controls the current value until a new
recorded selection supersedes it. The reviewed quantity and investment terms
remain applicable across balance observations until superseded; a new quote does
not require the same quantity to be entered with a later date.

Documented estimated shares retain their status, derivation, evidence, effective
date and split basis. A confirmed replacement supersedes that lot instead of
adding another allocation. Different share classes require an explicit
indicative-proxy decision and remain separately classified. Quantity and quote
bases use ratios to the same original issuer basis. Normalize their ratio with
integer arithmetic once, then round the final currency amount; never rescale
reported dollar balances or persist a second split-adjusted allocation.

The existing scheduled Tokenfolio capture includes per-share prices and any
explicit mark date, share class and split basis supplied by the portal. Unknown
metadata remains unknown, including when an email or reviewed correction has a
known date that the portal does not supply. There is no automatic email reader.
Accepted imports and reviewed price corrections invoke bounded write-side
recalculation. Newer dated quotes advance the source; a same-date reviewed
correction may supersede it. Older or undated observations cannot replace a
dated quote. A changed price with missing or incompatible inputs retains the
last valid estimate and exposes a stale source with observation and successful
sync times. The user can correct source metadata through the existing valuation
editor; failed source syncs use the existing Sources recovery controls.

A failed propagation can be retried by replaying the accepted import or the
authenticated `POST /api/valuation-proxies/refresh` maintenance operation.
Compare-and-swap guards preserve concurrent user edits and reject changed
quotes. GETs only read projections. Relationships are capped at 500 per
household; the 120-position real-D1 holdout grows tied observation history and
an unrelated household and enforces two round trips, at most 6,000 rows read and
1,000 rows written, including integrity triggers and index maintenance. A no-op
uses one round trip and writes nothing. This method does not alter provider
schedules or acceptance boundaries.
