# Query and Worker cost audit

This audit covers Keel-owned SQL factories in the API and database package,
their referenced views and integrity triggers, the API/web Worker entrypoints,
browser requests and timers, provider agents, the daily schedulers and queue
consumers, and the optional backup and deployment jobs. Production transports
remain fail-closed. All executable fixtures use fabricated data.

## Why the earlier fix was insufficient

The first repair scoped two exposure lookups. It did not measure the whole
application against D1's rows-read counter. A fixed number of SQL calls can
still scan a large amount of history, and an indexed plan can still repeat an
indexed household scan for each result. The repair also had to reach both
Workers and running clients; a merge alone could not change live traffic.

The final inventory contains 469 production SQL variants and 214 runtime call or
configuration entries. A separate history fixture holds the displayed collection
at 120 positions while adding 120 accepted captures per position. With all
provenance and ownership triggers active, it detects the missing creation-time
ordering in latest snapshots and container coverage. The dashboard read grew
from 2,540 to 31,340 rows before the index repair; afterward it reads 2,301 rows
with or without the 14,400 historical snapshots. Seven exact duplicate indexes
are removed; two overlapping snapshot indexes become one complete
latest-snapshot index, and the coverage index gains its complete ordering.

## Corrections and proof

| Path                            | Correction                                                                                                                                                          | Regression                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Exposure and review joins       | Include household with the join/filter keys                                                                                                                         | Every compiled query plan; unrelated-household holdout                                                                             |
| Reconnected position continuity | Push household, provider, normalized name and position predicates into candidate and ambiguity checks; retain both integrity triggers                               | 120 positive pairs with foreign keys and triggers enabled; ambiguity and identity mismatch tests                                   |
| Dashboard forecasts             | Start with the latest snapshot for each household scenario before reading curves                                                                                    | 120 additional historical snapshots do not multiply reads                                                                          |
| Import previews                 | Match quarantines by import and derive container row counts from already-loaded rows                                                                                | 120 rows and the maximum 100 containers; five D1 round trips                                                                       |
| Import ingestion                | Load all existing containers together; restrict prior snapshots to relevant positions                                                                               | Maximum 100 containers; accepted capture bounded independently by round trips, scanned rows and index-inclusive writes             |
| Debt and cash-flow proposals    | Load child rows together and group in memory                                                                                                                        | 120 rows, pending and historical proposals; fixed request count                                                                    |
| Cash proposals                  | Preserve the newer exception-based policy's existing bulk read                                                                                                      | 20 institutions, latest pending observations and history; policy/security holdouts                                                 |
| Brokerage statuses              | One indexed status query for the collection                                                                                                                         | Maximum 50 connections in three D1 round trips                                                                                     |
| Monthly cash/debt usage         | Filter by timestamp range instead of applying a function to every historical timestamp                                                                              | Prior-month history does not grow current-month read cost                                                                          |
| Due refreshes                   | Project the latest cash attempt and skip cooldown admission; reuse state when no connection is eligible; preserve atomic admission and pending-observation recovery | Full real-D1 cash day: 20 institutions, 100 accepted accounts, exceptions and history; failure falls from 2,325 to 485 round trips |
| Reconnect status GET            | Project expiration without issuing cleanup writes                                                                                                                   | GET changes zero stored rows; expired credentials still fail at use time                                                           |
| Browser status checks           | Shared nonoverlapping timer; five-second reconnect and ten-second active-status checks; hidden-tab pause, failure backoff and deadlines                             | Full virtual-day ceilings; actual reconnect client/authentication/repository tests; desktop/mobile focus and visibility tests      |
| Sources navigation              | Remove dashboard/holdings prefetch unrelated to the open screen                                                                                                     | Browser request assertion: Sources does not fetch `/api/alpha`                                                                     |
| Agent login setup               | Dedicated authenticated `/api/session` projection instead of the full dashboard                                                                                     | Actual setup client through proxy, authentication and D1; success, unprovisioned and outage cases                                  |
| Source monitoring               | Use existing ingestion triggers for homepage registration; set-based discovery and observations; no recursive queue fanout                                          | 120 targets, 40 discoveries and 40 observations; replay, full busy day and failure day                                             |
| Source admission                | At most 40 jobs per daily schedule or explicit scan, oldest work first                                                                                              | Daily scheduler through actual job processing and D1 counters; no empty queue write                                                |
| Retained-source maintenance     | Five objects / 25 MiB per invocation; aggregate evidence writes across the batch                                                                                    | 120-document backlog; five object reads and one call per evidence kind                                                             |
| DNS checks                      | Two resolvers, parallel A/AAAA, five-second deadline per resolver request                                                                                           | Fallback, private-address rejection and bounded source-request tests                                                               |
| Index writes                    | Remove seven exact duplicates of UNIQUE indexes; add only indexes demonstrated by query plans                                                                       | Uniqueness preserved; real D1 write counters include index maintenance                                                             |

Healthy public sources retain their seven-day check interval. Discovery and
failed-source work enter the daily admission queue. At 40 jobs/day a backlog of
120 immediately due sources needs at least three scheduling days. Further source
expansion requires a revised freshness and account budget. Manual scans are
explicit useful work and spend another bounded batch; repeatedly requesting them
is outside the idle-day envelope.

Retained-source maintenance defers failed objects for 24 hours in an
ownership-scoped retry record. Five unreadable documents cannot occupy every
slot or be re-read on every page visit. A 120-document regression proves that
later documents remain eligible and failed objects become retryable after a day.

Discovery capacity is checked inside the insertion transaction. A real D1 race
holds two batches after both read the same available capacity; the old condition
admitted 81 sources, while the corrected transaction retains the 50-source cap.

## Gates

Automatic investment recovery uses seven set-based reads and one transaction
containing nine INSERT statements for ordinary evidence for a 120-position
batch. An indexed position/exposure/version lookup also serves allocation
integrity triggers. Without it, the unchanged 25,000-read acceptance gate
measured 28,467 reads and failed because those triggers scanned unrelated
mappings. The corrected full batch measured 11,066 reads and 4,454
index-inclusive writes. Repeating unchanged evidence performs no writes. A
second control with 120 historical mapping versions per position failed at
66,369 reads. Looking up each mapping root in the existing partial index and
seeking its latest version also closes that growth path in the commit guards,
without another write index. Company citations are stored in the automatic
decision, avoiding a duplicate human-review receipt. The dedicated cost case
covers policy and mapping history, equal observation dates, an empty unrelated
household, complete capture cost and a virtual day. GETs remain projections.
Large citation arrays are split into bindings of at most 1,500,000 UTF-8 bytes
within the same transaction, below the
[D1 string limit](https://developers.cloudflare.com/d1/platform/limits/).
Per-position evidence admission is also measured in bytes, not characters.

- `scripts/d1-query-cost.test.ts` discovers SQL from production source, resolves
  conditional query variants, expands views and checks real workerd query plans.
  Unknown SQL construction fails the inventory. Explicit base-table scans and
  automatic indexes fail, with one documented indexed `LIMIT 1` deployment
  probe.
- `scripts/d1-read-budgets.test.ts` counts actual D1 `rows_read`,
  `rows_written`, statements and round trips. It includes 120-item cases,
  positive continuity, historical growth, unrelated households, and unchanged
  replay.
- `scripts/holding-history-d1-cost.test.ts` preserves 120 visible positions
  while adding 120 historical captures for every position. Returned values stay
  the same and both dashboard and Holdings reads have independent growth
  ceilings.
- `scripts/provider-agent-d1-cost.test.ts` executes a virtual day using the real
  clients, proxy, authentication and repositories inside workerd. The separate
  scheduler tests retain revocation, cancellation and recovery latency holdouts.
- `scripts/keel-session-check.test.ts` measures setup and browser reconnect
  checks through the real request/authentication/repository path.
- `scripts/cash-request-d1-cost.test.ts` counts actual D1 metadata through the
  browser helpers, proxy, API authentication and repository, including
  historical proposals and a full credential-storage outage day. The separate
  signed-JWT and provider-outage cases retain authentication and acceptance
  holdouts.
- `scripts/portfolio-watch-d1-cost.test.ts` drives a full scheduled day, maximum
  discovery/event payloads, duplicate delivery and a four-attempt outage
  envelope.
- `scripts/portfolio-watch-activity.test.ts` verifies saved run admission,
  duplicate and interrupted delivery, timeout recovery, 120-company pagination,
  growing same-date history and unrelated households. Filling all fifty source
  slots per company produces a 6,000-source holdout: full coverage reads take
  five round trips, while progress reads take three and remain below 3,000
  scanned rows. Its virtual-clock cases traverse the browser helper, proxy,
  authentication and D1 with a full-day request budget and ten-second completion
  detection. Polling full coverage instead fails the unchanged daily read
  ceiling.
- `scripts/runtime-work-inventory.test.ts` follows static and literal dynamic
  imports from the runtime entrypoints. Its snapshot flags changed network,
  storage, queue and timer call sites. Review the caller's loop and retry bounds
  before accepting a snapshot change; a call-site hash is not a cost estimate.
  It also covers Linux setup, explicit dead-letter recovery, Worker deployment
  configuration and the optional backup schedule.
- Browser tests verify the timer is actually wired into the screen. A standalone
  helper test alone cannot detect an old effect left in the component.

Negative controls temporarily restore the former implementation while leaving
the regression ceilings unchanged: subsecond reconnect checks fail the actual
browser timing assertion; repeated continuity ambiguity scans exceed the
60,000-read accepted-capture ceiling; cash cooldown admission exceeds the
600-trip daily ceiling. Restore the candidate before the final verification.

`EXPLAIN QUERY PLAN` also lists some foreign-key checks that SQLite's bytecode
skips for a particular insert/update. Blindly indexing every such line increases
writes. The collection/capture cost fixtures keep foreign keys and integrity
triggers enabled and measure executed reads and writes instead. The plan and
runtime gates complement one another; neither is a proof about every possible
future dataset or dependency implementation.

The inventory excludes test-only fixtures, local seed SQL and historical
migration backfills from recurring runtime costs. Explicit
deployments/migrations need their own one-time read/write reserve. Backups are a
separate bounded, operator-enabled workload: one D1 export, at most 4,096 source
PDFs / 1 GiB, and one encrypted archive upload plus read-back. Do not enable
backups or another deployment without adding them to the shared account
envelope.

## Lessons to enforce

1. Measure rows scanned, not rows returned or just query count.
2. Test positive matches, empty results, history and another household; each can
   expose a different expensive plan. Grow history per returned item, and
   include repeated observation dates that force secondary sort keys to matter.
3. Include views, triggers, authentication, proxies and auxiliary timers in the
   request graph. Browser prefetch and sign-in probes count too.
4. Count an entire idle, outage and useful-work day across every active process.
   Multiply discovery and retry fanout before comparing with account allowances.
5. Give each recurring job one owner, a freshness target, an admission bound and
   a stop condition. Empty checks and unchanged evidence must not write state.
6. Use actual D1 metadata for index-inclusive write budgets. Remove redundant
   indexes; keep only indexes that have demonstrated read savings.
7. Prove the old behavior fails the unchanged budget. Do not raise a ceiling or
   accept a changed inventory snapshot just to turn a failure green.
8. Verify the deployed revision, running clients and observed usage separately.
   A local pass, merged PR or newly created client does not update old
   processes.
9. Test beyond every relevant session deadline. An immediate reconnect and
   capture missed Sydecar's twelve-hour refresh expiry before its daily sync.
   Closing a page fixes an idle logout, not server-side token expiry. The repair
   uses bounded native-provider renewal with synthetic cold-browser expiry tests
   and requires a later live renewal and scheduled capture.
10. Exercise intermittent recovery, not only a complete outage: successful
    retries reset failure counters and can produce more work in a day. Keep
    request admission, retry limits and daily billing assertions independent.
11. Reset per-scenario operational timestamps before rewinding a test clock.
    Future heartbeat timestamps can make an apparently complete virtual day
    undercount writes. Assert a sanity floor as well as the independent ceiling.
12. Install request controls before any provider page can run. Chrome can
    restore saved tabs before an explicit navigation, bypassing a guard attached
    afterward or defer restoration until the first new window opens. Cold-start
    tests must cover reused profiles, reject requests from unowned pages and
    count actual admitted navigations through the whole operation. A zero-page
    startup assertion and a retry-dependent CI pass are insufficient proof.

These rules reduce recurrence and make known failures mechanically detectable.
They do not justify a promise that no future query, workload growth, repeated
manual action or third-party change can ever consume the account allowance.
