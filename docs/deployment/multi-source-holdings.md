# Multi-source holdings foundation

Migration `0019_multi_source_holdings_contract.sql` adds the M9.1 persistence
contract for multiple investment institutions and ownership containers. It is an
additive, synthetic-only foundation. It does not authorize another provider,
change the shipped Robinhood or AngelList paths, associate legacy positions, or
alter a Portfolio Baseline, plan, goal, or forecast.

## Identity and storage boundary

- An investment connection is identified by household, adapter type, and a
  64-character HMAC-derived source key. Institution keys and labels are
  versioned metadata, never identity.
- An ownership container is identified inside one connection by a 64-character
  HMAC-derived account key. Account labels, masks, and tax-wrapper text cannot
  merge containers.
- A position association is unique to one container and a protected position
  key. Existing immutable positions are not rewritten.
- Raw Item IDs, provider account or position IDs, account numbers, access
  tokens, and credentials do not enter D1, logs, browser responses, screenshots,
  or test artifacts. D1 may retain only a private-storage object reference.
- Connection and container metadata, accepted ownership associations, import
  scope, coverage, canonical exposures, and exposure mappings are append-only.
  Corrections use a version or supersession record.

## Cost and activation gate

M9.1 adds no network call, R2 object, Queue message, schedule, webhook, or paid
provider product. Its only incremental cost is D1 storage and backup volume for
rows that later M9 slices explicitly create.

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

Before release:

1. Replay all migrations from an empty database and apply the synthetic seed.
2. Apply migration 0019 forward to an already seeded migration-0018 database.
3. Compare holdings, accepted snapshots, Portfolio Baselines, goals, cash-flow
   plans, and forecast snapshots before and after the forward migration.
4. Verify every new table starts empty and contributes no planning value.
5. Run the household-integrity, protected-key, uniqueness, append-only,
   supersession, and allocation-parts-per-million tests.
6. Run `make verify`, reviewed PR checks, and the exact-SHA post-merge workflow.

Legacy association, container-scoped ingestion, canonical exposure resolution,
provider-neutral connection writes, and additional-institution authorization
remain later ordered M9 slices.
