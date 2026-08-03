# Keel web interface instructions

- Use `$keel-ui-quality` from `../../.codex/skills/keel-ui-quality/SKILL.md` for
  every task that touches or evaluates user-visible frontend behavior.
- This includes components, layout, styling, copy, responsive behavior,
  accessibility, charts, affordances, loading, empty, success, and error states,
  plus visual-regression coverage—even when the request is described only as a
  bug fix, rename, cleanup, or polish.
- Follow the root `AGENTS.md` and `docs/product/ui-and-copy.md`; the product
  contract remains authoritative if it conflicts with the workflow skill.
- Do not hand off a material interface change until current-run desktop and
  mobile screenshots have been inspected and `make verify` passes, or an exact
  pre-existing blocker is reported with evidence.
