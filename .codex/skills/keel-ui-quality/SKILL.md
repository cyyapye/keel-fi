---
name: keel-ui-quality
description:
  Implement or review Keel's user-visible UI, copy, accessibility, and
  responsive behavior in apps/web, packages/ui, and visual tests. Use for UI
  diagnosis and polish; skip backend-only and contributor-documentation work.
---

# Keel UI quality

The [product contract](../../../docs/product/ui-and-copy.md) owns Keel's visual
language, copy rules, and acceptance criteria. Use this skill to select the work
and evidence the requested task needs.

## Match the scope

- **Mechanical copy correction:** read the affected source and relevant copy
  rules. Use focused checks; app startup, reference-screen comparison, and new
  visual coverage are not automatic requirements. If an existing screenshot
  changes, follow the baseline procedure below for the affected cases.
- **Diagnosis or review:** inspect the relevant contract sections and current
  screen or screenshot evidence needed to assess the issue. Report findings;
  implementation and its completion checks apply when changes are authorized.
- **Material interface change:** read the product contract and satisfy its
  definition of done. This includes meaningful copy, appearance, responsive,
  accessibility, interaction, and transient-state changes. Inspect the running
  screen and its closest Keel reference before coding. Use the repository's
  documented development workflow when startup is needed.

For new concepts or structural redesigns, use Tugling's `$ui-design` when
available for user priorities, complete interactions and the independent design
challenge. This skill remains Keel's adapter: use the product contract for
financial meaning, approval and native verification. An unavailable generic
skill is not a completed design review; preserve the local requirements below
and report that adoption boundary. Routine approved repairs do not need a new
design phase.

Before application edits, classify whether the task introduces a new UI concept
under the product contract's **Design before implementation** section. New
concepts or changed information architecture first require its **Resolve meaning
before layout** review: establish the ordinary user task and domain hierarchy
from user evidence first; map related facts, terms and calculations. Keep the
ordinary scenario distinct from exception fixtures, and challenge section
boundaries with combined and incomplete cases before drawing. A field ownership
list or existing database split is insufficient. New concepts then need a
scenario-complete clickable proposal and the user's approval of its exact
version. Plan approval alone does not approve a later mockup. Reuse of an
approved pattern and routine fixes stay within existing authorization. For a new
flow, record the task's information/editing owners and effort budget; identify
which regression assertions must reject the old behavior. Do not substitute
baseline updates or an agent-written approval flag for those gates.

For holding metrics, apply the contract's value/return groupings and cost-label
rules. Challenge what the rendered grouping implies about each return's value,
denominator and exclusions; correct arithmetic alone does not pass that review.

For material changes or screenshot-baseline updates, read
[visual-verification.md](references/visual-verification.md). It owns screenshot
commands, supported-platform baselines, artifact handling, and visual replay.

For material design delivery or a requested rendered-design review, use
[design-review.md](references/design-review.md) and `.tugling/ui.json` to
connect the project brief, approved components, native evidence and independent
visual challenge. Keep mechanical edits on the focused path above. The review
helper records evidence coverage; it does not replace the product contract or
native verification.

## Follow the affected boundary

- When changing collection loading, request behavior, or a read model, trace the
  initial request and apply the root `AGENTS.md` read-path requirements. Initial
  content must not wait for sync, reconciliation, backfill, provider, or
  object-storage work; rendered collections must keep the DOM bounded. A
  copy-only correction does not itself require a backend scale investigation.
- For source-update or review disclosures, read the
  [source-update policy](../../../docs/architecture/source-update-policy.md).
  Describe the applicable automatic decision or human-review exception without
  changing acceptance policy as part of a copy edit.

Use focused checks while iterating. Material UI changes require `make verify`
before handoff; runtime or migration publication follows the root gate. Report
the outcome and evidence actually obtained, with any exact pre-existing blocker
or unverified boundary. A blocked check is not a passing result.
