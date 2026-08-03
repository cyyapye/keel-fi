---
name: keel-ui-quality
description:
  Enforce Keel's interface and copy contract for any task that creates, edits,
  reviews, diagnoses, or verifies user-visible frontend work. Use for React
  components, pages, layouts, CSS, design tokens, responsive behavior,
  accessibility, UI copy, charts, interaction affordances, loading, empty,
  success, or error states, and Playwright visual baselines under apps/web or
  e2e. Trigger even when the request is phrased only as polish, simplify,
  restyle, rename, clean up, make clearer, fix the mobile view, or fix a visual
  bug.
---

# Keel UI quality

Apply Keel's product language deliberately and leave current-run visual
evidence. Treat the repository contract as the authority; use this skill as its
execution workflow.

## Load the contract

1. Read `AGENTS.md` and `docs/product/ui-and-copy.md` completely before editing.
2. Inspect the current Git state and preserve unrelated user changes.
3. Inspect the affected screen in the running app at desktop and mobile sizes.
   If it is not running, use the repository's documented development workflow to
   start it.
4. Choose the closest Keel reference: use Holdings for information-dense
   layouts, Scenarios for interactive controls, or the closest established
   screen for another pattern.

Treat a change as material when it affects page or section hierarchy, visible
product copy beyond a typo, spacing, typography, color, borders, badges,
responsive behavior, interaction, or a loading, empty, success, or error state.

## Frame the change

Before coding, identify:

- the screen's primary action or decision;
- the essential trust boundary, if any;
- the hierarchy that should remain after secondary copy is removed;
- every line, box, badge, or label that must justify its presence.

Do not invent a new visual language when an existing Keel pattern solves the
problem.

## Implement

- Prefer whitespace, spacing, and type hierarchy to containers and dividers.
- Keep one primary action per section whenever possible.
- Keep only copy that helps the user act, decide, orient, or understand an
  essential trust or safety boundary.
- Remove repeated explanations and internal implementation terms. Rewrite
  necessary concepts in concise product language.
- Make labels and apparent affordances match implemented behavior.
- Preserve concise synthetic-data and review-before-change disclosures.
- Keep desktop and mobile layouts intentional; do not merely allow the desktop
  layout to wrap.
- Preserve Keel's financial correctness and external-evidence boundaries from
  `AGENTS.md`.

## Verify visually and functionally

1. Run the narrowest relevant lint, type, unit, and browser checks while
   iterating.
2. For every material change, ensure a deterministic Playwright screenshot
   covers the affected screen on both configured desktop and mobile projects.
   Add coverage when none exists.
3. Keep visual fixtures inside browser tests. Use fixed synthetic values and
   retain separate functional coverage for real application behavior.
4. Update snapshots only after confirming the rendered change is intentional:

   `pnpm exec playwright test e2e/<visual-spec> --update-snapshots=all`

5. Inspect every generated PNG with the image-viewing tool. Check hierarchy,
   spacing, copy density, borders, badges, contrast, clipping, sticky
   navigation, transient states, and horizontal overflow.
6. Rerun the visual spec without snapshot-update mode.
7. Run `make verify` before handoff. Keep browser tests serialized when they
   share the seeded local D1 state.

Never update a baseline merely to make a test green. Fix unintended rendering or
interaction first.

## Handoff gate

Do not call a material UI task complete unless all of these are true:

- the before-and-after comparison used an explicit Keel reference screen;
- desktop and mobile screenshots were generated and inspected in the current
  run;
- the border-and-badge and copy-reduction passes were completed;
- the primary action and trust boundary remain clear;
- the relevant visual test passes without updating snapshots;
- `make verify` passes, or the exact pre-existing blocker is reported with
  evidence.

In the handoff, lead with the user-visible outcome and report the reference
screen, inspected screenshots, and verification result. Never expose real
financial or personal data in code, fixtures, screenshots, or logs.
