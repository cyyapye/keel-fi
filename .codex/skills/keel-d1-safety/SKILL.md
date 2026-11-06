---
name: keel-d1-safety
description:
  Author or review Keel D1 schema migrations, database maintenance, quota
  admission, and recurring database producers. Use when changing migration SQL,
  backup or release database work, D1 cost evidence, or account capacity
  controls.
---

# Keel D1 safety

Treat a populated schema upgrade as a workload. An empty migration replay or a
query test seeded after migration does not establish its cost.

## Before changing SQL

1. Read root `AGENTS.md`, `docs/engineering/recurring-work-budgets.md`, and the
   affected schema, foreign keys, views and triggers. For release work also read
   `.github/workflows/README.md` and `docs/deployment/backup-and-recovery.md`.
2. Establish the exact old schema frontier and ordered pending migrations.
   Preserve already applied migration bytes. A later index migration cannot
   protect an earlier table rebuild. Refuse an uncertified upgrade frontier.
3. Inspect inbound foreign keys for every rebuilt or deleted parent. Check
   usable leading child-key indexes and query plans. Deferred constraints do not
   disable foreign-key work during SQLite's implicit DELETE for DROP.

## Prove the populated upgrade

Use `make d1-migration-check` and the registered real-D1 cost cases in
`.tugling/d1-migrations.json`. Register new SQL with a representative fixture,
old frontier, complete ordered pending set, explicit limits and preservation
assertions. Missing evidence must fail the command rather than count as a skip.
Start with `scripts/test-support/populated-migration.ts` and
`scripts/populated-migration-d1-cost.test.ts`. Implement support for the new
frontier in the fixture and canonical runner. Adding a registry entry or running
a separate one-off probe cannot substitute for that support.

Baseline evidence covers the unchanged applied schema with no pending SQL. It
has no migration measurement and cannot authorize a new migration. Future SQL
needs its implemented OLD-schema workload and terminal baseline. Keep necessary
index preparation and cleanup in the certified migration sequence. Repeat the
affected steady-state write budgets before making indexes permanent.

Attach actual D1 `rows_read` and `rows_written` measurement before the first
pending statement, including preparatory index creation and index maintenance.
Populate the OLD schema first. Include at least 120 items where supported,
repeated historical observations per item, positive and empty child matches, and
unrelated households. Grow history independently of returned items.

Check all prior table data or explicitly specified transformations, schema
objects, foreign keys and append-only guards after the upgrade. Preserve
nonempty review, baseline and evidence chains. Report unsupported integrity
checks as unavailable. Never substitute SQLite timing, returned row counts or
mock metadata for actual D1 billing counters.

The synthetic regression is not a bound on an unknown target database. Fresh
target footprint evidence and a reviewed export bound belong to operational
admission. The standalone CI proof does not provide that authority.

Run the focused registered cases and then required repository verification.
Include new native case identities without removing existing cases, changing
exclusions or relaxing the verification deadline to obtain a pass.

## Design quota activation

Shared quota enforcement and its release, backup and client integration remain
in draft PR #340. The CI split adds migration proof while preserving the
existing deployed paths. Apply the following requirements before activating that
deferred owner.

Capacity permission must precede the first remote D1 operation, including backup
export and frontier inspection. Cover export, migration, smoke checks and every
allowed retry in one conservative envelope. Independent maintenance owners and
runtime producers must share a durable account capacity authority that still
works when D1 is exhausted. GitHub concurrency groups and per-request limits
alone do not reserve shared daily capacity.

Bind admission to the account and database, UTC window, exact source and
migration frontier, cost evidence and attempt identity. Unknown, stale,
mismatched or sampled usage without a conservative bound must deny admission.
Lost responses and process death do not prove capacity was unused. Do not refund
uncertain work or retry an uncertain write automatically.

Protect interactive headroom with cumulative producer budgets. Preserve current
authentication and projection-only GETs. Quota exhaustion is temporary service
unavailability, not invalid credentials. Clients must honor the quota pause
without reconnect loops or automatic save replay.

Keep common-owner credentials, usage publication and bootstrap requirements
explicit. Missing configuration blocks activation. Do not create resources,
expand credentials, change billing or bypass mandatory backups to enable a gate.

## Handoff evidence

Report the exact revision, registered frontier and workload, measured reads and
writes, integrity outcomes, native verification and activation prerequisites.
Keep local, CI, admission, deployment and production evidence distinct. Use
synthetic data only. Do not put account identifiers, financial records, private
URLs, signed export links or credentials in committed evidence.
