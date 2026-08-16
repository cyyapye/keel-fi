# Multi-source holdings compatibility

Migration `0019_multi_source_holdings_contract.sql` adds the M9.1 persistence
contract for multiple investment institutions and ownership containers.
Migration `0020_legacy_holding_associations.sql` adds the M9.2 compatibility
layer. It associates shipped Robinhood and AngelList positions without changing
their IDs, snapshots, reviews, Portfolio Baselines, plans, goals, or forecasts.
Neither migration authorizes another provider or changes the shipped ingestion
and review paths.

## Identity and storage boundary

- An investment connection is identified by household, adapter type, and a
  64-character HMAC-derived source key. Institution keys and labels are
  versioned metadata, never identity.
- An ownership container is identified inside one connection by a 64-character
  HMAC-derived account key. Account labels, masks, and tax-wrapper text cannot
  merge containers.
- Legacy records are the bounded exception: they did not retain a protected
  provider account ID. Migration 0020 uses the already opaque position
  fingerprint as a per-position migration surrogate and marks the container
  `unresolved`. The surrogate cannot be interpreted as an account identity or
  used for omission inference.
- A position association is unique to one container and a protected position
  key. Existing immutable positions are not rewritten.
- Raw Item IDs, provider account or position IDs, account numbers, access
  tokens, and credentials do not enter D1, logs, browser responses, screenshots,
  or test artifacts. D1 may retain only a private-storage object reference.
- Connection and container metadata, accepted ownership associations, import
  scope, coverage, canonical exposures, and exposure mappings are append-only.
  Corrections use a version or supersession record.

## Legacy association boundary

- A Robinhood position is linked to a canonical connection only when its
  accepted import applications trace to exactly one retained `plaid-investments`
  sync connection with a protected Item key. Zero or several candidate
  connections produce an unresolved legacy connection instead.
- Legacy Robinhood rows contain an account label and an opaque position
  fingerprint, not a recoverable account key. Every position therefore remains
  in its own unresolved container until a reviewed resolution or a complete new
  sync supplies protected account identity.
- Reviewed AngelList owner and investment-entity labels remain display
  provenance. They do not merge two SPV interests or create account identity;
  every legal position remains distinct in an unresolved container.
- Migration 0020 records no import coverage. All legacy containers expose
  `omission_eligible = 0`, so they cannot support a `not reported` conclusion.
- `holding_position_compatibility` returns exactly one canonical association per
  legacy position. It contains no money. Holdings and Portfolio Baseline reads
  still select values only from the existing append-only position snapshots.
- `MULTI_SOURCE_HOLDINGS_COMPATIBILITY_READS=true` enables the compatibility
  view. Setting it to `false` or omitting it reverts reads to
  `holding_positions` without deleting accepted associations.

## Cost and activation gate

M9.1 and M9.2 add no network call, R2 object, Queue message, schedule, webhook,
or paid provider product. Their only incremental cost is D1 storage and backup
volume.

For a deployment with `C` connections, `O` ownership containers, `P` accepted
positions, `I` imports, `R` import rows, `E` canonical exposures, and `M`
accepted exposure-mapping versions, the initial upper-bound row growth is:

- `C` connection identities plus one connection-state version per connection;
- `O` container identities plus one metadata version per container;
- at most `P` position/container associations;
- at most `I` import/connection associations, `R` row/container associations,
  and `I × O` coverage rows when every import covers every container; and
- `E` exposure identities plus `M` append-only mapping versions.

For `P_legacy` shipped Robinhood and AngelList positions, M9.2 adds exactly one
container identity, one container version, and one accepted ownership row per
position. It also adds at most one AngelList legacy connection per household,
one unresolved Robinhood connection per household when needed, and one
connection identity per uniquely proven retained Robinhood Item. SQL views add
no rows. The compatibility flag changes only the read source and adds no
infrastructure.

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

Before the M9.2 release:

1. Replay all migrations from an empty database and apply the synthetic seed.
2. Apply migration 0020 forward to a migration-0019 database containing accepted
   synthetic Robinhood and AngelList positions.
3. Compare position IDs, latest snapshots, public/private totals, unknown
   counts, Portfolio Baselines, FI plans, goals, forecast snapshots, and
   versions before and after migration. Every value and reference must match.
4. Verify zero orphaned supported positions, zero multiply assigned positions,
   zero household mismatches, and zero coverage rows.
5. Verify a uniquely proven Robinhood Item is retained, ambiguous provenance is
   unresolved, two same-owner AngelList SPVs remain two positions, and every
   legacy container is ineligible for omission inference.
6. Compare compatibility-enabled and compatibility-disabled Holdings and
   Portfolio Baseline repository output byte-for-byte at the object boundary.
7. Stage and accept a synthetic legacy import after migration and confirm the
   additive trigger creates one unresolved association in the same transaction.
8. Run `make verify`, reviewed PR checks, and the exact-SHA post-merge workflow.

Container-scoped ingestion, canonical exposure resolution, provider-neutral
connection writes, and additional-institution authorization remain later ordered
M9 slices.
