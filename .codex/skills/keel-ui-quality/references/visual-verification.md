# Visual verification

Use visual checks to detect appearance regressions. Use behavior assertions and
stored-value readback to establish that the application works. A matching image
cannot prove a save or a financial calculation.

## Select coverage by the claim

- Exercise the affected behavior on both configured desktop and mobile projects.
  Assert values, validation, rejected drafts, pending controls, reloads and
  changed saves through user-facing roles and labels.
- For financial editors, include an unmocked browser flow through the local API
  and isolated D1 profile for each affected write path. Prepare synthetic state
  through supported ingestion and recorded acceptance. Check the stored receipt,
  projected value and preserved predecessor decisions. Keep mocks for controlled
  transient failures, not as the only persistence proof.
- Check keyboard focus with the real navigation present. Do not hide chrome,
  focus the target programmatically or center it before claiming natural focus
  behavior. Use retrying assertions for visibility, containment, hit targets,
  overlap and overflow. Avoid exact form heights, coordinates or row-gap
  equality unless those dimensions are the product requirement.
- Reuse the approved component baselines for standard controls. Keep page
  baselines for important compositions and financial meaning. Add a baseline
  when it covers a distinct appearance risk. Do not duplicate an entire form for
  every factor, validation result or save state.
- Keep fixtures inside browser tests and use fixed synthetic values. Serialize
  tests that share seeded D1 state. Never reset the user's practice scenario.

## Use the canonical renderer for pixel comparisons

`KEEL_SCREENSHOT_MODE=functional` is the local default. It runs behavior checks
without snapshot comparisons. Playwright's `ignoreSnapshots` disables every
snapshot matcher, including image, text and accessibility snapshots. Use direct
role, value and state assertions for the functional contract.

`KEEL_SCREENSHOT_MODE=canonical` enables snapshot comparisons on Linux x64. CI
requires this mode and rejects a functional override. Keep the existing locked
Playwright browser, Node and pnpm environment used by the CI lane. Do not
compare images produced by different operating systems, fonts, browser versions
or pixel scales. Developer screenshots are review evidence, not replacement
Linux baselines.

Keep one expected baseline per covered state and project in the canonical
renderer. Existing platform images may remain as approved references; they are
not an obligation to maintain a second pixel gate. Do not delete unrelated
references as part of a small repair.

For temporary Linux or Colima runs use the
[managed Linux runner](../../../../docs/deployment/linux-test-cleanup.md). An
ARM or emulated run is not a substitute for verified canonical rendering. Report
an unavailable renderer as unverified rather than changing thresholds.

## Capture, review and replay

Run focused behavior tests while iterating:

```sh
make e2e E2E_ARGS='e2e/<affected-spec>'
```

Capture current desktop and mobile images when they help judge changed
appearance. Use CSS-pixel scale, fixed data and time, disabled animations and
settled fonts. Scope any chrome masking to the image capture so later behavior
checks still exercise the real page. Transient-state images are diagnostic
artifacts unless the state introduces a distinct visual contract.

Inspect the changed composition against its closest approved Keel reference.
Check hierarchy, copy, contrast, clipping, navigation, focus and overflow. For a
routine use of an approved control, inspect representative states and reuse the
component's existing visual coverage. A new composition or changed state
presentation needs its affected visual states reviewed.

After confirming the intended rendering, update only affected baselines on the
canonical renderer:

```sh
KEEL_SCREENSHOT_MODE=canonical make e2e E2E_ARGS='e2e/<affected-spec> --update-snapshots=all'
```

Replay without update mode. Keep baseline updates deliberate and inspect every
changed image. Never increase thresholds, add sleeps or add retries to hide a
capture or application defect. Capture failure diagnostics when they help
explain an assertion; do not make routine image dumps the correctness gate.

Run the required broad verification after the source and visual review settle.
`make verify` remains the local gate. Its functional mode does not claim a
canonical pixel pass; publication requires the exact-revision CI gate with
canonical comparisons. Report both boundaries explicitly.

Commit only expected canonical images. Never commit test results, actual or diff
images, traces, Playwright reports, downloaded CI artifacts or real data.
