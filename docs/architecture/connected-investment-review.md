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
  cancellation does not declare the entity dissolved, zero a reported amount, or
  erase its documents.
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

Extraction v5 reads explicit underlying/target/portfolio company labels from
agreements and linked investment memos. A deal label, manager, representative,
comparable company, or an SPV name is not company-mapping authority. Company
choices retain document ID, hash, page, quote, extraction version, observation
time, provider, and association. A user confirmation is labelled separately.
Disagreement remains reviewable; the extractor does not choose a winner.

Company reviews replace the position's current exposure mapping through the
existing versioned mapping history. A source update never silently overwrites
that accepted decision. Existing mappings remain visible in the review form;
earlier mappings are not retroactively presented as v5 document citations.

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
requires review before these terms apply again. Historical reviews retain their
gross calculation, and a missing setup fee remains unrecorded. New UI reviews
require the setup rate explicitly, including zero when there is no setup fee.
Entity exports label reviewed gross commitment and imported net funding
separately.

Money calculations use integer minor units and ppm. The combined fee is rounded
half up once; any rounding remainder after the management fee belongs to setup,
so the breakdown always sums to gross. The database independently enforces the
same reconciliation without overflowing SQLite integer multiplication.

Apply `0058` before deploying the new API/web. There is no provider-agent change
or automatic rewrite of existing financial records. Domain, repository readback,
API validation, desktop/mobile review, and the existing 120-position query
budget cover this contract; these checks do not establish a production
deployment.

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
