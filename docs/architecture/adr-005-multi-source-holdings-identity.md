# ADR 005: Multi-source holdings identity

- Status: Accepted design; implementation pending
- Date: 2026-08-15

## Context

Keel must support more than one investment institution and more than one account
at the same institution without losing legal ownership context or double
counting economic exposure. The same public security may be held in a Robinhood
brokerage account, a Fidelity brokerage account, and a Fidelity IRA. The same
private company may be reached through several legally distinct SPVs. Those are
separate owned positions even when their economic exposure is the same.

The shipped model already provides important foundations:

- `holding_positions` represents the legal asset owned by the household;
- `holding_position_exposures` keeps an underlying company or fund separate from
  that legal asset;
- `holding_position_snapshots` and review decisions are append-only; and
- the Robinhood natural key includes both account identity and security
  identity, so the same security in two Robinhood accounts can remain separate.

However, the public-holdings path is still institution-specific. The accepted
provider contract enumerates Robinhood and AngelList, the Plaid flow validates
only Robinhood, a position has no first-class ownership-container relationship,
and missing-position reconciliation currently ranges across a provider instead
of an explicitly covered connection and account. Adding `fidelity` to the
provider enum would therefore be insufficient and could create false missing
positions or accidental merges.

This ADR defines the canonical logical model. Physical schema names may remain
compatible with existing tables during an additive migration, but the
relationships and invariants below are normative.

## Decision

### Canonical concepts

| Record                    | Canonical meaning                                                               | Example                                                                   | Identity and scope                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Investment connection     | One authorized external source or explicit manual/import source                 | A Plaid Item for Fidelity; an AngelList export profile                    | Household + adapter type + a protected stable source key. Institution display text is not identity.                                                       |
| Ownership container       | The account, tax wrapper, or ownership entity in which an asset is legally held | Fidelity brokerage; Fidelity Roth IRA; owner LLC                          | Connection + protected stable provider account key, or an explicit reviewed manual identity. Labels and masks are display metadata only.                  |
| Owned position            | One legal asset held in one ownership container                                 | NVDA shares in the Fidelity IRA; an LP interest in Anthropic SPV A        | Container + stable source position key. Exposure name, ticker, and institution name alone never identify a position.                                      |
| Position snapshot         | Dated facts observed for one owned position                                     | Quantity, cost basis, administrator value, or status on an effective date | Append-only and attributable to an import row plus an acceptance decision. Unknown and unavailable values remain explicit.                                |
| Canonical exposure        | The underlying security, company, fund, or other economic exposure              | NVIDIA common equity; Anthropic; OpenAI                                   | Independent of connection, institution, account, and legal vehicle. Provider text does not become canonical without deterministic or reviewed resolution. |
| Position-exposure mapping | A direct or look-through relationship between a position and an exposure        | An SPV interest maps to Anthropic                                         | Many-to-many. An allocation is integer parts per million when known and remains unknown otherwise.                                                        |
| Import coverage           | The exact connection and containers a complete observation represents           | One Fidelity Item covering a brokerage account and an IRA                 | Only complete, validated coverage can support a `not reported` proposal, and only inside the covered containers.                                          |
| Portfolio baseline item   | One exact accepted position snapshot selected for a reviewed baseline           | The latest accepted Fidelity-IRA NVDA snapshot                            | A position appears at most once in a baseline. Exposure joins never create extra baseline value.                                                          |

Every imported or manually entered holding follows the same chain:

`household → investment connection → ownership container → owned position → position snapshot`

The exposure relationship is deliberately orthogonal:

`owned position ↔ position exposure ↔ canonical exposure`

### Concrete relationship example

All names and relationships below are illustrative and contain no portfolio
values.

```mermaid
flowchart LR
  Household["Household"]

  Household --> RHConnection["Connection: Plaid / Robinhood"]
  Household --> FidelityConnection["Connection: Plaid / Fidelity"]
  Household --> AngelListConnection["Connection: AngelList import"]

  RHConnection --> RHBrokerage["Container: Robinhood brokerage"]
  FidelityConnection --> FidelityBrokerage["Container: Fidelity brokerage"]
  FidelityConnection --> FidelityIRA["Container: Fidelity Roth IRA"]
  AngelListConnection --> OwnerLLC["Container: owner LLC"]

  RHBrokerage --> RHNVDA["Position: NVDA shares in Robinhood"]
  FidelityBrokerage --> FidelityNVDA["Position: NVDA shares in Fidelity brokerage"]
  FidelityIRA --> IRANVDA["Position: NVDA shares in Fidelity IRA"]
  OwnerLLC --> AnthropicA["Position: interest in Anthropic SPV A"]
  OwnerLLC --> AnthropicB["Position: interest in Anthropic SPV B"]
  OwnerLLC --> OpenAIC["Position: interest in OpenAI SPV C"]

  RHNVDA -->|"direct"| NVIDIA["Canonical exposure: NVIDIA common equity"]
  FidelityNVDA -->|"direct"| NVIDIA
  IRANVDA -->|"direct"| NVIDIA
  AnthropicA -->|"look-through"| Anthropic["Canonical exposure: Anthropic"]
  AnthropicB -->|"look-through"| Anthropic
  OpenAIC -->|"look-through"| OpenAI["Canonical exposure: OpenAI"]

  RHNVDA --> ReviewedPortfolio["Reviewed portfolio: six distinct position line items"]
  FidelityNVDA --> ReviewedPortfolio
  IRANVDA --> ReviewedPortfolio
  AnthropicA --> ReviewedPortfolio
  AnthropicB --> ReviewedPortfolio
  OpenAIC --> ReviewedPortfolio
  ReviewedPortfolio --> FIPlan["FI plan: only policy-eligible accepted values"]

  NVIDIA --> ExposureView["Exposure view: three grouped exposures without merging positions"]
  Anthropic --> ExposureView
  OpenAI --> ExposureView
```

This example produces six legal position records, not three. The exposure view
can answer “what is the household's total NVIDIA exposure?” while the position
view still answers “which account owns each share?” The reviewed portfolio uses
each accepted position once; FI policy separately determines which accepted
values are usable in the plan.

### Logical relationship model

```mermaid
erDiagram
  HOUSEHOLD ||--o{ INVESTMENT_CONNECTION : authorizes
  INVESTMENT_CONNECTION ||--o{ OWNERSHIP_CONTAINER : contains
  OWNERSHIP_CONTAINER ||--o{ OWNED_POSITION : holds
  OWNED_POSITION ||--o{ POSITION_SNAPSHOT : records
  OWNED_POSITION ||--o{ POSITION_EXPOSURE : maps
  CANONICAL_EXPOSURE ||--o{ POSITION_EXPOSURE : groups

  INVESTMENT_CONNECTION ||--o{ SYNC_RUN : executes
  SYNC_RUN ||--o| HOLDING_IMPORT : produces
  HOLDING_IMPORT ||--|{ IMPORT_COVERAGE : declares
  OWNERSHIP_CONTAINER ||--o{ IMPORT_COVERAGE : covered_by
  HOLDING_IMPORT ||--o{ IMPORT_ROW : contains
  OWNERSHIP_CONTAINER ||--o{ IMPORT_ROW : scopes
  IMPORT_ROW ||--o| ACCEPTANCE_DECISION : receives
  ACCEPTANCE_DECISION ||--o| POSITION_SNAPSHOT : authorizes

  PORTFOLIO_BASELINE ||--|{ BASELINE_ITEM : selects
  POSITION_SNAPSHOT ||--o{ BASELINE_ITEM : referenced_by

  INVESTMENT_CONNECTION {
    uuid id PK
    uuid household_id FK
    string adapter_type
    string institution_label
    string protected_source_key
    string status
  }

  OWNERSHIP_CONTAINER {
    uuid id PK
    uuid connection_id FK
    string protected_account_key
    string display_label
    string container_kind
    string tax_treatment
  }

  OWNED_POSITION {
    uuid id PK
    uuid container_id FK
    string stable_position_key
    string position_kind
    string legal_vehicle_name
  }

  POSITION_SNAPSHOT {
    uuid id PK
    uuid position_id FK
    date effective_date
    int quantity_scaled
    int value_minor
    string value_state
  }

  CANONICAL_EXPOSURE {
    uuid id PK
    string exposure_kind
    string canonical_name
    string canonical_instrument_key
  }

  POSITION_EXPOSURE {
    uuid position_id FK
    uuid exposure_id FK
    string relationship_kind
    int allocation_ppm_nullable
  }

  IMPORT_COVERAGE {
    uuid import_id FK
    uuid container_id FK
    string completeness
  }

  BASELINE_ITEM {
    uuid baseline_id FK
    uuid position_snapshot_id FK
    string planning_treatment
  }
```

### Identity and reconciliation invariants

1. A legal position and an economic exposure are different records.
2. The same exposure held through different containers or legal vehicles remains
   separate positions. Keel never merges positions merely because tickers,
   company names, or exposure mappings match.
3. One position belongs to exactly one ownership container. A reconnect may
   reauthorize the same connection and container; it must not create a new
   position lineage when stable identity is unchanged.
4. A position may map to zero, one, or many canonical exposures. Zero means
   unresolved, not no exposure. A multi-exposure position contributes monetary
   values to exposure totals only when reviewed allocation parts are known and
   valid; otherwise the relationship is shown without duplicating its full value
   across exposures.
5. A Portfolio Baseline selects position snapshots, never exposure rows. Each
   position is counted at most once, while its planning treatment still keeps
   private paper, locked value, and unavailable value distinct from usable
   liquidity.
6. A source omission is evaluated only against prior positions in the same
   connection and an explicitly, completely covered container. It creates a
   reviewable `not reported` state or exception, never an inferred sale, closed
   account, zero value, or deletion. Partial or ambiguous coverage creates no
   omission claim.
7. External observations remain evidence. A snapshot becomes accepted only
   through an explicit review or a recorded deterministic policy decision.
   Accepted snapshots, decisions, baselines, and exposure mappings are
   append-only; corrections supersede rather than rewrite history.
8. Disconnecting or pausing a connection stops future retrieval and removes
   credentials according to policy, but it does not delete accepted position
   history or silently change a baseline.

### Sync and review behavior

For every acquisition run, Keel must:

1. validate the external response at the boundary and resolve the exact
   investment connection;
2. resolve each reported account or ownership entity to an ownership container
   using protected stable identifiers, never a mutable display label;
3. bind every import row to one container before attempting to match a position;
4. compare the row only with positions in that container;
5. record the containers for which the source response is complete;
6. stage new or changed facts and identity ambiguity for review, or record the
   deterministic policy decision that accepted a supported unchanged identity;
7. compute omissions only within completely covered containers; and
8. append accepted position snapshots without altering any other connection,
   container, position, baseline, or forecast.

A single connection may return several containers, such as a Fidelity brokerage
account and IRA. A failed Fidelity check cannot make a Robinhood position
missing. A complete Fidelity brokerage observation cannot make a Fidelity IRA
position missing unless that IRA is also explicitly included in the observation
coverage.

### Baseline and exposure views

Keel provides two projections over the same accepted facts:

- **Position view:** grouped by institution, ownership container, and legal
  position. This is the source of truth for review, provenance, tax wrapper,
  quantity, cost basis, value state, and baseline inclusion.
- **Exposure view:** grouped by canonical exposure with drill-down to every
  contributing position. It is a derived concentration view and cannot create,
  merge, update, or delete positions.

The position view is authoritative for money. A direct position can contribute
its accepted value once to one exposure. A fund or SPV with several underlying
exposures contributes allocated values only when the allocations are reviewed
and sum to at most 1,000,000 parts per million. Unallocated value stays visible
at the position level and is not manufactured in the exposure view.

### Migration and implementation boundary

Implementation must be additive and preserve existing accepted history:

1. add the canonical connection, ownership-container, import-coverage, and
   exposure identities or compatible association tables;
2. associate existing immutable positions with reviewed legacy containers rather
   than rewriting position or snapshot records;
3. backfill only identities that can be proven from retained source provenance;
   ambiguous legacy accounts remain in an explicit unresolved container until a
   review or a new complete sync resolves them;
4. generalize the Plaid Investments adapter, API contracts, and UI from
   Robinhood-specific naming to institution metadata, then prove the model with
   at least one additional institution such as Fidelity;
5. scope imports, omissions, refreshes, disconnects, and webhook processing to
   the exact connection and covered containers;
6. preserve the existing review boundary, integer money arithmetic, synthetic
   fixtures, and append-only baselines; and
7. add invariant tests for same-exposure/different-account positions,
   same-company/different-SPV positions, partial coverage, reconnects,
   aggregation, and double-count prevention before enabling another real
   institution.

Until those gates ship, Robinhood and AngelList remain the implemented holding
sources. This ADR must not be read as evidence that Fidelity or generic
multi-institution linking is already available.

## Consequences

Positive:

- another institution becomes an adapter and connection configuration, not a new
  holdings data model;
- account and tax-wrapper provenance survives exposure aggregation;
- multiple SPVs into the same company remain legally auditable;
- missing observations cannot leak across institutions or accounts; and
- baseline totals and exposure totals have explicit double-count rules.

Tradeoffs:

- the model adds connection and container identity that the current UI and
  provider-specific repositories do not yet expose;
- legacy records without reconstructible stable account identity require a
  reviewable unresolved container;
- canonical exposure resolution needs its own review and supersession path; and
- look-through funds and SPVs cannot show precise exposure value until an
  allocation is supported by evidence.

## Rejected alternatives

- **One holding per ticker or company:** merges different accounts, tax
  wrappers, cost bases, and legal claims.
- **One holdings table per institution:** repeats review and baseline logic and
  makes cross-source safety inconsistent.
- **Provider or display label as position identity:** changes across reconnects
  and cannot distinguish several accounts or vehicles reliably.
- **Merge SPVs that point to the same company:** destroys the legal ownership
  and distribution history Keel must reconcile.
- **Treat an omitted row as a sale:** turns incomplete external evidence into an
  unsupported financial mutation.
- **Sum through every exposure mapping:** double counts funds and SPVs whenever
  one position has several underlying exposures.
