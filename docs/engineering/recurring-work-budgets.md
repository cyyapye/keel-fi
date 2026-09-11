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
| D1 round trips, independent daily ceiling |                2,600 |                              2,600 |

An invalid JWT is rejected before D1 or provider work on the next request.
Pending exceptions are included in both cases. Empty admission checks do not
update connection timestamps. Failure changes one sync-run row at insertion and
once at completion; its primary, account/start, and active-run indexes must also
be budgeted. Reserving 200 index-inclusive writes per deployment is conservative
for these 40 changed rows. Successful checks and acceptance are useful work and
retain their separate bounded source/decision writes.

Across two deployments this reserves 192 Worker invocations, at most 48 Access
certificate reads, 40 provider attempts, 40 credential reads, 5,200 D1 round
trips, and 400 index-inclusive writes for the failure day. Combined with the
provider agent ceilings above, reserve at least 75,000 of the shared 100,000
daily Worker requests and 95,000 of the shared 100,000 daily D1 writes for other
work. These free-account allowance references were checked on 2026-09-11 against
the [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/). Round
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
