# Plan versus actual monitoring

Keel's Overview compares the saved runway plan with reviewed cash, debt, burn,
and derived runway. It is an in-app decision queue, not a notification service
or an automatic plan updater.

The normative policy is
[ADR 006](../architecture/adr-006-plan-actual-monitoring.md).

M10 shipped through implementation PR #84 and release merge
`a5d789016c3887b7bc9e4851201eaa7c999ca3d1`. Exact-SHA workflow `31963952670`
retained the encrypted pre-migration backup, applied migration `0024`, read back
both deployed Worker versions, passed protected smokes, and retained the release
evidence artifact.

## Release contract

- Migration `0024_plan_actual_monitoring.sql` adds only append-only monitoring
  cooldowns. It does not backfill, update, or delete a financial record.
- `GET /api/plan-actual-monitoring` is authenticated, household-scoped,
  Zod-validated, and `private, no-store`.
- `POST /api/plan-actual-monitoring/snooze` accepts only a known item key, the
  exact 64-character source revision, and the fixed seven-day duration.
- A source mismatch, changed item, or prior defer fails closed. The action does
  not call a provider or mutate a plan, baseline, accepted actual, goal, or
  forecast.
- The browser displays at most one decision per metric and routes review to the
  existing Holdings, Obligations, or Scenarios surface.

## Policy checklist

For policy version `plan-actual-v1`, verify:

| Check                     | Required result                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| Cash and debt materiality | Greater of 5% or $5,000, using integer arithmetic                                                  |
| Burn materiality          | Greater of 10% or $500 combined monthly burn                                                       |
| Runway materiality        | Three whole months or crossing from at least 12 to below 12 months                                 |
| Freshness                 | More than 45 days is stale; oldest included cash/debt date wins                                    |
| Priority                  | Review, overdue, and freshness precede numeric drift                                               |
| Deduplication             | No more than one active or deferred item for each metric                                           |
| Cooldown                  | Seven days for the exact source revision; new facts break the cooldown                             |
| No action                 | `clear` means covered and below thresholds; `limited` means coverage is incomplete or unconfigured |

Changing any threshold, precedence, source meaning, or cooldown duration
requires a new policy version, deterministic tests, updated copy, and a reviewed
forward migration if persistence constraints change.

## Cost and capacity

M10 introduces no provider product, provider request, polling schedule, Queue
message, R2 object, email, SMS, or push channel. Incremental approved external
spend is therefore `$0`.

Opening Overview makes one browser request for the monitoring projection. The
repository reads existing D1 planning and reviewed-actual records. An explicit
**Review in 7 days** action appends one small D1 row; no background process
writes cooldowns. Record ordinary Worker request, D1 row-read, row-write,
storage, backup, and protected-smoke usage against the deployment's existing
Cloudflare allowance. If a future external channel or schedule is proposed,
price and approve its data disclosure, volume, retention, failure handling, and
monthly ceiling separately before implementation.

## Deployment and rollback

1. Run `make verify`, including a fresh migration replay and the desktop/mobile
   monitoring flow.
2. Retain the encrypted pre-migration D1 backup.
3. Apply the forward-only migration and deploy the exact reviewed SHA.
4. Read back both Worker SHAs and run protected API and browser smokes.
5. Verify the seeded private alpha reports the honest `limited` state without a
   fabricated alert.
6. Use only independent synthetic fixtures to exercise cash, debt, burn, and
   runway decisions, a clear state, stale inputs, and an exact-source cooldown.

Rollback the application by restoring the last-known-good Worker versions or
disabling the monitoring surface and routes. Do not delete cooldown rows and do
not reverse migration `0024`; the table is additive and does not affect the
canonical financial read paths.

## Synthetic acceptance

- Confirm review-required cash, debt, or burn supersedes value drift.
- Confirm overdue debt supersedes debt drift.
- Confirm 46-day-old reviewed data reports freshness while 45-day-old data is
  current.
- Confirm material differences show saved and reviewed values plus the correct
  destination action.
- Confirm below-threshold covered values show the clear state.
- Confirm unconfigured sources show the limited state without an action item.
- Defer one decision and verify focus returns to the updated queue heading, the
  item moves to later review, and the buttons remain at least 44 pixels.
- Change one compared fact and verify the prior cooldown no longer applies.
- Verify desktop and mobile screenshots contain fabricated values only and the
  page has no horizontal overflow.

Never use real balances, plan values, account labels, screenshots, traces, API
responses, or cooldown records as release evidence.
