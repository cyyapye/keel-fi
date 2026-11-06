import { describe, expect, it } from "vitest";

import type { CanonicalExposure, PositionExposureMapping } from "./index";
import {
  companyExposureGroups,
  createInvestmentExposureView,
} from "./exposure-read-model";
import type {
  InvestmentPositionRecord,
  InvestmentPositionView,
} from "./position-read-model";
import { unknownInvestmentTerms } from "./investment-details";
import { calculatePositionPerformance } from "./position-economics";
import { calculatePortfolioPerformance } from "./portfolio-performance";

const asOf = "2026-08-16T12:00:00.000Z";
const evidenceSha256 = "a".repeat(64);

function position(
  id: string,
  valueMinor: number | null,
  valueState: "reported" | "locked" | "not_reported" = "reported",
): InvestmentPositionRecord {
  return {
    id,
    legalVehicleName: `Synthetic position ${id}`,
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
    },
    reportedExposureName: "Synthetic common equity",
    kind: "direct",
    openedOn: "2026-01-15",
    reviewStatus: "accepted",
    acceptedAt: "2026-08-15T12:00:00.000Z",
    ownershipVersion: 1,
    ownershipBasis: "provider_provenance",
    source: {
      label: "Synthetic Investments",
      effectiveDate: "2026-08-15",
      retrievedAt: "2026-08-15T11:50:00.000Z",
      freshness: "current",
    },
    snapshot: {
      id: `snapshot_${id}`,
      fingerprint: id.slice(-1).repeat(64),
      observedAt: "2026-08-15T11:45:00.000Z",
      providerStatus: "live",
      investedMinor: 100_000,
      allocationMinor: 100_000,
      unrealizedValue: { state: valueState, minor: valueMinor },
      realizedValueMinor: 0,
      netValue: { state: valueState, minor: valueMinor },
      instrumentType: "equity",
      currency: "USD",
      quantityMicros: 1_000_000,
      ticker: "SYN",
      costBasisMinor: 100_000,
    },
  };
}

function positionView(
  positions: readonly InvestmentPositionRecord[],
): InvestmentPositionView {
  return {
    asOf,
    connections: [
      {
        id: "connection_synthetic",
        purpose: "source",
        adapterType: "plaid-investments",
        institutionKey: "ins_synthetic",
        institutionLabel: "Synthetic Brokerage",
        lifecycleState: "active",
        containers: positions.map((record, index) => ({
          id: `container_${record.id}`,
          label: `Synthetic account ${index + 1}`,
          kind: index === 2 ? "ira" : "brokerage",
          taxTreatment: index === 2 ? "tax_exempt" : "taxable",
          coverage: {
            completeness: "complete",
            observedAt: "2026-08-15T11:45:00.000Z",
            freshness: "current",
          },
          positions: [record],
        })),
      },
    ],
  };
}

function reviewedProviderPosition(
  id: string,
  effectiveDate: string | null,
  valueMinor = 18_000,
): InvestmentPositionRecord {
  const record = position(id, valueMinor);
  record.kind = "spv_interest";
  record.snapshot.realizedValueMinor = 3_000;
  record.purchaseReceipt = {
    id: `receipt_${id}`,
    positionId: id,
    snapshotId: record.snapshot.id,
    currency: "USD",
    acceptedAt: asOf,
    details: {
      coversPosition: true,
      cashCoversPosition: true,
      investmentTerms: {
        ...unknownInvestmentTerms(),
        reportedValueReview: {
          sourceSnapshotId: record.snapshot.id,
          valueMinor,
          sourceLabel: "Synthetic reviewed GP statement",
          effectiveDate,
          carryStatus: "after_carry",
        },
      },
      lots: [
        {
          id: `lot_${id}`,
          purchasedOn: "2026-01-15",
          shareClass: null,
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: 12_000,
          netCapitalMinor: 10_000,
          upfrontDeductionsMinor: 2_000,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          originalSharesUnchanged: false,
          sourceLabel: "Synthetic subscription",
          sourceUrl: null,
          mark: null,
        },
      ],
      distributionReview: {
        method: "capital_return_first_v1",
        events: [
          {
            id: `distribution_${id}`,
            kind: "in_kind",
            receivedOn: "2026-08-10",
            investorValueMinor: 3_000,
            securityLabel: "Synthetic distributed shares",
            quantityMicros: 1_000_000,
            sourceLabel: "Synthetic distribution notice",
            sourceUrl: null,
            note: "",
          },
        ],
        coverage: { status: "complete", throughDate: "2026-08-31" },
        priorCarry: { status: "known", amountMinor: 0 },
        provider: {
          inclusion: "all",
          sourceSnapshotId: record.snapshot.id,
          realizedValueMinor: 3_000,
        },
        sourceLabel: "Synthetic reviewed history",
        sourceUrl: null,
        note: "",
      },
    },
  };
  return record;
}

function exposure(id: string, canonicalName: string): CanonicalExposure {
  return {
    id,
    householdId: "household_synthetic",
    exposureKind: "public_instrument",
    canonicalName,
    protectedIdentityKey: id.slice(-1).repeat(64),
    companyId: null,
    resolutionMethod: "strong_identifier",
    evidenceSha256,
    createdAt: "2026-08-15T12:00:00.000Z",
  };
}

function mapping(
  id: string,
  positionId: string,
  exposureId: string,
  allocationPpm: number | null = 1_000_000,
): PositionExposureMapping {
  return {
    id,
    householdId: "household_synthetic",
    positionId,
    exposureId,
    relationshipKind: allocationPpm === 1_000_000 ? "direct" : "look_through",
    allocationPpm,
    status: "active",
    decisionSource:
      allocationPpm === 1_000_000 ? "deterministic_policy" : "review",
    decisionReference: "synthetic exposure decision",
    evidenceSha256,
    effectiveAt: "2026-08-15T12:00:00.000Z",
    version: 1,
    supersedesMappingId: null,
  };
}

describe("investment exposure read model", () => {
  it("rolls reviewed public and SPV positions into one company without changing their values", () => {
    const publicSecurity = exposure(
      "exposure_public_b",
      "Synthetic listed security",
    );
    const privateCompany: CanonicalExposure = {
      ...exposure("exposure_company_a", "Synthetic company"),
      exposureKind: "private_company",
      protectedIdentityKey: null,
      companyId: "company_synthetic",
      resolutionMethod: "reviewed_company",
    };
    const publicPositions: InvestmentPositionRecord[] = Array.from(
      { length: 120 },
      (_, index) => ({
        ...reviewedProviderPosition(
          `public_${String(index).padStart(3, "0")}`,
          index % 2 === 0 ? null : "2026-08-12",
          1_000,
        ),
        kind: "direct" as const,
      }),
    );
    publicPositions.push(position("public_locked", null, "locked"));
    const spv = position("spv_1", 25_000);
    spv.kind = "spv_interest";
    spv.snapshot.quantityMicros = null;
    spv.snapshot.ticker = null;
    const canonical = createInvestmentExposureView(
      positionView([...publicPositions, spv]),
      [publicSecurity, privateCompany],
      [
        ...publicPositions.map((record, index) =>
          mapping(`public_mapping_${index}`, record.id, publicSecurity.id),
        ),
        {
          ...mapping("spv_mapping", spv.id, privateCompany.id),
          relationshipKind: "look_through",
          decisionSource: "review",
        },
      ],
    );
    const grouped = companyExposureGroups({
      ...canonical,
      publicCompanyLinks: [
        {
          publicExposureId: publicSecurity.id,
          companyExposureId: privateCompany.id,
        },
      ],
    });
    expect(canonical.exposures).toHaveLength(2);
    expect(
      canonical.positions.slice(0, 120).map((item) => item.valueEffectiveDate),
    ).toEqual(
      Array.from({ length: 120 }, (_, index) =>
        index % 2 === 0 ? null : "2026-08-12",
      ),
    );
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.exposure.id).toBe(privateCompany.id);
    expect(grouped[0]?.contributions).toHaveLength(122);
    expect(grouped[0]?.totals).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 145_000,
        knownValuePositionCount: 121,
        unknownValuePositionCount: 1,
      },
    ]);
    expect(
      canonical.positions.find((item) => item.id === spv.id),
    ).toMatchObject({
      quantityMicros: null,
      valueMinor: 25_000,
      valueSource: "provider",
    });
    expect(companyExposureGroups(canonical)).toHaveLength(2);
  });
  it("groups shared exposure while preserving exact position lineage and provenance", () => {
    const records = [
      position("position_1", 1_000_000),
      position("position_2", 2_000_000),
      position("position_3", 3_000_000),
    ];
    const sharedExposure = exposure("exposure_1", "Synthetic common equity");
    const view = createInvestmentExposureView(
      positionView(records),
      [sharedExposure],
      records.map((record, index) =>
        mapping(`mapping_${index + 1}`, record.id, sharedExposure.id),
      ),
    );

    expect(view.positions).toHaveLength(3);
    expect(
      new Set(view.positions.map((record) => record.containerId)).size,
    ).toBe(3);
    expect(view.positions[2]).toMatchObject({
      institutionLabel: "Synthetic Brokerage",
      containerKind: "ira",
      snapshotId: "snapshot_position_3",
      quantityMicros: 1_000_000,
      allocatedValueMinor: 3_000_000,
      unallocatedValueMinor: 0,
      mappings: [
        {
          decisionSource: "deterministic_policy",
          decisionReference: "synthetic exposure decision",
        },
      ],
    });
    expect(view.exposures).toEqual([
      expect.objectContaining({
        exposure: expect.objectContaining({ id: sharedExposure.id }),
        contributions: expect.arrayContaining([
          expect.objectContaining({
            positionId: "position_1",
            mappingId: "mapping_1",
            allocatedValueMinor: 1_000_000,
          }),
        ]),
        totals: [
          {
            currency: "USD",
            allocatedValueMinor: 6_000_000,
            knownValuePositionCount: 3,
            unknownValuePositionCount: 0,
          },
        ],
      }),
    ]);
  });

  it("keeps unknown allocations and unavailable values explicit without manufacturing money", () => {
    const reported = {
      ...position("position_4", 5_000_000),
      kind: "fund_interest" as const,
    };
    const locked = position("position_5", null, "locked");
    const first = exposure("exposure_4", "Synthetic Company One");
    const second = exposure("exposure_5", "Synthetic Company Two");
    const view = createInvestmentExposureView(
      positionView([reported, locked]),
      [first, second],
      [
        mapping("mapping_4", reported.id, first.id, null),
        mapping("mapping_5", reported.id, second.id, null),
        mapping("mapping_6", locked.id, first.id),
      ],
    );

    expect(
      view.positions.find((record) => record.id === reported.id),
    ).toMatchObject({
      knownAllocationPpm: 0,
      hasUnknownAllocation: true,
      allocatedValueMinor: 0,
      unallocatedValueMinor: 5_000_000,
    });
    expect(
      view.positions.find((record) => record.id === locked.id),
    ).toMatchObject({
      valueState: "locked",
      valueMinor: null,
      allocatedValueMinor: null,
      unallocatedValueMinor: null,
    });
    expect(
      view.exposures.find((group) => group.exposure.id === first.id)?.totals,
    ).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 0,
        knownValuePositionCount: 0,
        unknownValuePositionCount: 2,
      },
    ]);
  });

  it("rolls an accepted sourced position mark into exposure totals", () => {
    const providerPosition = position("position_7", 1_000_000);
    const adjustedPosition: InvestmentPositionRecord = {
      ...providerPosition,
      acceptedValueAdjustment: {
        id: "adjustment_position_7",
        positionId: providerPosition.id,
        snapshotId: providerPosition.snapshot.id,
        priorValueState: "reported",
        priorValueMinor: 1_000_000,
        valueMinor: 1_400_000,
        currency: "USD",
        effectiveDate: "2026-08-16",
        sourceKind: "gp_update",
        sourceLabel: "Synthetic GP update",
        sourceUrl: null,
        commentary: "Synthetic progress supports the reviewed mark.",
        acceptedAt: "2026-08-16T10:00:00.000Z",
      },
      priorValue: {
        state: "reported",
        minor: 1_000_000,
        observedAt: "2026-07-16T10:00:00.000Z",
      },
    };
    const reviewedExposure = exposure(
      "exposure_7",
      "Synthetic reviewed company",
    );

    const view = createInvestmentExposureView(
      positionView([adjustedPosition]),
      [reviewedExposure],
      [mapping("mapping_7", adjustedPosition.id, reviewedExposure.id)],
    );

    expect(adjustedPosition.snapshot.unrealizedValue.minor).toBe(1_000_000);
    expect(view.positions[0]).toMatchObject({
      valueMinor: 1_400_000,
      valueSource: "reviewed_adjustment",
      valueEffectiveDate: "2026-08-16",
      valueSourceLabel: "Synthetic GP update",
      priorValueState: "reported",
      priorValueMinor: 1_000_000,
      priorValueObservedAt: "2026-07-16T10:00:00.000Z",
    });
    expect(view.exposures[0]?.totals).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 1_400_000,
        knownValuePositionCount: 1,
        unknownValuePositionCount: 0,
      },
    ]);
  });

  it("uses invested amount for a live exposure when current value is not reported", () => {
    const missingMark = {
      ...position("position_8", null, "not_reported"),
      snapshot: {
        ...position("position_8", null, "not_reported").snapshot,
        investedMinor: 425_000,
      },
    };
    const estimatedExposure = exposure(
      "exposure_8",
      "Synthetic estimated company",
    );

    const view = createInvestmentExposureView(
      positionView([missingMark]),
      [estimatedExposure],
      [mapping("mapping_8", missingMark.id, estimatedExposure.id)],
    );

    expect(missingMark.snapshot.unrealizedValue).toEqual({
      state: "not_reported",
      minor: null,
    });
    expect(view.positions[0]).toMatchObject({
      valueState: "reported",
      valueMinor: 425_000,
      valueSource: "invested_amount",
      allocatedValueMinor: 425_000,
      unallocatedValueMinor: 0,
    });
    expect(view.exposures[0]?.totals).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 425_000,
        knownValuePositionCount: 1,
        unknownValuePositionCount: 0,
      },
    ]);
  });

  it("uses a GP mark and accepted financing rounds for a tranche-aware private estimate", () => {
    const reference = {
      ...position("position_reference", 6_000_000),
      openedOn: "2023-03-10",
      source: {
        ...position("position_reference", 6_000_000).source,
        label: "Synthetic GP portal",
      },
      snapshot: {
        ...position("position_reference", 6_000_000).snapshot,
        investedMinor: 2_000_000,
        costBasisMinor: null,
        ticker: null,
        instrumentType: "private preferred shares",
      },
    };
    const target = {
      ...position("position_target_a", null, "not_reported"),
      openedOn: "2024-06-15",
      snapshot: {
        ...position("position_target_a", null, "not_reported").snapshot,
        investedMinor: 1_000_000,
        costBasisMinor: null,
        ticker: null,
        instrumentType: "private preferred shares",
      },
    };
    const privateExposure = {
      ...exposure("exposure_private", "Synthetic private company"),
      exposureKind: "private_company" as const,
      protectedIdentityKey: null,
      companyId: "company_synthetic",
      resolutionMethod: "reviewed_company" as const,
    };

    const view = createInvestmentExposureView(
      positionView([reference, target]),
      [privateExposure],
      [
        mapping("mapping_reference", reference.id, privateExposure.id),
        mapping("mapping_target", target.id, privateExposure.id),
      ],
      [
        {
          companyId: "company_synthetic",
          evidenceEventId: "event_series_a",
          effectiveDate: "2023-03-01",
          postMoneyValueMinor: 50_000_000_000,
          currency: "USD",
          sourceTitle: "Synthetic Series A",
          sourceUrl: "https://example.com/synthetic-series-a",
          approximate: false,
        },
        {
          companyId: "company_synthetic",
          evidenceEventId: "event_series_b",
          effectiveDate: "2024-06-01",
          postMoneyValueMinor: 100_000_000_000,
          currency: "USD",
          sourceTitle: "Synthetic Series B",
          sourceUrl: "https://example.com/synthetic-series-b",
          approximate: false,
        },
      ],
    );

    expect(
      view.positions.find((record) => record.id === target.id),
    ).toMatchObject({
      isPrivateCompanyPosition: true,
      valueState: "reported",
      valueMinor: 1_500_000,
      valueSource: "portfolio_watch_estimate",
      valueEffectiveDate: "2026-08-15",
      valueSourceLabel: "Portfolio Watch + Synthetic GP portal",
      privateValueEstimate: {
        costBasisMinor: 1_000_000,
        referencePositionId: reference.id,
        positionRound: { evidenceEventId: "event_series_b" },
        referenceRound: { evidenceEventId: "event_series_a" },
      },
    });
    expect(view.exposures[0]?.totals).toEqual([
      {
        currency: "USD",
        allocatedValueMinor: 7_500_000,
        knownValuePositionCount: 2,
        unknownValuePositionCount: 0,
      },
    ]);
  });

  it("does not estimate missing cash, realized positions, or a zero basis", () => {
    const missingCash = {
      ...position("position_9", null, "not_reported"),
      snapshot: {
        ...position("position_9", null, "not_reported").snapshot,
        investedMinor: 25_000,
        instrumentType: "cash",
      },
    };
    const realized = {
      ...position("position_10", null, "not_reported"),
      snapshot: {
        ...position("position_10", null, "not_reported").snapshot,
        investedMinor: 600_000,
        providerStatus: "realized" as const,
      },
    };
    const zeroBasis = {
      ...position("position_11", null, "not_reported"),
      snapshot: {
        ...position("position_11", null, "not_reported").snapshot,
        investedMinor: 0,
      },
    };
    const first = exposure("exposure_9", "Synthetic cash");
    const second = exposure("exposure_10", "Synthetic realized company");
    const third = exposure("exposure_11", "Synthetic unknown basis");

    const view = createInvestmentExposureView(
      positionView([missingCash, realized, zeroBasis]),
      [first, second, third],
      [
        mapping("mapping_9", missingCash.id, first.id),
        mapping("mapping_10", realized.id, second.id),
        mapping("mapping_11", zeroBasis.id, third.id),
      ],
    );

    expect(view.positions.some((item) => item.id === realized.id)).toBe(false);
    expect(view.positions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: missingCash.id,
          valueState: "not_reported",
          valueMinor: null,
          valueSource: "provider",
        }),
        expect.objectContaining({
          id: zeroBasis.id,
          valueState: "not_reported",
          valueMinor: null,
          valueSource: "provider",
        }),
      ]),
    );
  });

  it("fails closed when a mapping is outside the authoritative position view", () => {
    expect(() =>
      createInvestmentExposureView(
        positionView([position("position_6", 100_000)]),
        [exposure("exposure_6", "Synthetic common equity")],
        [mapping("mapping_7", "position_missing", "exposure_6")],
      ),
    ).toThrow(/authoritative accepted position/u);
  });
});

it.each(["historical", "cancelled"] as const)(
  "excludes %s participation, including stale marks and estimates, while preserving the active replacement",
  (status) => {
    const closed = position("position_1", 1_250_000);
    closed.kind = "spv_interest";
    closed.investmentReview = {
      id: crypto.randomUUID(),
      positionId: closed.id,
      version: 1,
      participationStatus: status,
      ownershipObservations: [],
      documentAssignments: [],
      recordedAt: asOf,
    };
    const replacement = position("position_2", 2_000_000);
    const shared = exposure("exposure_1", "Synthetic shared company");
    const source = positionView([closed, replacement]);
    const rawSnapshot = structuredClone(closed.snapshot);
    for (const value of [1_250_000, null]) {
      closed.snapshot.unrealizedValue =
        value === null
          ? { state: "not_reported", minor: null }
          : { state: "reported", minor: value };
      closed.snapshot.netValue = closed.snapshot.unrealizedValue;
      const result = createInvestmentExposureView(
        source,
        [shared],
        [
          mapping("mapping_1", closed.id, shared.id),
          mapping("mapping_2", replacement.id, shared.id),
        ],
      );
      expect(result.positions.map((item) => item.id)).toEqual([replacement.id]);
      expect(result.exposures[0]?.totals).toEqual([
        {
          currency: "USD",
          allocatedValueMinor: 2_000_000,
          knownValuePositionCount: 1,
          unknownValuePositionCount: 0,
        },
      ]);
      expect(closed.snapshot.investedMinor).toBe(rawSnapshot.investedMinor);
      expect(closed.snapshot.realizedValueMinor).toBe(
        rawSnapshot.realizedValueMinor,
      );
    }
    closed.investmentReview.participationStatus = "current";
    expect(
      createInvestmentExposureView(
        source,
        [shared],
        [
          mapping("mapping_1", closed.id, shared.id),
          mapping("mapping_2", replacement.id, shared.id),
        ],
      ).positions,
    ).toHaveLength(2);
  },
);

it("uses a reviewed share estimate while preserving the provider mark separately", () => {
  const p = position("position_1", null, "not_reported");
  p.kind = "spv_interest";
  p.purchaseReceipt = {
    id: "purchase-review",
    positionId: p.id,
    snapshotId: p.snapshot.id,
    currency: "USD",
    acceptedAt: "2026-08-15T00:00:00.000Z",
    details: {
      coversPosition: true,
      lots: [
        {
          id: "lot",
          purchasedOn: "2026-01-01",
          shareClass: "Series A",
          priceMicros: 10_000_000,
          referencePriceMicros: null,
          grossCashMinor: 11_000,
          netCapitalMinor: 10_000,
          feePpm: 100_000,
          feeBasis: "net_capital",
          feeLabel: null,
          remainingSharesMicros: 10_000_000,
          sharesAsOf: "2026-08-01",
          originalSharesUnchanged: false,
          sourceLabel: "Synthetic subscription",
          sourceUrl: null,
          mark: {
            priceMicros: 20_000_000,
            effectiveDate: "2026-08-15",
            shareClass: "Series A",
            sourceLabel: "Synthetic GP statement",
            sourceUrl: null,
          },
        },
      ],
    },
  };
  expect(
    createInvestmentExposureView(positionView([p]), [], []).positions[0],
  ).toMatchObject({
    valueSource: "share_price_estimate",
    valueMinor: 20_000,
    shareValueEstimate: { valueMinor: 20_000 },
  });
  const proxyMark = p.purchaseReceipt.details.lots[0]!.mark!;
  proxyMark.proxy = {
    confirmed: true,
    reason: "Closest common-share price.",
    capturedAt: "2026-09-01T00:00:00.000Z",
  };
  proxyMark.sourceEvidenceId = "synthetic-source";
  proxyMark.shareClass = "Common";
  proxyMark.effectiveDate = null;
  expect(
    createInvestmentExposureView(positionView([p]), [], []).positions[0],
  ).toMatchObject({
    valueSource: "share_price_estimate",
    valueMinor: 20_000,
    valueEffectiveDate: null,
    valueSourceLabel: "Proxy share price estimate",
    shareValueEstimate: { proxy: true, effectiveDate: null },
  });
  p.snapshot.unrealizedValue = { state: "reported", minor: 18_000 };
  expect(
    createInvestmentExposureView(positionView([p]), [], []).positions[0],
  ).toMatchObject({
    valueSource: "share_price_estimate",
    valueMinor: 20_000,
    shareValueEstimate: { valueMinor: 20_000 },
  });
  expect(p.snapshot.unrealizedValue).toEqual({
    state: "reported",
    minor: 18_000,
  });
  p.linkedReportedValue = {
    state: "reported",
    minor: 17_000,
    reviewId: "synthetic-link-review",
    sourcePositionId: "synthetic-source-position",
    snapshotId: "synthetic-source-snapshot",
    sourceLabel: "Synthetic linked statement",
    observedAt: "2026-08-15T00:00:00.000Z",
  };
  expect(
    createInvestmentExposureView(positionView([p]), [], []).positions[0],
  ).toMatchObject({
    valueSource: "share_price_estimate",
    valueMinor: 20_000,
  });
  expect(p.linkedReportedValue.minor).toBe(17_000);
  p.acceptedValueAdjustment = {
    id: "synthetic-value-review",
    positionId: p.id,
    snapshotId: p.snapshot.id,
    priorValueState: "reported",
    priorValueMinor: 17_000,
    valueMinor: 22_000,
    currency: "USD",
    effectiveDate: "2026-08-15",
    sourceKind: "gp_update",
    sourceLabel: "Synthetic GP update",
    sourceUrl: null,
    commentary: "Reviewed synthetic value.",
    acceptedAt: "2026-08-15T12:00:00.000Z",
  };
  expect(
    createInvestmentExposureView(positionView([p]), [], []).positions[0],
  ).toMatchObject({
    valueSource: "reviewed_adjustment",
    valueMinor: 22_000,
    shareValueEstimate: { valueMinor: 20_000 },
  });
  p.snapshot.id = "new-snapshot";
  expect(
    createInvestmentExposureView(positionView([p]), [], []).positions[0]
      ?.shareValueEstimate,
  ).toBeNull();
});

it.each([false, true])(
  "preserves a bound provider review date and canonical distribution identity with linked NAV %s",
  (linked) => {
    for (const effectiveDate of [null, "2026-08-09", "2026-08-12"] as const) {
      const p = reviewedProviderPosition("provider_1", effectiveDate);
      if (linked) {
        p.snapshot.unrealizedValue.minor = 9_000;
        p.linkedReportedValue = {
          state: "reported",
          minor: 18_000,
          reviewId: "synthetic-nav-link",
          sourcePositionId: "synthetic-nav-position",
          snapshotId: "synthetic-nav-snapshot",
          sourceLabel: "Synthetic linked NAV",
          observedAt: "2026-08-16T00:00:00.000Z",
        };
        p.purchaseReceipt!.snapshotId = "synthetic-prior-receipt-snapshot";
        p.purchaseReceipt!.details.investmentSnapshotId = p.snapshot.id;
        p.purchaseReceipt!.details.investmentTerms!.reportedValueReview!.sourceSnapshotId =
          p.linkedReportedValue.snapshotId;
      }
      const source = positionView([p]);
      const before = structuredClone(source);
      const projected = createInvestmentExposureView(source, [], []);
      const value = projected.positions[0]!;
      expect(value).toMatchObject({
        snapshotId: p.snapshot.id,
        valueSource: "provider",
        valueMinor: 18_000,
        realizedValueMinor: 3_000,
        valueEffectiveDate: effectiveDate,
        reviewedInvestment: { netCapitalMinor: 10_000 },
      });
      const performance = calculatePositionPerformance({
        currentValueMinor: value.valueMinor,
        currentValueReported: value.valueState === "reported",
        realizedValueMinor: value.realizedValueMinor,
        providerCostBasisMinor: value.providerCostBasisMinor ?? null,
        fundedMinor: value.investedMinor,
        economicsContext: {
          snapshotId: value.snapshotId,
          currency: value.currency,
          committedMinor: value.committedMinor!,
          fundedMinor: value.investedMinor!,
          acceptedTerms: null,
          reportedTerms: null,
          reviewedInvestment: value.reviewedInvestment,
        },
        allowFundedAmountEstimate: true,
        valuationDate: value.valueEffectiveDate ?? null,
      });
      expect(performance).toMatchObject({
        costBasisMinor: 10_000,
        totalValueMinor: effectiveDate === "2026-08-12" ? 21_000 : null,
        totalGainMinor: effectiveDate === "2026-08-12" ? 11_000 : null,
        totalReturnPpm: effectiveDate === "2026-08-12" ? 1_100_000 : null,
      });
      const portfolio = calculatePortfolioPerformance(
        {
          version: 1,
          authorizationStatus: "available",
          positionView: source,
          exposureView: projected,
        },
        "USD",
      );
      expect(portfolio.privateDpi).toMatchObject({
        eligibleCount: 1,
        paidInMinor: 12_000,
        distributionsMinor: 3_000,
        multiplePpm: 250_000,
      });
      expect(portfolio.privateTvpi.multiplePpm).toBe(
        effectiveDate === "2026-08-12" ? 1_750_000 : null,
      );
      expect(source).toEqual(before);
      if (linked && effectiveDate === "2026-08-12") {
        value.reviewedInvestment!.distributionReview!.provider.sourceSnapshotId =
          p.linkedReportedValue!.snapshotId;
        const wrongRealizedOwner = calculatePortfolioPerformance(
          {
            version: 1,
            authorizationStatus: "available",
            positionView: source,
            exposureView: projected,
          },
          "USD",
        );
        expect(wrongRealizedOwner.holdingReturn.returnPpm).toBeNull();
        expect(wrongRealizedOwner.privateDpi.multiplePpm).toBeNull();
      }
    }
  },
);

it.each([
  "stale_investment_snapshot",
  "stale_receipt_snapshot",
  "stale_source_snapshot",
  "value_mismatch",
  "missing_review",
] as const)("keeps the provider observation date for %s", (invalid) => {
  for (const linked of [false, true]) {
    const p = reviewedProviderPosition("provider_2", null);
    const receipt = p.purchaseReceipt!;
    const review = receipt.details.investmentTerms!.reportedValueReview!;
    if (linked) {
      p.linkedReportedValue = {
        state: "reported",
        minor: 18_000,
        reviewId: "synthetic-nav-link",
        sourcePositionId: "synthetic-nav-position",
        snapshotId: "synthetic-nav-snapshot",
        sourceLabel: "Synthetic linked NAV",
        observedAt: "2026-08-16T00:00:00.000Z",
      };
      review.sourceSnapshotId = p.linkedReportedValue.snapshotId;
    }
    if (invalid === "stale_investment_snapshot")
      receipt.details.investmentSnapshotId = "synthetic-prior-snapshot";
    if (invalid === "stale_receipt_snapshot")
      receipt.snapshotId = "synthetic-prior-snapshot";
    if (invalid === "stale_source_snapshot")
      review.sourceSnapshotId = linked
        ? p.snapshot.id
        : "synthetic-prior-snapshot";
    if (invalid === "value_mismatch") review.valueMinor = 19_000;
    if (invalid === "missing_review")
      receipt.details.investmentTerms!.reportedValueReview = null;
    expect(
      createInvestmentExposureView(positionView([p]), [], []).positions[0],
    ).toMatchObject({
      valueSource: "provider",
      valueMinor: 18_000,
      valueEffectiveDate: linked ? "2026-08-16" : "2026-08-15",
    });
  }
});

it.each(["selected", "adjustment", "share_estimate", "invested"] as const)(
  "keeps the value owner's date for %s instead of a provider review date",
  (owner) => {
    const p = reviewedProviderPosition("provider_3", null);
    const receipt = p.purchaseReceipt!;
    if (owner === "selected") {
      receipt.details.valuation = {
        snapshotId: p.snapshot.id,
        selected: {
          recordId: "synthetic-estimate",
          method: "total",
          sharesKey: null,
        },
        records: [
          {
            id: "synthetic-estimate",
            origin: "judgment",
            totalMinor: 18_000,
            priceMicros: null,
            priceDate: null,
            effectiveDate: "2026-08-13",
            shareClass: null,
            carryStatus: "after_carry",
            sourceLabel: "Synthetic selected estimate",
            sourceUrl: null,
            sourceEvidenceId: null,
            sourcePositionId: null,
            sourceCapturedAt: null,
            watchEvidenceId: null,
          },
        ],
      };
    }
    if (owner === "adjustment") {
      p.acceptedValueAdjustment = {
        id: "synthetic-adjustment",
        positionId: p.id,
        snapshotId: p.snapshot.id,
        priorValueState: "reported",
        priorValueMinor: 18_000,
        valueMinor: 18_000,
        currency: "USD",
        effectiveDate: "2026-08-13",
        sourceKind: "gp_update",
        sourceLabel: "Synthetic GP update",
        sourceUrl: null,
        commentary: "Synthetic reviewed update.",
        acceptedAt: asOf,
      };
    }
    if (owner === "share_estimate") {
      Object.assign(receipt.details.lots[0]!, {
        shareClass: "Series A",
        remainingSharesMicros: 10_000_000,
        sharesAsOf: "2026-08-11",
        mark: {
          priceMicros: 18_000_000,
          effectiveDate: "2026-08-13",
          shareClass: "Series A",
          sourceLabel: "Synthetic GP quote",
          sourceUrl: null,
        },
      });
    }
    if (owner === "invested") {
      p.snapshot.unrealizedValue = { state: "not_reported", minor: null };
      p.snapshot.netValue = { state: "not_reported", minor: null };
    }
    expect(
      createInvestmentExposureView(positionView([p]), [], []).positions[0],
    ).toMatchObject({
      valueMinor: owner === "invested" ? 100_000 : 18_000,
      valueSource:
        owner === "selected" || owner === "adjustment"
          ? "reviewed_adjustment"
          : owner === "share_estimate"
            ? "share_price_estimate"
            : "invested_amount",
      valueEffectiveDate: owner === "invested" ? "2026-08-15" : "2026-08-13",
    });
  },
);
