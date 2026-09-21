# CI performance contract

Each ordinary workflow executes the complete native suite once for its exact
revision. The full requirement map, individual case accounting, expected
platform exclusions, native assertions and no-flaky-success policy remain
authoritative. PR merge candidates and merged commits require separate
execution. Named receipt checks are validation of the native producer, not
independent test runs.

## Baseline and budgets

The September 21 UTC baseline is PR run `35548798219` plus pilot run
`35548798262`: ordinary PR checks took 96.1 minutes elapsed, including a
separate 47.9-minute pilot using the same runner. The pilot's required execution
step took 46.0 minutes; ordinary quality and browser jobs took 26.9 and 19.5
minutes. Dependency setup was approximately 16 seconds per job. These are
observations, not fixed machine benchmarks; compare active execution separately
from waiting.

`.tugling/pilot.json` enforces a 3,000-second active native budget. The complete
receipt records each flow duration and a sorted timing summary. Exceeding that
budget fails required verification without silently dropping checks. Watchdogs
remain independent safety ceilings. Do not raise the budget to hide a
regression.

Use Actions job creation/start/completion timestamps to measure queue and setup
time separately. Compare complete successful workflows at the same coverage; do
not count cancelled or filtered runs as speed improvements. Desired future
service targets are p95 queue under two minutes and p95 PR completion under 15
minutes. This first deduplication change does not establish those targets.

## Capacity and further reductions

One `keel-ci` runner currently serializes verification. Adding YAML jobs alone
does not add capacity. The host also serves other workloads; measure peak CPU,
memory, I/O and queue pressure before adding runners or increasing worker
counts. Keep the credential-bearing deployment account separate.

Prioritize the real D1 cost fixtures and browser tests using measured receipt
and native-report timings. Preserve the full-day provider scenarios and real D1
cost assertions. Browser tests share mutable state today: sharding requires
independent D1 directories, servers, ports and cleanup. Do not increase
Playwright workers until that isolation is proven. Prefer bounded parallelism to
an unbounded matrix.

## Test layers

Use unit tests for pure scheduling and decision rules, fast SQLite integration
for SQL-backed behavior, and real D1 for billing counters, index maintenance,
migration compatibility and scale holdouts. SQLite changed-row counts cannot
stand in for D1 billed writes. Keep browser coverage for actual user workflows
and Worker runtime boundaries, without repeating every decision permutation.

The provider full-day gate runs all five scenarios through the production
client, web proxy, API, authentication and repositories using in-memory SQLite.
It records every SQL operation, binding, result and atomic batch, then replays
the complete trace inside workerd. Every D1 result must match. The original
HTTP, Worker invocation, round-trip and actual D1 billing ceilings still apply;
no averages, sampled requests or shorter virtual days replace them. The replay
fixture rejects unsupported metadata-dependent behavior rather than supplying
fake D1 metadata. Required browser tests continue to cover Worker HTTP behavior.

`scripts/sql-replay.test.ts` checks result divergence, missing operations,
missing metadata, transaction rollback, setup exclusion and real index-write
billing. A negative-control experiment restoring one-minute heartbeat writes
rejected 8,637 billed writes against the unchanged 2,000-write ceiling. The
fixed idle day reads 77,165 rows and writes 1,725, matching the previous harness
exactly. All five scenarios retained their previous measured billing totals.

On the same local macOS checkout, the old idle case took 33.6 seconds and replay
took 13.3 seconds. The complete five-scenario replay suite took 57.4 seconds.
These local measurements do not establish OVH timings or the 15-minute target.
Use the native timing receipt and Vitest artifact for the eventual OVH
comparison.

The 120-position baseline holdout retains one actual review transition and
directly seeds the other 118 historical reviews using schema-validated states
and normal database triggers. All history, unrelated-household, retained
exception, query-plan and read/write ceilings remain. Review workflow and
stale-evidence behavior remain covered by their dedicated integration tests.

## Failure and recovery

Native CI uses loopback ports 31000/31001, outside local development ranges and
OVH's Linux ephemeral range (32768-60999). A preflight checks both availability
and the live kernel range before expensive verification. This avoids automatic
outbound-port allocation colliding with browser startup after the unit suite; it
does not reserve ports against unrelated explicit listeners. The browser server
still fails closed on a later conflict and never reuses another server. Keep one
native job per dedicated runner and do not kill an unknown port owner.

Receipt consumers require the producer's success, the exact artifact name from
the current run, and matching project/config/map/helper/environment/run/attempt
identities. Missing, failed, partial, expired or stale evidence fails closed.
Rerun the entire workflow: rerunning only a consumer in a new attempt correctly
rejects evidence from the previous attempt. Receipt artifacts expire after seven
days; learning ledgers and provider data are never uploaded.

Receipt jobs skip cancelled workflows so obsolete runs release their concurrency
slot instead of waiting for the shared runner. A failed native producer still
runs the receipt jobs, which reject its unsuccessful result before downloading.

The manual candidate workflow retains the synthetic polling-regression rejection
experiment. Post-merge native verification, secret scanning, pinned released
adapter validation, protected backup/migration/deployment and smoke checks
remain required before claiming preview delivery.
