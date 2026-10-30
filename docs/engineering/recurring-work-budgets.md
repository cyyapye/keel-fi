# Recurring work budgets

An inexpensive request can exhaust an account when repeated all day. Review the
full producer-to-storage path before choosing a timer, including auxiliary
polls, retries, authentication, heartbeats, and proxy fanout. Empty work and a
provider outage both need explicit budgets.

## Change requirements

Before changing polling, retries, heartbeats, schedules, or authentication on
those paths:

- State the response/freshness target and count a full idle day and a full
  failure day across all active processes and deployments. Include every
  auxiliary loop, proxy/API invocation, database read, timestamp/index write,
  and retry. Compare the total with the shared account allowance and reserve
  explicit headroom for useful work; a per-call budget is insufficient.
- Also budget a maximum useful-work day, multiplying queue discovery and retry
  fanout. Include browser prefetch, sign-in probes, proxy hops, object reads and
  scheduled backup/export work. Give each recurring producer one owner, an
  admission bound, and a deadline. Update the runtime call inventory with a
  reviewed budget; accepting a snapshot or raising a ceiling is not a fix.
- Enforce discovery and queue capacity at atomic admission, then test racing
  callers and duplicate deliveries; a preflight count does not enforce a cap.
- Empty checks must not write application state. Any operational heartbeat must
  have a separately justified write cadence. Keep credential revocation checks
  current on every request; do not cache authorization to reduce writes.
- Add a virtual-clock regression through the real client request,
  authentication, and repository path. Assert independent daily ceilings,
  bounded failure retries, and the required detection/cancellation latency.
  Prove the old behavior fails the gate.
- When preserving a provider session, compare its access, refresh and idle
  deadlines with the complete scheduled interval. A successful immediate restart
  does not prove a later capture. Cover intermittent recovery as well as
  continuous outages; retries followed by success can be the busiest day. Reset
  heartbeat state when rewinding fixture clocks so future timestamps cannot
  silently suppress writes in the next measured scenario.
- A recurring-work fix is not activated until both the server and every existing
  long-running client use the verified revision. Preserve provider identities,
  credentials, and profiles; avoid interrupting an active run. Report local,
  deployed, restarted, and observed usage evidence separately.

Read the workload sections affected by the change; the measured envelopes below
do not automatically apply to another producer or deployment.

## Preview release storage

The automatic main-push release and explicit manual dispatch share one
serialized writer. They add zero idle-day requests and no background polling.
Each backup or release-record phase reads four fixed R2 policy endpoints and at
most five inventory pages. It verifies the active parent API token (at most two
endpoints for user/account token types), then issues one 900-second temporary
credential scoped to that phase's exact object keys. There is no credential
cache or automatic request retry. Four object operations store/read the backup
and manifest; two store/read the final release record. The complete new storage
boundary has at most **30 provider requests per attempt**, independently of the
number of retained objects within its 5,000-item envelope. Policy/authentication
reads time out at 30 seconds; each PUT/read-back has a 120-second deadline. The
existing 45-minute deployment job deadline remains unchanged.

The explicit `preview-backup-storage-check.yml` probe shares that writer lane.
It adds zero scheduled or idle requests. Each manual invocation makes at most 14
provider requests: four policy reads, five inventory pages, three parent/
temporary-credential calls, and one synthetic PUT plus read-back. Its constant
43-byte payload transfers 86 bytes, is retained under the 14-day backup policy,
and counts toward the same 300 MiB cap. No retry, D1 export/mutation or Worker
deployment occurs. The job has a ten-minute deadline and the same per-request
timeouts. Run it once to diagnose a storage change; repeated probes consume
capacity and require the same reviewed run-volume envelope as release attempts.

Backup/manifest bytes are bounded at 16 MiB combined and release bytes at 256
KiB, so complete upload plus read-back traffic is at most 32.5 MiB per attempt.
All retained objects count against 300 MiB; serialized admission refuses new
publication before exceeding it. Failure never retries, deletes a recovery point
or mutates D1. At the documented two-attempt/day planning envelope, maximum
storage-boundary work is 60 requests/day, including an outage day; existing
export, migration, build and smoke work is unchanged. More attempts consume
retained headroom and fail closed when it is exhausted. These limits do not
reserve account-wide Cloudflare capacity.

Native regression coverage exercises 120 retained objects, empty inventory,
cursor and keyset continuation, fixed page bounds, privacy/retention failures,
credential scope/TTL and request signing, refused/ambiguous PUTs, corrupted or
oversized read-back, and exact-attempt release evidence. A successful local
check is not activation: deployment must retain and read back the actual
encrypted export before its first migration.

## Holding detail interactions

Holding valuation evidence loads once when its editor mounts. History loads one
page when its disclosure mounts, then one page per explicit pagination or retry
action. Both reads abort on unmount, do not poll, and make no application
writes. History uses one indexed repository query for at most 31 receipts; the
120-position and growing-history D1 cost test bounds actual reads, including
empty and foreign results. Valuation evidence retains its existing fixed
two-query cost envelope.

Investment and valuation each submit one request per explicit Save. The pending
form disables duplicate submissions; failures preserve the draft and have no
automatic retry. A successful save refreshes the existing holdings projection.
These interactions add zero idle-day or unattended failure-day network requests.
The link-copy confirmation uses one cancellable 1.6-second local timer after a
successful copy, with zero network or storage operations.

## Provider agent contract

PDF reader/scanner admission uses one local owner per rootless daemon across all
processes. It adds zero provider/API/D1/object operations on idle, outage or
useful-work days; provider scheduling, download ceilings and failure retries
remain unchanged. No owner runs while there is no extraction request. At most
eight requests occupy local admission slots, one container executes, and a
waiting request selects its parent pipe every 50 ms for at most 120 seconds
(2,400 local waits, no daemon polling). Admission failures do not retry. Each
admitted document operation makes four execution control calls, one preflight
occupancy call, one exact removal, and at most five absence checks: 11 local
Docker calls, each control call bounded at 10 seconds. Only retained containers
cause the four 250-ms cleanup settling waits. The owner cancels after 180
seconds and completes bounded cleanup before releasing capacity; reader/scanner
execution remains 30/90 seconds with unchanged memory, CPU, input/output and
independent 32/95-second watchdog limits. A dirty ownership journal, including a
create without a recorded completion acknowledgment, stops admission until
explicit operator recovery; age or missing PIDs never authorize concurrent work.
The runtime inventory's reader timer changes its error classification only; it
does not raise the deadline. Process races, caller death, supervisor death and
cleanup barriers are native regression gates.

The verification-only orphan probe registers exactly two passive HTTP waits on
that same rootless socket, for next exit and removal, before starting the
worker. It makes no repeated lifecycle queries or retries. Registration is
bounded at 10 seconds, exit observation at 45 seconds after the caller-death
barrier (35-second watchdog plus 10-second response allowance), and removal
observation at 10 seconds after exit confirmation. Responses are capped at 4 KiB
each and observers are cancelled on every outcome. This replaces deadline
polling in the proof only; production call counts, admission, execution and
cleanup budgets above are unchanged.

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
Chrome after captures, sign-in verification and session maintenance, preserving
its profile without running an idle page. Empty checks must open zero browsers;
the one-minute discovery clock cannot become 1,440 browser launches per day.
Browser startup failures follow the leased operation's bounded failure path.

Tokenfolio's passkey/MFA classification inspects only visible DOM controls in
the existing page-readiness check. It adds no browser launch, network request,
API/D1/object operation, timer, credential probe, or retry. Existing 45-second
portfolio readiness and 15-minute reconnect deadlines still apply; explicit
authentication challenges use the existing sign-in-required failure path. The
three-agent idle, continuous-outage, intermittent-recovery and maximum
useful-work day envelopes below remain unchanged, including the shared account
headroom. A synthetic browser regression fails under the former detector and
requires passkey/MFA recovery while rejecting hidden and optional controls; the
authenticated virtual-day usage gates continue to enforce the existing ceilings.

### Authenticated reconnect gateway

The provider worker owns one named Tunnel and one loopback authentication
gateway only while an existing reconnect lease is active. D1's unique active
provider constraint and the provider-specific fixed loopback port exclude
duplicate owners. No gateway, key fetch, readiness probe or viewer timer runs
while idle. Idle-day and unattended provider-failure-day API/D1 ceilings remain
unchanged. The full virtual-day client and actual D1 counter fixtures retain
their idle, continuous outage and intermittent recovery assertions.

Each lease lasts at most 15 minutes and admits one WebSocket viewer, including
racing upgrades. A disconnect consumes that admission. The gateway caps JWT
verification at 256 allowed-route attempts per lease and eight concurrent
verifications, with at most 16 inbound TCP connections. Readiness retains the
30-second startup deadline, three-second request timeout and 250-ms retry
interval (at most 120 probe attempts). A service identity can receive only the
current lease nonce; viewer requests require the exact requesting user and
application audience. There is no authorization-result cache.

The JWKS client starts only on an admitted lease, times out after three seconds,
caches public keys for five minutes and imposes a 30-second cooldown on unknown
keys. Budget at most 31 key downloads per 15-minute lease, including a boundary
request. Neither key downloads nor viewer/probe requests invoke Keel Workers, D1
or object storage. Their edge/Tunnel traffic is separately counted. The Tunnel
retains cloudflared's bounded reconnect backoff inside the lease. Gateway expiry
and established viewer JWT expiry each use one cancellable local timer; HTTP
backend timeout is three seconds. Closing the gateway destroys sockets. Existing
five-second server status polling owns cancellation detection and retains its
180-check ceiling per full lease.

For three full reconnects, gateway admission adds at most 768 verification
attempts and 93 JWKS requests, with zero new D1 writes or object operations.
User link opening adds one passive GET followed by the existing consumption work
on POST. The leased subject uses an indexed user join in the existing
winning-lease query, with no extra repository round trip. The
positive/empty/foreign and growing-history D1 holdout measures this query and
inspects its plan. Repeated explicit user reconnects multiply these active
costs; a multi-customer public service needs atomic aggregate admission limits
and a new shared-account budget before launch. The current three-provider,
one-household operating envelope is not a public tenancy budget.

### Sydecar session maintenance

The provider's observed access-token lifetime is one hour and refresh-token
lifetime is twelve hours; its open-page idle logout is earlier still. Closing
Chrome prevents that idle logout but cannot preserve server authorization across
a daily capture interval. The existing Sydecar process checks for a maintenance
lease once per hour (24 additional authenticated requests per day). D1 admits
maintenance six hours after initial capture or fresh reconnect. A verified
renewal retains at least four hours of expiry headroom and checks again within
six hours; an eight-hour lifetime therefore schedules the next check in four
hours. A twelve-hour lifetime keeps the existing six-hour cadence. Later healthy
captures retain an earlier maintenance deadline: a working access token does not
prove fresh refresh-token lifetime. A fresh reconnect can restart the six-hour
window. A capture recovering from a failed or crashed renewal also restarts that
window together with its retry counter, preserving the existing recovery policy
without admitting hourly failures. The macOS Sydecar job also wakes hourly;
capture scheduling remains in D1.

One atomic five-minute lease excludes competing maintenance, capture and managed
reconnect browser ownership. Already queued captures and reconnects win
admission. An admitted operation opens the ordinary provider application so its
own client renews its session. Success requires a ready portfolio, an unexpired
access token and at least eight hours of provider-issued refresh lifetime. Only
expiry metadata leaves the browser. No provider credential or account claim is
sent to Keel. The operation has a two-minute deadline after browser startup,
closes its browser before reporting, and admits at most 150 page HTTP requests,
including assets and auxiliary calls. Chrome starts with no tabs and background
networking disabled. A blank startup URL alone permits restoration of older
provider tabs before the request guard attaches; cold-browser tests require zero
pages before installing routes, even after a prior portfolio visit. Chrome can
also defer restoration until the first explicit window opens. Sydecar admits
requests only from pages explicitly created by its operation, closes restored
tabs, and keeps its existing bounded agreement-popup interception. Tests count
exactly one provider document navigation per operation across repeated cold
starts; a zero-page startup assertion alone does not establish that boundary.

A reconnect requested during maintenance waits for its bounded provider
operation and browser cleanup, then the next one-minute discovery check. Browser
startup, cleanup and network latency add to that active-work delay. Once an
interactive reconnect starts, its existing five-second cancellation checks
remain unchanged. Maintenance does not add a second status-polling loop.

After an error or crashed lease, the next attempt is at least an hour later.
Three unclassified failures or crashed leases stop maintenance and expose an
error. A confirmed provider authorization rejection stops immediately. A fixed
transport or provider-service error may recover after the third attempt only
while previously observed refresh expiry remains in the future. This metadata
never proves authorization and cannot restore a session the provider cleared. A
verified reconnect or successful capture resets the consecutive counter. Turning
scheduled updates off disables maintenance. Authorization and revocation remain
current on every request. Maintenance never creates an import or advances the
portfolio's last/next capture time.

A separate indexed attempt history atomically enforces nine admitted renewals
per agent in any rolling 24 hours, including concurrent callers, successful
captures and reconnects that reset consecutive retries. The admission batch
prunes only that agent's expired history and records the winning lease. At most
nine current-window rows remain; old rows are removed on the next admission.
Crash cleanup retains its existing three-attempt stop and does not infer a safe
retry from the previous attempt's transport classification.

With the ordinary twelve-hour lifetime, the successful virtual day performs
three renewals (hours 6, 12 and 18). Shorter verified lifetimes can increase the
cadence. Completion allows for the existing five-minute lease age after the
browser verifies eight hours; it never permits an expired lease. Success and
typed transient recovery together with intermittent failures share the
independent nine-attempt ceiling, or 1,350 admitted provider-page HTTP requests.
Every attempt still has the two-minute operation deadline, five-minute lease and
150-request admission limit. No new process, polling loop, discovery request or
page fetch is introduced. The runtime call inventory changes only the existing
completion payload, carrying validated expiry metadata or a fixed failure
category instead of token values.

Actual-D1 day tests include three transport failures followed by recovery on the
fourth attempt, the existing maximum intermittent pattern, and both idle and
unclassified outage paths. They cap nine browser starts, exactly 24 discovery
calls, ten D1 round trips per request, 150,000 reads and 2,000 index-inclusive
writes. The additional attempt-history writes must fit that existing ceiling; no
workload limit is raised. No Keel object reads, imports or financial writes are
part of maintenance. Existing useful-capture reserves still apply separately.

Intervening manual captures at hours four and five must leave renewal due at
hour six. A virtual-clock regression follows the production completion
statements through the real client, web proxy, API authentication and repository
lease; the former deadline reset fails it. Repository tests also exercise full
capture completion and fresh reconnect separately. Retaining the earlier capture
deadline does not add a producer or timer; the independent recovery admission
index and retry bound are described above. The idle, failure and useful-work
envelopes and independent D1 ceilings remain unchanged. An additional day
holdout completes captures hourly after reported failures or expired leases.
Resetting retries without the recovery window admits 24 failed maintenance
operations; the guarded recovery path admits four, at hours 0, 7, 14 and 21 with
hourly discovery. The authenticated client holdout also rejects a retry one hour
after recovery. This remains inside the existing nine-attempt rolling-day
ceiling and does not raise any workload limit.

One bounded failure event records the refresh request count, HTTP status and a
fixed transport-error category. It observes only the operation's owned page and
the provider's exact refresh endpoint; it makes no extra requests and does not
record URLs, headers, bodies, credentials or raw error messages. Real-browser
tests distinguish a rejected refresh, provider-service failure and DNS failure
while keeping authentication fail-closed. A sign-in page alone cannot
distinguish those causes: the provider client may clear its session after any
refresh error.

The observer also records a fixed response-content category and, for bounded
uncompressed JSON error responses of at most 4 KiB, one of the provider's three
public refresh-error codes (expired, invalid, or unknown token). Unrecognized,
oversized, encoded, malformed or unavailable bodies remain unclassified; no
provider message or extra field is logged. It waits at most one second for
diagnostic response reads within the existing two-minute renewal deadline. This
adds no provider requests or polling timers. Persisting the fixed category and
expiry permits the bounded recovery policy above; actual D1 counters include
those writes and the independent attempt history. An invalid refresh token does
not by itself prove that another login caused the rejection. A synthetic
revocation case demonstrates why a successful capture using a still-valid access
token cannot establish refresh-token health.

Chrome's close-command acknowledgement precedes completion of profile writes.
The worker waits for the exact profile's processes to exit normally before
reporting success; it does not send a termination signal immediately after that
acknowledgement. Normal exit has a 30-second bound. If it cannot be confirmed,
the existing termination path can take another 30 seconds and runs only as
cleanup; the operation fails instead of reporting a saved session. Both waits
remain inside the five-minute lease alongside the two-minute renewal and browser
startup. Cold-start Linux tests use this actual worker shutdown path and enforce
token rotation across successive renewals and the following daily capture. They
do not substitute the reconnect flow's different graceful-shutdown helper.

Real Chrome tests model one-hour access and twelve-hour refresh expiry across
cold starts. The former close-only behavior loses authentication after a day;
normal provider refresh at hours 6/12/18 preserves the following daily capture.
The browser suite also invokes renewal through the service's production `tsx`
entrypoint, checking valid, missing, malformed and expired session metadata in
real Chromium. Playwright's own transpiler does not cover that serialization
boundary; browser callbacks must not depend on Node-side transform helpers. This
synthetic proof must be followed by a deployed renewal event and the next
scheduled live capture without another sign-in. Account revocation, changed
provider policy or downtime beyond the refresh deadline can still need
reconnect.

Tokenfolio's hosted sign-in is recognized only on its dedicated Auth0 origin, a
recognized login/MFA route, and visible credential fields and a submit control
within the same form. Unrelated hosts, hidden forms, settings and incomplete
pages stay unsupported. This classification adds no provider request or silent
authentication contract; the retained browser and ordinary daily capture cadence
are unchanged. A hosted login that requires fresh credentials still needs the
user to reconnect.

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
authentication and repository path run inside a virtual day against in-memory
SQLite. Every SQL operation, binding and result is recorded, then replayed in
order against a fresh workerd D1 database with the same migrations and seed.
Every D1 result must match the behavior run. Original transaction boundaries are
preserved, and actual D1 metadata supplies the full-day billing totals; SQLite
never supplies estimated billing counters. Missing operations, divergent
results, failed SQL or missing billing metadata fail the gate. Transport chunks
reduce host/workerd crossings without omitting repeated polling operations. Keep
the independent ceilings below separate from scheduler constants.

| Workload                                           | HTTP requests | Web/API invocations | D1 rows read | D1 rows written |
| -------------------------------------------------- | ------------: | ------------------: | -----------: | --------------: |
| Three idle agents, measured                        |         7,225 |              14,450 |       77,165 |           1,725 |
| Three agents with successful session renewal       |         7,228 |              14,456 |       77,248 |           1,731 |
| Three agents with a renewal outage                 |         7,228 |              14,456 |       77,250 |           1,732 |
| Three agents with intermittent renewal failures    |         7,234 |              14,468 |       77,353 |           1,743 |
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
totals: about 58,000 reads and 46,000 index-inclusive writes, 564 D1 round
trips, 40 queue messages, 40 object writes and 40 source fetches. Including the
two DNS resolvers with parallel A/AAAA, the external request bound is 200. Each
DNS request has a five-second deadline; the source request has a ten-second
deadline and a 1 MiB response limit. URLs and public-address checks remain
fail-closed.

A duplicate tracked delivery writes no database rows, observations, or objects;
the 40-job replay measures 120 reads and 80 D1 round trips. A later newly
admitted check still records its own attempt. Four complete legacy outage
attempts per job (the configured three retries plus the first attempt) measured
1,920 reads and 1,600 writes, with at most 800 external requests. An empty day
makes one indexed scheduler read, at most ten scanned rows, zero writes, and no
queue call. Ceilings: busy day 150,000 reads / 50,000 writes; failure day 20,000
reads / 8,000 writes. The test asserts the queue retry config and rejects
recursive sends.

Manual and scheduled source selection now spread the batch across companies,
with at most two checks per company enforced again during atomic admission. The
120-company, 6,000-page holdout measures 72,722 D1 rows read for both selections
together (two round trips, zero writes; combined ceiling 80,000). The scheduled
share stays within the existing 150,000-row busy-day allowance; no source-fetch,
retry, queue, or object-write budget is increased. The empty 6,000-page case
retains one due-index lookup and at most ten rows read. Query plans have no
correlated subqueries.

Website search is a separate explicit user action: one provider request, no
pagination or automatic retry, at most five suggestions, a ten-second deadline
and 256 KiB response cap. It does not fetch suggested sites or run on a cadence.
Website confirmation records one scoped identity decision and registers its
homepage through the existing bounded target triggers. Read/unread actions use
one D1 round trip on change, two on an idempotent replay or conflict, at most 30
rows read and three writes including the primary-key index. Neither action
changes source polling or financial acceptance. Receipt reads use the existing
Alpha query and a primary-key join, without another repository round trip.

### Portfolio Watch progress

The owner is one foreground Portfolio Watch page observing one admitted run.
Manual and daily producers share atomic admission: at most forty checks per run,
one active check per source, a two-minute claim lease, four processing attempts,
and a fifteen-minute run deadline. Uncertain queue dispatch remains visible as
pending until completion or timeout. No heartbeat, additional cron, source-fetch
cadence change, or GET-side reconciliation is introduced.

The freshness target is completion detection within ten seconds plus request
latency while visible and healthy. One initial activity read plus ten-second
polls before the deadline is at most 90 reads per run. A manual start and a
terminal response each refresh coverage once. Requests never overlap, have a
fifteen-second network timeout, and stop on terminal status, unmount, or
deadline. Hidden tabs do not poll; focus events share the same clock. Failures
back off at 60, 120, 240, then 300 seconds, with at most six reads including the
initial request before the fifteen-minute deadline. An idle page makes one
initial read and no recurring requests for the rest of a day. An explicit page
change, refresh, or check is separately user initiated.

Both activity endpoints use the normal browser proxy and current Access
verification on every request. `GET /api/watch/activity` takes five D1 round
trips and zero writes. Its 120-company holdout stays below 5,000 rows read as
history exceeds 19,000 checks across two households, including repeated
timestamps and both ordering keys. Filling all fifty source slots for every
company creates a 6,000-source holdout: the full page reads 22,926 rows against
a 30,000-row ceiling. This full coverage read happens on entry, explicit
actions, and completion. Company search is a user-initiated activity read with a
250-millisecond debounce, a 200-character limit, cancellation of obsolete reads,
and the same fifteen-second timeout. It filters the full household before the
twenty-company page and keeps the five-round-trip, zero-write budget. Positive,
empty, literal-punctuation, paginated and unrelated-household searches run
against the 120-company, 6,000-source history holdout within the unchanged
30,000-row cap.

Recurring requests use `GET /api/watch/activity/progress?runId=…`, which reads
only the selected run's forty sources and twenty recent runs. It takes three D1
round trips, zero writes and at most 3,000 rows read, even with 6,000 sources
and the history holdout. One full active day reserves 450,000 reads, 450 D1
round trips, zero writes and 200 proxy/API invocations, including up to three
full coverage reads and 89 progress polls. The measured active case uses 263,611
rows and 180 invocations; completion is detected within ten seconds. The
existing Alpha projection is refreshed once on completion, within the existing
foreground-session allowance. Source fetches, DNS, queue deliveries and R2
writes remain in the public-source workload above and do not multiply with
browser polls.

`scripts/portfolio-watch-activity.test.ts` advances a full virtual day through
the real browser helper, web proxy, API authentication and D1. Healthy, hidden,
expired-credential and terminal cases enforce these independent ceilings and
ten-second detection. Browser tests additionally exercise the actual hook,
reload, failed reads, empty results and pagination. The former enqueue-only UI
cannot pass the completion/readback assertions. Polling full coverage instead of
progress exceeds the unchanged 450,000-read daily ceiling in the 6,000-source
holdout. No auth caching or weaker cost limit is used to accept the new
runtime-call inventory.

### Useful-work reserve

Tokenfolio's legacy Deal Snapshot inspection returns through its existing single
portfolio navigation, now without the investment ID. The caller accepts the
already closed drawer and still requires the active list and full snapshot
reconciliation. This changes one runtime navigation fingerprint with zero added
idle-day, failure-day or useful-work-day navigation, API, D1 or object
operations. The navigation and readiness waits each retain their 30-second
bound; document capture retains its 24-document, 64-MiB and 20-minute limits. No
polling, authentication, retry, lease-renewal or shared daily ceiling changes.

After document inspection, the capture also waits at most 30 seconds for the
last expected holding row to become visible and then requires the exact list
count. This local DOM readiness check runs only within an admitted capture,
including after its final document return. It adds zero browser launches,
navigations, API, D1 or object operations on idle, failure or useful-work days;
all existing scheduling, document limits and independent daily ceilings remain.

For one deployment, three agents, one bounded foreground session, three explicit
setup sessions, the daily source batch and three 120-position accepted captures,
reserve 480,000 D1 reads for agents/source work plus captures (150,000 +
150,000 + 3 × 60,000, before UI/other reads), and at most 76,000 writes (2,000 +
50,000 + 3 × 8,000). The cash allowance below adds 500,000 reads and 800 writes
across two cash-enabled deployments. Portfolio Watch progress adds the
450,000-read foreground reserve above. Reserve at least 20,000 writes and 3
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

## Browser page recovery

Module-load or render failures expose recovery as soon as the failure is known.
The owning browser tab does not reload automatically: only an explicit "Reload
Keel" action starts a fresh navigation through the existing startup and
authentication paths. Delayed portfolio failures leave the rest of the screen
and navigation available. The document also carries a recovery link before
JavaScript starts.

This adds no recurring producer, timer, sign-in probe, API call, or database
write. Across all deployments and agents, the added idle-day, failure-day and
useful-work-day background cost is zero; the existing combined allowance and
useful-work reserve are unchanged. Each deliberate reload performs the ordinary
page load, without automatic retry fanout. No agent restart is needed; existing
tabs must reload once to receive the new browser code.

`e2e/app-recovery.visual.spec.ts` drives the real browser startup path against
synthetic local D1. A virtual failure day with hourly focus, visibility and
page-show events permits one failed module attempt and zero subsequent API
requests until a deliberate reload. Failed and successful manual reloads retain
the route; login HTML and render exceptions cannot erase the recovery action.
The same recovery assertion fails on the former unguarded app.

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

## Public issuer recommendation lookup

Opening a public holding’s grouping review makes one authenticated
recommendation POST. Its owner is `D1PublicCompanyLinkRepository.recommend`;
GETs, ingestion, schedulers and background tabs do not initiate these searches.
Accepted-name matches need zero external requests. A daily key reuses completed,
empty and failed results. Atomic admission permits at most 20 external searches
per household per UTC day, including concurrent requests and failures. A changed
company revision or link does not bypass that daily search ceiling. There is no
automatic retry, timer, provider-page fetch or queue fanout. An idle day costs
zero calls and writes. A full failure or useful-search day costs at most 20
provider requests, each with a ten-second deadline and 256 KiB response bound.
The default provider is Wikidata's public entity search (no credential); an
existing optional Brave credential selects Brave. Each admission calls only one
provider once. No new paid service or quota is purchased. Cache version and
provider availability changes permit a fresh observation, while preserving the
same 20-request household ceiling.

A fresh 120-security recommendation uses six D1 round trips, at most 4,200 rows
read and eight rows written including indexes. Reopening uses four round trips
and no writes. Approval uses four round trips, at most 100 reads and 12 writes;
a duplicate approval writes nothing. A 20-search day therefore budgets at most
84,000 reads and 160 writes for the lookup work, plus normal page/auth reads and
explicit approval requests. The search is not admitted again when its result is
pending or unavailable; the UI exposes the observed state and manual correction.

The protected release smoke also calls the configured issuer provider with a
fixed synthetic canary query from the deployed Worker. It does not read or write
holdings or recommendations. The smoke requires a validated provider response
(empty results are valid) and fails closed on missing/malformed or failed
responses. This adds at most one provider request per smoke attempt, at most
three during the existing version-propagation retry budget, and zero idle calls.
Live review verification remains necessary to prove a particular recommendation.
