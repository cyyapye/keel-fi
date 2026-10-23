import type {
  CanonicalExposure,
  Holding,
  PositionExposureMapping,
} from "../../packages/domain/src/index";
import { createInvestmentExposureView } from "../../packages/domain/src/exposure-read-model";
import {
  InvestmentHoldingsViewSchema,
  type InvestmentHoldingsView,
} from "../../packages/domain/src/investment-holdings-view";
import type {
  InvestmentPositionConnection,
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "../../packages/domain/src/position-read-model";

const asOf = "2026-08-16T12:00:00.000Z";
const householdId = "household_synthetic";

function fingerprint(character: string): string {
  return character.repeat(64);
}

function fingerprintForIndex(index: number): string {
  return index.toString(16).padStart(64, "0");
}

function recordFromHolding(
  holding: Holding,
  index: number,
): InvestmentPositionRecord {
  const valueState =
    holding.administratorNavState === "not_set"
      ? "not_reported"
      : holding.administratorNavState;
  return {
    id: holding.id,
    legalVehicleName: holding.positionName,
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
    },
    reportedExposureName: holding.exposureName,
    kind: holding.positionKind,
    openedOn: null,
    reviewStatus: "accepted",
    acceptedAt: "2026-08-15T12:00:00.000Z",
    ownershipVersion: 1,
    ownershipBasis:
      holding.sourceLabel === "Plaid Investments"
        ? "provider_provenance"
        : "reviewed_import",
    source: {
      label: holding.sourceLabel,
      effectiveDate: holding.effectiveDate,
      retrievedAt: holding.retrievedAt,
      freshness: "current",
    },
    acceptedValueAdjustment:
      holding.positionValueContext?.acceptedAdjustment ?? null,
    acceptedEconomicsTerms:
      holding.positionEconomicsContext?.acceptedTerms ?? null,
    reportedEconomicsTerms:
      holding.positionEconomicsContext?.reportedTerms ?? null,
    snapshot: {
      id: `snapshot_${holding.id}`,
      fingerprint: fingerprintForIndex(index),
      observedAt: holding.retrievedAt,
      providerStatus: "live",
      investedMinor:
        holding.investedMinor ?? holding.administratorNavMinor ?? 0,
      allocationMinor:
        holding.committedMinor ?? holding.administratorNavMinor ?? 0,
      unrealizedValue: {
        state: valueState,
        minor: holding.administratorNavMinor,
      },
      realizedValueMinor: holding.realizedValueMinor ?? 0,
      netValue: {
        state: valueState,
        minor: holding.administratorNavMinor,
      },
      instrumentType:
        holding.instrumentType ??
        (holding.ticker === null ? "private" : "equity"),
      currency: "USD",
      quantityMicros: holding.quantityMicros ?? null,
      ticker: holding.ticker ?? null,
      costBasisMinor: holding.costBasisMinor ?? null,
    },
  };
}

function reviewedExposure(holding: Holding, index: number): CanonicalExposure {
  const publicPosition = holding.ticker !== null;
  return {
    id: `exposure_${holding.id}`,
    householdId,
    exposureKind: publicPosition ? "public_instrument" : "private_company",
    canonicalName: holding.exposureName ?? holding.positionName,
    protectedIdentityKey: publicPosition ? fingerprintForIndex(index) : null,
    companyId: publicPosition ? null : holding.companyId,
    resolutionMethod: publicPosition ? "strong_identifier" : "reviewed_company",
    evidenceSha256: fingerprint("e"),
    createdAt: "2026-08-15T12:00:00.000Z",
  };
}

function directMapping(
  holding: Holding,
  exposure: CanonicalExposure,
  index: number,
): PositionExposureMapping {
  return {
    id: `mapping_${holding.id}`,
    householdId,
    positionId: holding.id,
    exposureId: exposure.id,
    relationshipKind:
      holding.positionKind === "direct" ? "direct" : "look_through",
    allocationPpm: 1_000_000,
    status: "active",
    decisionSource: holding.ticker === null ? "review" : "deterministic_policy",
    decisionReference: `synthetic decision ${index + 1}`,
    evidenceSha256: fingerprint("d"),
    effectiveAt: "2026-08-15T12:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  };
}

export function investmentHoldingsViewFor(
  holdings: readonly Holding[],
  priorValuesByPosition: Readonly<Record<string, number>> = {},
): InvestmentHoldingsView {
  const records = holdings.map((holding, index) => {
    const record = recordFromHolding(holding, index);
    const priorValueMinor = priorValuesByPosition[holding.id];
    return priorValueMinor === undefined
      ? record
      : {
          ...record,
          priorValue: {
            state: "reported" as const,
            minor: priorValueMinor,
            observedAt: "2026-07-16T12:00:00.000Z",
          },
        };
  });
  const privatePositions = records.filter(
    (record) => record.snapshot.ticker === null,
  );
  const publicPositions = records.filter(
    (record) => record.snapshot.ticker !== null,
  );
  const connections: InvestmentPositionConnection[] = [];
  if (privatePositions.length > 0) {
    connections.push({
      id: "connection_angellist_synthetic",
      purpose: "source",
      adapterType: "angellist-import",
      institutionKey: "angellist-synthetic",
      institutionLabel: "AngelList imports",
      lifecycleState: "active",
      containers: [
        {
          id: "container_angellist_synthetic",
          label: "Demo Family holdings",
          kind: "entity",
          taxTreatment: "unknown",
          coverage: {
            completeness: "complete",
            observedAt: "2026-08-15T11:45:00.000Z",
            freshness: "current",
          },
          positions: privatePositions,
        },
      ],
    });
  }
  if (publicPositions.length > 0) {
    connections.push({
      id: "11111111-1111-4111-8111-111111111111",
      purpose: "source",
      adapterType: "plaid-investments",
      institutionKey: "ins_robinhood",
      institutionLabel: "Robinhood",
      lifecycleState: "active",
      containers: [
        {
          id: "container_robinhood_synthetic",
          label: "Robinhood brokerage",
          kind: "brokerage",
          taxTreatment: "taxable",
          coverage: {
            completeness: "complete",
            observedAt: "2026-08-15T11:45:00.000Z",
            freshness: "current",
          },
          positions: publicPositions,
        },
      ],
    });
  }
  const positionView: InvestmentPositionView = { asOf, connections };
  const resolvedHoldings = holdings.filter(
    (holding) => holding.ticker !== null || holding.companyId !== null,
  );
  const exposureByIdentity = new Map<string, CanonicalExposure>();
  const mappings = resolvedHoldings.map((holding, index) => {
    const identity =
      holding.ticker === null
        ? `company:${holding.companyId}`
        : `position:${holding.id}`;
    const exposure =
      exposureByIdentity.get(identity) ?? reviewedExposure(holding, index);
    exposureByIdentity.set(identity, exposure);
    return directMapping(holding, exposure, index);
  });
  const exposures = [...exposureByIdentity.values()];
  return InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "provider_approval_required",
    positionView,
    exposureView: createInvestmentExposureView(
      positionView,
      exposures,
      mappings,
    ),
  });
}
