import { reviewedInvestmentFromReceipt } from "@keel/domain/position-purchases";
import { reportedPositionValue } from "@keel/domain/position-read-model";
import { investmentAmount } from "@keel/domain/investment-review";
import { includesCurrentInvestment } from "@keel/domain/investment-review";
import { HoldingSchema, type Holding } from "@keel/domain";
import type { InvestmentExposureView } from "@keel/domain/exposure-read-model";
import {
  HoldingsPageSchema,
  type HoldingsPage,
} from "@keel/domain/holdings-page";
import type {
  InvestmentAuthorizationStatus,
  InvestmentHoldingsView,
} from "@keel/domain/investment-holdings-view";
import type {
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "@keel/domain/position-read-model";

import { D1CashAccountsRepository } from "./cash-accounts";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import { D1HoldingImportRepository } from "./holding-imports";
import { D1InvestmentPositionViewRepository } from "./position-read-model";

type HouseholdIdentity = {
  household_id: string;
  household_name: string;
  pending_evidence_count: number;
};

type LegacyHoldingRow = {
  id: string;
  company_id: string;
  position_name: string;
  exposure_name: string;
  owner_label: string;
  position_kind: "direct" | "spv_interest" | "fund_interest";
  administrator_nav_minor: number | null;
  administrator_nav_state: "reported" | "not_set";
  external_mark_minor: number;
  underwriting_value_minor: number | null;
  scenario_value_minor: number | null;
  usable_liquidity_minor: number | null;
  source_status: "verified" | "review_due" | "proposed";
  source_label: string;
  effective_date: string;
  retrieved_at: string;
  confidence_ppm: number | null;
};

export interface HoldingsPageRepository {
  getPage(
    accessSubject: string,
    authorizationStatus: InvestmentAuthorizationStatus,
  ): Promise<HoldingsPage>;
}

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function legacyHoldingFrom(row: LegacyHoldingRow): Holding {
  return HoldingSchema.parse({
    id: row.id,
    companyId: row.company_id,
    positionName: row.position_name,
    exposureName: row.exposure_name,
    ownerLabel: row.owner_label,
    positionKind: row.position_kind,
    administratorNavMinor: row.administrator_nav_minor,
    administratorNavState: row.administrator_nav_state,
    externalMarkMinor: row.external_mark_minor,
    underwritingValueMinor: row.underwriting_value_minor,
    scenarioValueMinor: row.scenario_value_minor,
    usableLiquidityMinor: row.usable_liquidity_minor,
    sourceStatus: row.source_status,
    sourceLabel: row.source_label,
    effectiveDate: row.effective_date,
    retrievedAt: row.retrieved_at,
    confidencePpm: row.confidence_ppm,
  });
}

function importedHoldingFrom(
  position: InvestmentPositionRecord,
  ownerLabel: string,
  exposurePosition: InvestmentExposureView["positions"][number],
  exposureById: ReadonlyMap<
    string,
    InvestmentExposureView["exposures"][number]["exposure"]
  >,
): Holding {
  const mappedExposures = exposurePosition.mappedExposureIds.flatMap(
    (exposureId) => {
      const exposure = exposureById.get(exposureId);
      return exposure === undefined ? [] : [exposure];
    },
  );
  const companyIds = [
    ...new Set(
      mappedExposures.flatMap((exposure) =>
        exposure.companyId === null ? [] : [exposure.companyId],
      ),
    ),
  ];
  const companyId = companyIds.length === 1 ? (companyIds[0] ?? null) : null;
  const canonicalCompanyNames = mappedExposures
    .filter(
      (exposure) => exposure.companyId === companyId && companyId !== null,
    )
    .map((exposure) => exposure.canonicalName)
    .sort((left, right) => left.localeCompare(right));
  const acceptedAdjustment = position.acceptedValueAdjustment ?? null;

  return HoldingSchema.parse({
    linkedReportedValue: position.linkedReportedValue ?? null,
    purchaseContext:
      position.kind === "spv_interest" && position.snapshot.currency === "USD"
        ? {
            snapshotId: position.snapshot.id,
            currency: "USD",
            openedOn: position.openedOn,
            receipt: position.purchaseReceipt ?? null,
            reportedValueSnapshotId:
              position.linkedReportedValue?.snapshotId ?? position.snapshot.id,
            reportedValueMinor: reportedPositionValue(position).minor,
            reportedSourceLabel:
              position.linkedReportedValue?.sourceLabel ??
              position.source.label,
            sourceObservedOn: (
              position.linkedReportedValue?.observedAt ??
              position.snapshot.observedAt
            ).slice(0, 10),
          }
        : null,
    shareValueEstimate: exposurePosition.shareValueEstimate ?? null,
    id: position.id,
    companyId,
    positionName: position.legalVehicleName,
    exposureName: position.renamedCompany
      ? `${position.renamedCompany.name} (formerly ${position.renamedCompany.formerName})`
      : (canonicalCompanyNames.at(-1) ?? position.reportedExposureName),
    ownerLabel: position.ownerLabel ?? ownerLabel,
    positionKind: position.kind,
    administratorNavMinor: reportedPositionValue(position).minor,
    administratorNavState:
      reportedPositionValue(position).state === "reported"
        ? "reported"
        : reportedPositionValue(position).state === "locked"
          ? "locked"
          : "not_set",
    externalMarkMinor: acceptedAdjustment?.valueMinor ?? null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus:
      position.source.freshness === "stale" ? "review_due" : "verified",
    sourceLabel: position.source.label,
    effectiveDate: position.source.effectiveDate,
    retrievedAt: position.source.retrievedAt,
    confidencePpm: null,
    ticker: position.snapshot.ticker,
    quantityMicros: position.snapshot.quantityMicros,
    costBasisMinor: position.snapshot.costBasisMinor,
    investedMinor: position.snapshot.investedMinor,
    committedMinor: investmentAmount(position),
    realizedValueMinor: position.snapshot.realizedValueMinor,
    instrumentType: position.snapshot.instrumentType,
    positionEconomicsContext:
      position.kind !== "spv_interest" ||
      (investmentAmount(position) <= 0 &&
        !position.purchaseReceipt?.details.investmentTerms)
        ? undefined
        : {
            reviewedInvestment: reviewedInvestmentFromReceipt(
              position.purchaseReceipt,
            ),
            snapshotId: position.snapshot.id,
            currency: position.snapshot.currency,
            committedMinor: investmentAmount(position),
            amountCorrectionNote:
              position.investmentReview?.amountCorrection?.note ?? null,
            fundedMinor: position.snapshot.investedMinor,
            reportedTerms: position.reportedEconomicsTerms ?? null,
            acceptedTerms: position.acceptedEconomicsTerms ?? null,
          },
    positionValueContext: {
      snapshotId: position.snapshot.id,
      currency: position.snapshot.currency,
      providerValueState: position.snapshot.unrealizedValue.state,
      providerValueMinor: position.snapshot.unrealizedValue.minor,
      acceptedAdjustment,
      projectedEstimate: exposurePosition.privateValueEstimate,
    },
  });
}

function importedHoldings(
  positionView: InvestmentPositionView,
  exposureView: InvestmentExposureView,
): Holding[] {
  const exposurePositionById = new Map(
    exposureView.positions.map((position) => [position.id, position]),
  );
  const exposureById = new Map(
    exposureView.exposures.map((group) => [group.exposure.id, group.exposure]),
  );
  return positionView.connections.flatMap((connection) =>
    connection.containers.flatMap((container) =>
      container.positions.filter(includesCurrentInvestment).map((position) => {
        const exposurePosition = exposurePositionById.get(position.id);
        if (exposurePosition === undefined) {
          throw new Error(
            "Accepted position is missing its exposure projection.",
          );
        }
        return importedHoldingFrom(
          position,
          container.label,
          exposurePosition,
          exposureById,
        );
      }),
    ),
  );
}

export class D1HoldingsPageRepository implements HoldingsPageRepository {
  private readonly positions: D1InvestmentPositionViewRepository;
  private readonly exposures: D1InvestmentExposureViewRepository;
  private readonly cashAccounts: D1CashAccountsRepository;
  private readonly holdingImports: D1HoldingImportRepository;

  public constructor(private readonly db: D1Database) {
    this.positions = new D1InvestmentPositionViewRepository(db);
    this.exposures = new D1InvestmentExposureViewRepository(db);
    this.cashAccounts = new D1CashAccountsRepository(db);
    this.holdingImports = new D1HoldingImportRepository(db);
  }

  public async getPage(
    accessSubject: string,
    authorizationStatus: InvestmentAuthorizationStatus,
  ): Promise<HoldingsPage> {
    const identity = await this.findIdentity(accessSubject);
    const asOf = new Date().toISOString();
    const positionViewRequest = this.positions.listForHousehold(
      identity.household_id,
      asOf,
    );
    const exposureViewRequest = this.exposures.listForHousehold(
      identity.household_id,
      asOf,
      positionViewRequest,
    );
    const [
      positionView,
      exposureView,
      legacyHoldings,
      acceptedCashAccounts,
      pendingImports,
    ] = await Promise.all([
      positionViewRequest,
      exposureViewRequest,
      this.listLegacyHoldings(identity.household_id),
      this.cashAccounts.listAcceptedAccountsForHousehold(identity.household_id),
      this.holdingImports.listPendingHoldingImportsForHousehold(
        identity.household_id,
      ),
    ]);
    const investmentHoldings: InvestmentHoldingsView = {
      version: 1,
      authorizationStatus,
      positionView,
      exposureView,
    };

    return HoldingsPageSchema.parse({
      version: 1,
      shell: {
        householdName: identity.household_name,
        pendingEvidenceCount: identity.pending_evidence_count,
      },
      holdings: [
        ...legacyHoldings,
        ...importedHoldings(positionView, exposureView),
      ].sort((left, right) =>
        `${left.exposureName ?? ""}:${left.positionName}:${left.id}`.localeCompare(
          `${right.exposureName ?? ""}:${right.positionName}:${right.id}`,
        ),
      ),
      investmentHoldings,
      acceptedCashAccounts,
      pendingImports,
    });
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT
           household.id AS household_id,
           household.name AS household_name,
           (
             SELECT COUNT(*)
             FROM evidence_events event
             WHERE event.household_id = household.id
               AND event.status = 'pending_review'
           ) AS pending_evidence_count
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("No household is provisioned for this identity.");
    }
    return identity;
  }

  private async listLegacyHoldings(householdId: string): Promise<Holding[]> {
    const rows = await all<LegacyHoldingRow>(
      this.db
        .prepare(
          `SELECT
             lot.id,
             company.id AS company_id,
             lot.lot_label AS position_name,
             company.legal_name AS exposure_name,
             account.name AS owner_label,
             CASE
               WHEN lot.private_vehicle_id IS NULL THEN 'direct'
               WHEN account.account_type = 'fund' THEN 'fund_interest'
               ELSE 'spv_interest'
             END AS position_kind,
             (
               SELECT mark.value_minor
               FROM marks mark
               WHERE mark.asset_lot_id = lot.id
                 AND mark.mark_kind = 'administrator_nav'
               ORDER BY mark.effective_at DESC, mark.created_at DESC
               LIMIT 1
             ) AS administrator_nav_minor,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM marks mark
                 WHERE mark.asset_lot_id = lot.id
                   AND mark.mark_kind = 'administrator_nav'
               ) THEN 'reported'
               ELSE 'not_set'
             END AS administrator_nav_state,
             external.value_minor AS external_mark_minor,
             (
               SELECT mark.value_minor
               FROM marks mark
               WHERE mark.asset_lot_id = lot.id
                 AND mark.mark_kind = 'fi_underwriting'
               ORDER BY mark.effective_at DESC, mark.created_at DESC
               LIMIT 1
             ) AS underwriting_value_minor,
             (
               SELECT mark.value_minor
               FROM marks mark
               WHERE mark.asset_lot_id = lot.id
                 AND mark.mark_kind = 'thesis_weighted'
               ORDER BY mark.effective_at DESC, mark.created_at DESC
               LIMIT 1
             ) AS scenario_value_minor,
             (
               SELECT mark.value_minor
               FROM marks mark
               WHERE mark.asset_lot_id = lot.id
                 AND mark.mark_kind = 'usable_liquidity'
               ORDER BY mark.effective_at DESC, mark.created_at DESC
               LIMIT 1
             ) AS usable_liquidity_minor,
             CASE
               WHEN external.review_status = 'proposed' THEN 'proposed'
               WHEN julianday('now') - julianday(external.retrieved_at) > 90
                 THEN 'review_due'
               ELSE 'verified'
             END AS source_status,
             source.source_name AS source_label,
             substr(external.effective_at, 1, 10) AS effective_date,
             external.retrieved_at,
             source.confidence_ppm
           FROM asset_lots lot
           JOIN companies company ON company.id = lot.company_id
           JOIN asset_accounts account ON account.id = lot.asset_account_id
           JOIN marks external
             ON external.id = (
               SELECT latest.id
               FROM marks latest
               WHERE latest.asset_lot_id = lot.id
                 AND latest.mark_kind = 'external_mark'
               ORDER BY latest.effective_at DESC, latest.created_at DESC
               LIMIT 1
             )
           JOIN mark_sources source ON source.id = external.mark_source_id
           WHERE lot.household_id = ?
             AND NOT EXISTS (
               SELECT 1
               FROM asset_lot_retirements retirement
               WHERE retirement.asset_lot_id = lot.id
                 AND retirement.household_id = lot.household_id
             )
           ORDER BY company.legal_name, lot.lot_label, lot.id`,
        )
        .bind(householdId),
    );
    return rows.map(legacyHoldingFrom);
  }
}
