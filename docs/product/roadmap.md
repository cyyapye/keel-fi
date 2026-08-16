# Product delivery roadmap

This is Keel's canonical product sequence for the owner-operated private alpha.
The first unchecked milestone is next. Keep exactly one milestone marked
**Active** so delivery does not split across partially finished product slices.

- Last reconciled: 2026-08-15
- Reconciled product baseline:
  [`7bb5257`](https://github.com/cyyapye/keel-fi/commit/7bb5257010f0f5d76f27aea913d689a52e56c9aa)
- Baseline release evidence:
  [`31893835608`](https://github.com/cyyapye/keel-fi/actions/runs/31893835608)

## How to use this roadmap

- Check a milestone only after its reviewed PR is merged, terminal checks pass,
  and the merge is contained in an exact-SHA release that passes the post-merge
  deployment workflow.
- When an active milestone contains ordered delivery slices, the first unchecked
  slice is next. Do not begin or publish a later slice while an earlier slice is
  unchecked.
- Check an exit gate when its evidence exists. A checked implementation gate
  does not make the milestone delivered before its release gate passes.
- Preserve completed milestones and their evidence when priorities change. Add a
  short rationale when reordering unchecked milestones.
- Every milestone must state its user outcome, trust boundary, non-goals,
  dependencies, infrastructure-cost gate, and acceptance evidence before coding.
- External observations remain proposals. Missing data is unknown, not zero or
  an inferred sale, closed account, or repaid liability.
- Keep repository code, tests, screenshots, logs, and documentation synthetic
  only. Private runtime acceptance may verify a connector without recording
  private values in public artifacts.

## Delivered

- [x] **M1 — Versioned goals, forecasts, and evidence decisions.** Goals and
      forecast snapshots preserve prior versions; reviewed evidence moves
      through Scenario and Apply before changing an accepted decision.
  - Evidence: [PR #1](https://github.com/cyyapye/keel-fi/pull/1) at
    [`73f6115`](https://github.com/cyyapye/keel-fi/commit/73f6115e9fabab0a8fb0ec9c0c5df930aacd04d8)
    and [PR #10](https://github.com/cyyapye/keel-fi/pull/10) at
    [`d20a54a`](https://github.com/cyyapye/keel-fi/commit/d20a54a3f46c7ae650dc9bbde4e9481ff436b286).
- [x] **M2 — Portfolio Watch and reconciled public evidence.** Allowlisted
      company sources retain observations, separate reported facts from
      inference, reconcile conflicting signals, and create reviewable proposals.
  - Evidence: [PR #18](https://github.com/cyyapye/keel-fi/pull/18) at
    [`3e1b39c`](https://github.com/cyyapye/keel-fi/commit/3e1b39cf438d5ea59c4221b39f58aa8a032e014e),
    [PR #20](https://github.com/cyyapye/keel-fi/pull/20) at
    [`731ef35`](https://github.com/cyyapye/keel-fi/commit/731ef351ef4fc1d19989ed7c2083374ffb6d1aa8),
    and [PR #23](https://github.com/cyyapye/keel-fi/pull/23) at
    [`32d566f`](https://github.com/cyyapye/keel-fi/commit/32d566f4b8ea742cea3af2aae7e7f42f6b5e30d7).
- [x] **M3 — Review-gated private holdings imports.** AngelList exports stage in
      private storage, require review, preserve locked values as unknown, and
      can be collected by the bounded daily Mac agent.
  - Evidence: [PR #22](https://github.com/cyyapye/keel-fi/pull/22) at
    [`41c36d6`](https://github.com/cyyapye/keel-fi/commit/41c36d6642e9ac2d22547511061dc30f96a3923f),
    [PR #36](https://github.com/cyyapye/keel-fi/pull/36) at
    [`dbcde2d`](https://github.com/cyyapye/keel-fi/commit/dbcde2df3fd73b77eb948bc603a374eef4564d47),
    and [PR #38](https://github.com/cyyapye/keel-fi/pull/38) at
    [`42b3fc7`](https://github.com/cyyapye/keel-fi/commit/42b3fc7433a85d63a3ce01810dc10923798e3033).
- [x] **M4 — Review-gated public holdings imports.** Plaid Investments stages
      Robinhood holdings for review, handles provider failures safely, and uses
      verified webhooks for automatic checks without automatic acceptance.
  - Evidence: [PR #40](https://github.com/cyyapye/keel-fi/pull/40) at
    [`e8184a0`](https://github.com/cyyapye/keel-fi/commit/e8184a005ed47d106017f88902c2191170a008d4),
    [PR #41](https://github.com/cyyapye/keel-fi/pull/41) at
    [`4056650`](https://github.com/cyyapye/keel-fi/commit/40566509ac2aff2917401f5bb90df36c7242a434),
    and [PR #45](https://github.com/cyyapye/keel-fi/pull/45) at
    [`7197f9f`](https://github.com/cyyapye/keel-fi/commit/7197f9fddd49af199b1ffa4b781dab2de63f2225).
- [x] **M5 — Reviewed planning baseline and editable runway inputs.** Reviewed
      public holdings plus explicitly entered other liquid assets replace the FI
      baseline only after confirmation. Private paper stays outside current
      liquidity, and burn and protected-cash assumptions are editable drafts
      until saved into a new forecast version.
  - Evidence: [PR #43](https://github.com/cyyapye/keel-fi/pull/43) at
    [`d87e350`](https://github.com/cyyapye/keel-fi/commit/d87e35052ab39508f4976b6296ca731bac95f5fd)
    and [PR #44](https://github.com/cyyapye/keel-fi/pull/44) at
    [`f86fdc5`](https://github.com/cyyapye/keel-fi/commit/f86fdc5d192f913663d0307a0be69620833a6c90).
- [x] **M6 — Cash accounts to reviewed liquidity baseline.** Eligible linked
      balances remain dated proposals until cash review, then require a separate
      Portfolio Baseline confirmation before they enter FI planning. Missing,
      unavailable, non-USD, and possible-overlap cases remain explicit, and live
      balance checks are user-triggered and capped.
  - Evidence: [PR #50](https://github.com/cyyapye/keel-fi/pull/50) at
    [`dd8a4ce`](https://github.com/cyyapye/keel-fi/commit/dd8a4ce77e7625a31dcca7aa761c4ddb97ced79a),
    with exact-SHA verification, protected smokes, and deployment evidence in
    [run `31855386784`](https://github.com/cyyapye/keel-fi/actions/runs/31855386784).
    Private acceptance opened Plaid Link without selecting an institution or
    entering account credentials.
- [x] **M7 — Liabilities to reviewed obligation baseline.** Plaid and manual
      debt facts remain dated proposals until review. Explicit revolving and
      scheduled payment treatments preview net liquidity, burn, runway, and FI
      gap without subtracting all principal, double counting payments, or
      mutating an accepted plan. Missing, unsupported, overdue, and stale states
      remain visible.
  - Evidence: [PR #54](https://github.com/cyyapye/keel-fi/pull/54) at
    [`8196c94`](https://github.com/cyyapye/keel-fi/commit/8196c947a8cbc3f2029ee34ab9e97642df1f086e),
    with exact-SHA verification, encrypted D1 backup, forward-only migration,
    protected smokes, and deployment evidence in
    [run `31867504712`](https://github.com/cyyapye/keel-fi/actions/runs/31867504712).
    Provider-backed production use remains gated on deployment-specific
    coverage, pricing, and retention approval; manual review is available
    without provider retention.
- [x] **M8 — Observed cash flow to reviewed burn proposals.** Bounded Plaid
      transaction checks separate household, business, debt, and excluded cash
      flow, then compare three complete months with the accepted runway plan.
      Material differences create a reviewable plan draft; they never change
      accepted burn automatically.
  - Evidence: [PR #56](https://github.com/cyyapye/keel-fi/pull/56) at
    [`7bb5257`](https://github.com/cyyapye/keel-fi/commit/7bb5257010f0f5d76f27aea913d689a52e56c9aa),
    with exact-SHA verification, encrypted D1 backup, forward-only migration,
    protected smokes, and deployment evidence in
    [run `31893835608`](https://github.com/cyyapye/keel-fi/actions/runs/31893835608).
    Provider-backed activation remains gated on deployment-specific Plaid
    Transactions pricing confirmation; no live Item was activated.

## Ordered next milestones

Priority change, 2026-08-15: multi-source investment ownership moves ahead of
plan-versus-actual monitoring. Monitoring against today's provider-wide holding
identity could create false missing-position signals or double counts when a
second institution is added. M9 establishes the account-scoped identity and
aggregation boundary first.

### [ ] M9 — Multi-source investment ownership — **Active**

**User outcome:** The owner can connect Robinhood, Fidelity, and later
investment institutions; keep the same security separate in every brokerage or
retirement account; keep multiple SPV interests into one private company
separate; and still see a grouped exposure view.

**Trust boundary:** A sync can affect only its exact connection and completely
covered ownership containers. An omitted position is `not reported`, never a
sale, closed account, zero value, or deletion. Exposure grouping cannot merge
legal positions or add value to the reviewed baseline.

**Scope:** Implement the canonical model in
[ADR 005](../architecture/adr-005-multi-source-holdings-identity.md):
provider-neutral investment connections, first-class ownership containers,
container-scoped imports and coverage, position-to-exposure mappings,
institution/account position views, an exposure rollup, additive legacy
migration, and Fidelity as the first additional institution proving the
generalized Plaid Investments path.

**Non-goals:** Trading or transfers, tax-lot accounting, universal institution
coverage, inferred SPV look-through allocations, or automatically merging the
same legal account observed through unrelated sources.

**Dependencies:** M3 through M5 provide review-gated private/public positions,
append-only snapshots, and the reviewed Portfolio Baseline that this milestone
must preserve.

**Infrastructure-cost gate:** Keep provider credentials in existing private
storage and use one bounded sync lifecycle per connection. Record and approve
deployment-specific aggregation-provider coverage, per-Item/product pricing,
webhook volume, D1 growth, and retention before authorizing a real additional
institution.

**Delivery rule:** Complete the M9 slices below in order. The first unchecked M9
slice is the next unit of work. Each slice must be independently mergeable, must
preserve the currently shipped Robinhood, AngelList, cash-account, and Portfolio
Baseline behavior, and must pass `make verify`, reviewed PR checks, exact-head
merge, and exact-SHA post-merge evidence before the next slice starts. Keep M9
marked **Active** until every slice and milestone exit gate is checked.

#### [x] M9.1 — Canonical persistence and domain contract

**Outcome:** D1 and the shared domain contracts can represent the complete ADR
005 relationship model without changing any current accepted value.

**Required changes:**

- Add or compatibly map the logical investment connection, ownership container,
  import coverage, canonical exposure, and position-exposure records defined in
  ADR 005. Reusing `connector_accounts` is acceptable only if its contracts stop
  treating an institution-specific provider value or display name as identity.
- Give every connection a household, adapter type, institution metadata,
  protected stable source key, lifecycle state, and private credential
  reference.
- Give every ownership container a connection, protected stable account key,
  display label, container kind, and explicit tax treatment, including an
  unknown state. Brokerage, IRA, trust/entity, and unresolved/other cases must
  be representable without using a display name or account mask as identity.
- Keep a position's identity scoped to exactly one container plus a stable
  source position key. A private SPV interest is the owned position; the owner
  entity or account is its container; the underlying company is an exposure.
- Use HMAC-derived source and account keys in D1. Raw Item IDs, provider account
  IDs, access tokens, account numbers, and credentials remain outside D1, logs,
  browser responses, screenshots, and test artifacts.
- Because current positions, snapshots, and exposure rows are immutable, use
  additive association/version tables where an in-place update would rewrite
  history. Add household-integrity, uniqueness, no-update, and no-delete guards
  for new accepted records.
- Add Zod contracts and D1 invariant tests for every new external or persistence
  boundary. Money remains integer minor units, quantities use explicit integer
  scales, and allocations use integer parts per million.

**Slice gate:** Migration replay and synthetic seed checks prove the new records
are household-scoped, append-only where accepted, and initially have no effect
on holdings, baseline, goal, or forecast output.

- Evidence: [PR #62](https://github.com/cyyapye/keel-fi/pull/62) at
  [`93151d2`](https://github.com/cyyapye/keel-fi/commit/93151d22ec88b5bf12d614c14a09b1c96154cfe7)
  and [PR #61](https://github.com/cyyapye/keel-fi/pull/61) at
  [`0be5a2d`](https://github.com/cyyapye/keel-fi/commit/0be5a2dddc3c9d9c00e1948713ce5cb7cc602db6),
  with exact-SHA verification, encrypted D1 backup, forward-only migration,
  protected smokes, and deployment evidence in
  [run `31914632676`](https://github.com/cyyapye/keel-fi/actions/runs/31914632676).

#### [x] M9.2 — Legacy association and compatibility reads

**Outcome:** Every shipped Robinhood and AngelList position participates in the
canonical model without changing its ID, history, accepted snapshot, or planning
treatment.

**Required changes:**

- Associate existing positions with additive legacy connection and container
  records. Backfill a precise account/container only when retained provenance
  proves it; never reverse or guess an opaque fingerprint.
- Put an ambiguous legacy position in an explicit unresolved legacy container.
  It remains reviewable and keeps its accepted facts, but it cannot participate
  in container-scoped omission inference until a review or complete new sync
  resolves it.
- Preserve existing AngelList legal positions. Use reviewed owner/investment
  entity provenance for containers where available; never replace an SPV
  interest with the underlying portfolio company.
- Introduce compatibility reads before changing writes. During transition,
  legacy and canonical representations may describe the same position, but only
  the existing position/snapshot can contribute money to a baseline.
- Compare synthetic pre-migration and post-migration position IDs, latest
  snapshots, public/private totals, unknown counts, Portfolio Baselines, FI
  plans, goals, and forecast snapshots. Every value and version reference must
  remain identical.

**Slice gate:** Forward migration, fresh migration, seed replay, compatibility,
and feature-disable checks pass with zero orphaned positions, zero multiply
assigned positions, zero household mismatches, and zero planning-value drift.

- Evidence: [PR #64](https://github.com/cyyapye/keel-fi/pull/64) at
  [`2533c91`](https://github.com/cyyapye/keel-fi/commit/2533c9196207d4ba22ee7a98a99e9be883581b4d),
  with exact-SHA verification, encrypted D1 backup, forward-only migration,
  protected smokes, and deployment evidence in
  [run `31916501272`](https://github.com/cyyapye/keel-fi/actions/runs/31916501272).

#### [ ] M9.3 — Container-scoped ingestion, coverage, and omissions

**Outcome:** An observation can affect only the connection and ownership
containers it completely and unambiguously covers.

**Required changes:**

- Bind every sync run and holding import to one investment connection, and bind
  every import row to one resolved ownership container before position matching.
- Record coverage independently from rows so a valid complete observation with
  zero holdings can be represented. Coverage must distinguish `complete` from
  partial, unavailable, malformed, failed, and ambiguous observations.
- Match a row only against positions in its container. Remove provider-wide
  missing-position and possible-identity-change queries.
- Create `not reported` proposals or exceptions only for prior positions inside
  a container marked complete by that exact import. Partial, failed, stale, or
  unknown coverage creates no omission statement.
- Scope deduplication, refresh locks, sync limits, reconnects, disconnects, and
  webhook deliveries to the exact connection. A disconnect removes future access
  according to policy but preserves accepted history and baselines.
- Keep new/changed/ambiguous facts behind the existing review or recorded
  deterministic-policy boundary. No import or coverage record directly mutates
  an accepted position.

**Slice gate:** Tests cover complete zero-row observations, partial
multi-account responses, one failed institution beside one healthy institution,
reconnect to a stable account, changed provider identifiers, concurrent runs,
replayed webhooks, and disconnect. No case can mark a different connection or
uncovered container as missing.

#### [ ] M9.4 — Canonical exposure resolution and aggregation

**Outcome:** Keel can group shared economic exposure while preserving every
legal position and preventing look-through double counting.

**Required changes:**

- Create canonical exposure identities for public instruments, private
  companies, funds, and unresolved exposures. Prefer strong security identifiers
  for public instruments and reviewed company records for private exposures;
  ticker or provider display text alone cannot silently create a canonical
  identity.
- Represent direct and look-through position-exposure mappings as append-only
  accepted versions with evidence, decision provenance, effective time, and a
  supersession path for corrections.
- Allow zero, one, or many mappings per position. Allocation is nullable integer
  parts per million; known allocations for one position must be non-negative and
  sum to no more than 1,000,000.
- Map direct public securities at full allocation only after deterministic
  identity succeeds. Map SPV/fund interests to underlying companies only after
  deterministic evidence or explicit review; never merge the SPV/fund position
  into an exposure.
- Derive exposure totals only from accepted mappings and snapshots. Unknown or
  unallocated look-through value stays visible at the position level and is not
  repeated in every related exposure.

**Slice gate:** Synthetic NVDA positions across three accounts resolve to one
exposure but remain three positions. Two Anthropic SPVs resolve to one company
exposure but remain two positions. A multi-company SPV with unknown allocations
shows relationships without manufacturing exposure value.

#### [ ] M9.5 — Provider-neutral Investments connection and Robinhood cutover

**Outcome:** Robinhood runs through a generic Investments path that can safely
host another institution without regressing its shipped behavior.

**Required changes:**

- Replace institution-enumerated holding contracts and Robinhood-only service
  assumptions with an adapter contract plus validated institution metadata.
  AngelList remains a separate import adapter using the same canonical position
  model.
- Represent each Plaid Item as its own `plaid-investments` connection. Support
  multiple connections per household and multiple investment accounts per Item.
  Connection uniqueness uses the protected Item key, not institution label.
- Generalize Link exchange, credential envelopes, sync status, holdings
  normalization, API routes, Queue messages, and webhook routing while resolving
  every provider event to one exact connection before retrieval.
- Preserve byte/page/time limits, Zod validation, integer conversions, private
  R2 credential/raw-response storage, policy decision provenance, reconnect
  behavior, and fail-closed authentication.
- Keep compatibility routes and visible Robinhood behavior until the generic
  route passes parity tests. Never read both legacy and generic holdings into a
  baseline as separate positions.
- Preserve the cash boundary: Plaid-classified cash inside an investment account
  remains a brokerage cash position. Depository checking, savings, money-market,
  or cash-management balances remain separate `plaid-cash` connections with
  separate consent, review, and baseline overlap handling.

**Slice gate:** All existing Robinhood unit, API, webhook, database, baseline,
desktop, and mobile tests pass through the generic path. A synthetic non-
Robinhood institution can complete Link exchange and staging only when
Investments support is validated; unsupported institutions fail before storing
credentials or creating accepted facts.

#### [ ] M9.6 — Canonical read models and planning integration

**Outcome:** Position, exposure, and planning views use the canonical model with
one authoritative monetary path.

**Required changes:**

- Add a position read model grouped by institution, container, and legal
  position, with exact accepted snapshot, source freshness, value state,
  quantity, cost basis, tax treatment, and review status.
- Add an exposure read model grouped by canonical exposure with drill-down to
  every contributing position, mapping provenance, allocated value, and explicit
  unallocated/unknown value.
- Build Portfolio Baselines only from exact accepted position snapshots and
  enforce one item per position per baseline. Exposure rows are explanatory and
  cannot contribute a second copy of value.
- Preserve current FI policy: eligible accepted public-market value and reviewed
  cash can enter the FI plan after the applicable baseline policy; private
  paper, locked value, unavailable value, and unallocated look-through value do
  not become usable liquidity.
- Preserve brokerage-cash versus linked-cash versus manual-residual overlap
  review. A migration, reconnect, exposure resolution, or institution-label
  change cannot itself alter an accepted plan or forecast.
- Treat two sources that may describe the same legal account or position as an
  overlap requiring review; do not automatically merge them in M9.

**Slice gate:** Before/after migration totals match; baseline uniqueness and
exposure allocation invariants pass; initial or ambiguous baselines remain
review-gated; and an already accepted clean refresh can update only the exact
position lineage allowed by existing policy.

#### [ ] M9.7 — Fidelity proving institution

**Outcome:** Fidelity proves that the generic model supports another institution
and several account containers without institution-specific holdings logic.

**Required changes:**

- Add synthetic Fidelity fixtures with one connection containing at least a
  taxable brokerage and an IRA, and a second synthetic login/Item case proving
  that two connections at the same institution stay distinct.
- Exercise the same security in Robinhood brokerage, Fidelity brokerage, and
  Fidelity IRA. The result must be three positions, three position snapshots,
  one canonical exposure, and no cross-account omission inference.
- Validate Investments support from provider metadata at Link exchange and fail
  closed if the selected Fidelity institution variant lacks that product. Do not
  encode one mutable institution display string as the only accepted identity.
- Cover initial sync, unchanged sync, changed quantity/value, partial account
  response, webhook refresh, reconnect, pause, and disconnect through the
  generic adapter and canonical read models.
- Do not import a Fidelity or Robinhood banking/cash-management account through
  Investments. If the owner wants that balance, it follows the separate reviewed
  cash-account path and overlap check.

**Slice gate:** Synthetic end-to-end acceptance passes first, including
position, exposure, and Portfolio Baseline results. Before an owner-authorized
real connection, record private provider coverage and pricing. The private
runtime check may validate Link and a review-ready import but must not write
credentials, account labels, holdings, balances, or screenshots to public
artifacts.

#### [ ] M9.8 — Holdings experience, operations, and release

**Outcome:** The owner can connect and operate multiple investment institutions,
understand account-level positions and grouped exposures, and recover safely
from unsupported, partial, stale, or disconnected states.

**Required changes:**

- Replace the Robinhood-only Holdings control with an investment-institution
  section that shows each institution and account, connection health, last
  complete observation, pending review, and scoped action. Keep investment
  linking visibly separate from **Add institution** for linked banking cash.
- Provide explicit add, check, reconnect, pause, and disconnect flows. Explain
  unsupported Investments coverage before authorization and preserve accepted
  history after disconnect.
- Default to the position view and provide an exposure view with position
  drill-down. Show unresolved containers, unresolved exposures, partial
  coverage, unavailable values, and unallocated look-through value without
  converting them to zero.
- Preserve the Holdings visual hierarchy and concise trust-boundary copy. Cover
  loading, empty, success, no-change, partial, review, stale, error, reconnect,
  and disconnected states; retain keyboard access, focus behavior, 44-pixel
  targets, and no horizontal page scrolling on mobile.
- Update the generic investment-holdings deployment runbook, provider enablement
  checklist, data classification, architecture overview, screenshots, and
  synthetic operator instructions. Keep Robinhood-specific operational notes as
  an adapter appendix where still useful.
- Keep ADR 005 marked `implementation pending` until every M9 exit gate and the
  exact-SHA release pass. Then update its status and the README/architecture
  current-state copy with the release evidence that materialized the model.
- Keep additional-institution authorization unavailable until M9.1 through M9.7
  are released and the proof matrix below passes. Roll back by disabling new
  authorization and generic writes, never by deleting or rewriting accepted
  records.

**Slice gate:** Desktop and mobile visual review, accessibility checks,
protected preview smoke, private owner acceptance, migration/backup evidence,
and exact-SHA release evidence all pass with no private data in repository or CI
artifacts.

**Required proof matrix:**

| Scenario                                                          | Required result                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Existing Robinhood and AngelList data after migration             | Same position IDs, accepted snapshots, baseline items, totals, goals, and forecasts; only canonical associations are added.     |
| NVDA in Robinhood brokerage, Fidelity brokerage, and Fidelity IRA | Three legal positions and baseline line items, one canonical NVIDIA exposure, and exact account drill-down.                     |
| Two SPVs into the same private company                            | Two legal positions and histories, one shared company exposure, and no merge of invested, realized, or remaining values.        |
| One SPV or fund with several exposures and unknown allocations    | Position value appears once; relationships are visible; no underlying exposure receives manufactured value.                     |
| Complete observation omits a prior position in one container      | Only that connection/container receives a `not reported` proposal or exception; its last accepted value remains.                |
| Partial, failed, malformed, or ambiguous observation              | No position is called missing and no accepted position, baseline, or forecast changes.                                          |
| Reconnect with stable source/account identities                   | Existing connection, container, and position lineages continue; no duplicate position is created.                               |
| Same institution connected through two Items/logins               | Two connections remain distinct even when institution labels match.                                                             |
| Brokerage cash plus linked banking cash or manual residual        | Values remain separate and positive overlap requires explicit review before baseline confirmation.                              |
| Banking or cash-management account returned outside Investments   | It is excluded from holdings and can enter only through the separate reviewed `plaid-cash` flow.                                |
| Disconnect or pause                                               | Future retrieval stops as required; credentials follow deletion policy; accepted history and current baseline remain unchanged. |
| Ambiguous cross-source account or position match                  | The candidate is isolated for review and cannot be auto-merged or counted twice.                                                |

**Rollout and cost evidence:**

- M9.1 through M9.6 use synthetic provider data and add no real provider calls.
- Before M9.7 private authorization, record the selected institution variant's
  Investments coverage, Item/product price, expected webhook volume, and any
  reconnect or refresh charge from the private provider contract.
- Do not add Investments Refresh, a new polling schedule, a notification
  channel, or another paid product in M9 without a separate recorded decision.
  Continue bounded manual checks and the existing verified holdings webhook.
- Record expected D1 growth as connections, containers, import-coverage rows,
  position mappings, exposure mappings, and snapshots per active institution.
  Confirm retention and backup impact remain under the deployment's monthly
  ceiling before enabling a real additional institution.
- Every slice records its migration version, test counts, reviewed PR, exact
  head, merge SHA, post-merge workflow, deployed SHA, protected smoke, and any
  private acceptance performed. A failed or incomplete check leaves its slice
  unchecked.

**Exit gates:**

- [ ] M9.1 through M9.8 are checked in order with their evidence recorded.
- [ ] Every required proof-matrix scenario passes in domain, repository, API,
      and browser coverage where applicable.
- [ ] Additive migrations and compatibility reads preserve every accepted
      position, snapshot, decision, baseline, goal, and forecast without value
      or identity drift.
- [ ] Position totals count each accepted snapshot at most once; exposure views
      preserve legal drill-down and cannot duplicate allocated or unallocated
      value.
- [ ] The multi-institution Holdings experience passes desktop, mobile,
      accessibility, no-overflow, review-boundary, and error-state acceptance.
- [ ] Provider coverage, pricing, D1/storage growth, retention, backup, and
      rollback evidence are recorded before real additional-institution use.
- [ ] ADR 005, the architecture overview, roadmap evidence, and deployment
      runbooks identify the exact release that materialized the canonical model.
- [ ] `make verify`, reviewed PR checks, exact-head merge, and exact-SHA
      post-merge deployment evidence pass. Private runtime acceptance validates
      provider support without committing institution credentials or holdings.

### [ ] M10 — Plan versus actual monitoring

**User outcome:** Keel identifies meaningful drift in cash, debt, burn, and
runway and presents the next decision without requiring the user to compare
screens manually.

**Trust boundary:** Monitoring creates a bounded alert or proposal. It never
accepts a balance, changes a plan, or confirms a forecast.

**Scope:** Deterministic materiality thresholds, freshness checks, a
consolidated in-app action queue, change attribution, cooldowns, and clear
no-action states.

**Non-goals:** Noisy daily notifications, automated trades or transfers,
unreviewed forecast changes, or optimization advice.

**Dependencies:** M6 through M9 provide reviewed actuals, accepted plans, and
connection-scoped holding identity.

**Infrastructure-cost gate:** Start with in-app monitoring on existing scheduled
work. Price and approve any external notification channel separately before it
is added.

**Exit gates:**

- [ ] Materiality, freshness, deduplication, and cooldown policy is documented.
- [ ] Deterministic alert/proposal generation and no-action cases pass tests.
- [ ] The action queue is usable at desktop and mobile sizes and explains why
      each item matters.
- [ ] `make verify`, reviewed PR checks, exact-head merge, and exact-SHA
      post-merge deployment evidence pass.

### [ ] M11 — Actual distributions and forecast reconciliation

**User outcome:** When a private holding produces cash, Keel records what became
usable, reconciles it with the prior forecast, and shows the resulting FI and
runway decision.

**Trust boundary:** A distribution requires dated evidence and explicit review.
Actual cash, fees, withheld amounts, remaining paper value, and forecast
variance stay distinct; tax treatment is not inferred.

**Scope:** Reviewable distribution entry or import, append-only actual-liquidity
events, holding reconciliation, forecast-versus-actual attribution, and a
proposal for any resulting baseline or forecast change.

**Non-goals:** Tax filing, tax advice, cap-table administration, payment
initiation, or silently closing the holding.

**Dependencies:** M6 provides the destination cash model; M10 provides the
decision queue and variance pattern.

**Infrastructure-cost gate:** Prefer the existing D1 and private evidence
storage. Record any document-retention or source-ingestion cost before enabling
uploads.

**Exit gates:**

- [ ] Distribution semantics and reconciliation policy are documented with
      deterministic examples.
- [ ] Append-only recording, evidence review, and forecast reconciliation tests
      pass.
- [ ] History and decision surfaces work at desktop and mobile sizes.
- [ ] `make verify`, reviewed PR checks, exact-head merge, and exact-SHA
      post-merge deployment evidence pass.

### [ ] M12 — Owner readiness and approved production release

**User outcome:** The owner can export, recover, and operate Keel with a tested
release and recovery path rather than depending on an unproven private preview.

**Trust boundary:** Production remains fail-closed and manually approved. A
backup is not considered recoverable until a restricted restore drill passes.

**Scope:** Owner export, retention and deletion policy, restricted restore
drill, credential and access review, production resource checklist, monitoring,
and a manual go/no-go release with rollback evidence.

**Non-goals:** Multi-household collaboration, public signup, delegated adviser
access, or unattended production migrations.

**Dependencies:** M6 through M11 establish the private data and decision flows
that the operational controls must cover.

**Infrastructure-cost gate:** Record production Workers, D1, R2, Queue, Access,
backup, monitoring, and retention estimates with a monthly ceiling before
resource creation.

**Exit gates:**

- [ ] Owner export is complete, bounded, documented, and tested with synthetic
      data.
- [ ] Retention, deletion, credential rotation, and incident ownership are
      documented privately where required.
- [ ] A restricted non-production restore drill passes and produces a fresh
      verified backup.
- [ ] Every applicable item in the
      [private-alpha deployment checklist](../deployment/checklist.md) is
      checked with evidence.
- [ ] A manually approved production deployment and rollback verification pass
      for the exact release SHA.

## Outside the current sequence

Multi-household collaboration, adviser access, tax optimization, payment or
trading actions, connector expansion beyond M9's investment-holdings scope, and
AI-generated financial decisions are not current milestones. Add one only after
recording the user decision it improves, its trust boundary, its operational
cost, and why it should displace the first unchecked milestone above.
