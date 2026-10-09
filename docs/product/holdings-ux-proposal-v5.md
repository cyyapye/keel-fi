# Holdings proposal v5

Status: proposed, exact-version approval unrecorded. This replaces the earlier
proposal's flat metric row with related value/return groups. It is a standalone
synthetic mockup with simulated saves, not an application implementation.

The first group pairs the reported before-carry value with its cumulative
before-carry return. The second pairs the estimated after-carry value with its
cumulative after-carry return. Net invested remains visible as a separate
capital measure. Each pair stays together on narrow screens; capital is never
presented as the value underlying after-carry return.

Both returns use original contribution as their denominator and the same
evidenced cash flows. Refunds are included once; fees paid from the contribution
are not deducted again. When carry is unknown, preserve the supported
before-carry comparison. When the source supplies only an after-carry value,
preserve that value and its supported return without constructing a before-carry
counterpart. Omit unsupported return without hiding the known value.

The ordinary summary has no generic other-costs caveat. A recorded excluded
payment is named beside the affected result. Missing cost records are not proof
that no future expenses exist.

## Synthetic expected results

| Scenario                         | Before-carry value and return | After-carry value and return                            | Invested capital |
| -------------------------------- | ----------------------------- | ------------------------------------------------------- | ---------------- |
| One SPV investment               | $16,880.00; 78.80%            | $15,698.00; 66.98%                                      | $8,440.00        |
| Additional acquisition exception | $16,000.00; 13.33%            | $15,700.00; 11.33%                                      | $13,340.00       |
| Source after carry, payment due  | Unsupported                   | $12,000.00; 20.00%, excludes $100 unpaid management fee | $9,700.00        |

These figures follow the [concept map](holdings-concept-map.md). The ordinary
case uses $10,000 original cash, a $1,000 received refund,
$200 paid one-time fee,
$360 prepaid management fee and 15% carry above $9,000
retained cash. The due payment is an obligation, not another historical paid
deduction.

## Interaction scope

Investment owns cash, refunds, fee amount/rate/basis, prepaid management years,
shares and carry terms. The ordinary edit path is Edit then Save; optional
metadata does not block unrelated edits. Value & return owns the valuation
method and source. Source adoption reuses known inputs; manual replacement is a
separate mode. Source history, independent linked SPVs, draft retention, failed
saves and stale-source rejection remain part of the proposal.

Return calculation keeps the original-contribution basis reachable whenever a
supported return is displayed, including unknown carry and source-reported
after-carry states. It does not invent a carry charge to explain those returns.

## Verification boundary

The proposal checks cover value/return association at 1280, 1024, 390 and 320
CSS pixels, unknown carry, an after-carry source, a specific unpaid obligation,
refund inclusion, combined acquisitions, loss and break-even. Deliberate
regressions must fail: moving return beside capital, dropping a supported
before-carry return, or adding an unspecified cost caveat. These are scenario
assertions, not a generic proof of good information hierarchy.

Recovery checks cover source adoption, replacement/history, failed saves and
retry, stale sources, separate linked-SPV edits and invalid fees at desktop and
phone widths. Independent rendered review and the final artifact hash are
recorded with the task-local prototype evidence before handoff.

Independent review found no blocking summary defect and identified a useful
explanation gap: the calculation disclosure depended on positive estimated
carry. A new assertion reproduced that failure. The repaired disclosure passed
both affected states at desktop and phone widths, and the grouping checks were
replayed against the repair. The original finding and failed assertion remain in
the evidence record.

The final independent readback confirms the repair and the ordinary
edit/save/reopen/cancel task. Final fragment SHA-256:
`8eaf6f4c3b287dbe71b5b6678bd71149c3a7de6bf3a148db9a34be40e20307f6`. Initial
automated pointer-save attempts were inconclusive; later event traces and fresh
pointer tasks passed at both widths without a save-code change. The intermittent
cause remains unestablished in the standalone preview, and the evidence retains
that limit.

Application implementation requires approval of this exact proposal. It must
then transfer the relevant assertions to repository-native tests, prove
canonical accepted-state readback and run the required application checks.
Prototype checks do not establish D1 persistence, CI, deployment or installed
Tugling behavior.
