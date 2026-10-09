# Holdings proposal v8

Status: proposed; exact-version approval unrecorded. This is a standalone
synthetic mockup with simulated saves, not application implementation.

Edit is beside the source-backed headline value, with the accessible name Edit
valuation. Its source/date sit in the same metric group. There is no duplicate
edit action beside invested capital, Calculation, or a derived counterpart. An
after-carry source owns the edit action in the after-carry group.

The editor offers Reported value and Price per share. The latter now provides a
prefilled price input and date, using existing share evidence to update the
estimate while typing. Known source/class metadata remains available in Source
details; missing required metadata opens that disclosure. Save retains the
price, date, source and class; Cancel discards the draft. The original imported
quote remains in source history. A saved entered price is retained for
recalculation after an investment correction, separately from that imported
quote. Calculation exposes the shares and price used by an accepted estimate.

## Focused verification

Root reproduced v7's read-only share-price path, then verified the repairs in
the existing embedded browser. Desktop and phone observations covered the nearby
Edit action, mutually exclusive entry methods, prefill, live estimate,
save/reopen/cancel, negative-price rejection, retry with draft retention,
changed-source review, and entry without an imported source. An unchanged
price-based valuation cannot be saved again. No separate browser process was
launched.

The synthetic 84.4 shares at $210 produced $17,724.00 before carry and
$16,415.40 after carry; reopening retained $210 while source history retained
the original
$200 quote. A later correction to 85 shares retained that entered
$210 price and
proposed $17,850.00. Applying and reopening preserved the price. At 320 pixels,
the price form had matching document/client widths and no overflowing input,
select, button or amount. The ordinary overview was inspected at 1280, 1024 and
390 pixels.

Final fragment SHA-256:
`834247e54935f373661d8c293fa5cfcbe5bccdda2509e0aae9e398d3b319a5a8`. JavaScript
syntax passed. The v7 artifact is preserved. The last price-retention repair was
replayed on these final bytes. Earlier broad checks were focused iteration
evidence, not a repeated full matrix on the final revision.

The [v7 implementation boundaries](holdings-ux-proposal-v7.md) still apply,
including the unfinished refund-reconciliation recovery flow. Host icon,
clipboard and widget-persistence integration, native application verification,
CI and deployment were not established by this standalone direct preview.
