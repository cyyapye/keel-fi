# ADR 006: Plan versus actual monitoring

- Status: Accepted; implementation pending exact-SHA M10 release
- Date: 2026-08-16

## Context

Keel already preserves reviewed cash, obligations, observed burn, and saved
runway plans, but the owner otherwise has to compare those screens manually.
Monitoring must identify a useful next decision without weakening the review
boundaries that made those records trustworthy.

An external observation is not an actual until its existing review path accepts
it. A difference is not permission to change a plan. Missing or old data is not
zero, and a reminder must not become a noisy stream of duplicate alerts.

## Decision

### Projection boundary

`plan-actual-v1` is a deterministic, read-only projection over the authenticated
household's canonical D1 state:

| Metric | Saved comparison                                                                    | Reviewed actual                                                                                      |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Cash   | Cash value in the latest accepted Portfolio Baseline                                | Sum of current accepted cash accounts; unavailable accounts remain explicit                          |
| Debt   | Prior reviewed total for the current accepted obligation lineages                   | Current accepted obligation total; overdue and unavailable balances remain explicit                  |
| Burn   | Household plus business burn in the current saved runway plan                       | Latest reviewed three-month cash-flow result, including the existing reviewed debt-payment treatment |
| Runway | Whole months from saved FI-eligible liquidity, protected cash floor, and saved burn | Whole months after applying only the reviewed cash difference and reviewed burn                      |

The projection cannot write a cash balance, obligation, cash-flow review, plan,
Portfolio Baseline, goal, or forecast. The Overview calls one authenticated
`GET /api/plan-actual-monitoring`; the response is Zod-validated and returned
with `Cache-Control: private, no-store`.

### Priority and freshness

Each metric emits at most one item. Higher-trust work takes priority over a
numeric comparison:

1. a waiting cash, debt, or burn review;
2. an overdue accepted obligation;
3. missing or stale reviewed data; then
4. material cash, debt, burn, or runway drift.

Reviewed cash, debt, or burn is stale when its included observation is more than
45 days old. For cash and debt, the oldest included accepted observation sets
freshness so one old account cannot hide behind a newer account. Runway is
available only when both cash and burn are current.

An unconfigured source produces a `limited` no-action state. It does not create
a setup alert or manufacture an actual. A fully covered comparison below every
threshold produces `clear`.

### Materiality

Money uses integer minor units and proportional thresholds use integer parts per
million with ceiling division.

| Metric | Deterministic threshold                                                                           |
| ------ | ------------------------------------------------------------------------------------------------- |
| Cash   | Absolute difference at least the greater of 5% of baseline cash or $5,000                         |
| Debt   | Absolute difference at least the greater of 5% of the prior reviewed total or $5,000              |
| Burn   | Absolute combined monthly difference at least the greater of 10% of saved combined burn or $500   |
| Runway | At least three whole months of difference, or a change from at least 12 months to below 12 months |

The runway comparison changes neither FI-eligible liquidity nor the forecast. It
attributes what the current reviewed cash difference and burn would mean if the
owner chose to revise the plan.

### Deduplication and review later

The canonical source material is hashed into a SHA-256 revision. The hash
includes the compared plan, baseline cash, accepted actuals, review counts,
unknown and overdue counts, and observation dates; evaluation time is excluded.

The action queue keeps at most one item for each of cash, debt, burn, and
runway. **Review in 7 days** appends one household-scoped cooldown for the exact
item key and source revision. Cooldown records cannot be updated or deleted. A
changed plan or reviewed fact creates a new source revision and immediately
makes the new decision eligible; an old cooldown cannot suppress it. A stale or
already deferred request fails with `409`.

There is no scheduler, daily notification, external channel, Queue message, R2
object, or provider call. The owner sees the projection when opening Overview
and can navigate to the existing Holdings, Obligations, or Scenarios decision
surface.

## Consequences

Positive:

- the next material decision is visible without comparing several screens;
- review, overdue, missing, and stale states cannot be hidden by numeric drift;
- exact-source cooldowns reduce repetition without suppressing new facts;
- clear and limited states distinguish evidence-backed no action from missing
  coverage; and
- monitoring adds no external provider or notification spend.

Tradeoffs:

- monitoring updates when Overview is opened rather than in the background;
- debt drift is relative to the prior reviewed state, not a separate debt plan;
- 45 days and the materiality thresholds are policy choices that require a new
  policy version if changed; and
- repeated explicit deferrals append small audit rows until a future retention
  policy supersedes them.

## Rejected alternatives

- **Compare unreviewed provider values:** bypasses the existing acceptance
  boundary and can turn partial data into a false decision.
- **Automatically update the plan or forecast:** confuses evidence with owner
  intent and rewrites the decision history.
- **Daily email, SMS, or push alerts:** adds noise, external data disclosure,
  provider cost, and delivery operations before in-app usefulness is proven.
- **One alert for every failed threshold:** creates duplicate work when review
  or freshness must be resolved first.
- **A time-only snooze:** can hide a newly changed fact; source revision must be
  part of the cooldown identity.
