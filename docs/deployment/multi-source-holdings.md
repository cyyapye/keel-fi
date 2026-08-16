# Multi-source investment holdings

Migration `0019_multi_source_holdings_contract.sql` defines Keel's only
connection, ownership-container, import-coverage, and exposure relationship
contract. Migration `0020_container_scoped_holding_ingestion.sql` makes the
Plaid Investments and AngelList writers populate that contract directly.
Migration `0021_canonical_exposure_resolution.sql` carries only protected,
checksum-validated public identifiers into that contract and enforces the
direct-allocation boundary. Migration `0022_provider_neutral_investments.sql`
cuts the institution-enumerated public provider value over to
`plaid_investments`, preserves existing position and baseline identities, and
replaces the Robinhood-only integrity checks. Migration
`0023_authoritative_portfolio_baselines.sql` makes every newly confirmed
Portfolio Baseline item reference the exact position and snapshot accepted by a
review decision. It adds no data rewrite. None of these migrations authorizes
another live institution or changes the reviewed value in a Portfolio Baseline,
plan, goal, or forecast.

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
- Plaid Investments creates one canonical `plaid-investments` connection per
  protected Item identity. A household may retain several Items, including two
  Items with the same institution label. Every sync run and webhook delivery
  records one exact connection even if its operational credential is later
  reauthorized.
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
  append state. A different Item receives a distinct connection without
  replacing or disconnecting another Item. Disconnect revokes future retrieval
  and the credential reference for only the selected connection while retaining
  accepted holdings, other connections, and baselines.
- Any synthetic environment that applied the removed transition experiment must
  be rebuilt from the checked-in migration chain before it can provide release
  evidence. Applying only later migrations to that database is not proof of the
  canonical schema.
- The rebuild is authorized only while every retained value is fabricated and
  disposable. Before any environment is allowed to retain real user data, this
  exception ends. Deployed migrations then become forward-only, database resets
  require incident or recovery authorization, and accepted history remains
  append-only.
- Applying an accepted Plaid Investments row with a validated strong identifier
  creates or reuses one household-level public exposure and records a full
  direct mapping under the deterministic policy. Reapplying the same decision is
  a no-op. Missing or invalid strong identifiers leave the position unmapped.
- Direct mappings carry exactly 1,000,000 ppm. Look-through mappings may carry a
  reviewed allocation or `NULL` when only the relationship is known. Current
  known allocations for one position cannot exceed 1,000,000 ppm; corrections
  append a superseding version.
- Exposure totals read only current accepted mappings and accepted position
  snapshots. A relationship with unknown allocation contributes no monetary
  value to an exposure total, while the position retains its full unallocated
  value.
- Position, exposure, and Portfolio Baseline reads share one authoritative
  position projection. Exposure rows explain allocation and provenance; they do
  not create another baseline item or monetary path.

## Cost and activation gate

The provider-neutral cutover adds no network call, R2 object, Queue message,
schedule, webhook, or paid provider product. It reuses the shipped Plaid
Investments and AngelList paths. Its incremental cost is bounded D1 storage and
backup volume for connection metadata, exact sync/webhook associations,
canonical exposure rows, and append-only mapping versions.

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

M9.1 through M9.8 use synthetic provider data and therefore have zero approved
incremental provider spend.

## Owner experience and scoped operations

The Holdings page reads the canonical position and exposure projections from
`GET /api/investment-holdings`. Positions are the default view and stay grouped
by their exact connection and ownership container. The exposure view groups
accepted mappings without merging positions and retains the contributing
institution and account as drill-down context. Partial coverage, stale facts,
unavailable values, unknown allocations, unresolved exposures, and unallocated
position value remain explicit. They are never rendered as zero.

Each investment connection has its own actions:

- **Check now** performs one bounded Investments retrieval for that connection.
- **Reconnect** opens Plaid update mode with the exact retained credential. It
  does not create a second Item or request a new product.
- **Pause** stops user-triggered retrieval without changing accepted history.
- **Resume updates** re-enables the same connection lineage.
- **Disconnect** removes only that connection's future retrieval credential
  after confirmation. Accepted positions, review decisions, Portfolio Baselines,
  plans, goals, and forecasts remain available.

Investment authorization is deliberately separate from the reviewed Plaid Auth
flow for banking cash. `INVESTMENTS_ADDITIONAL_INSTITUTIONS_ENABLED` defaults to
`false` in checked-in local, preview, and production configuration. With that
default, `POST /api/investment-connections/link-token` returns a fail-closed
conflict and the interface explains that coverage and pricing approval are
required. Existing connection reconnects remain available because they do not
authorize a new institution or product.

## Provider enablement checklist

Before setting `INVESTMENTS_ADDITIONAL_INSTITUTIONS_ENABLED=true` in a private
deployment, record all of the following outside public Git for the exact
institution variant:

1. Plaid Investments coverage for every intended brokerage and retirement
   account type, including known unsupported or partial cases.
2. The per-Item and per-product price, any Link update/reconnect charge, the
   expected bounded manual-check and webhook volume, and the approved monthly
   ceiling and owner.
3. The expected number of connections, containers, imports, coverage rows,
   position associations, exposure mappings, and accepted snapshots, plus the
   resulting D1 and encrypted-backup growth.
4. Credential, normalized-fact, backup, and disconnect retention; a successful
   deletion test for the selected synthetic or Sandbox Item.
5. Provider approval for the intended deployment environment and institution,
   and a private owner acceptance run showing account coverage without copying
   labels, identifiers, balances, holdings, or screenshots into Git or CI.
6. Rollback ownership and the exact configuration change that disables new
   authorization and generic writes while preserving accepted history.

Do not enable Investments Refresh, a Worker schedule, a notification channel, or
another paid product as part of this checklist. Those require a separate cost
and product decision.

## Synthetic operator check

Use only the checked-in fabricated seed and Playwright fixtures for public
release evidence:

1. Start the isolated stack with `make dev` and open the printed web URL.
2. Open **Holdings**. Confirm investment institutions and their brokerage,
   retirement, entity, partial, stale, paused, and disconnected states are
   distinguishable from the separate banking-cash section.
3. Confirm **Positions** is selected by default and the same fabricated security
   in three accounts remains three position rows.
4. Open **Exposures**, expand the shared security, and confirm its three exact
   account contributions. Confirm the fabricated multi-exposure fund shows
   unknown allocations and unallocated value without a zero exposure total.
5. Exercise check, pause/resume, reconnect, review, and disconnect confirmation
   on only the intended synthetic connection. Confirm another same-label
   connection is unchanged and accepted history remains visible.
6. Run the focused domain/API tests, desktop and mobile Playwright flows, fresh
   migration replay, and `make verify`. Inspect both viewport screenshots for
   keyboard focus, 44-pixel controls, and horizontal overflow.
7. Release only through a reviewed exact-head PR followed by the exact-SHA
   backup, forward migration, deployment, and protected-smoke workflow. Keep
   additional-institution authorization disabled unless the private checklist
   above is complete.

## Canonical contract verification

Before accepting the M9.6b release:

1. Replay migrations `0001` through
   `0023_authoritative_portfolio_baselines.sql`, apply the synthetic seed, and
   verify the former public provider values read as `plaid_investments` without
   changing position IDs or accepted baseline items, goals, plans, or forecasts.
2. Verify two protected Items create two connection lineages, including Items
   with different validated institution metadata. Reconnecting one stable Item
   must append only its state; syncing or disconnecting one connection must not
   alter the other.
3. Verify Link exchange accepts a synthetic non-Robinhood institution only when
   its metadata includes Investments. An unsupported institution must have its
   Plaid Item removed before Keel stores a credential or creates an accepted
   fact.
4. Verify several investment accounts returned by one Item become distinct
   ownership containers and every row, omission decision, run, and webhook stays
   on that exact connection/container lineage.
5. Verify the generic `/api/investment-connections` routes replace the former
   Robinhood-only routes, which must return `404`; no duplicate provider read or
   baseline path may remain.
6. Verify positions appear exactly once under their connection and container;
   exposure groups preserve the exact contributing position, accepted snapshot,
   mapping version, allocation, and explicit unknown or unallocated value.
7. Verify a Portfolio Baseline can include each accepted position only once and
   rejects any snapshot without its exact accepted application. Reconnects,
   institution-label changes, and exposure mapping versions must leave the
   accepted baseline source revision, plan, goal, and forecast unchanged.
8. Verify raw Item, account, security, and position identifiers remain outside
   D1, API responses, logs, screenshots, and repository artifacts. Preserve
   integer money/quantity conversion, response bounds, encrypted R2 storage,
   append-only decisions, and fail-closed Access authentication.
9. Run the unit, migration, desktop/mobile, `make verify`, reviewed PR,
   exact-head merge, and exact-SHA protected preview gates before marking the
   corresponding M9 slice complete.
