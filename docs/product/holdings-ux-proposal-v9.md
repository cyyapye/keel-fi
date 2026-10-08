# Holdings proposal v9

Status: proposed; exact-version approval unrecorded. Standalone synthetic mock
with simulated saves. Application implementation remains outside this revision.

## Source and representation

The ordinary task starts with this position's GP report, containing both its
position total and share price. Source selection is independent of those facts.
Both fields can coexist, and either may be omitted. The directly reported total
drives the summary by default. A comparable disagreement exposes the difference
and a choice of total or share calculation; neither original fact is erased.
After-carry totals and before-carry share calculations remain distinguishable
and selectable without clearing the reported total.

An available other-SPV price is read-only source evidence. Selecting it derives
this position's value using its own supported shares and terms, with a visible
proxy label even for matching classes. No other vehicle's total is transferred.
My estimate accepts a total, share price or both and can reference the synthetic
Portfolio Watch update. It remains user-attributed. Source switching preserves
the GP report and personal estimate for later restoration.

Edit remains beside the source-backed headline value. Supported before/after
values and their respective signed percentages stay together; net invested is
separate. A form shows a changed-result preview; an unchanged result is not
repeated beneath the inputs. Carry treatment is shown for a supplied total and
is not requested for a price-only calculation. Imported evidence exposes no
redundant manual form. Unknown carry treatment remains visible after saving.

## Task and enforcement boundaries

Ordinary source adoption takes Edit, source choice, Save: three activations and
zero re-entry. Editing known report fields takes Edit and Save plus changed
inputs. Personal estimates require their new value; evidence selection is
optional. A discrepancy may add one justified result-selection decision.

Implementation owners: the valuation record model should separate preserved
observations, user assertions, derived results and the selected result; the
shared editor should own compatible fields and genuinely exclusive sources;
native browser assertions should cover save/readback, both fields present,
source restoration, total without shares, preserved attribution, and conditional
carry fields. Projection/calculation tests should reject cross-vehicle totals
and stale share calculations. These are implementation requirements, not claims
that application enforcement has been added.

## Verification

Root exercised the mock in the existing embedded browser. Checks covered source
switching and restoration, both fields, price-only and total-only inputs,
unexplained differences, after-carry reports, unknown treatment, evidence
linkage, save/reopen/cancel, failed saves and changed-source recovery. Share
corrections produce a new proposal; unrelated purchase-date corrections retain
the active valuation. Desktop and phone rendering were inspected, including
320px input layout with no horizontal overflow.

Independent source review found four functional issues; root repaired and
replayed each in the embedded browser. The reviewer could not access that
browser and did not start Chrome, so independent rendered-task proof remains
unavailable. Root's browser proof is distinct from the source review.

The final fragment passed JavaScript syntax checking. The local evidence record
binds final bytes and separates broad iteration checks from final focused
replay. The inherited unfinished refund-reconciliation flow remains a
limitation. Native application checks, production persistence, host
clipboard/icons/widget restoration, CI and deployment were not established by
this direct preview.
