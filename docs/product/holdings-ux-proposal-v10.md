# Holdings proposal v10

Status: approved for implementation on October 8, 2026. The user approved this
exact version: “this looks good. optimize the data models if needed. nothing is
live. no bkwd compat needed. ok to wipe the data if needed maybe just retain
plaid connections. impl n ship.” The approval applies to the fragment hash
below. Application verification and deployment evidence are recorded separately.

V10 replaces v9's ambiguous result-selection dropdown with two visible radio
choices: Reported by GP (or Your estimate) and Calculated from your shares. Each
shows its amount, origin or calculation, and carry treatment. The calculation
explicitly uses the share count already held in Investment. Selecting a result
preserves both valuation inputs and never changes those shares.

Choices sit side by side on desktop and stack on narrow screens. They appear
when results differ or have different carry treatments; identical comparable
results need no extra choice. The preview opens on the differing-results editor
to expose this revision immediately; the ordinary scenario remains available.

Focused embedded-browser checks passed for selection, keyboard arrows/Space,
Save/reopen, Cancel, preserved inputs and Investment shares, after-carry totals
alongside before-carry calculations, and hiding the choice when inputs agree.
Desktop, 390px and 320px layouts were inspected without horizontal overflow.
Final startup and JavaScript syntax checks passed. These checks establish mock
behavior only; application persistence and host state restoration are
unverified.

Fragment SHA-256:
`39141a65f07aa89abb2352eee6d4cfe2537aaea0b8afffac41e1f0e7209a1b42`.
