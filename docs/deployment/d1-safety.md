# D1 migration and capacity safety

`make d1-migration-check` is required by local checks and the native source
quality flow. It rejects changed applied SQL, unregistered migration sequences
and raw maintenance workflow bypasses. The native unit flow also runs populated
migration cases. Empty migration replay remains necessary and separate.

## Populated upgrade evidence

`scripts/populated-migration-d1-cost.test.ts` verifies old-schema upgrade
regressions and the current applied schema. Migration cases populate the OLD
schema before measuring actual local D1 metadata from the first pending
statement. Measurement includes preparation, cleanup and index-maintenance
writes. Fixtures have 120 main holdings, 120 unrelated holdings, 12/24 captures,
accepted reviews, baseline items and a manual submission. Checks cover old table
hashes, schema objects, foreign keys, immutable guards and positive/empty
inbound-FK plans. Physical `integrity_check` is unsupported in local D1 and
reported as unavailable.

The immutable 0089 regression demonstrates the failure class. At 12 captures,
its snapshot DROP reads 5,864,077 rows. Installing missing inbound child-key
indexes before the rebuild reduces that DROP to 11,207 reads. These are local
synthetic counters, not production measurements.

This change adds no production DDL. The indexed correction remains test-only.
Permanent indexes increased existing capture and participation write costs
beyond their unchanged limits. Installing them after already-applied 0089 would
not protect that earlier rebuild. Applied SQL remains byte-identical, and
populated frontiers before 0089 with 0089 pending are refused.

`.tugling/d1-migrations.json` binds ordered SQL hashes, the current baseline and
reviewed upgrade cases. Receipts bind Git SHA, fixture/tool sources, history
profiles, complete table counts and preservation. Baseline evidence explicitly
has no pending SQL and no migration measurement. It records existing indexed and
scan plans without claiming that unindexed foreign keys were repaired. Upgrade
evidence separately requires actual complete-sequence counters and applicable
pre-destructive FK plans. A baseline cannot authorize pending SQL.

A registry entry alone does not implement a new frontier. The canonical runner
must support its OLD-schema workload and terminal baseline before emitting a
receipt. Unknown, stale, future, mismatched or incomplete evidence fails
admission. Future migrations own their necessary preparation and cleanup in the
certified ordered SQL. They must preserve data, required constraints and the
accepted steady-state read/write budgets. A separate writer barrier or recovery
protocol needs a concrete design rather than implicit receipt authorization.

Both maintenance workflows regenerate the receipt on their exact checked-out
revision before remote work. Optional artifact downloads are not required. The
synthetic receipt is not a bound on an unknown target database. Maintenance also
needs a fresh complete target footprint upper bound within the measured profile
and a reviewed export cost/size envelope.

## Shared account owner

`packages/database/src/d1-capacity.ts` owns one ledger outside D1. Worker R2 and
Node S3 conditional-write adapters use the same fixed mutable
`operations/d1-capacity/<name>.json` object. Full operation bounds are charged
before execution. Actual counters provide attribution and overrun detection;
success, failure and uncertainty never automatically refund capacity. Unknown
maintenance outcomes block another maintenance attempt until reviewed positive
reconciliation. Ledger deletion and timeouts are not reconciliation.

The declared policy preserves three million reads and 20,000 writes for
essential authentication and interactive work. Governed producers share the
remaining allowance and cumulative producer ceilings. Every runtime ingress is
explicitly classified; missing or stale route classifications fail coverage.
Pure user GETs do not access the ledger, and authentication stays current. This
protects declared headroom. Unbounded human traffic and unknown external
administrators are not a proven account-wide hard cap.

An operation has an immutable creation time and finite execution/replay window.
Expired identical requests cannot start. Completed entries can compact after
that window without refunding daily totals. Running and unknown work remains a
liability across midnight. Rollover requires an explicitly published allowance;
callers cannot recreate missing state or initialize usage to zero. Structural
and daily limits deny further admission.

The ledger contains hashes, producer identities, times and integer costs. It
contains no SQL, financial records, documents, provider payloads or signed URLs.
The fixed key sits outside immutable backup/release prefixes, adds no retention
rule and counts toward its bucket's existing inventory bound.

## Maintenance owner

`scripts/d1-maintenance.ts release` owns admission through retained release
evidence. The private backup job enters the same owner as `daily-backup`.
Admission precedes frontier reads and export. Its complete plan covers export,
pending migration and every existing smoke/readiness attempt. Actual frontier
mismatch stops before export. Backup encryption, round-trip comparison and
private retained read-back still precede migration.

Export has at most 12 polling requests and one bounded download. Failed exports
are not automatically restarted. Raw responses and signed URLs are not printed.
Export billing counters remain unavailable; maintenance records that fact and
retains its full conservative charge. Subprocess output and duration are bounded
and private. Timeout means an uncertain outcome.

Deployment smoke also needs runtime admission on the same account owner. This
intentionally adds a conservative second charge so old smoke credentials cannot
bypass admission. The publisher must budget that extra charge. The whole-plan
reservation does not guarantee later server admission; denied smokes leave the
release incomplete.

## Activation requirements

Activation requires verified existing resources and separate operator
configuration. Missing configuration blocks nonessential runtime work and remote
maintenance. Code installation alone does not establish operational readiness.

Activation needs separately verified evidence for these facts:

1. Every Worker, release and daily backup has authorized conditional-write
   access to the same existing account object. Matching strings alone prove
   neither common access nor exclusive ownership. The daily document-source
   principal remains read-only. Helpers never widen it.
2. An authorized publisher supplies reviewed operation bounds, cumulative
   limits, source identities, complete account inventory and current-day
   allowances. Midday bootstrap needs a conservative prior-usage upper bound.
   Runtime gets no analytics credential. Sampled/delayed totals without a
   defensible uncertainty bound are unknown capacity.
3. Maintenance has fresh complete usage and target-footprint evidence, a
   reviewed export bound and an exact revision/frontier migration receipt.
   `KEEL_D1_MAINTENANCE_PLAN` follows `MaintenancePlanSchema`; its digest must
   match the authenticated published producer policy. It binds this run, attempt
   and original operation time. `KEEL_D1_QUOTA_R2_CONFIG` and
   `KEEL_D1_QUOTA_KEY` identify existing authorized Node access. This change
   does not provision those private values.
4. Queue work has a reviewed durable deferral path preserving payloads,
   retention and business deadlines through a quota pause. Remote queue
   activation remains blocked. Existing finite retry/DLQ handling remains;
   denial is never success. Free retention alone does not prove an aged message
   survives a reset pause.
5. Published cadence/cost policies fit aggregate R2 requests, storage and CPU,
   including contention, denials and failed settlement. Native adapters and
   virtual-day models prove bounded behavior, not an unconfigured production
   workload's price or freshness.

Known daily exhaustion returns temporary service unavailability and a reset
pause rather than invalid authentication. Generic outages invent no reset time.
Web and agent pollers preserve deadlines and pause together. Financial drafts
remain intact, and uncertain financial saves are never automatically replayed.

The maintained authoring entry point is
[keel-d1-safety](../../.codex/skills/keel-d1-safety/SKILL.md). Guidance and
enforced verification are separate layers. Neither promises every future quota
incident is impossible.
