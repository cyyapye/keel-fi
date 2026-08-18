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
review decision. It adds no data rewrite. Migration
`0026_reconciled_holding_ownership.sql` repairs accepted holding history that
predates the canonical ownership chain, reapplies the same high-confidence
exposure rules across providers, and prevents a new exposure mapping without a
current ownership association. The repair does not change an accepted position,
snapshot, value, Portfolio Baseline, plan, goal, or forecast. None of these
migrations authorizes another live institution. Migration
`0027_retained_public_exposure_identity.sql` adds an append-only evidence table
for accepted public rows whose exact retained source document predates the
strong-identifier columns. On the next Holdings read, Keel verifies the retained
object's recorded byte length and SHA-256, validates its Plaid schema, protects
only a checksum-valid CUSIP, ISIN, or SEDOL, and applies the same deterministic
public-exposure policy. It never rewrites the accepted import row. Migration
`0028_provider_scoped_public_exposure.sql` records a second, append-only outcome
only when that retained evidence has no valid global identifier. Eligible
equity, ETF, and mutual-fund rows may share a protected Plaid security identity
inside one exact protected Item. Different Items never share this fallback, and
cash, cryptocurrency, unsupported types, ticker, and display text cannot resolve
an exposure through that policy. Migration `0029_structured_asset_exposure.sql`
adds a separate append-only structured outcome: exact USD cash shares one
currency exposure across investment connections, while cryptocurrency shares
only an exact Plaid security identity inside one protected Item. Unsupported
types and text-only identity remain unresolved.

The public repository and release fixtures remain synthetic-only. A short-lived
synthetic transition experiment was removed instead of becoming a permanent
dual-read surface. Deployed accepted review history is treated as retained and
forward-only under ADR 005's 2026-08-16 operational amendment. Every holding
writer must write the canonical contract directly; migration `0026` is a bounded
repair for already accepted history, not an alternate ingestion or read path.

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
- A public canonical exposure is shared across connections through a
  checksum-valid CUSIP, ISIN, or SEDOL protected with the deployment identity
  key. When none exists, one exact Plaid security ID may group eligible public
  positions only across accounts inside the same protected Item. That fallback
  cannot cross Items or institutions. A ticker or display label cannot create a
  canonical exposure.
- For an accepted pre-`0021` public row, the same protected identifier may be
  appended in `holding_import_row_public_exposure_evidence` only after the exact
  retained source object matches its immutable D1 byte length and SHA-256.
  Missing, changed, and malformed evidence stays unresolved and does not make
  Holdings unavailable. Migration `0028` may append either the protected
  Item-scoped provider identity or an explicit ineligible outcome for a
  checksum-verified `0027` no-strong-identifier row. Migration `0029` may then
  append one global exact-USD currency identity, one exact Item-scoped
  cryptocurrency identity, or an explicit unsupported outcome. None of these
  rules uses ticker or display text.
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

- There is no compatibility view, runtime read-source flag, or dual repository
  path. Migration `0026` is the single bounded ownership repair for accepted
  positions that were created before ADR 005 and have accepted application
  evidence but no current canonical ownership association.
- The repair reuses an accepted import row's existing container when present.
  Only a position with no proven row/container scope receives a provider-scoped
  reviewed-history connection and its own unresolved container; the migration
  also records the missing import and row associations with ambiguous coverage.
  It does not merge positions by owner, institution, legal-vehicle, ticker, or
  company text, and ambiguous coverage cannot support omission inference.
- Every new exposure-mapping insert must reference a position with a current
  household-scoped ownership association. The database trigger fails closed
  before an orphan mapping can make the shared Position, Exposure, and Portfolio
  Baseline projections unreadable.
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
- Applying an accepted import row with a validated strong identifier creates or
  reuses one household-level public exposure and records a full direct mapping
  under the deterministic policy, regardless of provider. Only a checksum-valid
  CUSIP, ISIN, or SEDOL protected with the deployment identity key qualifies;
  reapplying the same decision is a no-op, while a missing or invalid identifier
  leaves the position unmapped.
- Accepted public history that predates the row columns follows the same rule.
  The runtime reads each unreconciled retained source object at most until its
  append-only resolution evidence is recorded, then reconciliation runs entirely
  from D1. A row without a valid global identifier can use the exact provider
  security ID only after it is protected with the exact Item identity and only
  for eligible public security types. The same provider ID in another Item does
  not match. Exact USD cash instead uses one currency identity across investment
  connections. Cryptocurrency uses the same exact-Item boundary and remains
  outside FI planning. Source-row number and raw provider IDs are used only
  inside the hash-verified original response; ticker and display name never
  become shared identity. The final structured or unsupported outcome prevents
  repeated object reads. A failed legacy repair is logged and skipped without
  turning the canonical Position or Exposure view into an error state.
- Private exposure reconciliation is likewise provider-neutral when the position
  already has exactly one stable reviewed company ID. Eligible SPVs from any
  provider can participate in the reviewed exact-company batch, but a provider
  label, ticker, company-name string, or legal-vehicle/SPV name cannot silently
  select or create an exposure. Ambiguous rows remain unresolved for individual
  review.
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

The provider-neutral cutover adds no provider request, new R2 object, Queue
message, schedule, webhook, or paid provider product. It reuses the shipped
Plaid Investments and AngelList paths. Migration `0027` adds one bounded read of
each unresolved legacy source object and small append-only D1 evidence and
mapping rows. Migration `0028` rereads only a `0027` no-strong-identifier source
whose rows have no provider-scope outcome, then records that outcome so the
object is not read again. Migration `0029` performs one final bounded reread
only for an existing `0028` ineligible row without a structured-asset outcome.
It adds no provider request or new R2 object. At the current retained-history
volume this remains inside the existing Cloudflare usage envelope, with expected
incremental spend of `$0`.

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

Migration `0026` adds only bounded D1 rows for legacy ownership relationships,
high-confidence exposure identities and mappings, and the insertion invariant.
It adds no provider request, paid product, polling schedule, Queue message, R2
object, notification channel, or recurring work; approved incremental external
spend remains `$0`.

## Owner experience and scoped operations

The Holdings page reads the canonical position and exposure projections from
`GET /api/investment-holdings`. It presents the exposure hierarchy once, with
each exact legal position and its detail action inside the relevant exposure.
Accepted mappings never merge positions. Useful source-account context remains
on current brokerage positions; bounded reviewed-history connections stay out of
account management because they are not reconnectable accounts. Partial
coverage, stale facts, unavailable values, unknown allocations, unresolved
exposures, and unallocated position value remain explicit. They are never
rendered as zero.

The browser initially renders 12 exposure groups and progressively reveals the
rest with an intersection observer plus an accessible **Load more exposures**
fallback. This reduces DOM and page length; it does not issue a query per group
or claim to reduce the single canonical API payload. Unallocated and unresolved
positions remain explicit in the same hierarchy, with any available review
action attached to the exact legal position.

If the authoritative holdings projection cannot load, the page shows the load
error without falling back to company-evidence rows, a fabricated position
count, or false unresolved exposures. **Try again** reloads the authoritative
projection. Portfolio Baseline uses the same position projection and the same
retry boundary.

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
flow for banking cash. `INVESTMENTS_NEW_CONNECTIONS_ENABLED` defaults to `false`
in checked-in local and production configuration. The owner-operated private
preview enables it so the owner can authorize Robinhood Investments, Fidelity,
and Schwab through the same Plaid Investments flow. Both Link-token creation and
public-token exchange fail closed when the flag is disabled.

An invalid retained Item can still use **Reconnect** in Plaid update mode
without creating a second Item. A deliberately disconnected Item cannot: Keel
has removed its Plaid credential and exposes **Connect again**, which creates a
new Item while preserving accepted positions and planning history. Bank and
investment consent remain separate. Robinhood banking uses **Add bank**; its
brokerage and retirement accounts use **Add brokerage**.

Plaid's [current Trial plan](https://plaid.com/docs/account/billing/) includes
Investments and permits at most 10 Production Items. Every new Item counts
toward that lifetime Trial ceiling; removing an Item does not restore capacity.
The owner must therefore treat a bank connection, an investment connection, and
a post-disconnect replacement as separate Item uses. Link and the Dashboard
remain authoritative for Fidelity and Schwab availability; Plaid documents
additional institution access requirements for both after a paid-plan upgrade.
Keel additionally reads exact institution metadata after exchange, requires the
Investments product, and removes an unsupported Item before storing a
credential. Institution display text never authorizes or identifies a
connection.

## Provider enablement checklist

Before setting `INVESTMENTS_NEW_CONNECTIONS_ENABLED=true` in production or a
paid deployment, record all of the following outside public Git for the exact
institution variant. The owner-operated Trial preview uses Plaid's published
Trial ceiling and product inclusion; it must still fail closed when Link or
exact post-exchange metadata denies Investments access.

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
   account contributions, including contributions accepted through different
   providers. Confirm separate SPVs with one reviewed company ID remain separate
   legal positions under one exposure. Confirm the fabricated multi-exposure
   fund shows unknown allocations and unallocated value without a zero exposure
   total.
5. Exercise check, pause/resume, reconnect, review, and disconnect confirmation
   on only the intended synthetic connection. Confirm another same-label
   connection is unchanged and accepted history remains visible.
6. Run the focused domain/API tests, desktop and mobile Playwright flows, fresh
   migration replay, and `make verify`. Inspect both viewport screenshots for
   keyboard focus, 44-pixel controls, and horizontal overflow.
7. Release only through a reviewed exact-head PR followed by the exact-SHA
   backup, forward migration, deployment, and protected-smoke workflow. Keep
   new-connection authorization disabled outside the owner-operated Trial
   preview unless the private checklist above is complete.

## Canonical contract verification

Before accepting the M9 canonical release:

1. Replay migrations `0001` through `0029_structured_asset_exposure.sql`, apply
   the synthetic seed, and verify the former public provider values read as
   `plaid_investments` without changing position IDs or accepted baseline items,
   goals, plans, or forecasts.
2. Seed synthetic accepted pre-ADR positions with applications but no ownership
   associations, including one with a proven row container and one with no
   canonical import scope. Apply migration `0026`; verify the proven container
   is reused, the unscoped row receives one unresolved container with ambiguous
   coverage, and each position appears once in Position, Exposure, and Portfolio
   Baseline reads. Verify a later exposure-mapping insert without current
   ownership fails at the database boundary.
3. Verify two protected Items create two connection lineages, including Items
   with different validated institution metadata. Reconnecting one stable Item
   must append only its state; syncing or disconnecting one connection must not
   alter the other.
4. Verify Link exchange accepts a synthetic non-Robinhood institution only when
   its metadata includes Investments. An unsupported institution must have its
   Plaid Item removed before Keel stores a credential or creates an accepted
   fact.
5. Verify several investment accounts returned by one Item become distinct
   ownership containers and every row, omission decision, run, and webhook stays
   on that exact connection/container lineage.
6. Verify the generic `/api/investment-connections` routes replace the former
   Robinhood-only routes, which must return `404`; no duplicate provider read or
   baseline path may remain.
7. Verify positions appear exactly once under their connection and container;
   exposure groups preserve the exact contributing position, accepted snapshot,
   mapping version, allocation, and explicit unknown or unallocated value.
   Verify cross-provider public grouping uses only a protected global strong
   identifier. Verify the provider-security fallback groups only positions from
   the same protected Item and never crosses Items. Private grouping uses only a
   reviewed company ID; none of these paths uses display text.
8. Verify a Portfolio Baseline can include each accepted position only once and
   rejects any snapshot without its exact accepted application. Reconnects,
   institution-label changes, and exposure mapping versions must leave the
   accepted baseline source revision, plan, goal, and forecast unchanged.
9. Verify raw Item, account, security, and position identifiers remain outside
   D1, API responses, logs, screenshots, and repository artifacts. Preserve
   integer money/quantity conversion, response bounds, encrypted R2 storage,
   append-only decisions, and fail-closed Access authentication.
10. Seed accepted pre-`0021` Plaid documents containing the same valid global
    identifier in two accounts, the same provider security ID in two accounts of
    one Item, that provider ID in a different Item, exact USD cash in two
    accounts, cryptocurrency in two accounts of one Item, and an unsupported
    row. Verify the retained repair creates separate global, Item-scoped public,
    global USD cash, and Item-scoped cryptocurrency exposures with two legal
    contributions each; does not merge the different Item; leaves only the
    unsupported row unresolved; is idempotent; and does not block the canonical
    view when an object is unavailable or its checksum differs.
11. Run the unit, migration, desktop/mobile, `make verify`, reviewed PR,
    exact-head merge, and exact-SHA protected preview gates before marking the
    corresponding M9 slice complete.
