export { investmentHoldingsViewFor } from "../scripts/test-support/investment-holdings-view";
import type {
  CanonicalExposure,
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
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "../packages/domain/src/position-read-model";

const asOf = "2026-08-16T12:00:00.000Z";
const householdId = "household_synthetic";

function fingerprint(character: string): string {
  return character.repeat(64);
}

export const emptyInvestmentHoldingsView: InvestmentHoldingsView =
  InvestmentHoldingsViewSchema.parse({
    version: 1,
    authorizationStatus: "provider_approval_required",
    positionView: { asOf, connections: [] },
    exposureView: { asOf, positions: [], exposures: [] },
  });

function syntheticPublicPosition(input: {
  costBasisMinor?: number | null;
  id: string;
  observedAt: string;
  quantityMicros?: number;
  valueMinor: number;
}): InvestmentPositionRecord {
  return {
    id: input.id,
    legalVehicleName: "NVDA common stock",
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
    },
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
      quantityMicros: input.quantityMicros ?? 1_000_000,
      ticker: "NVDA",
      costBasisMinor: input.costBasisMinor ?? null,
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
    costBasisMinor: 17_035_000,
    id: "position_nvda_robinhood_1",
    observedAt: "2026-08-15T11:45:00.000Z",
    quantityMicros: 1_000_000_000,
    valueMinor: 18_500_000,
  });
  const fidelityBrokerage = syntheticPublicPosition({
    costBasisMinor: 22_099_000,
    id: "position_nvda_fidelity_brokerage_2",
    observedAt: "2026-08-15T11:45:00.000Z",
    quantityMicros: 1_297_297_297,
    valueMinor: 24_000_000,
  });
  const fidelityIra = syntheticPublicPosition({
    costBasisMinor: 29_006_000,
    id: "position_nvda_fidelity_ira_3",
    observedAt: "2026-08-15T11:45:00.000Z",
    quantityMicros: 1_702_702_703,
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
  const investedAmountPosition: InvestmentPositionRecord = {
    ...syntheticPublicPosition({
      id: "position_invested_amount_8",
      observedAt: "2026-08-15T11:45:00.000Z",
      valueMinor: 4_000_000,
    }),
    legalVehicleName: "Synthetic Beacon SPV",
    reportedExposureName: "Beacon Robotics",
    kind: "spv_interest",
    openedOn: "2024-06-15",
    ownershipBasis: "reviewed_import",
    source: {
      ...syntheticPublicPosition({
        id: "position_invested_amount_8",
        observedAt: "2026-08-15T11:45:00.000Z",
        valueMinor: 4_000_000,
      }).source,
      label: "Synthetic GP portal",
    },
    snapshot: {
      ...syntheticPublicPosition({
        id: "position_invested_amount_8",
        observedAt: "2026-08-15T11:45:00.000Z",
        valueMinor: 4_000_000,
      }).snapshot,
      netValue: { state: "not_reported", minor: null },
      unrealizedValue: { state: "not_reported", minor: null },
      ticker: null,
      quantityMicros: null,
      instrumentType: "spv interest",
    },
  };
  const gpMarkedPosition: InvestmentPositionRecord = {
    ...syntheticPublicPosition({
      id: "position_gp_marked_9",
      observedAt: "2026-08-15T11:45:00.000Z",
      valueMinor: 6_000_000,
    }),
    legalVehicleName: "Synthetic Beacon Direct",
    reportedExposureName: "Beacon Robotics",
    kind: "direct",
    openedOn: "2023-03-10",
    ownershipBasis: "reviewed_import",
    source: {
      ...syntheticPublicPosition({
        id: "position_gp_marked_9",
        observedAt: "2026-08-15T11:45:00.000Z",
        valueMinor: 6_000_000,
      }).source,
      label: "Synthetic GP portal",
    },
    snapshot: {
      ...syntheticPublicPosition({
        id: "position_gp_marked_9",
        observedAt: "2026-08-15T11:45:00.000Z",
        valueMinor: 6_000_000,
      }).snapshot,
      investedMinor: 2_000_000,
      allocationMinor: 2_000_000,
      costBasisMinor: null,
      ticker: null,
      quantityMicros: null,
      instrumentType: "private preferred shares",
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
            positions: [
              lockedPosition,
              investedAmountPosition,
              gpMarkedPosition,
            ],
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
  const investedAmountExposure: CanonicalExposure = {
    ...privateExposure,
    id: "exposure_invested_amount_synthetic",
    canonicalName: "Beacon Robotics",
    companyId: "company_beacon_synthetic",
    evidenceSha256: fingerprint("7"),
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
  mappings.push({
    id: "mapping_invested_amount_1",
    householdId,
    positionId: investedAmountPosition.id,
    exposureId: investedAmountExposure.id,
    relationshipKind: "look_through",
    allocationPpm: 1_000_000,
    status: "active",
    decisionSource: "review",
    decisionReference: "synthetic invested amount mapping",
    evidenceSha256: fingerprint("7"),
    effectiveAt: "2026-08-15T12:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  });
  mappings.push({
    id: "mapping_gp_marked_1",
    householdId,
    positionId: gpMarkedPosition.id,
    exposureId: investedAmountExposure.id,
    relationshipKind: "direct",
    allocationPpm: 1_000_000,
    status: "active",
    decisionSource: "review",
    decisionReference: "synthetic GP-marked private mapping",
    evidenceSha256: fingerprint("6"),
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
      investedAmountExposure,
    ],
    mappings,
    [
      {
        companyId: "company_beacon_synthetic",
        evidenceEventId: "event_beacon_series_a",
        effectiveDate: "2023-03-01",
        postMoneyValueMinor: 50_000_000_000,
        currency: "USD",
        sourceTitle: "Beacon Robotics Series A",
        sourceUrl: "https://example.com/beacon-series-a",
        approximate: false,
      },
      {
        companyId: "company_beacon_synthetic",
        evidenceEventId: "event_beacon_series_b",
        effectiveDate: "2024-06-01",
        postMoneyValueMinor: 100_000_000_000,
        currency: "USD",
        sourceTitle: "Beacon Robotics Series B",
        sourceUrl: "https://example.com/beacon-series-b",
        approximate: false,
      },
    ],
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
  // One reviewed source has a single legal position; the other owns the rest.
  // Neither group should appear as a brokerage when connections finish loading.
  const source = positionView.connections[0]!;
  if (source.containers.length > 1) {
    const [first, ...remaining] = source.containers;
    positionView.connections = [
      { ...source, containers: remaining },
      { ...source, id: `${source.id}:single-position`, containers: [first!] },
    ];
  }
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

export function alphaHoldingsFrom(view: InvestmentHoldingsView) {
  const sourcePositionById = new Map(
    view.positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => [position.id, position] as const),
      ),
    ),
  );
  return view.exposureView.positions.map((position) => {
    const sourcePosition = sourcePositionById.get(position.id);
    if (sourcePosition === undefined) {
      throw new Error(
        "Synthetic exposure position is missing source evidence.",
      );
    }
    return {
      id: position.id,
      companyId:
        view.exposureView.exposures.find((group) =>
          group.contributions.some(
            (contribution) => contribution.positionId === position.id,
          ),
        )?.exposure.companyId ?? null,
      positionName: position.legalVehicleName,
      acceptedLegalName: sourcePosition.acceptedLegalName,
      exposureName: position.reportedExposureName,
      ownerLabel: position.containerLabel,
      positionKind: position.positionKind,
      administratorNavMinor: sourcePosition.snapshot.unrealizedValue.minor,
      administratorNavState:
        sourcePosition.snapshot.unrealizedValue.state === "not_reported"
          ? ("not_set" as const)
          : sourcePosition.snapshot.unrealizedValue.state,
      externalMarkMinor: null,
      underwritingValueMinor: null,
      scenarioValueMinor: null,
      usableLiquidityMinor: null,
      sourceStatus: "verified" as const,
      sourceLabel: position.sourceLabel,
      effectiveDate: position.observedAt.slice(0, 10),
      retrievedAt: position.observedAt,
      confidencePpm: null,
      ticker: position.ticker,
      quantityMicros: null,
      costBasisMinor: position.providerCostBasisMinor,
      investedMinor: position.investedMinor,
      committedMinor: position.committedMinor,
      realizedValueMinor: position.realizedValueMinor,
      instrumentType: position.instrumentType,
      positionEconomicsContext:
        position.positionKind !== "spv_interest" ||
        position.committedMinor === null ||
        position.investedMinor === null ||
        position.committedMinor <= 0
          ? undefined
          : {
              snapshotId: position.snapshotId,
              currency: position.currency,
              committedMinor: position.committedMinor,
              fundedMinor: position.investedMinor,
              acceptedTerms: position.acceptedEconomicsTerms ?? null,
              reportedTerms: position.reportedEconomicsTerms ?? null,
            },
      positionValueContext: {
        snapshotId: position.snapshotId,
        currency: position.currency,
        providerValueState: sourcePosition.snapshot.unrealizedValue.state,
        providerValueMinor: sourcePosition.snapshot.unrealizedValue.minor,
        acceptedAdjustment: sourcePosition.acceptedValueAdjustment ?? null,
        projectedEstimate: position.privateValueEstimate,
      },
    };
  });
}
