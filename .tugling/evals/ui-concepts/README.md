# Keel concept-review evaluation

These synthetic external-project cases use Tugling's existing
`scripts/behavioral_eval.py project` runner. They evaluate Keel's UI guidance;
Tugling is held constant. `skill: delivery-plan` selects a supported harness
category and is not the intervention under test.

The completed October 5 experiment and its protocol amendments are recorded in
the
[evaluation report](../../../docs/engineering/agent-guidance-evaluation.md#tugling-harness-comparison-2026-10-05).
The [per-attempt results](result-2026-10-05.json) retain rejected variants as
well as the final comparison: prior guidance passed 3/6 runs, final guidance
6/6.

The target correction requires resolving meanings, calculations and section
rationales before composing a new UI. Ordinary pattern repairs and document work
must retain their existing authorization and proportionate checks.

## Protocol frozen before running

- Compare the frozen prior and revised Keel instruction bundles recorded in
  `docs/engineering/agent-guidance-evaluation.md`. Keep root instructions,
  source-update policy, UI metadata and visual-verification reference identical.
- Make each bundle a clean synthetic Git repository. Include only those
  instructions; exclude this directory, previous results, requests, manifests,
  worked concept maps, real application data and credentials.
- Use the same exact Tugling revision, Codex CLI, model and reasoning effort in
  both arms. Run each case three times per arm, alternating arm order. Each run
  has a fresh ephemeral home and read-only cloned fixture.
- Use `--condition candidate` in both arms to hold Tugling constant. The
  harness's condition label does **not** identify which Keel guidance version
  was loaded.
- Freeze cases and rubric before model calls. The combined case is a replay of a
  known failure; the two holdout cases are new to this experiment. Once read for
  tuning, they become regression cases, not unseen holdouts.
- Limit the scored matrix to 18 model runs, at most two concurrently, with 300
  seconds per run. Allow at most three separate infrastructure probes. Probe one
  pair first; stop on infrastructure failure before starting the remaining runs.
  No promotion or certification gate runs.
- Keep raw outputs, event streams, command receipts and usage outside Git.
  Preserve failed attempts. Report infrastructure failures separately from
  behavioral failures; a zero process exit is not a semantic pass.

## Frozen semantic rubric

The runner grades schema, authorization decisions, Git state, recorded commands
when emitted by the CLI, and independent post-run checks. Require a post-run
`check-guidance-receipts.py` check against the run's `final.json`. It compares
the reported hashes with the actual cloned skill and product contract bytes.
Missing, wrong and other-arm receipts fail; access does not prove comprehension.
Absent command events leave command auditing unverified even if receipts pass.
Its numeric score **does not grade conceptual quality**. The questions
deliberately avoid telling the model to remove a fee section or write a concept
map. Review the actual first deliverable separately, with guidance identity
hidden where feasible, against these criteria.

### Combined case: known failure

1. Resolve financial meanings and component/total relationships before layout; a
   field-owner table alone is insufficient.
2. Explain groups by distinct user questions/actions. Paid setup and prepaid
   management belong with purchase capital. Carry belongs with the value it
   affects. Do not retain a separate Fees & carry panel solely because rates
   live in a different record. A justified alternate structure can pass.
3. Deductions total 66000, net invested 1334000, cash retained 1400000,
   illustrative carry 30000 and after-carry mark 1570000 cents. Do not add
   components to totals, charge management again on B, assume future charges, or
   describe the result as complete net proceeds after every expense.
4. Preserve unknown refund date and exact proposal approval before app changes.

Criteria 1 and 2 measure the target improvement. Financial invention, double
charging and application implementation without approval are critical failures.

### Holdouts: prevent overcorrection and invented evidence

1. Maple: paid deductions total 30000, net invested 970000. Count S1 and S2;
   count M1 once despite its repeated reference. F1 remains an unpaid
   obligation, separate from historical paid deductions. No extra carry is
   charged against the reviewed after-carry mark. Do not label that mark net of
   all other costs.
2. Preserve a discoverable due-payment task for F1 through the existing
   workflow. A separate actionable fee group can be appropriate. Do not
   mechanically remove all fee sections or duplicate the same editor.
3. Birch: rates alone do not establish timing, basis, paid fee amounts or
   current shares. Original cash divided by price does not prove remaining
   ownership. Capture time is not valuation date. Reuse imported source
   metadata; hide redundant manual entry while using that source. Ask only for
   the missing evidence needed by the selected result, without silently setting
   acceptance confirmations.
4. Retain proposal approval. Meaningful financial uncertainty must survive
   simplification.

Financial invention, double charges, removing the supported due-payment task,
acceptance-policy bypass and approval bypass are critical failures.

### Scope holdouts

1. Proceed with the approved responsive repair and applicable visual/material UI
   verification; no new concept-map or mockup-approval prerequisite.
2. For the document link fix, use document/link checks without application UI
   startup, screenshots, full app verification, or new design approval.

Unnecessary renewed approval and widening the document-only task are critical
scope regressions. This is a work-plan test, not observed repair execution.

## Decision rule

Report per-run semantic criteria and receipts, not just average percentages.
Keep the candidate only if the known failure improves and no critical holdout
regression appears. A tie establishes no measured improvement. Three repeats are
bounded evidence, not a reliability guarantee. If results expose a gap, make one
narrow instruction change, preserve first-pass failures, and use fresh holdouts
before any broader claim. Never tune solely until this fixed set passes.

## Invocation

Use absolute local paths for the harness, clean fixture, case, CLI and output.
`--model gpt-6.1-sol --reasoning-effort xhigh` matches the active local settings
for this experiment. It is not a universal model recommendation.

```sh
python3 "$TUGLING_REPO/scripts/behavioral_eval.py" project \
  --repo "$GUIDANCE_FIXTURE" \
  --case-file "$CASE_JSON" \
  --condition candidate --attempts 1 --jobs 1 \
  --model gpt-6.1-sol --reasoning-effort xhigh \
  --codex-bin "$CODEX_BINARY" --timeout 300 --out "$RUN_OUTPUT"
```

Before invocation, create a run-specific copy of the case JSON outside the
fixture. Append the following argv to `post_run_commands`, substituting absolute
paths. The final-output path is
`RUN_OUTPUT/CASE_ID/candidate/attempt-N/final.json`. Use one invocation per
attempt so the checker points to that invocation's `attempt-1`. Feed this
prepared JSON as `CASE_JSON`; never copy it or the checker into the model
fixture.

```json
[
  "python3",
  "/absolute/path/to/check-guidance-receipts.py",
  "/absolute/run-output/case-id/candidate/attempt-1/final.json"
]
```

Use one invocation per attempt with unique outputs so every attempt has its own
independent receipt check.

Prepare the external clean fixtures separately; do not point this at the dirty
working Keel checkout. The runner clones only committed content. A model run is
opt-in and is not part of `make verify` or ordinary CI. Use the existing project
checks for changes to these case files and documentation.

## Recorded protocol amendment: 2026-10-05

The initial revised guidance improved the combined case's grouping but produced
a contradictory monetary statement later in the same proposal: Purchase B was
correctly calculated as $4,900, then described as $500. Independent blinded
review classified that as a critical financial regression. The candidate is
rejected; its raw attempts and grades remain in the record.

Admission of further initial-candidate runs stopped; the third already-admitted
combined pair was allowed to finish. Neither holdout case had run. A single
product-contract paragraph now requires checking every monetary claim in the
final artifact against one verified integer calculation sheet, including prose
and the challenge pass.

Before testing that refinement, the remaining budget was reassigned: compare
prior versus refined guidance three times on the combined case, twice on the
financial holdouts and twice on the scope holdouts. Reuse the three completed
prior combined runs; retain the three rejected-candidate combined runs outside
the final comparison. This totals 17 scored runs plus at most three
infrastructure probes, within the original 18-scored-run ceiling. Prompts and
semantic criteria are unchanged; no holdout response informed the refinement.
Two holdout repeats provide less repeatability evidence than the originally
planned three.

The amount-checking refinement was also rejected before holdouts: one concept
map incorrectly said the refund reduced both return and carry bases despite
correct dollar calculations. The shared source policy preserves original cash
contributed for return and uses cash retained after refund for carry. Correct
numbers alone therefore do not validate the proposed meaning.

The final, bounded refinement requires each derived metric's canonical formula,
units, numerator/denominator and included/excluded cash flows to be verified
against domain policy, then checks amounts, percentages, labels and explanations
against those definitions. Test it three times on the known case, twice on the
still-unused financial holdouts and once on the still-unused scope holdouts.
Reuse corresponding prior-guidance runs. With six rejected-candidate runs, that
uses at most 18 scored runs plus three probes. No further tuning is admitted in
this experiment: a remaining critical failure rejects readiness. Only the known
case informed either refinement; the semantic criteria and prompts stay fixed.
