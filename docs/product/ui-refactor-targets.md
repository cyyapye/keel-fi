# UI refactor targets

This is Keel's bounded maintenance queue for user-interface refactors. It is
separate from the product roadmap: an item belongs here only when it reduces a
demonstrated UI duplication without changing product behavior.

Audited against `origin/main` at `7a97222` on 2026-08-29.

## Queue rules

- Keep at most four active targets. Park new candidates until a slot opens.
- Admit a target only when there are at least three genuinely recurring uses, or
  when an exact high-risk behavior or shell is duplicated.
- Put reusable semantics and interaction behavior in `@keel/ui`. Keep routing,
  provider policy, financial meaning, and screen composition app-local.
- Do not create a generic primitive from visually similar markup alone.
- Each pull request addresses one target; a target may use bounded, file-owned
  sub-PRs. Mark the target complete only after every tested SHA is merged, each
  exact-SHA post-merge workflow passes, and the checkouts are clean.

## Completed baseline

- [x] **UI-01 — Shared foundation, forms, and controls.** PRs #116, #136, and
      #165 established the shared shell, fields, buttons, links, and
      native-control usage guard.
- [x] **UI-02 — Shared actions and feedback.** PR #167 adopted `ActionGroup`,
      `FormMessage`, and shared feedback patterns.
- [x] **UI-03 — Shared read-only data displays.** PR #171 adopted `DataList`,
      `StatGroup`, and the shared display usage guards.
- [x] **UI-05 — Compact shared empty states.** PR #180 extended `EmptyState`,
      migrated the four audited states, and added inspected desktop/mobile
      baselines for macOS and Linux. Exact-SHA post-merge run `33320978259`
      passed for `56a4386`.

## Active queue

### [ ] UI-04 — Shared section hierarchy

**Claim:** Active on 2026-08-29; implementation is owned by
`codex/ui-04-section-hierarchy`.

**Progress:** The shared API and the file-owned `InitialShell.tsx`,
`InvestmentHoldings.tsx`, `Obligations.tsx`, and `PlanActualMonitoring.tsx`
adoption are complete. Direct `App.tsx` adoption remains sequenced after UI-07.

**Why it qualifies:** four `SectionHeader` uses exist, while 42 additional
high-confidence structural section headings still repeat the eyebrow, heading,
description, and action pattern. The audited candidates are in `App.tsx`,
`InitialShell.tsx`, `InvestmentHoldings.tsx`, `Obligations.tsx`, and
`PlanActualMonitoring.tsx`.

- [x] Extend `SectionHeader` to preserve `h2`, `h3`, or `h4` semantics, required
      description placement, and heading `id`, focus ref, and `tabIndex`.
- [x] Migrate only page-level or section-level structure. Keep record, evidence,
      reconciliation, final-review, and other domain-card headings local.
- [x] Preserve existing domain class names and layout anatomy unless a visual
      change is explicitly approved.
- [x] Add a bounded usage guard for approved structural patterns; do not ban all
      raw eyebrow headings.
- [ ] Finish direct `App.tsx` adoption after UI-07 moves the provider-control
      region.

**Ownership:** `packages/ui/src/components/layout.tsx`, the five audited screen
files, and their focused visual specs. Remaining `App.tsx` adoption follows
UI-07 so the same region is not moved twice.

### [ ] UI-06 — Initial and loading route shells

**Claim:** Active on 2026-08-30; implementation is owned by
`codex/ui-06-route-shells`.

**Progress:** The navigation definition, full-page loading shell, Holdings
initial route, and focused desktop/mobile coverage are consolidated. The target
remains open until the tested SHA is merged and its exact-SHA post-merge
workflow passes.

**Why it qualifies:** `InitialShell.tsx` and the bottom of `App.tsx` contain an
exact full-page loading-shell duplicate, near-duplicate Holdings route
scaffolds, and separate navigation definitions.

- [x] Extract one dependency-light app-local navigation definition and loading
      shell.
- [x] Consolidate the Holdings initial route state without importing the
      deferred `App` bundle into `InitialShell`.
- [x] Preserve the early Holdings paint, route labels, active-state semantics,
      and responsive navigation behavior.

**Ownership:** `InitialShell.tsx`, the final route-shell region of `App.tsx`,
new app-local shell files, `e2e/navigation.visual.spec.ts`, and the initial-load
case in `e2e/investment-holdings.visual.spec.ts`. This is app-local composition,
not a new `@keel/ui` primitive.

### [ ] UI-07 — Provider source controls

**Why it qualifies:** roughly 1,500 lines in `App.tsx` repeat scheduling,
reconnect, setup, status, metadata, and feedback composition across AngelList,
Tokenfolio, and Sydecar.

- [ ] Extract provider controls into `apps/web/src/provider-agents/` behind an
      app-local adapter and common controller/view.
- [ ] Keep provider-specific cadence, retry policy, reconnect behavior, copy,
      routes, polling, and review gates explicit in each adapter.
- [ ] Continue composing existing shared `Button`, `ActionGroup`, `Select`,
      `DataList`, and `FormMessage` primitives; do not add a provider component
      to `@keel/ui`.
- [ ] Confirm whether the retired AngelList Browser Run UI's one-release
      rollback window has closed. If it has, remove only its unreachable
      frontend, client helpers, styles, and orphaned snapshots; otherwise record
      the deferral.

**Ownership:** the provider-control region of `App.tsx`, provider-specific CSS,
new app-local modules, and the provider cases in
`e2e/holdings-import.visual.spec.ts`. Server endpoints and domain schemas are
out of scope.

## Parallel work plan

Worktrees may develop independent lanes concurrently, but shared-file merges
remain ordered.

### Wave 1 — foundations

- **Lane A:** UI-04 API in `packages/ui/src/components/layout.tsx`.
- **Lane B:** UI-05 API in `packages/ui/src/components/feedback.tsx` and its
  exact shared style block.
- **Lane C:** UI-06 route-shell consolidation.

One integration owner handles `scripts/shared-ui-usage.test.ts`, shared-style
overlap, and exports after the three lanes are reconciled.

### Wave 2 — screen adoption

After the shared APIs land, these file-exclusive lanes can run in parallel:

- **Lane A:** `PlanActualMonitoring.tsx` section hierarchy.
- **Lane B:** `Obligations.tsx` section hierarchy plus its empty state.
- **Lane C:** `InvestmentHoldings.tsx` section hierarchy plus its two empty
  states.
- **Lane D:** `PortfolioSnapshot.tsx` empty state.

Each lane owns its focused spec and snapshots. Preserve current app-local CSS so
the lanes do not contend for `apps/web/src/styles.css`.

### Wave 3 — `App.tsx` architecture

UI-07 can be developed while Wave 2 touches the file-exclusive screens. Merge
direct `App.tsx` writers in this order:

1. UI-06 route shells.
2. UI-07 provider controls.
3. UI-04 remaining structural headings in `App.tsx` and the extracted provider
   module.

Rebase each later branch on the released preceding SHA and rerun its focused
visual spec plus `make verify`.

## Parked candidates — not active todos

- **Generic tables:** only two uses exist, both in the holding-import domain.
- **Generic disclosures:** the three native `<details>` uses have materially
  different jobs and already share browser behavior.
- **More panels or cards:** the recurring container already uses shared `Panel`;
  the remaining compositions carry domain meaning.
- **Wholesale `App.tsx` splitting:** extract a cohesive behavior only when an
  active target justifies it. File length alone is not a shared-UI target.
- **Goal-selector empty copy:** this is a selectable missing-value label, not an
  empty state.

## Definition of done for every active item

- Preserve heading semantics, labels, actions, copy, routes, financial meaning,
  review gates, and unknown-value handling.
- Compare the changed screen with Holdings or Scenarios as appropriate.
- Run the focused visual spec without update mode before accepting new
  baselines. Inspect desktop and mobile PNGs on macOS and Linux.
- Confirm no horizontal overflow or clipped primary content, then run the
  border-and-badge and copy-reduction passes from the interface contract.
- Run `make verify`, publish the exact tested SHA, and verify the post-merge
  exact-SHA workflow before checking the item off.
