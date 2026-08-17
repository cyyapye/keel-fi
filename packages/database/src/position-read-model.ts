import {
  investmentSourceFreshness,
  InvestmentPositionViewSchema,
  type InvestmentCoverageCompleteness,
  type InvestmentPositionConnection,
  type InvestmentPositionContainer,
  type InvestmentPositionRecord,
  type InvestmentPositionView,
} from "@keel/domain/position-read-model";

type HouseholdIdentity = {
  household_id: string;
};

type InvestmentConnectionRow = {
  connection_id: string;
  adapter_type: "plaid-investments" | "angellist-import" | "manual";
  institution_key: string;
  institution_label: string;
  lifecycle_state: "pending" | "active" | "paused" | "disconnected";
};

type InvestmentContainerRow = {
  connection_id: string;
  container_id: string;
  container_label: string;
  container_kind:
    | "brokerage"
    | "ira"
    | "retirement"
    | "trust"
    | "entity"
    | "unresolved"
    | "other";
  tax_treatment: "taxable" | "tax_deferred" | "tax_exempt" | "unknown";
  coverage_completeness: InvestmentCoverageCompleteness | null;
  coverage_observed_at: string | null;
};

type InvestmentPositionRow = {
  container_id: string;
  position_id: string;
  legal_vehicle_name: string;
  reported_exposure_name: string | null;
  position_kind: "direct" | "spv_interest" | "fund_interest";
  opened_on: string | null;
  ownership_version: number;
  association_basis: "provider_provenance" | "reviewed_import" | "manual";
  snapshot_id: string;
  snapshot_fingerprint: string;
  snapshot_observed_at: string;
  provider_status: "live" | "realized";
  invested_minor: number;
  allocation_minor: number;
  unrealized_value_minor: number | null;
  unrealized_value_state: "reported" | "locked" | "not_reported";
  realized_value_minor: number;
  net_value_minor: number | null;
  net_value_state: "reported" | "locked" | "not_reported";
  instrument_type: string;
  currency: string;
  quantity_micros: number | null;
  ticker: string | null;
  cost_basis_minor: number | null;
  accepted_at: string;
  source_label: string;
  effective_date: string;
  retrieved_at: string;
};

type ConnectionBuilder = {
  readonly value: InvestmentPositionConnection;
  readonly containers: Map<string, InvestmentPositionContainer>;
};

const RECONCILED_HISTORY_CONNECTION_PREFIX =
  "reconciled-holding-connection-v1:";

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function positionFromRow(
  row: InvestmentPositionRow,
  asOf: string,
): InvestmentPositionRecord {
  return {
    id: row.position_id,
    legalVehicleName: row.legal_vehicle_name,
    reportedExposureName: row.reported_exposure_name,
    kind: row.position_kind,
    openedOn: row.opened_on,
    reviewStatus: "accepted",
    acceptedAt: row.accepted_at,
    ownershipVersion: row.ownership_version,
    ownershipBasis: row.association_basis,
    source: {
      label: row.source_label,
      effectiveDate: row.effective_date,
      retrievedAt: row.retrieved_at,
      freshness: investmentSourceFreshness(row.retrieved_at, asOf),
    },
    snapshot: {
      id: row.snapshot_id,
      fingerprint: row.snapshot_fingerprint,
      observedAt: row.snapshot_observed_at,
      providerStatus: row.provider_status,
      investedMinor: row.invested_minor,
      allocationMinor: row.allocation_minor,
      unrealizedValue: {
        state: row.unrealized_value_state,
        minor: row.unrealized_value_minor,
      },
      realizedValueMinor: row.realized_value_minor,
      netValue: {
        state: row.net_value_state,
        minor: row.net_value_minor,
      },
      instrumentType: row.instrument_type,
      currency: row.currency,
      quantityMicros: row.quantity_micros,
      ticker: row.ticker,
      costBasisMinor: row.cost_basis_minor,
    },
  };
}

function groupRows(
  connectionRows: readonly InvestmentConnectionRow[],
  containerRows: readonly InvestmentContainerRow[],
  positionRows: readonly InvestmentPositionRow[],
  asOf: string,
): InvestmentPositionView {
  const connections = new Map<string, ConnectionBuilder>();
  const containers = new Map<string, InvestmentPositionContainer>();

  for (const row of connectionRows) {
    const value: InvestmentPositionConnection = {
      id: row.connection_id,
      purpose: row.connection_id.startsWith(
        RECONCILED_HISTORY_CONNECTION_PREFIX,
      )
        ? "reviewed_history"
        : "source",
      adapterType: row.adapter_type,
      institutionKey: row.institution_key,
      institutionLabel: row.institution_label,
      lifecycleState: row.lifecycle_state,
      containers: [],
    };
    connections.set(row.connection_id, { value, containers: new Map() });
  }

  for (const row of containerRows) {
    const connection = connections.get(row.connection_id);
    if (connection === undefined) {
      throw new Error("Investment container is missing its connection.");
    }
    const container: InvestmentPositionContainer = {
      id: row.container_id,
      label: row.container_label,
      kind: row.container_kind,
      taxTreatment: row.tax_treatment,
      coverage:
        row.coverage_completeness === null || row.coverage_observed_at === null
          ? null
          : {
              completeness: row.coverage_completeness,
              observedAt: row.coverage_observed_at,
              freshness: investmentSourceFreshness(
                row.coverage_observed_at,
                asOf,
              ),
            },
      positions: [],
    };
    connection.containers.set(row.container_id, container);
    connection.value.containers.push(container);
    containers.set(row.container_id, container);
  }

  for (const row of positionRows) {
    const container = containers.get(row.container_id);
    if (container === undefined) {
      throw new Error("Investment position is missing its current container.");
    }
    container.positions.push(positionFromRow(row, asOf));
  }

  return InvestmentPositionViewSchema.parse({
    asOf,
    connections: [...connections.values()].map(({ value }) => value),
  });
}

export interface InvestmentPositionViewRepository {
  list(accessSubject: string, asOf?: string): Promise<InvestmentPositionView>;
}

export class D1InvestmentPositionViewRepository implements InvestmentPositionViewRepository {
  public constructor(private readonly db: D1Database) {}

  public async list(
    accessSubject: string,
    asOf = new Date().toISOString(),
  ): Promise<InvestmentPositionView> {
    InvestmentPositionViewSchema.shape.asOf.parse(asOf);
    const identity = await this.findIdentity(accessSubject);
    const [connectionRows, containerRows, positionRows] = await Promise.all([
      all<InvestmentConnectionRow>(
        this.db
          .prepare(
            `SELECT
             connection.id AS connection_id,
             connection.adapter_type,
             connection_version.institution_key,
             connection_version.institution_label,
             connection_version.lifecycle_state
           FROM investment_connections connection
           JOIN investment_connection_versions connection_version
             ON connection_version.connection_id = connection.id
            AND NOT EXISTS (
              SELECT 1
              FROM investment_connection_versions later_connection_version
              WHERE later_connection_version.supersedes_version_id =
                    connection_version.id
            )
           WHERE connection.household_id = ?
           ORDER BY lower(connection_version.institution_label), connection.id`,
          )
          .bind(identity.household_id),
      ),
      all<InvestmentContainerRow>(
        this.db
          .prepare(
            `SELECT
             container.connection_id,
             container.id AS container_id,
             container_version.display_label AS container_label,
             container_version.container_kind,
             container_version.tax_treatment,
             coverage.completeness AS coverage_completeness,
             coverage.observed_at AS coverage_observed_at
           FROM ownership_containers container
           JOIN ownership_container_versions container_version
             ON container_version.container_id = container.id
            AND NOT EXISTS (
              SELECT 1
              FROM ownership_container_versions later_container_version
              WHERE later_container_version.supersedes_version_id =
                    container_version.id
            )
           LEFT JOIN holding_import_coverages coverage
             ON coverage.id = (
               SELECT latest_coverage.id
               FROM holding_import_coverages latest_coverage
               WHERE latest_coverage.container_id = container.id
                 AND latest_coverage.household_id = container.household_id
               ORDER BY latest_coverage.observed_at DESC,
                        latest_coverage.created_at DESC,
                        latest_coverage.id DESC
               LIMIT 1
             )
           WHERE container.household_id = ?
           ORDER BY container.connection_id,
                    lower(container_version.display_label),
                    container.id`,
          )
          .bind(identity.household_id),
      ),
      all<InvestmentPositionRow>(
        this.db
          .prepare(
            `SELECT
             ownership.container_id,
             position.id AS position_id,
             position.legal_vehicle_name,
             accepted_row.exposure_label AS reported_exposure_name,
             position.position_kind,
             position.opened_on,
             ownership.version AS ownership_version,
             ownership.association_basis,
             snapshot.id AS snapshot_id,
             snapshot.snapshot_fingerprint,
             snapshot.observed_at AS snapshot_observed_at,
             snapshot.provider_status,
             snapshot.invested_minor,
             snapshot.allocation_minor,
             snapshot.unrealized_value_minor,
             snapshot.unrealized_value_state,
             snapshot.realized_value_minor,
             snapshot.net_value_minor,
             snapshot.net_value_state,
             snapshot.instrument_type,
             snapshot.currency,
             snapshot.quantity_micros,
             snapshot.ticker,
             snapshot.cost_basis_minor,
             application.applied_at AS accepted_at,
             document.source_label,
             COALESCE(
               document.effective_date,
               substr(document.retrieved_at, 1, 10)
             ) AS effective_date,
             document.retrieved_at
           FROM holding_positions position
           JOIN holding_position_ownerships ownership
             ON ownership.position_id = position.id
            AND NOT EXISTS (
              SELECT 1
              FROM holding_position_ownerships later_ownership
              WHERE later_ownership.supersedes_ownership_id = ownership.id
            )
           JOIN ownership_containers container
             ON container.id = ownership.container_id
           JOIN holding_import_applications application
             ON application.id = (
               SELECT candidate.id
               FROM holding_import_applications candidate
               JOIN holding_position_snapshots candidate_snapshot
                 ON candidate_snapshot.id = candidate.snapshot_id
               WHERE candidate.position_id = position.id
               ORDER BY candidate.applied_at DESC,
                        candidate_snapshot.observed_at DESC,
                        candidate.id DESC
               LIMIT 1
             )
           JOIN holding_position_snapshots snapshot
             ON snapshot.id = application.snapshot_id
           JOIN holding_import_rows accepted_row
             ON accepted_row.id = application.import_row_id
           JOIN holding_imports accepted_import
             ON accepted_import.id = accepted_row.import_id
           JOIN source_documents document
             ON document.id = accepted_import.source_document_id
           WHERE position.household_id = ?
           ORDER BY ownership.container_id,
                    lower(position.legal_vehicle_name),
                    position.id`,
          )
          .bind(identity.household_id),
      ),
    ]);
    return groupRows(connectionRows, containerRows, positionRows, asOf);
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("Household not found for the authenticated user.");
    }
    return identity;
  }
}
