# Multi-source holdings canonical foundation

Migration `0019_multi_source_holdings_contract.sql` defines Keel's only
connection, ownership-container, import-coverage, and exposure relationship
contract. It does not authorize another provider or change the reviewed value in
a Portfolio Baseline, plan, goal, or forecast.

Keel has no live user data. A short-lived synthetic transition experiment was
removed instead of becoming a permanent backfill and dual-read surface. The next
holding ingestion migration must write this canonical contract directly.

## Identity and storage boundary

- An investment connection is identified by household, adapter type, and a
  64-character HMAC-derived source key. Institution keys and labels are
  versioned metadata, never identity.
- An ownership container is identified inside one connection by a 64-character
  HMAC-derived account key. Account labels, masks, and tax-wrapper text cannot
  merge containers.
- A position association is unique to one container and a protected position
  key. `provider_provenance`, `reviewed_import`, and `manual` are the supported
  association bases.
- `unresolved` is a current, reviewable container state for observations whose
  identity is ambiguous. It is not permission to reconstruct missing identifiers
  from labels or opaque fingerprints, and it cannot support omission inference.
- Raw Item IDs, provider account or position IDs, account numbers, access
  tokens, and credentials do not enter D1, logs, browser responses, screenshots,
  or test artifacts. D1 may retain only a private-storage object reference.
- Connection and container metadata, accepted ownership associations, import
  scope, coverage, canonical exposures, and exposure mappings are append-only.
  Corrections use a version or supersession record.
- `holding_positions` and accepted position snapshots are authoritative for
  money. Relationship and exposure records cannot create, duplicate, or alter
  Portfolio Baseline value.

## Pre-live cutover boundary

- There is no holdings backfill migration, compatibility view, association
  trigger, runtime read-source flag, or dual repository path.
- Current canonical relationship tables may remain empty until M9.3. An upgraded
  writer must create its connection, container, coverage, and position
  association directly in the reviewed ingestion flow; it cannot rely on a later
  reconstruction pass.
- Any synthetic environment that applied the removed transition experiment must
  be rebuilt from the checked-in migration chain before it can provide release
  evidence. Applying only later migrations to that database is not proof of the
  canonical schema.
- The rebuild is authorized only while every retained value is fabricated and
  disposable. Before any environment is allowed to retain real user data, this
  exception ends. Deployed migrations then become forward-only, database resets
  require incident or recovery authorization, and accepted history remains
  append-only.

## Cost and activation gate

The canonical foundation adds no network call, R2 object, Queue message,
schedule, webhook, or paid provider product. Its only incremental cost is D1
storage and backup volume for rows that later M9 slices explicitly create.

For a deployment with `C` connections, `O` ownership containers, `P` accepted
positions, `I` imports, `R` import rows, `E` canonical exposures, and `M`
accepted exposure-mapping versions, the initial upper-bound row growth is:

- `C` connection identities plus one connection-state version per connection;
- `O` container identities plus one metadata version per container;
- at most `P` position/container associations;
- at most `I` import/connection associations, `R` row/container associations,
  and `I × O` coverage rows when every import covers every container; and
- `E` exposure identities plus `M` append-only mapping versions.

No real additional institution may be enabled until the private deployment
records and approves all of the following for the exact provider contract and
institution variant:

1. Investments coverage and account/container coverage behavior;
2. Item and product pricing, including any refresh or reconnect charge;
3. expected webhook and user-triggered request volume;
4. expected D1 row and backup growth under the retention policy;
5. the incremental monthly cost ceiling and owner; and
6. rollback by disabling new authorization and writes while preserving accepted
   history.

M9.1 through M9.6 use synthetic provider data and therefore have zero approved
incremental provider spend.

## Verification

Before accepting the M9.2 replacement release:

1. Confirm the migration directory ends at
   `0019_multi_source_holdings_contract.sql`; the next direct ingestion slice
   owns the next migration number.
2. Replay every migration against an empty database, apply the synthetic seed,
   and verify household, protected-key, uniqueness, append-only, supersession,
   and allocation-parts-per-million invariants.
3. Verify the schema contains no holdings transition view or trigger and rejects
   the removed migration-only association value.
4. Verify Holdings and Portfolio Baseline repositories read `holding_positions`
   directly and expose no read-source configuration.
5. Run a bounded source, schema, migration, and deployment-config scan for the
   removed holdings transition symbols.
6. Run `make verify`, reviewed PR checks, and exact-head merge verification.
7. Rebuild the synthetic preview D1 from the checked-in migrations, deploy the
   exact merge SHA, and require the protected smoke workflow to prove that SHA
   before marking M9.2 complete.

Container-scoped ingestion, canonical exposure resolution, provider-neutral
connection writes, and additional-institution authorization remain later ordered
M9 slices.
