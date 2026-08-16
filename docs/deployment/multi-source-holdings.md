# Multi-source holdings canonical foundation

Migration `0019_multi_source_holdings_contract.sql` defines Keel's only
connection, ownership-container, import-coverage, and exposure relationship
contract. Migration `0020_container_scoped_holding_ingestion.sql` makes the
Robinhood and AngelList writers populate that contract directly. Migration
`0021_canonical_exposure_resolution.sql` carries only protected,
checksum-validated public identifiers into that contract and enforces the
direct-allocation boundary. None of these migrations authorizes another provider
or changes the reviewed value in a Portfolio Baseline, plan, goal, or forecast.

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
- A public canonical exposure is shared across connections only through a
  checksum-valid CUSIP, ISIN, or SEDOL protected with the deployment identity
  key. A ticker, provider security ID, or display label may still help identify
  a position but cannot create a canonical exposure.
- A private-company exposure resolves to an existing reviewed company record.
  Fund and unresolved identities require recorded review evidence. Exposure
  identity never replaces the connection, container, or legal position.
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

## Direct-ingestion boundary

- There is no holdings backfill migration, compatibility view, association
  trigger, runtime read-source flag, or dual repository path.
- Robinhood creates one canonical `plaid-investments` connection per protected
  Item identity. Every sync run and webhook delivery records that exact
  connection even if the operational connector is later reauthorized.
- AngelList uses one protected household export connection. Its ownership labels
  become protected trust or entity containers; every parsed row is scoped to one
  of those containers before matching.
- Every import records its connection and container coverage in the same D1
  batch as its rows. A row cannot be stored without declared coverage for its
  container, and an unresolved container cannot claim complete coverage.
- A complete covered container may contain zero rows. `partial`, `unavailable`,
  `malformed`, `failed`, and `ambiguous` coverage remain explicit and cannot
  support an omission exception.
- Position matching uses the pair of container ID and protected position key.
  Only a prior FI-planning position in a complete container covered by that
  exact import may receive `position_not_reported`; its accepted value remains
  unchanged. Missing cryptocurrency remains outside the active FI exception
  path.
- Reconnects with the same protected Item reuse the canonical connection and
  append state. A changed Item receives a distinct connection; the prior
  connection becomes disconnected. Disconnect revokes future retrieval and the
  credential reference while retaining accepted holdings and baselines.
- Any synthetic environment that applied the removed transition experiment must
  be rebuilt from the checked-in migration chain before it can provide release
  evidence. Applying only later migrations to that database is not proof of the
  canonical schema.
- The rebuild is authorized only while every retained value is fabricated and
  disposable. Before any environment is allowed to retain real user data, this
  exception ends. Deployed migrations then become forward-only, database resets
  require incident or recovery authorization, and accepted history remains
  append-only.
- Applying an accepted Robinhood row with a validated strong identifier creates
  or reuses one household-level public exposure and records a full direct
  mapping under the deterministic policy. Reapplying the same decision is a
  no-op. Missing or invalid strong identifiers leave the position unmapped.
- Direct mappings carry exactly 1,000,000 ppm. Look-through mappings may carry a
  reviewed allocation or `NULL` when only the relationship is known. Current
  known allocations for one position cannot exceed 1,000,000 ppm; corrections
  append a superseding version.
- Exposure totals read only current accepted mappings and accepted position
  snapshots. A relationship with unknown allocation contributes no monetary
  value to an exposure total, while the position retains its full unallocated
  value.

## Cost and activation gate

Canonical exposure resolution adds no network call, R2 object, Queue message,
schedule, webhook, or paid provider product. It reuses the shipped Robinhood and
AngelList paths. Its only incremental cost is bounded D1 storage and backup
volume for two nullable import-row fields, canonical exposure rows, and
append-only mapping versions.

For a deployment with `C` connections, `O` ownership containers, `P` accepted
positions, `I` imports, `R` import rows, `E` canonical exposures, and `M`
accepted exposure-mapping versions, the initial upper-bound row growth is:

- `C` connection identities plus one connection-state version per connection;
- one operational connector-link version per authorization or changed Item, one
  connection association per sync run, and one per accepted webhook delivery;
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

Before accepting the M9.4 release:

1. Replay migrations `0001` through `0021_canonical_exposure_resolution.sql` and
   apply the synthetic seed.
2. Verify checksum-valid CUSIP, ISIN, and SEDOL handling, cross-connection key
   stability, and fail-closed ticker-only or invalid-identifier behavior.
3. Verify three synthetic NVDA positions remain distinct while aggregating to
   one exposure, and two reviewed Anthropic SPVs remain distinct while
   aggregating to one company exposure.
4. Verify a multi-company SPV with unknown allocations shows both relationships,
   contributes zero duplicated value, and retains its full value at the legal
   position.
5. Verify append-only correction chains, full direct allocations, the
   1,000,000-ppm sum ceiling, deterministic retry behavior, and household
   isolation at both the domain and D1 boundaries.
6. Verify raw Item, account, security, and position identifiers remain outside
   D1, API responses, logs, screenshots, and repository artifacts.
7. Run `make verify`, reviewed PR checks, exact-head merge verification, and the
   exact-SHA protected preview workflow before marking M9.4 complete.

Provider-neutral connection writes and additional-institution authorization
remain later ordered M9 slices.
