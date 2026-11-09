# Interface and copy contract

Keel should feel calm, sparse, and decision-oriented. The interface explains
financial distinctions without exposing the machinery used to implement them.

Use the repo-local `$keel-ui-quality` skill for the required implementation and
verification workflow. This document remains the canonical product contract. The
finite maintenance queue lives in
[`ui-refactor-targets.md`](./ui-refactor-targets.md).

## Visual language

- Keep the palette to ink and canvas. Use opacity and whitespace for hierarchy;
  do not introduce semantic colors unless the trust boundary cannot be
  communicated another way.
- Use whitespace and section rhythm before adding a container or rule.
- Use type, reading order and space to express the user's task priorities.
  Primary answers or actions must not be subordinate to section headings or
  metadata. Keep a clear page identity and consistent sibling headings without
  imposing a fixed prominence order on every screen.
- Add a border or divider only when it separates a real data group, state, or
  interaction. Do not box every concept.
- Use badges for exceptional status, not repeated metadata or labels that are
  already clear from context.
- Keep one primary action per section whenever possible.
- Use Holdings as the default reference for information density and Scenarios as
  the default reference for interactive controls.
- Reuse established visual patterns, and make labels and apparent affordances
  match implemented behavior.
- Give sibling section headings the same shared size and spacing. Use body-size
  text for actionable purchase summaries; metadata must not carry the task.
- Keep supporting source metadata in the existing secondary text style. Omit a
  field label when its value and surrounding section already explain its
  meaning. Present multiple related SPVs as a list with wrapping links on
  mobile.

## Design before implementation

### Resolve meaning before layout

Tugling's `ui-design` owns the reusable design method when installed: priority
mapping, complete input representations, conditional effort and an independent
challenge of the rendered task. Keel owns the financial definitions, product
choices and approval boundaries below. Retain these local checks while the
generic skill is a candidate; a source change alone does not prove installation
or improved behavior.

For a holding, make supported value, invested capital and performance
immediately legible before transaction mechanics. Identify the value's
reported/estimated status and cost treatment; a fallback to net invested is not
a market valuation. Use net invested capital and the canonical cash-flow
definitions for performance. An evidenced urgent action may change emphasis;
missing optional metadata may not.

Treat value and performance as related comparisons. Group a supported
before-carry value with its before-carry return, and an after-carry value with
its after-carry return. Label a calculated after-carry value as estimated. Keep
net invested visible as a separate capital measure and the return denominator;
it is not current value after carry. Preserve these relationships when the
layout stacks on mobile. Supported before-carry return remains useful when carry
terms are missing; an after-carry source alone cannot establish a before-carry
value or return.

For this holding summary, show both supported return treatments using net
capital after upfront deductions and received capital refunds, with the same
distributions excluding capital refunds. Refunds already reduce this
denominator; remove any refund included in reported distributions and do not add
an excluded refund to the numerator. Keep exact net capital distinct from an
estimate based on complete reviewed fee terms. Unknown deductions, partial
funding, stale reviews or unknown refund inclusion cannot establish a supported
return. Do not deduct upfront fees again from the value. Keep the calculation
basis reachable whenever a supported return is shown, including when estimated
carry is absent. Do not use blanket caveats such as "before other costs". Name
an excluded cost only when a recorded obligation or an explicit source
limitation establishes it; retain that specific qualification beside the
affected result. An absent cost record does not prove that the holding is free
of all future costs.

An investment editor must support the terms it displays: a known fee amount or a
percentage with its supported basis, and an annual management rate with the
duration needed for a prepaid calculation. A known paid amount does not require
unknown inputs that are needed only to derive it. Preserve paid versus estimated
amounts and source-backed coverage. Require a date or ownership scope only for
the selected calculation or evidence assertion that needs it, reuse its actual
source when available, and do not block unrelated investment edits. A capture
timestamp must not be relabelled as a historical effective date.

Start with the ordinary user task and the user's established domain model.
Identify the primary object, its legal or economic parent, and which records are
transactions or evidence about it. Record why the initial scenario is
representative, using stated workflow or inspected evidence; a schema's maximum
cardinality and a complex synthetic test do not establish frequency. Keep edge
cases in regression coverage and reveal their extra structure only when the
actual record requires it. Test the ordinary default separately: a design can
handle every exception correctly and still impose the wrong everyday model.

For an SPV holding, default to one investment with its applicable terms, paid
amounts and refund history together. Preserve separate legal SPVs within a
reviewed company grouping. Several payments toward one subscription are not
automatically several purchases; additional accepted acquisitions within the
same vehicle can justify transaction detail. Do not infer a split, identity, fee
coverage or unchanged ownership from names or absent history. Prefer "Shares"
for ordinary share information; explain remaining ownership when a partial
disposal or other evidenced change makes that distinction relevant. Retain
source-backed scope and date requirements for valuation calculations.

Use one chronological holding history for investment edits, valuation changes,
and link decisions. Identify the change and its timestamp in the closed entry,
using the viewer’s local time zone with minute precision and no zone suffix
(calendar-only source dates retain their date); expansion shows changed fields
with their previous and new values, rather than repeating an unchanged snapshot.
An initial record may show its recorded facts. Link management uses the standard
disclosure header. Reversible unlinking is one activation; explain its effect on
investment visibility and value sourcing in an adjacent accessible info popup.
Preserve records/history and support relinking. Do not add a confirmation to a
reversible action merely to display its explanation; reserve confirmations for
irreversible or trust-sensitive changes. Label the selector as adding another
source when links already exist.

For a new concept or changed information architecture, make a concise concept
map before a mockup. Cover the affected user task and adjacent concepts that
could overlap. For each concept, identify its meaning, scope, lifecycle or
timing, evidence, dependencies and calculations, and editing owner. Separate
facts, contractual terms, estimates and derived displays. Where an item is a
component of a total or a different representation of another item, record that
relationship explicitly. Do not choose its UI location from its database table,
component name, or current section.

Then justify each proposed section with a distinct user question and action.
Challenge existing sections too. Combine overlapping questions or explain the
necessary relationship in the design. A list assigning fields to existing
sections is not a concept review. One editing owner does not by itself justify a
separate visible section.

Check the complete map against at least one realistic combination of related
concepts and one incomplete-evidence case. Calculate expected results using the
domain rules, and check that each input affects the result exactly as intended.
For fees, a rate, paid amount, covered period and future obligation are related
but different facts: an annual label cannot establish a future charge or prove
that nothing was prepaid. Inspect schema and policy limitations; never fill a
gap by inventing a financial fact.

For each derived metric, record its canonical formula, units, numerator and
denominator, and included/excluded cash flows. Verify those definitions against
domain policy before calculating. Shared inputs do not make two metrics' bases
interchangeable. Keep one checked calculation sheet in integer minor units and
reuse its results in summaries, detail rows, examples and explanatory prose.
Before presenting, reconcile every amount, percentage, label and explanation in
the final artifact against those definitions and results, including the
challenge pass. Correct arithmetic elsewhere does not excuse contradictory
display text or a wrong calculation rule; any mismatch fails the proposal check.

Before presenting the mockup, perform a separate challenge pass: can a user
explain where each fact belongs, what changes the result, and why each section
exists without knowing the implementation? Reject a layout that merely passes
component, click-count and screenshot checks while failing those questions. For
the holding summary, also ask the reviewer to identify which value each return
describes, its denominator and the effect of carry. A misplaced return, missing
supported comparison or unsupported cost caveat fails this check even when the
arithmetic is correct. Record the rationale and unresolved assumptions in the
task brief; resolve material ambiguity before implementing its dependent
behavior. Reuse a valid map for routine repairs rather than adding this work to
every visual fix.

The [Holdings concept map](holdings-concept-map.md) is the first worked example.

The [Cash accounts view](cash-accounts-view.md) defines account grouping,
conditional small-balance folding, exact totals and bounded balance history.

### Propose and approve the interaction

A new UI concept changes navigation, task steps, editing ownership, decision
semantics, or introduces a pattern absent from the approved library. Before
implementing it, prepare a task brief and a clickable proposal using synthetic
data. Include ordinary, empty, incomplete, saving, failed-save and later-edit
states on desktop and mobile. Review and simplify it before presenting it.

Record the proposal version, scenario coverage, and the user's approval of that
version. Approval of a plan is not approval of its later mockup. Stop before
application implementation until that design is approved. Material departures
from the approved flow require an updated proposal; routine fixes and reuse of
an approved pattern within its recorded bounds do not require renewed approval.
Never mark a proposal approved on the user's behalf.

Complete the required shared patterns and their state examples before composing
the page. Reuse existing components first; build only missing patterns required
by the approved flow. Generic behavior belongs in `packages/ui`; financial
rules, provider meaning and domain composition belong in the application. A
catalogue entry must show keyboard, mobile, loading, disabled and error behavior
where applicable. A complete library means coverage of the approved task, not
every imaginable component.

The executable examples and approved control APIs are documented in
[the UI library](ui-library.md).

## Shared implementation layer

- Build recurring interface patterns in `packages/ui` and consume them through
  `@keel/ui`. Keep app-local CSS for domain-specific composition only.
- Follow shadcn's source-owned composition model: accessible behavior comes from
  headless primitives, while Keel owns the markup, variants, copy, and visual
  language.
- Start with the narrow layout. Shared interactive targets must be at least 44px
  high on mobile, and horizontal scrolling must be intentional and local.
- Prefer the shared shell, page and section headers, buttons, badges, panels,
  metrics, fields, feedback, and tabs before adding another variant.
- Match the component's variant to its role: toggle filters use outlined buttons
  with a filled selected state; quiet buttons are link-like actions. Empty
  collection results use compact, left-aligned feedback without an icon. Check
  the rendered spacing and mobile targets as well as component usage; broad
  screen selectors must not erase a component's padding. These layout assertions
  remain required when screenshot baselines are updated.
- Keep the primary action in the current section. Do not add a separate step,
  modal, or confirmation unless it protects an irreversible or trust-sensitive
  action.
- Enable a form's submit action only when required fields are complete and all
  entered values are valid. Show actionable inline feedback instead of native
  browser validation pop-ups, and keep server-side validation authoritative.
- Prefill identified source facts and safe workflow defaults. Do not ask users
  to retype metadata already implied by a chosen source or document. A default
  is not a reviewed decision, and unknown financial facts must remain unknown.
- Show saving on the action being performed, then show the resulting state and
  disable unchanged resubmission. Reuse the established feedback components;
  avoid duplicate success banners. Failed saves preserve the user's draft.
- Keep list triage separate from detailed multi-section review. Use shared
  responsive section navigation and actionable progress; optional information
  must not appear to block completion or export.
- Explain the failure actually observed and offer the corresponding next step.
  Missing source data, failed retrieval, failed extraction, conflicting
  evidence, and security restrictions are different states. A retry must not
  weaken a security boundary, and a read failure does not prove sign-in expired.

## User effort contract

Before building a form, record its outcome, entry point, known facts, permitted
calculations, actual user decisions, single editing owner, and effort budget.
Show the proposed result first when it can be supported by the evidence.

- Ordinary tasks with sufficient evidence target at most three action
  activations from the named entry point through successful save. Count opening
  sections, switching modes, confirmations and submitting; count required fields
  separately. Record any justified exception before implementation. Do not hide
  work behind a narrower entry point, exclude confirmations, or remove a
  necessary financial decision to meet the count.
- Existing sufficient evidence requires zero re-entry. Prefill known facts and
  derive supported calculations. Show only the inputs missing for the selected
  task. Selecting imported evidence and entering replacement evidence are
  mutually exclusive modes; selecting a source supplies its known metadata.
- Apply can record the decision expressed by the selected action. Do not add a
  generic acknowledgement checkbox or written rationale to every save. Ask a
  focused question only when unresolved evidence changes the result or
  acceptance boundary. Existing domain acceptance requirements remain
  authoritative until deliberately revised and verified; hiding a checkbox
  cannot manufacture its financial assertion.
- Give each fact one editing owner and each action one visible entry within a
  task. Reuse its canonical editor. A second entry needs a concrete navigation
  benefit that cannot be met by the existing entry, recorded in the task brief.
- Display a fact once within the current reading context. A collapsed summary
  may identify an item, and an editor may show that fact for editing; do not
  repeat it in the expanded metadata, another metric and another terms block.
  Necessary cross-context repetition must have a stated user purpose.
- Suppress absent optional rows, empty sections, unknown placeholders and zero
  fee rows in summaries. A meaningful zero (such as an evidenced zero balance or
  a user's explicit zero input) remains visible where needed. Unknown remains
  distinct from zero in storage and calculations.
- Show a notice only for a current failure, conflict, required decision, or a
  material limit on the result the user is using. Put it beside that result or
  action. Optional enrichment and missing optional metadata are not warnings.
- Keep consequential estimate/proxy labels visible. A cost fallback must be
  labelled net invested, not current market value. Missing fee bases, share
  counts, dates, coverage and distribution treatment cannot become confirmed
  facts through a cleaner presentation.

Choose section navigation by the task. Use tabs for related alternate views,
visible sections for information needed together, and disclosure for supporting
detail. Section count alone does not choose tabs or accordions. Avoid nested
disclosure and never hide the sole primary action behind optional detail.

For imported valuation evidence, show the source, proposed estimate and the
single action that adopts it. Keep the manual alternative in the valuation
editor, opened with Edit. Reuse valid saved purchase evidence; do not recreate a
purchase editor or summary under valuation. If the evidence cannot establish
remaining shares or coverage, ask only for that unresolved information in its
owning workflow. A captured date is never a substitute for an absent valuation
date.

Treat valuation source, representation and selection as separate dimensions. A
position's GP report may contain both a position value and a share price; retain
both with their dates, scope and cost treatment. Prefer the directly reported
position value for that position unless the user selects a supported
alternative. Surface a material unexplained discrepancy with a comparable share
calculation without overwriting either fact or inventing a reconciliation. An
after-carry total is not directly comparable with a gross share calculation.

Another GP's evidence may supply a compatible price for this company's shares,
but its vehicle's total or after-carry value is not this position's value. Use
this position's supported shares and terms, preserve share-class and date
limits, and label the result a proxy estimate even when classes match. A user's
judgment estimate may contain a total, share price or both and reference
Portfolio Watch evidence; it remains a user estimate. Selecting it must preserve
original reports and allow switching back. Reusing a company-level valuation
requires a supported ownership/dilution basis; never treat it as a position
value.

## Enforcement boundaries

Use existing shared-component usage checks for structural rules and shared
tokens for type, spacing, focus and target sizes. Extend repository-native
browser tests with task-specific assertions for mode exclusivity, duplicate
actions, visible fields, absent optional content, interaction budgets, failure
recovery and stored-state readback. Match facts by semantic identity (entity,
field and context), not by repeated strings or equal dollar amounts.

For each regression, specify an old behavior that must fail the new assertion.
Screenshot changes cannot waive these assertions. Keep visual inspection and
human approval for hierarchy, useful copy, information ownership and genuinely
new concepts; a keyword linter cannot prove those judgments. CI may check a
proposal reference and scenario coverage, but must not claim to authenticate
human approval from an agent-written flag.

The first application of this contract is the
[Holdings UX pilot](holdings-ux-pilot.md). Its scenario matrix separates
proposal checks from application tests that will be added after design approval.

## Copy filter

Every visible sentence or label must do at least one of these jobs:

1. Help the user act.
2. Help the user make a decision.
3. Orient the user in the current workflow.
4. Explain an essential trust or safety boundary.

Remove copy that only describes implementation. Avoid terms such as connector,
append-only, immutable, retained, persistence, D1, model status, and private
alpha unless the user must understand that concept to proceed. Explain a concept
once, in the shortest accurate language.

Keep synthetic-data and review disclosures concise and accurate. Use “Demo
sources” for synthetic data. For source updates, follow the
[source-update policy](../architecture/source-update-policy.md): routine updates
can apply through recorded automatic decisions, while exceptions and planning
choices require review. Explain the boundary for the current action; “Review
needed” is appropriate for an exception. Do not imply that every routine update
requires a human click or that a source default is an accepted decision.

## Portfolio summary

Lead the Overview portfolio snapshot with value and supported performance. Keep
mapping coverage and concentration beside the holdings chart. Follow the
[portfolio performance definitions](portfolio-performance.md) for
current-holding scope, eligible coverage, paid-in versus net-capital bases, and
refund/carry treatment. Do not imply a complete lifetime portfolio return from
current positions. Unknown inputs produce unavailable metrics, not zero returns.

## Verify behavior and appearance separately

Use observable behavior as the primary correctness contract. Assert entered and
saved values, validation, errors, pending controls and later edits through the
user's interface. For a financial editor, exercise each affected write path
through the real local API and isolated synthetic D1 state. Verify the accepted
receipt, projected value and preserved decision history after reload. Mocked
failure flows and repository tests supplement this end-to-end proof.

Keep visual baselines for approved controls and important compositions. Reuse
that coverage for routine control changes. Add a page or state baseline when it
protects distinct visual meaning. A picture does not prove persistence or money
arithmetic. Exact coordinates and row gaps are not contracts unless the product
requires them. Test keyboard focus and navigation overlap without preparatory
centering or hidden chrome.

Pixel comparisons use the canonical Linux x64 CI renderer. Local functional runs
keep behavior assertions active without claiming a pixel pass. Use current local
captures for appearance review, with CSS-pixel scale and consistent capture
settings. Follow the
[visual verification procedure](../../.codex/skills/keel-ui-quality/references/visual-verification.md).

## Definition of done

A change is material when it affects hierarchy, layout, spacing, typography,
color, borders, badges, responsive behavior, accessibility, interaction, a
transient state, or product meaning. Copy beyond a mechanical spelling or
punctuation correction is material, including source and review disclosures.

Before handing off a material interface change:

- For a new concept or changed information architecture, verify the concept map,
  section rationale and combined/incomplete cases before accepting visual proof.
- Verify that the flow reuses an approved pattern or has approval of its exact
  proposal version. Confirm required component examples are complete.
- Test the ordinary-path effort budget: visible required inputs, confirmations,
  and actions. A screenshot passing is not sufficient. Exercise the path without
  typing when existing evidence is sufficient, and verify optional adjustments
  and failed-save draft preservation.
- Compare the screen side by side with its Keel reference screen before coding
  and after implementation.
- Review desktop and mobile layouts at their tested breakpoints.
- Confirm there is no horizontal overflow or clipped primary content.
- Run a border-and-badge pass: remove every line, box, or status pill that does
  not communicate meaningful structure or state.
- Run a copy-reduction pass: remove repeated explanations, implementation terms,
  and labels that are already evident from hierarchy or context.
- Confirm the primary action and trust boundary remain clear without reading
  secondary metadata.
- Exercise the primary action, reload its saved state, repeat a changed save,
  and reject a save while checking draft retention. Financial editors need a
  real local browser, API and D1 roundtrip for each affected write path. Retain
  repository readback and controlled failure mocks; a success response alone is
  insufficient.
- Check sibling uses of changed patterns and use the
  [review safeguards](../engineering/review-safeguards.md) to select existing
  regressions before adding new coverage.
- Review representative changed appearance against approved references. Update
  affected canonical baselines when the visual contract changed. Inspect those
  images and run `make verify` after the final source and review fixes settle.
  Report local functional and canonical CI outcomes separately.

Screenshot changes are reviewed product changes. Do not update a baseline only
to make a failing test green; first confirm the new image satisfies this
contract.

## Brokerage source decisions

The ordinary source task needs no action: show the automatic result, accepted
holdings total, report date and last successful check. Connection health does
not establish freshness; omit repeated healthy badges. Name a genuine decision
count. A verified complete account inventory removes absent holdings from
current totals automatically; show “No longer held”, the quantity transition,
source date and optional dated prior value in activity. Do not imply sale
proceeds or a realized loss. Incomplete accounts keep their dated accepted
holdings. Summaries count holdings removed from current totals separately from
unreported holdings still counted at their last accepted values. A partial
report for one account must not claim that no holdings were removed from other
accounts. Omit carryover notices when no unreported holdings were kept. An
omission alone never supplies a Review button or acknowledgement. Reappearance
counts one identity. Earlier activity is read-only and uses the saved report's
values. Count changed financial facts and presence changes, rather than calling
every unchanged accepted row a new change.

For an unresolved source identity, compare the existing and reported position
with account, shares, value and date. Prefill only a credible unique comparison
or a saved match; being the only prior holding does not make it a match. With no
comparison selected, lead with the reported position and its named add action.
State that existing holdings stay unchanged. Matching an existing holding is an
explicit alternative, including when only one is available, and the user can
return to adding a new holding without saving a match. Keep alternate candidates
reachable without re-entry. Give each direct choice its accepted-total effect:
same holding, separate holding, or ignore this report. Keep unknown totals
visibly unavailable. One ordinary identity decision requires one explicit
choice. Save once, keep failures beside the choices, read uncertain status
explicitly, and allow later correction in activity. Saved choices and routine
automatic updates must survive reload without a repeated identity/planning
approval. The source-update policy owns acceptance; these controls compose the
existing shared library in the application.

A saved source decision completes exact security grouping before the accepted
holdings readback. A new legal position joins an existing exposure only when its
verified security identity agrees; it does not become the same legal position. A
confirmed same-holding observation retains its accepted grouping. Pending
grouping uses the existing saved-but-refresh-pending state, with one explicit
refresh of derived state and no repeated financial decision. A status read that
discovers an already saved receipt follows this same recovery path.

After a decision is saved, keep stale source totals and decision counts out of
the summary until its readback succeeds. A failed refresh must preserve the
saved receipt, identify the pending readback and offer its own recovery. An
invalid source must not offer acceptance actions that its controls disable.
