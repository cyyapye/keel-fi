# Holdings proposal v6

Status: proposed; exact-version approval unrecorded. This is a standalone
synthetic proposal with simulated saves. Application implementation has not
started for this revision.

The proposal preserves v5's value/return pairs and separate invested capital. It
applies the user's presentation corrections: directional returns have an
explicit positive or negative sign with two decimal places and neutral `0.00%`;
editing a saved valuation is labelled Edit; the collapsed return calculation
retains the carry amount. When carry cannot be calculated, the supported
contribution basis remains reachable without inventing a charge. Opening a
disclosure adds supporting facts; no empty disclosure is created.

The ordinary before-carry group shows
$16,880.00 and +78.80%; the after-carry
group shows $15,698.00 and +66.98%; net
invested remains $8,440.00. Estimated
carry is $1,182.00. Both returns use
original contribution, with the evidenced refund included once, as defined in
the [concept map](holdings-concept-map.md). Supported values remain visible when
their return or counterpart is unknown.

## Enforcement when implemented

Use a shared directional percentage formatter for sign, precision and zero
handling. Use consistent saved-record edit labels. A shared disclosure requires
a useful summary and adds details only when they exist; task-based review still
determines the meaningful summary. Native holding assertions should cover value
and return association, collapsed summary readback, positive/negative/zero,
source/manual transitions, fee representations, optional input independence and
accepted-state readback. These production mechanisms are not implemented by the
standalone proposal.

## Verification boundary

Root checks passed ordinary signed returns, editing to a loss and break-even,
visible carry in the collapsed calculation, and narrow metric grouping.
Independent rendered review found a fee-state defect: a cash-only edit cleared
known fee percentages. The failure was reproduced and repaired. Final root
replay verified retained rates and years, percentage-derived fee previews,
save/reopen/cancel, and optional-input independence at desktop and phone widths.
Blank input for an existing positive fee cannot silently remove that fee.

The independent post-repair browser connection was unavailable; final replay was
performed by the root agent. The iframe preview also had intermittent no-effect
pointer activations. The same mobile save/reopen/cancel passed by pointer in a
direct standalone rendering of the unchanged fragment; keyboard saving passed in
the wrapper. This narrows the issue to the preview or its automation boundary
without establishing its cause. It is not production interaction proof.

Final fragment SHA-256:
`b4e8299040452e14a4d7dcfeac47dc605fed89ae4547035398c05202b9b37ded`. The
task-local evidence retains the original failure, pre-repair artifact,
independent review and final readbacks.

Approval of a previous plan or widget state is not approval of this exact
proposal. Application persistence, native verification, CI and deployment remain
separate implementation gates.

## Copy-only revision v6.1

The return percentages now appear without a repeated visible `return` suffix.
The surrounding value groups retain their before/after carry labels;
accessible-only text identifies each return. The prototype version label and
return-line template are the only two changed lines. Calculations and
interaction logic are unchanged.

The revised fragment has SHA-256
`29eda9e328a61c7c6717caa0c4462454eb642f2794ef48bf4172d8f9e7fb0310`. JavaScript
syntax, the exact copy diff, embedded-browser desktop/phone rendering and
accessible-text readback passed. The original v6 artifact and its evidence
remain preserved. These focused checks do not constitute a new full-flow replay
or exact-version approval. The reusable deletion pass belongs to Tugling's
experimental `ui-design` skill.
