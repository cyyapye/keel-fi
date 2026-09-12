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
- Use type hierarchy in this order: page title, section heading, primary value
  or action, supporting copy, metadata.
- Add a border or divider only when it separates a real data group, state, or
  interaction. Do not box every concept.
- Use badges for exceptional status, not repeated metadata or labels that are
  already clear from context.
- Keep one primary action per section whenever possible.
- Use Holdings as the default reference for information density and Scenarios as
  the default reference for interactive controls.
- Reuse established visual patterns, and make labels and apparent affordances
  match implemented behavior.

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

## Definition of done

A change is material when it affects hierarchy, layout, spacing, typography,
color, borders, badges, responsive behavior, accessibility, interaction, a
transient state, or product meaning. Copy beyond a mechanical spelling or
punctuation correction is material, including source and review disclosures.

Before handing off a material interface change:

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
  and reject a save while checking draft retention. Pair mocked browser flows
  with repository/API readback tests; a success response alone is insufficient.
- Check sibling uses of changed patterns and use the
  [review safeguards](../engineering/review-safeguards.md) to select existing
  regressions before adding new coverage.
- Update the relevant Playwright screenshot baselines, inspect the generated
  images, and run `make verify`.

Screenshot changes are reviewed product changes. Do not update a baseline only
to make a failing test green; first confirm the new image satisfies this
contract.
