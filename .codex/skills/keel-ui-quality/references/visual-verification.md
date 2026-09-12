# Visual verification

Use this procedure for material UI changes and any screenshot-baseline update.
The [product contract](../../../../docs/product/ui-and-copy.md) defines visual
acceptance; a passing pixel comparison does not replace that judgment.

## Coverage and baselines

- Material changes need deterministic Playwright coverage of the affected states
  on both configured desktop and mobile projects. Add missing coverage.
- Keep visual fixtures inside browser tests, using fixed synthetic values.
  Retain separate functional coverage for real application behavior and the
  product contract's stored-value readback requirements.
- Keep one expected baseline per covered state, project, and supported platform.
  Preflight the renderer/platform before generating images. For temporary
  Linux/Colima runs, use the
  [managed Linux runner](../../../../docs/deployment/linux-test-cleanup.md).
- Keep browser tests serialized when they share seeded local D1 state. Use the
  repository's isolated test profile; do not reset the user's practice scenario.

## Update and replay

After confirming that the rendered change is intentional, update the affected
visual spec from the repository root:

```sh
make e2e E2E_ARGS='e2e/<visual-spec> --update-snapshots=all'
```

Inspect every generated PNG with an image-viewing tool. Check the product
contract's hierarchy and copy criteria, contrast, clipping, sticky navigation,
transient states, and horizontal overflow. Fix unintended rendering or
interaction before accepting a new baseline; never update merely to turn a test
green. For material changes, compare current-run desktop and mobile images with
the chosen Keel reference screen.

Rerun with `make e2e E2E_ARGS='e2e/<visual-spec>'` without snapshot-update mode.
These commands select the isolated synthetic D1 profile. Run `make verify` for
material UI handoff; focused replay does not replace that gate.

Commit only expected baselines, overwriting canonical files instead of creating
dated copies. Remove obsolete baselines when their state, test, project, or
platform is removed. Never commit `test-results/`, actual/diff images, traces,
Playwright reports, or downloaded CI artifacts. Report the reference screen,
inspected screenshots, functional checks, and verification result for material
changes; keep financial and personal data out of artifacts and logs.
