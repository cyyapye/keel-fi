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
