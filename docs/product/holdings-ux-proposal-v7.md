# Holdings proposal v7

Status: proposed; exact-version approval unrecorded. Standalone synthetic mockup
with simulated saves. This revision does not implement application changes.

The headline now owns its source/date, Edit valuation action, and Calculation
disclosure. The separate Value & return section is removed. Before- and
after-carry values remain paired with their signed percentages, with net
invested separate. Calculation reveals contribution, refund and carry details;
its collapsed label adds no competing metric. Enter value opens the manual
editor directly when an imported price is available. Source and manual input
remain mutually exclusive.

The ordinary synthetic example retains
$16,880.00 / +78.80% before carry,
$15,698.00 / +66.98% after carry, and
$8,440.00 net invested. The financial definitions remain in the
[concept map](holdings-concept-map.md). This proposal supersedes v6's
requirement for a carry amount in the collapsed calculation.

## Verification

Root inspection used the existing embedded browser at 1280, 1024, 390 and 320
pixel viewport widths. The ordinary headline and phone layout were inspected;
the narrow manual editor and final inline-width overview had no horizontal
overflow. Focused interaction replay covered calculation access, valuation
edit/save/reopen/cancel, signed loss and zero, source/manual switching, failed
save/retry, changed-source review/apply, and missing/empty states.

Independent source review found two existing correction defects. Root reproduced
and repaired both: saving a share correction now retains the submitted share
date; correcting an existing refund amount retains that refund's already
recorded distribution treatment. A newly added refund still requires a new
decision, and existing unknown treatment remains unknown. Phone replay of a
same-date share correction and a refund correction read back 85 shares dated Sep
30, 2026, +79.80% before carry and +67.83% after carry. Reopening fee inputs
retained the recorded annual percentage and prepaid years. The independent
source reviewer confirmed both scoped repairs.

Final fragment SHA-256:
`34a9a402a74ebacbbd53fae79097d72591a4e591c80565a12c32071c8751f230`. The v6.1
artifact is preserved. JavaScript syntax and document whitespace checks passed.
The reviewer could not access the embedded browser, so rendered replay was
performed by the root agent. The direct preview did not supply host icons or
widget persistence; those integrations were not proved by these checks.

## Remaining implementation boundary

The prototype still lacks a recovery flow for newly added refunds and already
unknown distribution treatment. Those cases retain supported values and withhold
unsupported returns. Resolve that flow with the existing reconciliation owner
before implementing the full experience; do not silently assume a distribution
treatment or add a redundant editor.

Mockup interaction state is not user approval. Application persistence, native
UI verification, CI and release evidence remain separate gates. This revision
does not establish general skill effectiveness or installed-plugin changes.
