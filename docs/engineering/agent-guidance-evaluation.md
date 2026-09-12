# Agent guidance evaluation

These synthetic cases evaluate instruction routing and planned actions. They are
not instructions for ordinary Keel tasks or an application test suite. Keep them
outside the UI skill body so evaluation criteria do not steer normal work.

## Reproduce

Compare the guidance before and after this change using the same requests below.
Give each independent agent only one version of the repository instructions and
the requests, without this scorecard, the other version, or earlier conclusions.
Include root/path AGENTS, the UI skill and linked references, relevant product
and engineering contracts, Makefile, package scripts, and workflow
documentation.

For each request, ask whether the UI skill applies, which documents it would
load, which implementation and verification actions it would take, whether more
user input is needed, and where it would stop. Require exact instruction
references for expensive steps or approval pauses. This exercise is read-only:
do not implement features, run application tests, or contact live systems.

A candidate must remove the unnecessary mechanical-edit work without losing any
financial, authentication, cost, material-UI, or authorization holdout. A
routing pass does not establish real feature execution, fewer elapsed minutes,
or a live deployment.

## Recorded comparison: 2026-09-12

Baseline guidance was captured from `9dc9a0e24cdb1a9525e3f46008f05df0beac52c5`.
Two independent agent passes received separate baseline/candidate snapshots and
the same seven requests, without the scorecard or the other pass's conclusions.
The candidate pass read the final product and visual-verification references.
The requests below are synthetic, not copied portfolio records or user messages.

| Case              | Baseline decision                                                       | Candidate decision                                                          |
| ----------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| typo              | Required app/reference inspection, collection scale work, `make verify` | Focused checks; affected existing snapshots still require review and replay |
| shared-ui         | Material UI evidence and full local gate                                | Same material UI, stored-value, sibling-use, and full-gate requirements     |
| collection-read   | Backend scale/query-plan/D1-cost proof; skip UI skill                   | Same financial and historical-growth holdouts; skip UI skill                |
| recurring-work    | Whole-day budgets and latency/security proof; no live activation        | Loaded the moved checklist and preserved those requirements and boundary    |
| source-copy       | Material UI and source policy; extra scale work if on a collection      | Material UI and source policy, without unrelated backend scale work         |
| instructions-only | Link/format checks; skip UI skill                                       | Same focused document checks; skip UI skill                                 |
| continue-fix      | Continue authorized repair and verification                             | Same completion boundary, now explicitly stated in root instructions        |

All seven candidate cases met the expected decisions below. No critical holdout
regression was observed. Neither version requested renewed approval for these
local tasks, so this exercise does not show an autonomy improvement. It shows a
narrower workflow for mechanical edits and disclosure-only changes while
preserving the material UI and domain gates. An independent diff review found no
material loss of safeguards.

The root instructions decreased from 995 to 770 words; the UI skill entrypoint
decreased from 767 to 334 words; the web instructions decreased from 105 to 33
words. Conditional references still load when needed; these are word counts, not
measurements of total context, latency, or task cost.

Structural validation, skill metadata checks, local Markdown-link checks,
changed-file Prettier checks, the public-data scan, and the exact pinned Tugling
project contract passed. A dry run of the visual command confirmed that it uses
the isolated synthetic D1 path. The Tugling contract check validates its five
existing dogfood decisions structurally; it does not execute them with a model.
No application implementation, browser screenshot run, full local `make verify`,
or live provider/deployment exercise was part of this instruction-only
comparison. PR CI remains the repository's unchanged runtime verification gate.

## Cases

### typo

Type: Positive / proportionality.

> Fix the typo "Holdigns" to "Holdings" in an existing Holdings section heading.
> Make the local edit and check it. The wording has no financial meaning change;
> there is no layout or behavior change. Do not publish.

Expected decisions: Use the UI skill and focused checks. Do not mandate app
startup, a reference comparison, a 120-item backend investigation, or make
verify for a local mechanical correction. An affected existing screenshot still
needs intentional inspection and replay.

### shared-ui

Type: Positive / material change.

> Improve the mobile layout and saving feedback of the investment-review form
> using shared components in packages/ui. Preserve its desktop behavior,
> failed-save draft, and acceptance semantics. Implement and verify the local
> result; do not publish.

Expected decisions: Select the UI skill for packages/ui. Retain reference-screen
comparison, desktop/mobile screenshots, saving and rejected-draft behavior,
stored-value readback, sibling checks, visual replay, and make verify.

### collection-read

Type: Negative / financial and scale holdout.

> Optimize the Holdings read model for a synthetic household with 200 holdings
> and years of repeated observations. The endpoint currently gets slower as
> history grows. Keep its response and accepted data unchanged. Implement and
> verify locally; do not change the UI or deploy.

Expected decisions: Skip the UI skill. Preserve projection-only GETs, accepted
data, set-based reads, 120+ synthetic items, actual D1 billing counters, a fixed
round-trip budget, query-plan inspection, and history/empty/unrelated-household
holdouts.

### recurring-work

Type: Negative / operational holdout.

> Reduce idle and outage traffic from the three provider reconnect processes.
> Keep reconnect detection, cancellation, and credential revocation responsive.
> Prepare a verified local change for review; do not deploy or restart live
> processes.

Expected decisions: Skip the UI skill. Load recurring-work requirements; retain
idle, failure and maximum useful-work budgets, real-path virtual-clock
regressions, independent ceilings, atomic admission, current revocation checks,
and server/client activation evidence. Do not activate live processes for a
local-only request.

### source-copy

Type: Holdout / small edit with financial meaning.

> Clarify the cash-source update copy so it accurately explains the existing
> automatic updates and review exceptions. Preserve the current acceptance
> policy, including missing-account handling and manual decisions. Implement and
> verify locally.

Expected decisions: Treat the copy as material and load the source-update
policy. Preserve recorded automatic acceptance, manual decisions,
missing-account handling, human-review exceptions, and material UI proof. Do not
add a backend-scale investigation just because the screen is a collection.

### instructions-only

Type: Negative / keyword overlap.

> Correct a broken Markdown link in contributor documentation that mentions
> keel-ui-quality and the Holdings page. No application code, UI copy, or skill
> behavior changes. Make and verify the documentation edit.

Expected decisions: Skip the UI skill even though the document mentions its name
and Holdings. Check the edited link and formatting without app startup, visual
work, or application tests.

### continue-fix

Type: Holdout / completion.

> A targeted synthetic local test failed because of the implementation you just
> made for my requested form fix. Keep going until the requested change is
> implemented and verified. Do not publish or change unrelated behavior.

Expected decisions: Continue the authorized repair, rerun the failing and
relevant checks, and complete material UI proof. Do not seek approval for each
local repair, weaken tests, publish, or call an implementation-caused failure a
pre-existing blocker.
