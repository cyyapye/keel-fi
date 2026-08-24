import type {
  CanonicalExposure,
  Holding,
  PositionExposureMapping,
} from "../packages/domain/src/index";
import {
  createInvestmentExposureView,
  type InvestmentExposureView,
} from "../packages/domain/src/exposure-read-model";
import {
  InvestmentHoldingsViewSchema,
  type InvestmentHoldingsView,
} from "../packages/domain/src/investment-holdings-view";
import type {
  InvestmentPositionConnection,
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "../packages/domain/src/position-read-model";

const asOf = "2026-08-16T12:00:00.000Z";
const householdId = "household_synthetic";

function fingerprint(character: string): string {
  return character.repeat(64);
}

function fingerprintForIndex(index: number): string {
  return index.toString(16).padStart(2, "0").repeat(32);
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
    snapshot: {
      id: `snapshot_${holding.id}`,
      fingerprint: fingerprintForIndex(index),
      observedAt: holding.retrievedAt,
      providerStatus: "live",
      investedMinor: holding.administratorNavMinor ?? 0,
      allocationMinor: holding.administratorNavMinor ?? 0,
      unrealizedValue: {
        state: valueState,
        minor: holding.administratorNavMinor,
      },
      realizedValueMinor: 0,
      netValue: {
        state: valueState,
        minor: holding.administratorNavMinor,
      },
      instrumentType: holding.ticker === null ? "private" : "equity",
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

export const emptyInvestmentHoldingsView: InvestmentHoldingsView =
  InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "provider_approval_required",
    positionView: { asOf, connections: [] },
    exposureView: { asOf, positions: [], exposures: [] },
  });

export function investmentHoldingsViewFor(
  holdings: readonly Holding[],
): InvestmentHoldingsView {
  const records = holdings.map(recordFromHolding);
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

function syntheticPublicPosition(input: {
  id: string;
  observedAt: string;
  valueMinor: number;
}): InvestmentPositionRecord {
  return {
    id: input.id,
    legalVehicleName: "NVDA common stock",
    reportedExposureName: "NVIDIA common stock",
    kind: "direct",
    openedOn: null,
    reviewStatus: "accepted",
    acceptedAt: "2026-08-15T12:00:00.000Z",
    ownershipVersion: 1,
    ownershipBasis: "provider_provenance",
    source: {
      label: "Plaid Investments",
      effectiveDate: input.observedAt.slice(0, 10),
      retrievedAt: input.observedAt,
      freshness:
        input.observedAt < "2026-05-18T12:00:00.000Z" ? "stale" : "current",
    },
    snapshot: {
      id: `snapshot_${input.id}`,
      fingerprint: fingerprint(input.id.at(-1) ?? "a"),
      observedAt: input.observedAt,
      providerStatus: "live",
      investedMinor: input.valueMinor,
      allocationMinor: input.valueMinor,
      unrealizedValue: { state: "reported", minor: input.valueMinor },
      realizedValueMinor: 0,
      netValue: { state: "reported", minor: input.valueMinor },
      instrumentType: "equity",
      currency: "USD",
      quantityMicros: 1_000_000,
      ticker: "NVDA",
      costBasisMinor: null,
    },
  };
}

function syntheticCashPosition(input: {
  id: string;
  observedAt: string;
  valueMinor: number;
}): InvestmentPositionRecord {
  const position = syntheticPublicPosition(input);
  return {
    ...position,
    legalVehicleName: "U S Dollar",
    reportedExposureName: "US Dollar",
    snapshot: {
      ...position.snapshot,
      instrumentType: "cash",
      ticker: null,
      quantityMicros: null,
      costBasisMinor: null,
    },
  };
}

export function multiInstitutionInvestmentHoldingsView(): InvestmentHoldingsView {
  const robinhood = syntheticPublicPosition({
    id: "position_nvda_robinhood_1",
    observedAt: "2026-08-15T11:45:00.000Z",
    valueMinor: 18_500_000,
  });
  const fidelityBrokerage = syntheticPublicPosition({
    id: "position_nvda_fidelity_brokerage_2",
    observedAt: "2026-08-15T11:45:00.000Z",
    valueMinor: 24_000_000,
  });
  const fidelityIra = syntheticPublicPosition({
    id: "position_nvda_fidelity_ira_3",
    observedAt: "2026-08-15T11:45:00.000Z",
    valueMinor: 31_500_000,
  });
  const robinhoodCash = syntheticCashPosition({
    id: "position_cash_robinhood_6",
    observedAt: "2026-08-15T11:45:00.000Z",
    valueMinor: 125_000,
  });
  const fidelityCash = syntheticCashPosition({
    id: "position_cash_fidelity_ira_7",
    observedAt: "2026-08-15T11:45:00.000Z",
    valueMinor: 225_000,
  });
  const fundPosition: InvestmentPositionRecord = {
    ...syntheticPublicPosition({
      id: "position_synthetic_fund_4",
      observedAt: "2026-08-15T11:45:00.000Z",
      valueMinor: 9_000_000,
    }),
    legalVehicleName: "Synthetic Growth Fund",
    reportedExposureName: null,
    kind: "fund_interest",
    snapshot: {
      ...syntheticPublicPosition({
        id: "position_synthetic_fund_4",
        observedAt: "2026-08-15T11:45:00.000Z",
        valueMinor: 9_000_000,
      }).snapshot,
      instrumentType: "mutual fund",
      ticker: "SYNF",
    },
  };
  const lockedPosition: InvestmentPositionRecord = {
    ...syntheticPublicPosition({
      id: "position_locked_spv_5",
      observedAt: "2026-08-15T11:45:00.000Z",
      valueMinor: 0,
    }),
    legalVehicleName: "Synthetic Horizon SPV",
    reportedExposureName: "Harbor Health Systems",
    kind: "spv_interest",
    ownershipBasis: "reviewed_import",
    snapshot: {
      ...syntheticPublicPosition({
        id: "position_locked_spv_5",
        observedAt: "2026-08-15T11:45:00.000Z",
        valueMinor: 0,
      }).snapshot,
      netValue: { state: "locked", minor: null },
      unrealizedValue: { state: "locked", minor: null },
      ticker: null,
      quantityMicros: null,
      instrumentType: "spv interest",
    },
  };
  const positionView: InvestmentPositionView = {
    asOf,
    connections: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        purpose: "source",
        adapterType: "plaid-investments",
        institutionKey: "ins_robinhood",
        institutionLabel: "Robinhood",
        lifecycleState: "active",
        containers: [
          {
            id: "container_robinhood_brokerage",
            label: "Robinhood brokerage",
            kind: "brokerage",
            taxTreatment: "taxable",
            coverage: {
              completeness: "complete",
              observedAt: "2026-08-15T11:45:00.000Z",
              freshness: "current",
            },
            positions: [robinhood, robinhoodCash],
          },
        ],
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        purpose: "source",
        adapterType: "plaid-investments",
        institutionKey: "ins_fidelity",
        institutionLabel: "Fidelity",
        lifecycleState: "active",
        containers: [
          {
            id: "container_fidelity_brokerage",
            label: "Fidelity brokerage",
            kind: "brokerage",
            taxTreatment: "taxable",
            coverage: {
              completeness: "complete",
              observedAt: "2026-08-15T11:45:00.000Z",
              freshness: "current",
            },
            positions: [fidelityBrokerage, fundPosition],
          },
          {
            id: "container_fidelity_ira",
            label: "Fidelity rollover IRA",
            kind: "ira",
            taxTreatment: "tax_deferred",
            coverage: {
              completeness: "partial",
              observedAt: "2026-08-15T11:45:00.000Z",
              freshness: "current",
            },
            positions: [fidelityIra, fidelityCash],
          },
        ],
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        purpose: "source",
        adapterType: "plaid-investments",
        institutionKey: "ins_fidelity",
        institutionLabel: "Fidelity",
        lifecycleState: "paused",
        containers: [
          {
            id: "container_fidelity_second_item",
            label: "Fidelity inherited IRA",
            kind: "ira",
            taxTreatment: "tax_deferred",
            coverage: {
              completeness: "complete",
              observedAt: "2026-04-01T11:45:00.000Z",
              freshness: "stale",
            },
            positions: [],
          },
        ],
      },
      {
        id: "connection_angellist_synthetic",
        purpose: "source",
        adapterType: "angellist-import",
        institutionKey: "angellist-synthetic",
        institutionLabel: "AngelList imports",
        lifecycleState: "active",
        containers: [
          {
            id: "container_synthetic_entity",
            label: "Demo Family LLC",
            kind: "entity",
            taxTreatment: "unknown",
            coverage: {
              completeness: "complete",
              observedAt: "2026-08-15T11:45:00.000Z",
              freshness: "current",
            },
            positions: [lockedPosition],
          },
        ],
      },
    ],
  };
  const nvdaExposure: CanonicalExposure = {
    id: "exposure_nvda_synthetic",
    householdId,
    exposureKind: "public_instrument",
    canonicalName: "NVIDIA common stock",
    protectedIdentityKey: fingerprint("a"),
    companyId: null,
    resolutionMethod: "strong_identifier",
    evidenceSha256: fingerprint("b"),
    createdAt: "2026-08-15T12:00:00.000Z",
  };
  const fundUnderlyingOne: CanonicalExposure = {
    ...nvdaExposure,
    id: "exposure_fund_one",
    canonicalName: "Synthetic Cloud Basket",
    protectedIdentityKey: fingerprint("c"),
  };
  const cashExposure: CanonicalExposure = {
    ...nvdaExposure,
    id: "exposure_usd_cash_synthetic",
    canonicalName: "US Dollar",
    protectedIdentityKey: fingerprint("9"),
  };
  const fundUnderlyingTwo: CanonicalExposure = {
    ...nvdaExposure,
    id: "exposure_fund_two",
    canonicalName: "Synthetic Infrastructure Basket",
    protectedIdentityKey: fingerprint("d"),
  };
  const privateExposure: CanonicalExposure = {
    id: "exposure_private_synthetic",
    householdId,
    exposureKind: "private_company",
    canonicalName: "Harbor Health Systems",
    protectedIdentityKey: null,
    companyId: "company_harbor_synthetic",
    resolutionMethod: "reviewed_company",
    evidenceSha256: fingerprint("e"),
    createdAt: "2026-08-15T12:00:00.000Z",
  };
  const mappings: PositionExposureMapping[] = [
    robinhood,
    fidelityBrokerage,
    fidelityIra,
  ].map((position, index) => ({
    id: `mapping_nvda_${index + 1}`,
    householdId,
    positionId: position.id,
    exposureId: nvdaExposure.id,
    relationshipKind: "direct",
    allocationPpm: 1_000_000,
    status: "active",
    decisionSource: "deterministic_policy",
    decisionReference: `synthetic public mapping ${index + 1}`,
    evidenceSha256: fingerprint("f"),
    effectiveAt: "2026-08-15T12:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  }));
  for (const [index, position] of [robinhoodCash, fidelityCash].entries()) {
    mappings.push({
      id: `mapping_cash_${index + 1}`,
      householdId,
      positionId: position.id,
      exposureId: cashExposure.id,
      relationshipKind: "direct",
      allocationPpm: 1_000_000,
      status: "active",
      decisionSource: "deterministic_policy",
      decisionReference: "cash-currency-v1:USD",
      evidenceSha256: fingerprint("8"),
      effectiveAt: "2026-08-15T12:00:00.000Z",
      version: 1,
      supersedesMappingId: null,
    });
  }
  for (const [index, exposure] of [
    fundUnderlyingOne,
    fundUnderlyingTwo,
  ].entries()) {
    mappings.push({
      id: `mapping_fund_${index + 1}`,
      householdId,
      positionId: fundPosition.id,
      exposureId: exposure.id,
      relationshipKind: "look_through",
      allocationPpm: null,
      status: "active",
      decisionSource: "review",
      decisionReference: `synthetic fund relationship ${index + 1}`,
      evidenceSha256: fingerprint("1"),
      effectiveAt: "2026-08-15T12:00:00.000Z",
      version: 1,
      supersedesMappingId: null,
    });
  }
  mappings.push({
    id: "mapping_private_1",
    householdId,
    positionId: lockedPosition.id,
    exposureId: privateExposure.id,
    relationshipKind: "direct",
    allocationPpm: 1_000_000,
    status: "active",
    decisionSource: "review",
    decisionReference: "synthetic private mapping",
    evidenceSha256: fingerprint("2"),
    effectiveAt: "2026-08-15T12:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  });
  const exposureView: InvestmentExposureView = createInvestmentExposureView(
    positionView,
    [
      nvdaExposure,
      cashExposure,
      fundUnderlyingOne,
      fundUnderlyingTwo,
      privateExposure,
    ],
    mappings,
  );
  return InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "available",
    positionView,
    exposureView,
  });
}

export function reconciledReviewedHistoryInvestmentHoldingsView(
  positionCount = 14,
): InvestmentHoldingsView {
  const base = multiInstitutionInvestmentHoldingsView();
  const seedPosition = base.positionView.connections
    .flatMap((connection) => connection.containers)
    .flatMap((container) => container.positions)
    .find((position) => position.kind === "spv_interest")!;
  const positions = Array.from({ length: positionCount }, (_, index) => {
    const sequence = String(index + 1).padStart(2, "0");
    return {
      ...seedPosition,
      id: `position_reviewed_history_${sequence}`,
      legalVehicleName: `Demo Pharmacy SPV ${sequence}`,
      reportedExposureName: "Demo Pharmacy",
      snapshot: {
        ...seedPosition.snapshot,
        id: `snapshot_reviewed_history_${sequence}`,
        fingerprint: fingerprint((index % 10).toString()),
      },
    };
  });
  const positionView: InvestmentPositionView = {
    asOf,
    connections: [
      {
        id: "reconciled-holding-connection-v1:household_synthetic:angellist",
        purpose: "reviewed_history",
        adapterType: "angellist-import",
        institutionKey: "reviewed-history:angellist",
        institutionLabel: "AngelList reviewed history",
        lifecycleState: "pending",
        containers: positions.map((position, index) => {
          const sequence = String(index + 1).padStart(2, "0");
          return {
            id: `reconciled-holding-container-v1:${position.id}`,
            label: `Demo Family holding ${sequence}`,
            kind: "unresolved" as const,
            taxTreatment: "unknown" as const,
            coverage: {
              completeness: "ambiguous" as const,
              observedAt: "2026-08-15T11:45:00.000Z",
              freshness: "current" as const,
            },
            positions: [position],
          };
        }),
      },
    ],
  };
  const exposure: CanonicalExposure = {
    id: "exposure_demo_pharmacy_synthetic",
    householdId,
    exposureKind: "private_company",
    canonicalName: "Demo Pharmacy",
    protectedIdentityKey: null,
    companyId: "company_demo_pharmacy_synthetic",
    resolutionMethod: "reviewed_company",
    evidenceSha256: fingerprint("e"),
    createdAt: "2026-08-15T12:00:00.000Z",
  };
  const mappings: PositionExposureMapping[] = positions.map(
    (position, index) => ({
      id: `mapping_reviewed_history_${index + 1}`,
      householdId,
      positionId: position.id,
      exposureId: exposure.id,
      relationshipKind: "look_through",
      allocationPpm: 1_000_000,
      status: "active",
      decisionSource: "review",
      decisionReference: `synthetic reviewed company ${index + 1}`,
      evidenceSha256: fingerprint("f"),
      effectiveAt: "2026-08-15T12:00:00.000Z",
      version: 1,
      supersedesMappingId: null,
    }),
  );
  return InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "available",
    positionView,
    exposureView: createInvestmentExposureView(
      positionView,
      [exposure],
      mappings,
    ),
  });
}
