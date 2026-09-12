import {
  investmentSourceFreshness,
  InvestmentPositionViewSchema,
  LegalEntityNameEvidenceSchema,
  reviewedInvestmentNameEvidence,
  type InvestmentCoverageCompleteness,
  type InvestmentPositionConnection,
  type InvestmentPositionContainer,
  type InvestmentPositionRecord,
  type InvestmentPositionView,
} from "@keel/domain/position-read-model";
import {
  PositionEconomicsTermsSchema,
  ReportedPositionEconomicsTermsSchema,
} from "@keel/domain/position-economics";
import { PositionValueAdjustmentSchema } from "@keel/domain/position-value";
import {
  InvestmentCompanyReceiptSchema,
  InvestmentReviewStateSchema,
} from "@keel/domain/investment-review";
import { LegalNameDocumentReferenceSchema } from "@keel/domain/provider-legal-documents";
import { z } from "zod";

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
  owner_label: string;
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
  prior_snapshot_id: string | null;
  prior_snapshot_observed_at: string | null;
  prior_snapshot_unrealized_value_minor: number | null;
  prior_snapshot_unrealized_value_state:
    "reported" | "locked" | "not_reported" | null;
  accepted_at: string;
  source_label: string;
  effective_date: string;
  retrieved_at: string;
  import_provider: string;
  legal_name_evidence_json: string | null;
  investment_review_json?: string | null;
  company_review_json?: string | null;
  incoming_document_json?: string | null;
  adjustment_id: string | null;
  adjustment_supersedes_proposal_id: string | null;
  adjustment_snapshot_id: string | null;
  adjustment_prior_value_state: "reported" | "locked" | "not_reported" | null;
  adjustment_prior_value_minor: number | null;
  adjustment_value_minor: number | null;
  adjustment_currency: string | null;
  adjustment_effective_date: string | null;
  adjustment_source_kind: "gp_update" | "news_article" | "other" | null;
  adjustment_source_label: string | null;
  adjustment_source_url: string | null;
  adjustment_commentary: string | null;
  adjustment_accepted_at: string | null;
  prior_adjustment_effective_date: string | null;
  economics_id: string | null;
  economics_snapshot_id: string | null;
  economics_commitment_minor: number | null;
  economics_funded_minor: number | null;
  economics_capital_basis: "gross_commitment" | "net_invested" | null;
  economics_gross_commitment_minor: number | null;
  economics_setup_fee_ppm: number | null;
  economics_annual_admin_fee_ppm: number | null;
  economics_admin_fee_years: number | null;
  economics_carry_ppm: number | null;
  economics_note: string | null;
  economics_accepted_at: string | null;
  reported_management_fee_ppm: number | null;
  reported_carry_ppm: number | null;
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
  const acceptedValueAdjustment =
    row.adjustment_id === null
      ? null
      : PositionValueAdjustmentSchema.parse({
          id: row.adjustment_id,
          positionId: row.position_id,
          snapshotId: row.adjustment_snapshot_id,
          priorValueState: row.adjustment_prior_value_state,
          priorValueMinor: row.adjustment_prior_value_minor,
          valueMinor: row.adjustment_value_minor,
          currency: row.adjustment_currency,
          effectiveDate: row.adjustment_effective_date,
          sourceKind: row.adjustment_source_kind,
          sourceLabel: row.adjustment_source_label,
          sourceUrl: row.adjustment_source_url,
          commentary: row.adjustment_commentary,
          acceptedAt: row.adjustment_accepted_at,
        });
  const priorValue =
    acceptedValueAdjustment !== null
      ? {
          state: acceptedValueAdjustment.priorValueState,
          minor: acceptedValueAdjustment.priorValueMinor,
          observedAt:
            row.adjustment_supersedes_proposal_id === null
              ? row.snapshot_observed_at
              : `${row.prior_adjustment_effective_date}T00:00:00.000Z`,
        }
      : row.prior_snapshot_id === null ||
          row.prior_snapshot_observed_at === null ||
          row.prior_snapshot_unrealized_value_state === null
        ? null
        : {
            state: row.prior_snapshot_unrealized_value_state,
            minor: row.prior_snapshot_unrealized_value_minor,
            observedAt: row.prior_snapshot_observed_at,
          };
  const acceptedEconomicsTerms =
    row.economics_id === null
      ? null
      : PositionEconomicsTermsSchema.parse({
          id: row.economics_id,
          positionId: row.position_id,
          acceptedAgainstSnapshotId: row.economics_snapshot_id,
          commitmentMinorAtAcceptance: row.economics_commitment_minor,
          fundedMinorAtAcceptance: row.economics_funded_minor,
          capitalBasis: row.economics_capital_basis,
          grossCommitmentMinor: row.economics_gross_commitment_minor,
          setupFeePpm: row.economics_setup_fee_ppm,
          annualAdminFeePpm: row.economics_annual_admin_fee_ppm,
          adminFeeYears: row.economics_admin_fee_years,
          carryPpm: row.economics_carry_ppm,
          note: row.economics_note,
          acceptedAt: row.economics_accepted_at,
        });
  const reportedEconomicsTerms =
    row.reported_management_fee_ppm === null && row.reported_carry_ppm === null
      ? null
      : ReportedPositionEconomicsTermsSchema.parse({
          managementFeePpm: row.reported_management_fee_ppm,
          carryPpm: row.reported_carry_ppm,
          sourceLabel: row.source_label,
          observedAt: row.retrieved_at,
        });
  return {
    id: row.position_id,
    legalVehicleName: row.legal_vehicle_name,
    ...(row.investment_review_json == null
      ? {}
      : {
          investmentReview: InvestmentReviewStateSchema.parse(
            JSON.parse(row.investment_review_json),
          ),
        }),
    ...(row.company_review_json == null
      ? {}
      : {
          companyReview: InvestmentCompanyReceiptSchema.parse(
            JSON.parse(row.company_review_json),
          ),
        }),
    legalEntityNameEvidence: reviewedInvestmentNameEvidence(
      row.import_provider === "angellist"
        ? {
            state: "provider_reported",
            legalName: row.legal_vehicle_name,
            sourceField: "Fund Name",
          }
        : row.legal_name_evidence_json != null
          ? LegalEntityNameEvidenceSchema.parse(
              JSON.parse(row.legal_name_evidence_json),
            )
          : {
              state: "unavailable",
              legalName: null,
              sourceField: null,
              ...(["sydecar", "tokenfolio"].includes(row.import_provider)
                ? { problem: "not_checked" as const }
                : {}),
            },
      row.investment_review_json == null
        ? null
        : InvestmentReviewStateSchema.parse(
            JSON.parse(row.investment_review_json),
          ),
      z
        .array(LegalNameDocumentReferenceSchema)
        .max(6)
        .parse(JSON.parse(row.incoming_document_json ?? "[]")),
    ),
    ownerLabel: row.owner_label,
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
    acceptedValueAdjustment,
    acceptedEconomicsTerms,
    reportedEconomicsTerms,
    priorValue,
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
    return this.listForHousehold(identity.household_id, asOf);
  }

  public async listForHousehold(
    householdId: string,
    asOf = new Date().toISOString(),
  ): Promise<InvestmentPositionView> {
    InvestmentPositionViewSchema.shape.asOf.parse(asOf);
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
          .bind(householdId),
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
          .bind(householdId),
      ),
      all<InvestmentPositionRow>(
        this.db
          .prepare(
            `SELECT
             ownership.container_id,
             position.id AS position_id,
             position.legal_vehicle_name,
             position.owner_label,
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
             prior_snapshot.id AS prior_snapshot_id,
             prior_snapshot.observed_at AS prior_snapshot_observed_at,
             prior_snapshot.unrealized_value_minor
               AS prior_snapshot_unrealized_value_minor,
             prior_snapshot.unrealized_value_state
               AS prior_snapshot_unrealized_value_state,
             application.applied_at AS accepted_at,
             document.source_label,
             COALESCE(
               document.effective_date,
               substr(document.retrieved_at, 1, 10)
             ) AS effective_date,
             document.retrieved_at,
             accepted_import.provider AS import_provider,
             legal_observation.evidence_json AS legal_name_evidence_json,
             investment_review.state_json AS investment_review_json,
             company_review.receipt_json AS company_review_json,
             (SELECT json_group_array(json(assignment.document_json)) FROM investment_document_assignments assignment
               WHERE assignment.household_id = position.household_id AND assignment.target_position_id = position.id) AS incoming_document_json,
             adjustment.id AS adjustment_id,
             adjustment.supersedes_proposal_id
               AS adjustment_supersedes_proposal_id,
             adjustment.snapshot_id AS adjustment_snapshot_id,
             adjustment.prior_value_state AS adjustment_prior_value_state,
             adjustment.prior_value_minor AS adjustment_prior_value_minor,
             adjustment.value_minor AS adjustment_value_minor,
             adjustment.currency AS adjustment_currency,
             adjustment.effective_date AS adjustment_effective_date,
             adjustment.source_kind AS adjustment_source_kind,
             adjustment.source_label AS adjustment_source_label,
             adjustment.source_url AS adjustment_source_url,
             adjustment.commentary AS adjustment_commentary,
             adjustment_review.decided_at AS adjustment_accepted_at,
             prior_adjustment.effective_date
               AS prior_adjustment_effective_date,
             economics.id AS economics_id,
             economics.snapshot_id AS economics_snapshot_id,
             economics.commitment_minor AS economics_commitment_minor,
             economics.funded_minor AS economics_funded_minor,
             economics.capital_basis AS economics_capital_basis,
             economics.gross_commitment_minor AS economics_gross_commitment_minor,
             economics.setup_fee_ppm AS economics_setup_fee_ppm,
             economics.annual_admin_fee_ppm
               AS economics_annual_admin_fee_ppm,
             economics.admin_fee_years AS economics_admin_fee_years,
             economics.carry_ppm AS economics_carry_ppm,
             economics.note AS economics_note,
             economics_review.decided_at AS economics_accepted_at,
             economics_evidence.management_fee_ppm
               AS reported_management_fee_ppm,
             economics_evidence.carry_ppm AS reported_carry_ppm
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
           LEFT JOIN holding_import_applications prior_application
             ON prior_application.id = (
               SELECT candidate.id
               FROM holding_import_applications candidate
               JOIN holding_position_snapshots candidate_snapshot
                 ON candidate_snapshot.id = candidate.snapshot_id
               WHERE candidate.position_id = position.id
                 AND candidate.id <> application.id
               ORDER BY candidate.applied_at DESC,
                        candidate_snapshot.observed_at DESC,
                        candidate.id DESC
               LIMIT 1
             )
           LEFT JOIN holding_position_snapshots prior_snapshot
             ON prior_snapshot.id = prior_application.snapshot_id
           JOIN holding_import_rows accepted_row
             ON accepted_row.id = application.import_row_id
           LEFT JOIN holding_import_row_provider_investments provider_identity ON provider_identity.import_row_id = accepted_row.id
           LEFT JOIN holding_import_row_reported_economics_evidence
             economics_evidence
             ON economics_evidence.import_row_id = accepted_row.id
           JOIN holding_imports accepted_import
             ON accepted_import.id = accepted_row.import_id
           LEFT JOIN provider_legal_document_latest legal_latest
             ON legal_latest.household_id = position.household_id
            AND legal_latest.provider = accepted_import.provider
            AND legal_latest.position_fingerprint = accepted_row.position_fingerprint
           LEFT JOIN provider_legal_document_observations legal_observation
             ON legal_observation.id = legal_latest.observation_id
             AND (provider_identity.provider_investment_id IS NULL OR json_extract(legal_observation.capture_json, '$.sourceInvestment.id') = provider_identity.provider_investment_id)
           LEFT JOIN holding_investment_reviews investment_review ON investment_review.id = (
             SELECT id FROM holding_investment_reviews WHERE household_id = position.household_id AND position_id = position.id ORDER BY version DESC LIMIT 1
           )
           LEFT JOIN investment_company_reviews company_review ON company_review.id = (
             SELECT id FROM investment_company_reviews WHERE household_id = position.household_id AND position_id = position.id ORDER BY version DESC LIMIT 1
           )
           JOIN source_documents document
             ON document.id = accepted_import.source_document_id
           LEFT JOIN holding_position_value_proposals adjustment
             ON adjustment.id = (
               SELECT proposal.id
               FROM holding_position_value_proposals proposal
               JOIN holding_position_value_reviews review
                 ON review.proposal_id = proposal.id
                AND review.decision = 'accepted'
               WHERE proposal.position_id = position.id
                 AND proposal.household_id = position.household_id
                 AND NOT EXISTS (
                   SELECT 1
                   FROM holding_position_value_proposals later
                   JOIN holding_position_value_reviews later_review
                     ON later_review.proposal_id = later.id
                    AND later_review.decision = 'accepted'
                   WHERE later.supersedes_proposal_id = proposal.id
                 )
               ORDER BY review.decided_at DESC, proposal.id DESC
               LIMIT 1
             )
           LEFT JOIN holding_position_value_reviews adjustment_review
             ON adjustment_review.proposal_id = adjustment.id
            AND adjustment_review.decision = 'accepted'
           LEFT JOIN holding_position_value_proposals prior_adjustment
             ON prior_adjustment.id = adjustment.supersedes_proposal_id
           LEFT JOIN holding_position_economics_proposals economics
             ON economics.id = (
               SELECT proposal.id
               FROM holding_position_economics_proposals proposal
               JOIN holding_position_economics_reviews review
                 ON review.proposal_id = proposal.id
                AND review.decision = 'accepted'
               WHERE proposal.position_id = position.id
                 AND proposal.household_id = position.household_id
                 AND NOT EXISTS (
                   SELECT 1
                   FROM holding_position_economics_proposals later
                   JOIN holding_position_economics_reviews later_review
                     ON later_review.proposal_id = later.id
                    AND later_review.decision = 'accepted'
                   WHERE later.supersedes_proposal_id = proposal.id
                 )
               ORDER BY review.decided_at DESC, proposal.id DESC
               LIMIT 1
             )
           LEFT JOIN holding_position_economics_reviews economics_review
             ON economics_review.proposal_id = economics.id
            AND economics_review.decision = 'accepted'
           WHERE position.household_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM holding_position_continuities continuity
               WHERE continuity.predecessor_position_id = position.id
             )
           ORDER BY ownership.container_id,
                    lower(position.legal_vehicle_name),
                    position.id`,
          )
          .bind(householdId),
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
