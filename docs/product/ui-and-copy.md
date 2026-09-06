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

Synthetic data and review boundaries remain non-negotiable, but they should be
expressed as concise product language such as “Demo sources” and “Nothing
changes until you review it.”

## Definition of done

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
- Update the relevant Playwright screenshot baselines, inspect the generated
  images, and run `make verify`.

Screenshot changes are reviewed product changes. Do not update a baseline only
to make a failing test green; first confirm the new image satisfies this
contract.
