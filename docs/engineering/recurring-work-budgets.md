# Recurring work budgets

An inexpensive request can exhaust an account when repeated all day. Review the
full producer-to-storage path before choosing a timer, including auxiliary
polls, retries, authentication, heartbeats, and proxy fanout. Empty work and a
provider outage both need explicit budgets.

## Provider agent contract

The envelope is one always-on process per provider, three providers, and one
deployment. Additional workers, households, or deployments require a new shared
account budget. Do not silently multiply this envelope.

| Work                                       | Cadence or bound                                    | Reason                                                                                                                              |
| ------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Idle reconnect discovery                   | 60 seconds after the previous check completes       | Roughly 30 seconds average and 60 seconds maximum scheduling delay while healthy and idle; network and browser startup add latency. |
| Tokenfolio/Sydecar queued update discovery | 60 seconds                                          | Preserve the existing manual-update response target; D1 owns actual capture scheduling.                                             |
| AngelList queued update discovery          | Daily, or immediately after reconnect               | Preserve its existing update cadence.                                                                                               |
| Credential and agent activity timestamps   | At most once per five minutes each while idle       | Presence is approximate; no need to persist every authentication or empty lease.                                                    |
| Active reconnect status                    | Five seconds, capped by the 15-minute session lease | Cancellation/sign-in detection remains responsive only while there is actual work.                                                  |
| Transient idle failures                    | 60, 120, 240, 480, then 900 seconds                 | Stop an outage from becoming a request storm. Success resets the delay.                                                             |
| Authorization failures                     | 900 seconds                                         | Repeatedly rejected credentials cannot make progress; revocation is still checked on every request.                                 |

Update failures back off separately from reconnect discovery, so a broken
provider browser cannot delay the reconnect that repairs it. A successful
reconnect bypasses the update retry delay and checks for work immediately.

Portfolio checks acquire a run before opening a provider browser. Sydecar closes
Chrome after captures and explicit sign-in verification, preserving its saved
profile without running an idle page. The full-day test also requires zero
browser starts during empty checks; the one-minute discovery clock must not turn
browser shutdown into 1,440 browser launches per provider per day. Browser
startup failure after a lease is reported through the existing terminal failure
path. This lifecycle adds no polling loop, provider keepalive, API request, or
heartbeat write to an idle day. The existing failure and cancellation bounds
remain in force.

Authentication performs an indexed database lookup for each request. There is no
authorization cache. First use of a replacement credential retires older
credentials atomically, independently of the timestamp cadence. Heartbeat
updates also have a SQL time predicate so concurrent requests cannot bypass the
write interval. These timestamps are not indexed; adding an index to an updated
column requires recounting D1 row writes.

For three idle reconnect loops alone:

| Interval     | HTTP checks/day | Typical / maximum scheduling delay |
| ------------ | --------------: | ---------------------------------- |
| Five seconds |          51,840 | 2.5 / 5 seconds                    |
| 30 seconds   |           8,640 | 15 / 30 seconds                    |
| 60 seconds   |           4,320 | 30 / 60 seconds                    |
| Five minutes |             864 | 2.5 / 5 minutes                    |

These figures exclude queued-update checks. One minute keeps the same response
target as the existing portfolio update loop with half the reconnect traffic of
30 seconds. Five minutes saves more requests but delays a user-requested
reconnect by up to five minutes. Subsecond updates would require a separately
budgeted push design. A timer should follow a response target and cost envelope,
not a generic preferred interval.

## Executable ceilings

`scripts/provider-agent-usage.test.ts` drives the production scheduler, actual
client helpers, web/API routing, authentication, and real SQL against a
synthetic database for a virtual 24-hour day. The three-agent idle ceilings are:

- 10,000 HTTP requests;
- 20,000 Worker invocations, conservatively counting both web and API;
- 2,000 changed database rows; and
- 10 D1 round trips for any one request, independent of credential history.

The fixture includes 120 retired credentials and checks the authentication query
plan for indexed lookups. It counts actual SQLite changes, not merely calls to
an UPDATE. SQLite does not include index maintenance in this counter, so schema
review and deployed D1 metrics remain necessary. The changed heartbeat columns
must remain unindexed for this write estimate to apply. Worker invocations are
not asserted to equal billable requests.

For context, Cloudflare's published free allowances are 100,000 Workers requests
and 100,000 D1 rows written per day. The caps above reserve substantial headroom
for other account traffic and useful captures. Recheck current allowance and
billing definitions when changing the envelope:
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

When reconnect discovery itself fails, the failure-day ceiling is 105 requests
per agent including the first recovery check. An update-only failure allows
1,440 reconnect checks plus at most 105 update attempts per agent per day.
Separate tests preserve queued reconnect detection, immediate work after
reconnect, five-second cancellation checks, lease expiry, and immediate
credential revocation. Keep ceilings independent of implementation constants.
During a budget change, temporarily restore the former timer or write cadence
and prove the unchanged budget test rejects it; then restore and verify the fix.

## D1 billing-counter gate and combined envelope

The SQL-only change counter above is supplemented by actual workerd D1 metadata
in `scripts/provider-agent-d1-cost.test.ts`. The production client, web proxy,
authentication and repository path run inside a virtual day; missing D1 billing
metadata fails the test. Keep the independent ceilings below separate from
scheduler constants.

| Workload                                           | HTTP requests | Web/API invocations | D1 rows read | D1 rows written |
| -------------------------------------------------- | ------------: | ------------------: | -----------: | --------------: |
| Three idle agents, measured                        |         7,201 |              14,402 |       76,901 |           1,725 |
| Three idle agents, ceiling                         |        10,000 |              20,000 |      150,000 |           2,000 |
| Three revoked agents, measured                     |           288 |                 576 |          288 |               0 |
| Three revoked agents, ceiling                      |           300 |                 600 |        1,000 |               0 |
| Three maximum-length setup sessions, unprovisioned |         1,080 |               2,160 |            0 |               0 |
| Three setup sessions during an outage              |            24 |                  48 |           48 |               0 |
| Three browser reconnects, healthy measured         |           537 |               1,074 |        2,148 |               0 |
| Three browser reconnects, failed measured          |            15 |                  30 |           60 |               0 |

Setup runs only on explicit setup. `/api/session` checks current authentication
and household ownership with an indexed, small projection. Reconnect UI checks
have a five-second healthy interval and the server's 15-minute deadline. Active
status checks use ten seconds and stop after 30 minutes; transient browser
errors back off at 60/120/240/300 seconds. A hidden tab makes no checks, focus
cannot bypass the next deadline, and terminal state stops the timer. Across
eight conservatively simultaneous UI loops, a virtual day permits at most 1,440
healthy or 72 failed checks. Every auth request still validates current
authorization.

### Public-source queue

Daily source admission and an explicit scan each cap at 40 jobs. A job may
register 40 candidate URLs and persist 40 observations, but cannot enqueue child
jobs. Discovery enters the indexed due queue. Healthy sources retain seven-day
checks; failures are eligible after an hour and picked up by the next daily
schedule. A larger backlog therefore affects freshness: 120 immediately due
sources need at least three daily batches, and new discoveries can add backlog.

The real scheduler/processor/D1 test includes 120 targets. A maximum discovery
day of 40 jobs produces 1,600 observations plus discovered sources. Measured
totals: 52,682 reads, 42,200 index-inclusive writes, 481 D1 round trips, 40
queue messages, 40 object writes and 40 source fetches. Including the two DNS
resolvers with parallel A/AAAA, the external request bound is 200. Each DNS
request has a five-second deadline; the source request has a ten-second deadline
and a 1 MiB response limit. URLs and public-address checks remain fail-closed.

An unchanged replay writes no new observations or objects. Verification still
records an explicit attempted check: the 40-job replay measured 400 writes. Four
complete outage attempts per job (the configured three retries plus the first
attempt) measured 1,920 reads and 1,600 writes, with at most 800 external
requests. An empty day makes one indexed scheduler read, at most ten scanned
rows, zero writes, and no queue call. Ceilings: busy day 150,000 reads / 50,000
writes; failure day 20,000 reads / 8,000 writes. The test asserts the queue
retry config and rejects recursive sends.

### Useful-work reserve

For one deployment, three agents, one bounded foreground session, three explicit
setup sessions, the daily source batch and three 120-position accepted captures,
reserve 480,000 D1 reads for agents/source work plus captures (150,000 +
150,000 + 3 × 60,000, before UI/other reads), and at most 76,000 writes (2,000 +
50,000 + 3 × 8,000). The cash allowance below adds 500,000 reads and 800 writes
across two cash-enabled deployments. Reserve at least 20,000 writes and 3
million reads for other useful work, historical-growth allowance and operations.
The remaining Worker-request headroom is over 70,000 using the conservative
two-hop invocation count plus bounded UI/setup/source activity. Invocation
counts are not asserted to equal billable requests.

This is a declared envelope, not a guarantee for arbitrary manual imports, 50
simultaneously large brokerage updates, more households, repeated manual scans,
new deployments or backup activation. Those require a new combined budget before
activation. A 120-position capture measured about 51,000 reads and 7,083 writes
with all foreign keys and continuity triggers enabled; this is deliberately a
positive reconnect case, not an empty query. See
[query and Worker audit](query-and-worker-cost-audit.md) for individual paths
and regressions. Cloudflare allowances are shared across the entire account:
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

### Investment review recovery

Automatic investment review adds no background scheduler. The owner is either
the existing accepted-import operation or one foreground Legal entities page.
Ingestion runs after accepted source evidence; page entry recovers already saved
positions. The freshness target is the completion of that operation, with a
30-second browser deadline. Navigation aborts the browser request; a server
transaction already admitted may finish atomically. Failure exposes an explicit
retry. There is no network retry, focus refresh or idle heartbeat.

Admission is 120 positions per transaction. An existing import's 500-row cap
limits recovery to five sequential batches. A page likewise stops after five
batches and offers continuation. Stale transaction races allow at most three
attempts; they do not enqueue additional work. Authentication remains current on
every request. The operation reads only D1 projections and evidence: zero
provider calls, object reads/writes or PDF processing. Normal document capture
keeps the existing 24-document per-run limit and sandbox limits.

`scripts/automatic-investment-review-d1-cost.test.ts` measures the actual
client, web/API path and D1 metadata for a 120-position household. One
foreground session making 20 deliberate visits in a virtual day sends 40 HTTP
requests (80 conservative web/API invocations), reads 175,760 D1 rows and writes
zero rows. An idle open tab adds zero requests. A complete request outage makes
one failed request per visit with no automatic retry or application write.
Independent ceilings are 350,000 reads and zero writes for unchanged visits.

A synthetic 120-row source import with 24 captured agreements costs 6,118
index-inclusive writes before automatic review. Automatic review adds 1,286, for
7,404 total, inside the unchanged 8,000-write accepted-capture allowance. A
separate one-time 120-agreement backlog costs 4,454 automatic-review writes; its
documents already exist and are not fetched again. Reserve up to 8,000 of the
existing 20,000 useful-work writes for one such backlog session, leaving at
least 12,000 for other useful work. Its 350,000-read visit ceiling also comes
from the existing 3-million useful-work reserve. This does not add a new
deployment or multiply the three-agent envelope. Repeated bulk imports or larger
foreground inventories require the existing combined-budget review.

The runtime inventory change is one authenticated recovery fetch, the existing
initial-load timer's callback, and a single abort deadline. It introduces no
periodic callback. The history and unchanged-replay tests must pass before
accepting that inventory update. API/web deployment, reloaded browser tabs and
upgraded document agents are separate activation steps; local tests do not
establish live backlog completion.

## Activation and observation

Deploy the tested API and update all existing long-running clients before
claiming the idle rate is fixed. Check for active runs, preserve existing Linux
identities and profiles, and verify the restart uses the tested code. Observe a
bounded idle window with account-level requests and D1 row-write metrics.
Separate client HTTP calls, Worker invocations, billed requests, actual row
writes, and sampling limitations. A local simulation is not a live savings
measurement.

The PR must show the envelope, idle/failure budget, matched regression, latency
and security holdouts, headroom, and activation evidence or the exact remaining
activation step. An omitted daily cost estimate blocks readiness for recurring
work even when individual requests pass tests.

## Cash balance checks

Cash has no background loop, cron, webhook refresh, heartbeat, or automatic
retry timer. A due Sources-page visit starts the existing check; an open idle
page creates no additional traffic. The freshness target remains the first
eligible visit after seven days, with four live attempts per institution per UTC
month. Failure consumes an attempt and preserves the seven-day automatic
cooldown; a manual retry remains explicit and shares the monthly limit.

Exception-based acceptance removes the pending-review admission block. It does
not shorten either interval. The existing automatic-refresh POST also recovers
waiting D1 observations without a provider or object read. Unchanged recovery
writes nothing. Source acceptance invokes the existing baseline POST once when
accepted facts change; there is no new baseline polling loop.

The synthetic envelope is 20 institutions and 100 accepted accounts per
household, one foreground session with 24 hourly visits per day. Budget two
cash-enabled deployments conservatively. Tests force both the GET and POST on
every visit, which exceeds what the browser sends when checks are not due. The
test uses the real browser helpers, web proxy, API authentication with a signed
JWT and a synthetic JWKS endpoint, and real SQL; only Plaid and R2 transports
are simulated.

| Full day, per deployment                  | Idle within cooldown | Provider outage with all banks due |
| ----------------------------------------- | -------------------: | ---------------------------------: |
| Cash HTTP requests                        |                   48 |                                 48 |
| Web + API invocations                     |                   96 |                                 96 |
| Access certificate reads, upper bound     |                   24 |                                 24 |
| Plaid live requests                       |                    0 |                                 20 |
| R2 credential reads                       |                    0 |                                 20 |
| R2 writes/deletes                         |                    0 |                                  0 |
| Changed D1 rows                           |                    0 |                                 40 |
| D1 round trips, independent daily ceiling |                  600 |                                600 |

An invalid JWT is rejected before D1 or provider work on the next request.
Pending exceptions are included in both cases. Empty admission checks do not
update connection timestamps. Failure changes one sync-run row at insertion and
once at completion; its primary, account/start, and active-run indexes must also
be budgeted. A separately indexed latest-attempt projection lets the browser and
automatic POST skip admission during cooldown, including after failure. The
atomic repository admission still checks eligibility for every actual attempt.
Successful checks and acceptance are useful work and retain their separate
bounded source/decision writes.

`scripts/cash-request-d1-cost.test.ts` supplements the signed-JWT SQL test with
actual workerd D1 metadata. It includes 100 accepted accounts, 20 pending
proposals and 100 historical proposals. Authentication runs in the normal API
middleware with a synthetic verification hook; existing signed-JWT tests cover
certificate fetching and rejection. Measured idle day: 360 round trips, 111,528
reads and zero writes. Credential-storage outage day: 485 round trips, 97,003
reads and 140 index-inclusive writes, including 20 attempted credential reads
and zero provider calls. Independent per-deployment ceilings are 600 round
trips, 250,000 reads, zero idle writes and 400 failure writes. Restoring the
former cooldown admission produces 2,325 trips and fails the unchanged ceiling.

Across two deployments this reserves 192 Worker invocations, at most 48 Access
certificate reads, 40 provider attempts, 40 credential reads, 1,200 D1 round
trips, 500,000 D1 rows read and 800 index-inclusive writes for the failure day.
Combined with the provider agent ceilings above, reserve at least 75,000 of the
shared 100,000 daily Worker requests and 95,000 of the shared 100,000 daily D1
writes before source monitoring and useful captures. The combined envelope above
reserves those workloads separately. These free-account allowance references
were checked on 2026-09-11 against the
[Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Round
trips are not billed rows read: inspect D1 row metrics for historical-data
growth, and keep the indexed read-plan regression. Additional deployments,
households, visits, or institutions require multiplying this envelope.

`packages/database/src/cash-accounts.test.ts` enforces these budgets, the
monthly ceiling, weekly eligibility, and automatic updates despite waiting
exceptions. A control run with the former pending-review admission block failed:
only 19 of 20 due institutions reached the provider. Restoring the new policy
passes. No timer or credential process needs restarting. Deploy API + web
together and reload existing browser tabs before claiming activation. Local
tests do not prove live deployment or account usage.

## Tugling improvement

Tugling 0.4.0 already asks for recurring costs in `scale-cost-review`, but a
general instruction allowed a review to count the main job while missing its
auxiliary loops. The upstream candidate should require the full idle and failure
day above and make cost-envelope evidence a critical readiness criterion.

Add a synthetic behavioral case with three idle agents, a five-second auxiliary
poll, and authentication/heartbeat writes. A passing candidate must find the
combined quota overrun, justify a response target, require a fixed-budget
regression, preserve revocation/cancellation, and include client activation.
Test a held-out fast-cancellation or revoked-credential case so saving cost by
delaying security actions fails. Compare the released and candidate skills on
the same cases before promotion. The Keel rules and CI tests enforce this
boundary now; they do not certify or release an upstream Tugling skill.
