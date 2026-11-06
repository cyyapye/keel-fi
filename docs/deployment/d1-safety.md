# D1 migration and capacity safety

`make d1-migration-check` is required by local checks and the native source
quality flow. It rejects changed applied SQL, unregistered migration sequences
and unimplemented migration registrations. The native unit flow also runs
populated migration cases. Empty migration replay remains necessary and
separate.

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

Historical upgrade costs retain both 12 and 24 captures. The applied-schema
baseline uses 24 captures, which retains the complete record families and
conservative per-table envelope of the former two-baseline proof.

The immutable 0089 regression demonstrates the failure class. At 12 captures,
its snapshot DROP reads 5,864,077 rows. Installing missing inbound child-key
indexes before the rebuild reduces that DROP to 11,207 reads. These are local
synthetic counters, not production measurements.

The indexed correction remains test-only. Permanent indexes increased existing
capture and participation write costs beyond their unchanged limits. Installing
them after already-applied 0089 would not protect that earlier rebuild. Applied
SQL remains byte-identical, and populated frontiers before 0089 with 0089
pending are refused.

The distribution-review upgrade starts at applied 0089 and runs
`0090_distribution_reviews.sql`. Its six trigger DDL statements change no table
data. Both 12- and 24-capture profiles measure 1,891 D1 rows read and four rows
written, within the 2,000-read and 100-write envelope. The proof preserves all
137 tables and 691 prior schema objects, including unknown manual distribution
totals. The terminal baseline has 693 schema objects, no foreign-key violations
and passing immutable-record probes. Destructive-table foreign-key plans do not
apply to this trigger-only upgrade. The earlier 0089 regression remains a
separate historical test.

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

The complete native gate regenerates the proof on its exact checked-out
revision. Optional artifact downloads are not required. The synthetic receipt is
not a bound on an unknown target database and cannot authorize remote
maintenance by itself.

## Deferred quota activation

Shared account admission, the R2 ledger, release and backup integration, and
quota-aware runtime clients remain in
[draft PR #340](https://github.com/cyyapye/keel-fi/pull/340). This CI change
preserves the existing deployment, backup and sync paths. It proves migration
costs and preservation without claiming account-wide runtime capacity
enforcement or live target admission.

The deferred owner needs verified common-object access, conservative current-day
usage, measured target footprint and operation bounds, and durable queue
handling before activation. Missing configuration must not be filled with
invented zero usage or a guessed allowance. An uncertain operation must not be
automatically retried or refunded. These remain requirements for that future
activation, rather than additional secrets required by the existing release.
