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
- Follow the active milestone's delivery rule. Numeric ordering is the default:
  the first unchecked slice is next unless the milestone explicitly permits
  dependency-gated parallel development.
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
institution/account position views, an exposure rollup, a pre-live canonical
cutover, and Fidelity as the first additional institution proving the
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

**Delivery rule:** M9 permits dependency-gated parallel development while merges
and releases remain serialized and dependency ordered. A sibling slice may start
only from all released prerequisites named in that slice, and it may merge only
after those prerequisites have exact-SHA release evidence. After any sibling
merges, every still-open branch must rebase onto released `origin/main` and
rerun `make verify` before its PR can merge. Each slice must be independently
mergeable, preserve the currently shipped Robinhood, AngelList, cash-account,
and Portfolio Baseline behavior, and pass reviewed PR checks, exact-head merge,
and exact-SHA post-merge evidence. Keep M9 marked **Active** until every slice
and milestone exit gate is checked.

#### [x] M9.1 — Canonical persistence and domain contract

**Outcome:** D1 and the shared domain contracts can represent the complete ADR
005 relationship model without changing any current accepted value.

**Required changes:**

- Add the logical investment connection, ownership container, import coverage,
  canonical exposure, and position-exposure records defined in ADR 005. Reusing
  `connector_accounts` is acceptable only if its contracts stop treating an
  institution-specific provider value or display name as identity.
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

#### [x] M9.2 — Pre-live canonical-only cutover

**Outcome:** Keel carries one holdings schema and one read path before any real
data exists. Disposable synthetic state is rebuilt instead of preserving a
transitional representation.

**Required changes:**

- Remove the holdings backfill migration, association triggers, transitional
  views, read-source flag, dual-read repository plumbing, and obsolete internal
  identity export.
- Remove migration-only contract values. Reviewed imports use a canonical
  `reviewed_import` association basis; unresolved remains a valid current state,
  not a historical-data category.
- Keep `holding_positions` and accepted snapshots as the sole financial read
  path until M9.3 writes the full canonical connection/container relationship in
  the same reviewed ingestion transaction.
- Rebuild every synthetic environment that applied the removed schema from the
  checked-in migration chain. This reset authority ends before any environment
  may retain real user data.
- Reserve the next migration number for the first direct container-scoped write
  contract instead of an unused transition layer.

**Slice gate:** Fresh migration replay, synthetic seed, focused contract tests,
and `make verify` pass. A bounded production-source/schema/config scan finds no
M9 holdings backfill view, trigger, feature flag, dual-read mode, or
migration-only association support; negative contract tests reject the removed
value. The exact-SHA preview is rebuilt before protected smoke evidence is
accepted.

**Evidence:** Delivered in [PR #66](https://github.com/cyyapye/keel-fi/pull/66)
at exact checked head
[`a87c911`](https://github.com/cyyapye/keel-fi/commit/a87c911cfb6ea988f1bd813d4c1731c990d87b52)
and merge commit
[`4af6dff`](https://github.com/cyyapye/keel-fi/commit/4af6dff35a8cf483d788e278fcc6cd8be882977f).
Fresh migration replay, the synthetic seed, 396 tests, 44 browser flows, and the
bounded removed-symbol scan passed. The ordinary exact-SHA deployment passed in
[run `31919018427`](https://github.com/cyyapye/keel-fi/actions/runs/31919018427).
The approved synthetic preview rebuild then retained its encrypted backup,
restored the pre-transition point, applied migrations `0001` through `0019`,
proved zero removed transition objects and contract values, deployed the same
exact SHA, and passed protected smokes in
[run `31919271581`](https://github.com/cyyapye/keel-fi/actions/runs/31919271581).
The one-time reset authority was removed immediately afterward. Incremental
provider spend remains $0.

#### [x] M9.3 — Container-scoped ingestion, coverage, and omissions

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

**Evidence:** Delivered in [PR #68](https://github.com/cyyapye/keel-fi/pull/68)
at exact checked head
[`47f1950`](https://github.com/cyyapye/keel-fi/commit/47f1950aa0bb823d0a91b37da4194298ad5380d3)
and merge commit
[`0552540`](https://github.com/cyyapye/keel-fi/commit/0552540f5b6e659fb7d8ad0e8ebb02b86e0d9f26).
Migration `0020_container_scoped_holding_ingestion.sql`, 406 tests, and 44
desktop/mobile browser flows cover connection/container scope, complete zero-row
and incomplete observations, omission isolation, stable reconnect, changed
identifiers, concurrent and replayed work, and disconnect history. The first
post-merge run retained its encrypted backup and stopped before either Worker
deployed when D1 rejected the table rebuild.
[PR #69](https://github.com/cyyapye/keel-fi/pull/69) corrected the rebuild for
D1's implicit transaction at exact checked head
[`f4618e1`](https://github.com/cyyapye/keel-fi/commit/f4618e111438cc5b3a73d78fbc0d92258feb14e4)
and merge commit
[`bdc1392`](https://github.com/cyyapye/keel-fi/commit/bdc13922ec6f40144451cab924292159df2ed31e).
The final exact-SHA release retained an encrypted D1 backup, applied migrations
`0001` through `0020`, deployed API and web Workers, and passed protected smokes
in
[run `31925513342`](https://github.com/cyyapye/keel-fi/actions/runs/31925513342).
No provider or runtime calls were added; incremental provider spend remains $0,
with only bounded D1 and encrypted-backup growth.

#### [x] M9.4 — Canonical exposure resolution and aggregation

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

**Evidence:** Delivered in [PR #71](https://github.com/cyyapye/keel-fi/pull/71)
at exact checked head
[`71ee30e`](https://github.com/cyyapye/keel-fi/commit/71ee30ebe02dfe66795113df2e23a421003ac17f)
and merge commit
[`18c7951`](https://github.com/cyyapye/keel-fi/commit/18c795153b99535ac249bac7105033211e18e25d).
Migration `0021_canonical_exposure_resolution.sql`, 411 tests, and 44
desktop/mobile browser flows cover checksum-valid public identity, reviewed
private and fund resolution, append-only mapping corrections, the allocation
ceiling, deterministic retry, accepted-snapshot aggregation, and all three
synthetic slice-gate cases. The exact-SHA release retained an encrypted D1
backup, applied migration `0021`, deployed API and web Workers, read back both
versions, passed protected smokes, and retained release evidence in
[run `31928019480`](https://github.com/cyyapye/keel-fi/actions/runs/31928019480).
No provider, network, schedule, Queue, or webhook call was added; incremental
provider spend remains $0, with only bounded D1 and encrypted-backup growth.

#### [x] M9.5 — Provider-neutral Investments connection and Robinhood cutover

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
- Replace Robinhood-only routes and exports in one reviewed cutover after the
  generic route passes parity tests. Do not ship duplicate endpoints or read
  paths, and never load the same position twice into a baseline.
- Preserve the cash boundary: Plaid-classified cash inside an investment account
  remains a brokerage cash position. Depository checking, savings, money-market,
  or cash-management balances remain separate `plaid-cash` connections with
  separate consent, review, and baseline overlap handling.

**Slice gate:** All existing Robinhood unit, API, webhook, database, baseline,
desktop, and mobile tests pass through the generic path. A synthetic non-
Robinhood institution can complete Link exchange and staging only when
Investments support is validated; unsupported institutions fail before storing
credentials or creating accepted facts.

**Evidence:** Delivered in [PR #76](https://github.com/cyyapye/keel-fi/pull/76)
at exact checked head
[`bcebddc`](https://github.com/cyyapye/keel-fi/commit/bcebddc5abb98877fd067a8cf9129a38599eeb19)
and merge commit
[`8ef342f`](https://github.com/cyyapye/keel-fi/commit/8ef342f9643d357fd4909dd11aedcefd7b445c6a).
Migration `0022_provider_neutral_investments.sql`, 422 tests, and 44
desktop/mobile browser flows cover validated generic Link exchange, a synthetic
non-Robinhood institution, fail-before-storage rejection, multiple Items per
household, multiple accounts per Item, exact-connection sync/webhook/Queue and
disconnect routing, legacy credential compatibility, and preservation of
accepted import, position, snapshot, and baseline values. The exact-SHA release
retained and verified an encrypted D1 backup, applied migration `0022`, deployed
and read back both Worker versions, passed protected smokes, and retained
release evidence in
[run `31933239325`](https://github.com/cyyapye/keel-fi/actions/runs/31933239325).
No additional institution or paid Plaid product was activated; incremental
provider spend remains $0, with only bounded storage and Queue growth when a
later-authorized connection is used.

#### [x] M9.6a — Authoritative position read model

**Outcome:** Database consumers can read one household-scoped institution →
connection → container → legal-position projection without joining exposure
rollups or creating a second monetary path.

**Dependencies and ownership:** This slice depends only on released M9.3 and may
develop in parallel under the M9 delivery rule. Its implementation ownership is
limited to new `position-read-model.ts` contract and repository modules, their
focused tests, and explicit subpath exports in `packages/domain` and
`packages/database`. M9.4 owns canonical exposure identity, mapping, and
aggregation. This slice must rebase onto every sibling release and rerun
`make verify` before merge; it remains unchecked until its own exact-SHA release
evidence exists.

**Required changes:**

- Project institution metadata, exact connection identity, ownership container,
  and legal position without using institution label, account text, ticker, or
  exposure name as identity.
- Select the exact latest accepted position snapshot and expose source
  freshness, value state, quantity, cost basis, tax treatment, and review status
  without converting locked, unavailable, or not-reported values to zero.
- Keep each legal position exactly once in its container and preserve distinct
  connections at the same institution. Household, connection, and container
  boundaries must fail closed.
- Add repository invariant tests using only synthetic M9.3 connection,
  container, ownership, application, and snapshot records.

**Non-goals:** No canonical exposure repository or API, exposure aggregation,
Portfolio Baseline integration, UI route, provider cutover, or additional
institution authorization belongs in M9.6a; those remain in later slices.

**Slice gate:** Synthetic positions across two institutions, two connections at
one institution, and several containers appear once under their exact legal
lineage. Only accepted snapshots are selected, unresolved values remain
explicit, and cross-household or cross-container leakage is impossible.

**Evidence:** Delivered in [PR #73](https://github.com/cyyapye/keel-fi/pull/73)
at exact checked head
[`bbcb04e`](https://github.com/cyyapye/keel-fi/commit/bbcb04e28432cac2e020f14bee5ae56f3e0a2bde)
and merge commit
[`fa77bd3`](https://github.com/cyyapye/keel-fi/commit/fa77bd352ae7bb2e8d93daf36186baf7a675bc46),
with the explicit second-institution slice-gate proof completed in
[PR #74](https://github.com/cyyapye/keel-fi/pull/74) at exact checked head
[`eb0171e`](https://github.com/cyyapye/keel-fi/commit/eb0171e7792342aa2fa9e7c67e6eeb68c2a0c74b)
and merge commit
[`ae36cb0`](https://github.com/cyyapye/keel-fi/commit/ae36cb01b9a45e230cbe7de1b50812fca7a044f1).
The final release passed 417 tests and 44 desktop/mobile browser flows, retained
an encrypted D1 backup, applied all forward-only migrations, deployed and read
back both Worker versions, passed protected smokes, and retained exact-SHA
evidence in
[run `31929487255`](https://github.com/cyyapye/keel-fi/actions/runs/31929487255).
The read model adds no provider, network, Queue, storage, schedule, webhook, or
database write path and no migration; incremental provider spend remains $0.

#### [x] M9.6b — Exposure read model and planning integration

**Outcome:** Exposure and planning views consume the authoritative position
projection and preserve one monetary path.

**Dependencies:** Released M9.4, M9.5, and M9.6a.

**Required changes:**

- Consume the released M9.6a position read model; do not add a second position
  repository, position query path, or competing monetary projection.
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

**Evidence:** Delivered in [PR #78](https://github.com/cyyapye/keel-fi/pull/78)
at exact checked head
[`8454c2e`](https://github.com/cyyapye/keel-fi/commit/8454c2e9887524858245f575410885dfbe1ffaa7)
and merge commit
[`2fd3672`](https://github.com/cyyapye/keel-fi/commit/2fd3672f494670f9179c790f11d76f1047a95bb3).
Migration `0023` replayed without rewriting accepted history; 425 tests and 44
desktop/mobile browser flows passed. The release retained an encrypted D1
backup, applied the forward-only migration, deployed and read back both Worker
versions, passed protected smokes, and retained exact-SHA evidence in
[run `31954053677`](https://github.com/cyyapye/keel-fi/actions/runs/31954053677).
The authoritative read path adds no provider call, Queue message, R2 object,
schedule, or webhook; incremental provider spend remains $0.

#### [x] M9.7 — Fidelity proving institution

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

**Evidence:** Delivered in [PR #80](https://github.com/cyyapye/keel-fi/pull/80)
at exact checked head
[`07d6ddc`](https://github.com/cyyapye/keel-fi/commit/07d6ddcb86213982d571423d20ed8d7678c3917d)
and merge commit
[`788c033`](https://github.com/cyyapye/keel-fi/commit/788c033bead361d7d073d472088e9af6cd04be2e).
Synthetic Fidelity brokerage and IRA fixtures proved three distinct NVDA
positions and accepted snapshots under their exact accounts, one canonical
exposure, one-value-path Portfolio Baselines, stable reconnect identity,
connection-scoped webhooks, append-only pause/resume, retained history after
disconnect, and fail-closed banking and unsupported-product boundaries. Any
incomplete account coverage now remains review-pending without changing an
accepted position, baseline, or forecast. All 429 tests and 44 desktop/mobile
browser flows passed; the first PR browser attempt lost its local Wrangler
process after 43 passing flows, and the unchanged-head rerun passed without a
code change. The release retained an encrypted D1 backup, applied the existing
forward-only migration chain, deployed and read back both Worker versions,
passed protected smokes, and retained exact-SHA evidence in
[run `31956046446`](https://github.com/cyyapye/keel-fi/actions/runs/31956046446).
This slice adds no migration, polling schedule, Queue message, notification
channel, or paid product. Private Fidelity coverage and pricing were not
provided, so no real authorization or private provider call was performed and
approved incremental provider spend remains $0.

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
- Keep additional-institution authorization unavailable until M9.1 through M9.7,
  including M9.6a and M9.6b, are released and the proof matrix below passes.
  Roll back by disabling new authorization and generic writes, never by deleting
  or rewriting accepted records.

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

- M9.1 through M9.6b, including M9.6a, use synthetic provider data and add no
  real provider calls.
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

- [ ] M9.1 through M9.8, including M9.6a and M9.6b, are checked in dependency
      order with their evidence recorded.
- [ ] Every required proof-matrix scenario passes in domain, repository, API,
      and browser coverage where applicable.
- [ ] Fresh canonical migration replay and every direct-ingestion cutover keep
      each accepted position, snapshot, decision, baseline, goal, and forecast
      on one authoritative path without value or identity drift.
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
