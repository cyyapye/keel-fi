# Review safeguards

This is an index of reviewed engineering decisions and their regression cases,
not a conversation log or a second product specification. All examples and tests
are synthetic. The owning contracts remain
[connected investment review](../architecture/connected-investment-review.md),
[interface and copy](../product/ui-and-copy.md), and the linked security and
deployment runbooks.

## Audit and ownership

For a change touching one of these rows, the maintainer of that surface owns its
proof. **Covered** means an executable regression exists, not that it passed in
the current run or proves a live provider. **Extended** identifies a gap closed
by this audit. Test descriptions below identify the relevant cases within each
linked suite; running the entire suite also checks adjacent behavior.

| ID / surface owner                | Decision and synthetic counterexample                                                                                                                                                                  | Regression and proof boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Audit                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| R1 / ingestion + identity         | A company label, investor, manager, or representative must not become the invested entity's legal name. Two exact source names remain distinct.                                                        | [Extraction tests](../../scripts/legal-document-extraction.test.ts): labels and truncated names are not vehicle evidence; exact name/page preserved. [Domain tests](../../packages/domain/src/legal-entities.test.ts): legal names require provider/document evidence. These test association and extraction rules, not completeness of a live provider's documents.                                                                                                                                    | Covered                                                            |
| R2 / document evidence + export   | No document, a failed reader, and a readable agreement with no extracted name have different remedies. Never describe all three as missing source data. Guidance must not require an optional excerpt. | [Projection tests](../../packages/database/src/provider-legal-documents.test.ts): preserve capture-stage and document-stage problems plus original references. [Recovery copy](../../packages/domain/src/provider-legal-documents.test.ts), [CSV export](../../apps/api/src/legal-entity-export.test.ts), and [manual-entry browser flow](../../e2e/legal-name-resolution.visual.spec.ts) check consistent guidance and an actionable form.                                                             | Extended: stage-specific regressions and optional-excerpt guidance |
| R3 / investment model             | Two vehicles may invest in one company; cancelling one participation must not dissolve its entity, erase evidence, or copy another investment's money.                                                 | [Repository tests](../../packages/database/src/investment-review.test.ts): two vehicles into one company; separate cancelled agreement; export without invented money; reviewed decisions survive a newer provider snapshot. [Review browser flow](../../e2e/investment-review.visual.spec.ts): separate cancelled investment and exact agreement assignment. SQL-backed tests complement browser fixtures.                                                                                             | Covered                                                            |
| R4 / review forms + progress      | Source defaults are not acceptance. A new investment without a K-1 is usable; unknown ownership or fee terms do not become zero. Do not ask twice for metadata a selected document supplies.           | [Progress tests](../../apps/web/src/investment-review-progress.test.ts): optional ownership, source-only suggestions, defaults not completion. [Review browser flow](../../e2e/investment-review.visual.spec.ts): separate optional K-1 shares and rejected draft. [Name review](../../e2e/legal-name-resolution.visual.spec.ts): document/page-only entry and validity-driven submission.                                                                                                              | Covered                                                            |
| R5 / review writes + readback     | Saving one agreement must visibly assign it after reload; a second save preserves the first. Failure preserves selection; unchanged submission is disabled.                                            | [Repository tests](../../packages/database/src/investment-review.test.ts): successive assignment readback, duplicate request convergence, payload mismatch rejection. [Review browser flow](../../e2e/investment-review.visual.spec.ts): saved destinations after reload, rejected selection, saving on the clicked button without success banners. A mocked UI response is not database proof.                                                                                                         | Covered                                                            |
| R6 / shared UI + workspace        | Detailed review belongs in a coherent workspace. Narrow navigation, focus, standard fee/carry controls, source/date hierarchy, and optional progress need intentional treatment.                       | [Shared component checks](../../scripts/shared-ui-usage.test.ts) plus [desktop/mobile review cases](../../e2e/investment-review.visual.spec.ts): responsive section navigation, visible focus, standard economics fields, ownership evidence layout. Inspect the images against Holdings/Scenarios; imports and pixel equality alone do not judge clarity.                                                                                                                                              | Covered; visual judgment remains required                          |
| R7 / provider recovery + security | Delayed portfolio controls do not prove logout. A scan limit is not a malware finding. Recovery must reuse the existing provider path and keep unsafe originals private.                               | [Provider sessions](../../e2e/provider-session.spec.ts), [portfolio capture](../../e2e/provider-portfolio-mac-agent.spec.ts), [existing command routing](../../scripts/provider-agent-command-interface.test.ts), [security UX](../../e2e/agreement-security.visual.spec.ts), and [authorized download tests](../../apps/api/src/provider-legal-documents.test.ts). Real synthetic isolation probes run in `make pdf-sandbox-verify`. Live account recovery is a separate authorized operational check. | Covered                                                            |
| R8 / reads + delivery             | Progressive rendering must not conceal per-row queries or provider work on GET. Local success must not be described as a verified deployment.                                                          | [Inventory reads](../../packages/database/src/legal-entities.test.ts) and [detail reads](../../packages/database/src/investment-review.test.ts) check 120+ records, fixed query budgets, and query plans. [Queue browser cases](../../e2e/legal-name-resolution.visual.spec.ts) check 500-source attention ordering and bounded rendering. Follow the [exact-SHA deployment contract](../../.github/workflows/README.md) separately.                                                                    | Covered; live release evidence required at merge                   |

The copy defect in R2 is a concrete negative control: the new domain regression
fails on the prior instruction to provide a "page and excerpt", while the form
already accepts document/page-only entry. The correction is shared by the UI and
counsel export. No parser permissions, security limits, review acceptance, or
financial data rules change.

## Exception-based investment decisions

R1, R3, R4 and R5 now also cover `investment-review-auto-v1`. Merely visiting a
section still does not accept source defaults. A recorded automatic decision can
resolve an unambiguous source-backed section without another human click. The
[automatic repository cases](../../packages/database/src/automatic-investment-review.test.ts)
exercise import recovery, complete reconciled terms, conflicting documents,
duplicate vehicle names, manual corrections, live scan races and duplicate
requests. [Extraction cases](../../scripts/legal-document-economics.test.ts)
reject unsupported terms, missing values and forged numeric citations.

The
[automatic review browser flow](../../e2e/automatic-investment-review.visual.spec.ts)
starts with 120 sources, leaves a missing setup fee as the only exception,
prefills clear terms, saves a manual correction and reopens the saved values.
Desktop/mobile failure states retain inventory access and require an explicit
retry. The
[D1 cost case](../../scripts/automatic-investment-review-d1-cost.test.ts) counts
billing metadata, history and empty/repeated requests. These tests prove
synthetic behavior; deployment, agent upgrades and live backlog completion
remain distinct evidence.

## Use the audit during delivery

1. Select the affected rows before editing. Check the linked implementation and
   sibling flows; reuse existing connectors, fields, and feedback before adding
   another path.
2. For an uncovered failure, add a synthetic case that reproduces it. Run it on
   the old behavior and record the failure; a passing new test alone does not
   demonstrate that the original mistake is caught. For an already covered row,
   inspect its assertions and rerun the relevant native suite.
3. Run focused tests while iterating. For example:

   ```sh
   make test TEST_ARGS='packages/domain/src/provider-legal-documents.test.ts packages/database/src/provider-legal-documents.test.ts apps/api/src/legal-entity-export.test.ts'
   make e2e E2E_ARGS='e2e/legal-name-resolution.visual.spec.ts e2e/investment-review.visual.spec.ts e2e/agreement-security.visual.spec.ts'
   ```

4. Run `make verify` before publishing runtime changes. It owns the full gate;
   this index does not introduce a competing verifier. Browser tests use their
   isolated D1 profile. Do not reset or reseed the user's practice scenario.
5. Inspect current-run desktop/mobile images, including focus and pending/error
   states, and rerun without snapshot-update mode. Preflight the supported
   renderer/platform before generating baselines. Use the
   [managed Linux runner](../deployment/linux-test-cleanup.md) for temporary
   Linux work; do not build a parallel unmanaged test environment.
6. Include the affected IDs, exact tested revision, commands, inspected
   artifacts, failure reproduction, and remaining manual/live boundary in the
   PR. Checks prove only their stated layer. After an authorized merge, verify
   the pinned head and exact post-merge workflow, deployed revision, and
   protected smokes.

If a check is inconclusive, state the observed stage and next bounded
diagnostic. Do not loop through reconnects, increase retries, weaken limits, or
report absent provider data without evidence. A visual assertion must not
replace stored-value readback; a stored-value assertion must not replace visible
interaction proof.

## Local learning and upstream candidates

Keel's adapter enables local learning. Use the installed Tugling
`scripts/project_learning.py` helper with `--repo <keel-checkout>` and its
`capture`, `digest`, and `review` commands. Record only the smallest sanitized
observed/expected/scope/summary tuple. The ignored `.tugling/local/` ledger is
review evidence; it is never a prompt source, tracked artifact, or CI input. Do
not copy this thread, provider documents, real names, identifiers, or financial
values into public tests or Tugling.

Disposition is explicit:

- **Keep local:** Keel financial semantics and the established Keel interface.
  Encode these in the owning contract, shared implementation, and tests above.
- **Promotion candidate:** generic decisions such as diagnosing the observed
  failure stage, reusing an existing path, or proving a save through readback. A
  `promote` review means eligible for evaluation, not released or effective.
- **Dismiss:** a duplicate, incorrect lesson, or one-off decision that adds no
  reusable safeguard.

Before an upstream change, construct a new synthetic case without private
project context; define expected decisions, critical holdout regressions, and
stop thresholds before editing the skill. Compare the accepted release and
candidate on the same blinded cases. Keep a candidate only if it fixes the
target without a critical holdout regression. Obtain any required evaluation
spend approval separately. This audit does not change Keel's accepted Tugling
pin, upload the ledger, run a paid evaluation, or modify upstream skills.
