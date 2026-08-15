# Product delivery roadmap

This is Keel's canonical product sequence for the owner-operated private alpha.
The first unchecked milestone is next. Keep exactly one milestone marked
**Active** so delivery does not split across partially finished product slices.

- Last reconciled: 2026-08-14
- Reconciled product baseline:
  [`8196c94`](https://github.com/cyyapye/keel-fi/commit/8196c947a8cbc3f2029ee34ab9e97642df1f086e)
- Baseline release evidence:
  [`31867504712`](https://github.com/cyyapye/keel-fi/actions/runs/31867504712)

## How to use this roadmap

- Check a milestone only after its reviewed PR is merged, terminal checks pass,
  and the merge is contained in an exact-SHA release that passes the post-merge
  deployment workflow.
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

## Ordered next milestones

### [ ] M8 — Observed cash flow to reviewed burn proposals — **Active**

**User outcome:** Keel compares accepted household and business burn assumptions
with observed cash flow and proposes a better runway plan when the evidence is
materially different.

**Trust boundary:** Raw transactions remain restricted source material.
Deterministic aggregates may propose a plan change, but no transaction or model
silently changes accepted burn.

**Scope:** Incremental private transaction ingestion, bounded normalization,
reviewable household-versus-business treatment, monthly aggregates, and a
proposal that reuses the M5 runway-plan preview and save path.

**Non-goals:** A general budgeting product, tax categorization, autonomous
merchant classification, payments, or automatic plan changes.

**Dependency:** M6 supplies linked cash accounts; M7 supplies debt-payment
context that must not be double counted as ordinary burn.

**Infrastructure-cost gate:** Record Transactions product billing, refresh and
webhook volume, R2/D1 retention, deletion policy, and expected monthly storage
and request cost before ingesting private transaction data.

**Exit gates:**

- [ ] Transaction data classification, retention, and redaction policy is
      approved.
- [ ] Incremental ingestion, deduplication, aggregation, and proposal tests
      pass.
- [ ] Runway comparison and proposal review work at desktop and mobile sizes.
- [ ] `make verify`, reviewed PR checks, exact-head merge, and exact-SHA
      post-merge deployment evidence pass.

### [ ] M9 — Plan versus actual monitoring

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

**Dependencies:** M6 through M8 provide reviewed actuals and accepted plans.

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

### [ ] M10 — Actual distributions and forecast reconciliation

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

**Dependencies:** M6 provides the destination cash model; M9 provides the
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

### [ ] M11 — Owner readiness and approved production release

**User outcome:** The owner can export, recover, and operate Keel with a tested
release and recovery path rather than depending on an unproven private preview.

**Trust boundary:** Production remains fail-closed and manually approved. A
backup is not considered recoverable until a restricted restore drill passes.

**Scope:** Owner export, retention and deletion policy, restricted restore
drill, credential and access review, production resource checklist, monitoring,
and a manual go/no-go release with rollback evidence.

**Non-goals:** Multi-household collaboration, public signup, delegated adviser
access, or unattended production migrations.

**Dependencies:** M6 through M10 establish the private data and decision flows
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
trading actions, broad connector expansion, and AI-generated financial decisions
are not current milestones. Add one only after recording the user decision it
improves, its trust boundary, its operational cost, and why it should displace
the first unchecked milestone above.
