# Connected investment review

The [review safeguard audit](../engineering/review-safeguards.md) maps these
invariants to synthetic regression cases and distinguishes automated proof from
visual and live-provider checks.

The existing holding position is the investor's participation in a vehicle. It
connects the titled holder, exact legal-entity identity, reviewed financial
snapshots, fee/carry terms, documents, and underlying company. It is not a
second store of investment amounts.

- Multiple SPVs can map to one company without becoming one investment.
- The normal SPV company mapping is one 100% look-through link. Existing
  multi-company mappings are shown before replacing them; fund portfolio
  allocation modeling is not inferred from a single memo.
- Participation is current, pending, historical, cancelled, or unknown. A
  reviewed decision overrides the provider's live/realized default. Historical
  and cancelled positions are excluded from current holdings, exposure totals,
  and the current values used for net worth and baseline proposals. Their source
  amounts, contributions, distributions, documents and prior forecast snapshots
  remain intact. Pending and unconfirmed participation retain existing value
  treatment; neither uncertainty nor a partial exit implies a completed closure.
- Historical participation can record an optional ended date, closure reason,
  note, and replacement investment. The replacement is a distinct position in
  the same household; the link never merges investments or copies amounts. A
  refund note does not create a cash transaction. Closure never declares a legal
  entity dissolved. A later review can correct participation, while prior
  decisions and closure details remain in history.
- Ownership observations belong to the position and titled holder. K-1 profit,
  loss, and capital beginning/ending shares remain separate from a dated
  ownership percentage. Missing is not zero. K-1s are optional, and entering
  transcribed K-1 values without an attachment is labelled user reported.
- Amendments name an earlier observation and append history. Earlier
  entity-level owner, percentage, and status entries remain labelled as such;
  they are not silently assigned to every linked position.
- Document assignments distinguish supporting agreements, general governing
  documents, another investment, and unassigned evidence. A separate
  pending/cancelled document-backed investment has the original titled holder,
  but no manufactured snapshot, amount, fee, or carry. Link an agreement to an
  existing investment when that investment already has financial records.

## Source association and company evidence

Legal names come unchanged from an identified provider field or a cited
agreement. Neither an investment label nor a plausible generated name is a
substitute. Keep unavailable documents, unsuccessful extraction, conflicting
names, and blocked reads distinct through the projection, review, and export.
Document-based manual entry needs the exact name, supporting document, and page;
an excerpt is optional and must match if supplied. Existing extracted choices
still require their exact citation. Review only the decision being accepted; do
not add redundant confirmation or silently accept unrelated financial facts.

The browser agents keep provider investment IDs in v3 captured CSVs and document
observations. Sydecar's central Documents page uses an observed investment link
to distinguish same-label investments. The Tokenfolio drawer/Deal Snapshot and
Sydecar detail fallback must match the observed investment ID. Signed document
URLs are still ephemeral and provider-allowlisted.

Extraction v5 introduced explicit underlying/target/portfolio company labels
from agreements and linked investment memos. A deal label, manager,
representative, comparable company, or an SPV name is not company-mapping
authority. Company choices retain document ID, hash, page, quote, extraction
version, observation time, provider, and association. A user confirmation is
labelled separately. Disagreement remains reviewable; the extractor does not
choose a winner.

Extraction v7 also reads a bounded
`Portfolio Investment: The entity referred to as …` definition, including short
line wraps on one page. It preserves the exact company name and definition
quote. Risk-factor mentions, lists of possible companies, manager roles and
incomplete definitions do not become citations. Versions 1–6 remain readable;
deploy the API before upgrading agents. The next bounded capture reprocesses
cached older extraction versions even when the PDF bytes are unchanged. This
does not add document reads to a GET endpoint.

Company reviews replace the position's current exposure mapping through the
existing versioned mapping history. A source update never silently overwrites a
human decision. Exact cited matches can receive a recorded automatic policy
decision; its company receipt is stored with that policy, without manufacturing
a second human review. Existing mappings remain visible in the review form;
earlier mappings are not retroactively presented as v5 document citations.

The company picker remains available after choosing an agreement citation and
searches the loaded household companies. An explicit `document_link` decision
can associate the exact reported name with a differently named portfolio
company. For example, an agreement naming Synthetic Robotics Global LLC can
support a reviewed link to Synthetic Robotics. The receipt preserves both names,
the original citation and document, and the chosen company ID. It does not
rewrite the source, merge legal vehicles, or establish a global name-matching
rule. Reusing an existing company also reuses its exposure rather than creating
a duplicate. The server verifies the original choice, household, assignment and
scan state under the existing stale-write guards. Search is local to the loaded
projection, with at most 100 options rendered and no new requests while typing.

A new supporting citation that contradicts an earlier manual mapping creates a
company-review exception while preserving that mapping. The company section
remains incomplete and opens with the conflict. A subsequent explicit company
decision records a stable fingerprint of the company evidence considered.
Repeated captures of identical evidence do not reopen that decision; changed
evidence can. The fingerprint excludes observation times and document IDs, and
includes the PDF hash, exact name, page and quote. Automatic review evaluation
version 2 rechecks older cached summaries once without rewriting their history.

Provider IDs are retained for association, not used to re-key existing accepted
financial positions in this migration. Legacy ambiguous financial natural keys
remain a blocked import review, not an automatic merge or split. A separate
provider-identity migration would need explicit continuity reconciliation and
tests for renamed and same-date investments before changing those keys.

## Reviewed gross and net capital

SPV economics reviews distinguish a gross imported commitment from an imported
amount that already excludes fees. A net import requires an explicit reviewed
gross commitment; Keel does not infer that choice from the provider name.
Management fees (rate times prepaid years) and a separate one-time setup fee are
percentages of gross commitment. A one-time management fee uses one year. Gross
less both fees must reconcile exactly to the imported net commitment. Carry is
recorded separately and never deducted from contributed or invested capital.

Migration `0058` extends the existing append-only economics proposals. Original
snapshot commitment and funded amounts remain source evidence; reviewed gross
commitment is a separate term tied to that snapshot. A new source snapshot
requires a new recorded decision before these terms apply again. Historical
reviews retain their gross calculation, and a missing setup fee remains
unrecorded. New UI reviews require the setup rate explicitly, including zero
when there is no setup fee. Entity exports label reviewed gross commitment and
imported net funding separately.

Money calculations use integer minor units and ppm. The combined fee is rounded
half up once; any rounding remainder after the management fee belongs to setup,
so the breakdown always sums to gross. The database independently enforces the
same reconciliation without overflowing SQLite integer multiplication.

Apply `0058` before deploying the new API/web. There is no provider-agent change
or automatic rewrite of existing financial records. Domain, repository readback,
API validation, desktop/mobile review, and the existing 120-position query
budget cover this contract; these checks do not establish a production
deployment.

## Automatic review and remaining exceptions

Migration `0059` and `investment-review-auto-v1` extend the review boundary to
recorded deterministic decisions. Complete, consistent evidence resolves
identity, company, participation, fees and document association automatically.
The queue contains remaining exceptions, including exceptions on already linked
entities. Its action opens the section needing attention. All records remain
editable, and recovery preserves subsequent human corrections.

Extraction v6 adds independently validated citations for gross/net capital,
management rate and term, setup fee and carry. Quotes must reproduce exact
integer values and an explicit supported basis. Missing fields, currency
conflicts, conditional or tiered terms, unreadable documents and inconsistent
citations cannot be accepted as complete economics. The form prefills the clear
fields. No provider default supplies a missing setup fee or prepaid term.

The source-update policy documents the transaction guards, bounded recovery, and
client activation requirement. Existing v1-v5 document evidence remains
readable; agents must run the new extractor during a normal capture before those
documents can supply v6 fee citations.

## Read and write budgets

The entity collection remains projection-only: four position-view reads plus
four inventory reads, independent of row count. Detail loads are lazy and use
seven fixed reads. Neither GET reads PDFs/R2, synchronizes providers, backfills,
or writes state. Synthetic regressions cover 120+ records and indexed query
plans. Collections retain existing progressive rendering and complete exports.

A detail review is bounded to 100 document references, 100 ownership
observations, 100 exposure mappings, and 5,000 company/investment labels. These
are review metadata limits, not PDF-processing allowances: each capture keeps
its original six-document, byte, page, timeout, scanner, and VM limits.

Review and company receipts are append-only; assignment rows are their
replaceable projection. Writes check household, current snapshot, prior review,
current exposure-mapping set, document observation, incoming assignments, and
live scan state. Commit-time checks close validation/save races. Request IDs are
payload-bound; exact retries converge on the original receipt. A stale or failed
request leaves the client draft in place.

## Rollout and verification boundary

1. Verify and apply migration `0053` before the new API/web or v3 agents.
2. Upgrade the existing agents. No new provider connection is required by the
   data model; ordinary bounded updates re-extract older document versions.
3. Review company mappings and document assignments before accepting changes. Do
   not bulk rewrite old identities, ownership, or financial snapshots.
4. Verify the exact deployed build and provider runs separately. Repository
   tests use synthetic data and do not establish live provider extraction or
   production deployment.

The counsel export includes underlying company and dated ownership evidence by
default. Fee/carry and detailed company citations are selectable. Historical
scope includes cancelled investments. Exported inventory is not a conclusion
about trust funding, tax basis, entity dissolution, or legal ownership.

## Historical participation and closure details

Migration `0066` adds a commit-time replacement scope guard before the API/web
release. Optional closure metadata extends the existing versioned review JSON;
older decisions remain readable and are never rewritten. Independent ownership
or document reviews preserve closure details, and subsequent source imports do
not replace a reviewed participation decision. Ended dates cannot precede a
known opening date or be in the future. Selecting Current again clears the
current closure details while preserving the earlier historical decision.

Current financial projections omit ended positions before estimates and exposure
allocations are calculated. The complete position projection remains available
for legal-entity history and document review. A mixed entity stays in current
inventory while any linked participation remains open. Current-only exports omit
ended position sources; exports including history preserve closure details and
label their current value as excluded. Entity-level lifecycle facts are not
changed. Planning refresh retains the existing review boundary for removed
baseline sources and never rewrites a previous forecast.

The real D1 holdout uses 120 positions, 120 additional review versions per
position with tied timestamps, and 120 unrelated-household positions. Current
Holdings reads have an 11-round-trip, 3,500-row read budget with no writes; a
closure save has a nine-round-trip, 500-row read, six-row write budget including
index maintenance. Retries add no writes. Indexed query plans and the legacy
read endpoint are checked alongside save/readback, newer imports, cancelled
positions, mixed entities, an all-historical portfolio, and desktop/mobile
flows.
