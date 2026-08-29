import { describe, expect, it } from "vitest";

import {
  AcceptedCashAccountSchema,
  AcceptedLiabilitySchema,
  createCashFlowComparison,
  createLiabilityImpact,
  createPlanInputImpact,
  createPortfolioBaselineImpact,
  createGoalPreview,
  estimateThresholdProbabilityPpm,
  FinancingAnnouncementFactsSchema,
  FinancingMoneyFactSchema,
  HoldingSchema,
  HttpsSourceUrlSchema,
  InvestmentConnectionsStateSchema,
  InvestmentConnectionStatusSchema,
  MacAgentAuthorizationSchema,
  multiplyMinorByPpm,
  PrivateExposureResolutionInputSchema,
  PrivateExposureReviewStateSchema,
  PortfolioBaselineConfirmInputSchema,
  PortfolioBaselineCashAccountChangeSchema,
  PortfolioBaselineCashAccountSchema,
  PortfolioBaselinePositionChangeSchema,
  ProviderBrowserSessionReadyInputSchema,
  PlanInputSaveSchema,
  projectScenario,
  probabilityMeetingThresholdPpm,
  reconcileFinancingSignals,
  summarizeLiquidityPaths,
} from "./index";

describe("Mac agent authorization boundary", () => {
  it("accepts HTTPS or loopback origins and rejects an insecure remote host", () => {
    const token = `keel_agent_v1_${"a".repeat(43)}`;
    expect(
      MacAgentAuthorizationSchema.parse({
        version: 1,
        target: "angellist",
        apiOrigin: "https://keel-agents.example.com",
        token,
      }),
    ).toMatchObject({ apiOrigin: "https://keel-agents.example.com" });
    expect(
      MacAgentAuthorizationSchema.safeParse({
        version: 1,
        target: "angellist",
        apiOrigin: "http://keel-agents.example.com",
        token,
      }).success,
    ).toBe(false);
    expect(
      MacAgentAuthorizationSchema.safeParse({
        version: 1,
        target: "angellist",
        apiOrigin: "http://127.0.0.1:8787",
        token,
      }).success,
    ).toBe(true);
  });
});

describe("provider browser session boundary", () => {
  const leaseToken = "b".repeat(43);
  const entryPath = `${"c".repeat(43)}.html`;

  it("accepts only a clean ephemeral tunnel entry URL", () => {
    expect(
      ProviderBrowserSessionReadyInputSchema.safeParse({
        leaseToken,
        liveUrl: `https://synthetic-quiet-brook.trycloudflare.com/${entryPath}`,
      }).success,
    ).toBe(true);
    expect(
      ProviderBrowserSessionReadyInputSchema.safeParse({
        leaseToken,
        liveUrl: `https://example.com/${entryPath}`,
      }).success,
    ).toBe(false);
    expect(
      ProviderBrowserSessionReadyInputSchema.safeParse({
        leaseToken,
        liveUrl: `https://synthetic-quiet-brook.trycloudflare.com/${entryPath}?next=https://example.com`,
      }).success,
    ).toBe(false);
  });
});

describe("reviewed holding exposure identity", () => {
  const holding = {
    id: "holding_synthetic_spv",
    companyId: "company_synthetic_shared",
    positionName: "Synthetic Beacon SPV",
    exposureName: "Synthetic Harbor Health",
    ownerLabel: "Synthetic Family LLC",
    positionKind: "spv_interest" as const,
    administratorNavMinor: 1_000_000,
    administratorNavState: "reported" as const,
    externalMarkMinor: null,
    underwritingValueMinor: null,
    scenarioValueMinor: null,
    usableLiquidityMinor: null,
    sourceStatus: "verified" as const,
    sourceLabel: "Synthetic reviewed source",
    effectiveDate: "2026-08-16",
    retrievedAt: "2026-08-16T12:00:00.000Z",
    confidencePpm: null,
    ticker: null,
    quantityMicros: null,
    costBasisMinor: null,
  };

  it("requires a stable company ID or an explicit unresolved state", () => {
    expect(HoldingSchema.parse(holding).companyId).toBe(
      "company_synthetic_shared",
    );
    expect(
      HoldingSchema.parse({ ...holding, companyId: null }).companyId,
    ).toBeNull();
    const missingIdentity: Record<string, unknown> = { ...holding };
    Reflect.deleteProperty(missingIdentity, "companyId");
    expect(HoldingSchema.safeParse(missingIdentity).success).toBe(false);
  });

  it("requires an explicit reviewed company choice instead of display text", () => {
    expect(
      PrivateExposureResolutionInputSchema.safeParse({
        expectedSnapshotId: "snapshot_synthetic_spv",
        company: { legalName: "Synthetic Harbor Health" },
      }).success,
    ).toBe(false);
    expect(
      PrivateExposureResolutionInputSchema.parse({
        expectedSnapshotId: "snapshot_synthetic_spv",
        company: {
          mode: "existing",
          companyId: "company_synthetic_shared",
        },
      }),
    ).toEqual({
      expectedSnapshotId: "snapshot_synthetic_spv",
      company: {
        mode: "existing",
        companyId: "company_synthetic_shared",
      },
    });
    expect(
      PrivateExposureReviewStateSchema.parse({
        version: 2,
        positions: [
          {
            positionId: "holding_synthetic_spv",
            snapshotId: "snapshot_synthetic_spv",
            legalVehicleName: "Synthetic Beacon SPV",
            reportedExposureName: "Synthetic Harbor Health",
            positionKind: "spv_interest",
            ownerLabel: "Synthetic Family LLC",
            observedAt: "2026-08-16T12:00:00.000Z",
          },
        ],
        companies: [
          {
            id: "company_synthetic_shared",
            legalName: "Synthetic Harbor Health",
            websiteHost: "harbor.example",
            status: "active",
          },
        ],
        exactBatch: {
          revision: "a".repeat(64),
          positionCount: 1,
          companyCount: 1,
          existingCompanyCount: 1,
          newCompanyCount: 0,
          excludedPositionCount: 0,
        },
      }).positions,
    ).toHaveLength(1);
  });
});

describe("reviewed liability planning policy", () => {
  const acceptedAt = "2026-08-14T18:05:00.000Z";
  const common = {
    connectionId: "connection_liability_1",
    source: "plaid" as const,
    institutionLabel: "First Synthetic Bank",
    balanceMinor: 1_000_000,
    valueState: "reported" as const,
    interestRatePpm: 125_000,
    nextPaymentDueDate: "2026-08-28",
    isOverdue: false,
    effectiveDate: "2026-08-01",
    observedAt: "2026-08-14T18:00:00.000Z",
    retrievedAt: "2026-08-14T18:00:00.000Z",
    acceptedAt,
    freshness: "current" as const,
  };

  it("reserves only a revolving payment and adds only a scheduled payment to burn", () => {
    const liabilities = [
      {
        ...common,
        id: "decision_card",
        naturalKeySha256: "a".repeat(64),
        accountLabel: "Household card",
        kind: "credit_card" as const,
        classification: "revolving" as const,
        balanceMinor: 300_000,
        paymentMinor: 12_500,
        paymentTreatment: "reserve_from_liquidity" as const,
      },
      {
        ...common,
        id: "decision_student",
        naturalKeySha256: "b".repeat(64),
        accountLabel: "Student loan",
        kind: "student_loan" as const,
        classification: "scheduled" as const,
        balanceMinor: 4_000_000,
        paymentMinor: 45_000,
        paymentTreatment: "add_to_household_burn" as const,
      },
      {
        ...common,
        id: "decision_mortgage",
        naturalKeySha256: "c".repeat(64),
        accountLabel: "Mortgage",
        kind: "mortgage" as const,
        classification: "scheduled" as const,
        balanceMinor: 24_000_000,
        paymentMinor: 200_000,
        paymentTreatment: "already_in_plan" as const,
      },
    ];

    expect(
      createLiabilityImpact(
        {
          currentFiEligibleLiquidMinor: 20_000_000,
          protectedCashFloorMinor: 1_000_000,
          householdBurnMonthlyMinor: 300_000,
          businessBurnMonthlyMinor: 100_000,
          fiTargetMinor: 32_500_000,
        },
        liabilities,
      ),
    ).toEqual({
      liabilityCount: 3,
      totalOutstandingMinor: 28_300_000,
      unknownBalanceCount: 0,
      unknownPaymentCount: 0,
      overdueCount: 0,
      reservedPaymentMinor: 12_500,
      addedHouseholdBurnMinor: 45_000,
      netLiquidityMinor: 19_987_500,
      adjustedHouseholdBurnMonthlyMinor: 345_000,
      adjustedTotalBurnMonthlyMinor: 445_000,
      protectedRunwayMonths: 42,
      obligationAdjustedFiGapMinor: 12_512_500,
    });
  });

  it("keeps missing facts unknown and rejects mismatched payment treatment", () => {
    const unavailable = {
      ...common,
      id: "decision_unknown",
      naturalKeySha256: "d".repeat(64),
      accountLabel: "Unreported loan",
      kind: "student_loan" as const,
      classification: "scheduled" as const,
      balanceMinor: null,
      valueState: "not_reported" as const,
      paymentMinor: null,
      paymentTreatment: "already_in_plan" as const,
    };
    expect(AcceptedLiabilitySchema.safeParse(unavailable).success).toBe(true);
    expect(
      createLiabilityImpact(
        {
          currentFiEligibleLiquidMinor: 1_000_000,
          protectedCashFloorMinor: 100_000,
          householdBurnMonthlyMinor: 100_000,
          businessBurnMonthlyMinor: 0,
          fiTargetMinor: 2_000_000,
        },
        [unavailable],
      ),
    ).toMatchObject({
      totalOutstandingMinor: 0,
      unknownBalanceCount: 1,
      unknownPaymentCount: 1,
      netLiquidityMinor: 1_000_000,
    });
    expect(
      AcceptedLiabilitySchema.safeParse({
        ...unavailable,
        balanceMinor: 50_000,
        valueState: "reported",
        paymentMinor: 5_000,
        paymentTreatment: "reserve_from_liquidity",
      }).success,
    ).toBe(false);
  });
});

describe("accepted cash account boundaries", () => {
  const accepted = {
    id: "decision_cash_1",
    naturalKeySha256: "a".repeat(64),
    connectionId: "connection_cash_1",
    institutionLabel: "First Synthetic Bank",
    accountLabel: "Household checking",
    subtype: "checking",
    valueMinor: 125_000,
    valueState: "reported",
    balanceSource: "available",
    refreshKind: "live",
    observedAt: "2026-08-14T18:00:00.000Z",
    acceptedAt: "2026-08-14T18:05:00.000Z",
  };

  it("allows reviewed facts and rejects provider-only unavailable states", () => {
    expect(AcceptedCashAccountSchema.safeParse(accepted).success).toBe(true);
    expect(
      AcceptedCashAccountSchema.safeParse({
        ...accepted,
        valueMinor: null,
        valueState: "unavailable",
        balanceSource: null,
      }).success,
    ).toBe(false);
    expect(
      AcceptedCashAccountSchema.safeParse({
        ...accepted,
        valueMinor: null,
      }).success,
    ).toBe(false);
    expect(
      PortfolioBaselineCashAccountSchema.safeParse({
        id: accepted.id,
        institutionLabel: accepted.institutionLabel,
        accountLabel: accepted.accountLabel,
        subtype: accepted.subtype,
        valueMinor: null,
        valueState: "unsupported",
        refreshKind: accepted.refreshKind,
        observedAt: accepted.observedAt,
      }).success,
    ).toBe(false);
  });
});

describe("portfolio baseline source changes", () => {
  const observedAt = "2026-08-14T18:00:00.000Z";

  it("pairs updated sources with a prior value and added sources with none", () => {
    const position = {
      id: "position_synthetic",
      positionName: "Synthetic Public Company",
      ownerLabel: "Synthetic brokerage",
      sourceLabel: "Plaid Investments",
      provider: "plaid_investments" as const,
      classification: "public_market" as const,
      valueMinor: 200_000,
      valueState: "reported" as const,
      observedAt,
      ticker: "SYN",
      isCashPosition: false,
      potentialDuplicate: false,
      duplicateWith: [],
    };
    const cashAccount = {
      id: "cash_synthetic",
      institutionLabel: "Synthetic Bank",
      accountLabel: "Synthetic checking",
      subtype: "checking" as const,
      valueMinor: 300_000,
      valueState: "reported" as const,
      refreshKind: "live" as const,
      observedAt,
    };

    expect(
      PortfolioBaselinePositionChangeSchema.safeParse({
        changeType: "updated",
        current: position,
        previous: null,
      }).success,
    ).toBe(false);
    expect(
      PortfolioBaselinePositionChangeSchema.safeParse({
        changeType: "updated",
        current: position,
        previous: {
          valueMinor: 150_000,
          valueState: "reported",
          observedAt: "2026-08-13T18:00:00.000Z",
        },
      }).success,
    ).toBe(true);
    expect(
      PortfolioBaselineCashAccountChangeSchema.safeParse({
        changeType: "added",
        current: cashAccount,
        previous: null,
      }).success,
    ).toBe(true);
    expect(
      PortfolioBaselineCashAccountChangeSchema.safeParse({
        changeType: "added",
        current: cashAccount,
        previous: {
          valueMinor: 250_000,
          valueState: "reported",
          observedAt: "2026-08-13T18:00:00.000Z",
        },
      }).success,
    ).toBe(false);
  });
});

describe("investment connection status", () => {
  it("rejects inconsistent configuration and run states", () => {
    const base = {
      version: 1 as const,
      connectionId: "connection_investments_1",
      institutionKey: "ins_synthetic_brokerage",
      institutionLabel: "Synthetic Brokerage",
      status: "ready" as const,
      lastSyncedAt: null,
      automaticUpdatesEnabled: false,
      latestImportId: null,
      latestRunStatus: null,
      errorCode: null,
    };
    expect(InvestmentConnectionStatusSchema.safeParse(base).success).toBe(true);
    expect(
      InvestmentConnectionStatusSchema.safeParse({
        ...base,
        errorCode: "configuration_required",
      }).success,
    ).toBe(false);
    expect(
      InvestmentConnectionStatusSchema.safeParse({
        ...base,
        status: "syncing",
        latestRunStatus: "succeeded",
      }).success,
    ).toBe(false);
    expect(
      InvestmentConnectionsStateSchema.safeParse({
        version: 1,
        configured: false,
        connections: [base],
        errorCode: "configuration_required",
      }).success,
    ).toBe(true);
  });
});

describe("financing announcement facts", () => {
  it("accepts deterministic minor-unit facts with bounded evidence", () => {
    expect(
      FinancingAnnouncementFactsSchema.parse({
        roundType: "series",
        roundLabel: "Series C",
        instrument: "mixed",
        announcedAmount: {
          amountMinor: 125_000_000_00,
          currency: "USD",
          qualifier: "exact",
          evidenceText: "The company announced US$125 million in new funding.",
        },
        companyValuation: {
          amountMinor: 1_250_000_000_00,
          currency: "USD",
          qualifier: "approximately",
          evidenceText:
            "The round values the company at about US$1.25 billion.",
          basis: "post_money",
        },
        ambiguities: ["combined_tranches"],
      }),
    ).toMatchObject({
      roundLabel: "Series C",
      announcedAmount: { amountMinor: 125_000_000_00 },
      companyValuation: { basis: "post_money" },
    });
  });

  it("rejects floating point money, non-ISO currency, and unbounded evidence", () => {
    expect(() =>
      FinancingMoneyFactSchema.parse({
        amountMinor: 100.5,
        currency: "usd",
        qualifier: "exact",
        evidenceText: "x".repeat(241),
      }),
    ).toThrow();
    expect(() =>
      FinancingMoneyFactSchema.parse({
        amountMinor: 100,
        currency: "USD",
        qualifier: "exact",
        evidenceText: "The company announced one dollar.",
        parserNote: "unexpected external field",
      }),
    ).toThrow();
  });

  it("rejects a financing object with no meaningful term", () => {
    expect(() =>
      FinancingAnnouncementFactsSchema.parse({
        roundType: "undisclosed",
        roundLabel: null,
        instrument: "undisclosed",
        announcedAmount: null,
        companyValuation: null,
        ambiguities: [],
      }),
    ).toThrow("at least one meaningful term");
  });

  it("accepts only credential-free HTTPS source links", () => {
    expect(
      HttpsSourceUrlSchema.parse("https://example.com/news/series-c"),
    ).toBe("https://example.com/news/series-c");
    for (const unsafe of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "http://example.com/news",
      "https://user:secret@example.com/news",
    ]) {
      expect(HttpsSourceUrlSchema.safeParse(unsafe).success).toBe(false);
    }
  });
});

describe("financing signal reconciliation", () => {
  const valuation = (amountMinor: number) => ({
    amountMinor,
    currency: "USD",
    qualifier: "exact" as const,
    evidenceText: `The company reported a USD ${amountMinor} valuation.`,
    basis: "post_money" as const,
  });
  const observation = ({
    id,
    sourceUrl,
    publishedAt,
    amountMinor,
    evidenceStatus = "pending_review" as const,
    roundLabel = "Series C financing",
    sourceClass = "official_company" as const,
  }: {
    id: string;
    sourceUrl: string;
    publishedAt: string;
    amountMinor: number;
    evidenceStatus?:
      "pending_review" | "accepted" | "rejected" | "scenario_only";
    roundLabel?: string;
    sourceClass?:
      | "official_company"
      | "regulatory_filing"
      | "reputable_reporting"
      | "secondary_source";
  }) => ({
    id,
    companyId: "co_northstar",
    companyName: "Northstar Robotics",
    evidenceEventId: `evt_${id}`,
    evidenceStatus,
    sourceClass,
    sourceUrl,
    sourceTitle: `Synthetic Series C report ${id}`,
    publishedAt,
    retrievedAt: publishedAt,
    observedFact: "Northstar Robotics reported a Series C financing.",
    inference: "Company-level financing signal only.",
    sourceReliabilityPpm:
      sourceClass === "official_company" ? 1_000_000 : 940_000,
    modelConfidencePpm: 920_000,
    valuationLowMinor: null,
    valuationMiddleMinor: null,
    valuationHighMinor: null,
    financingFacts: {
      roundType: "series" as const,
      roundLabel,
      instrument: "equity" as const,
      announcedAmount: null,
      companyValuation: valuation(amountMinor),
      ambiguities: [],
    },
    limitations: "Holding ownership and security terms are not known.",
  });

  it("groups by company and normalized round independent of arrival order", () => {
    const reports = [
      observation({
        id: "official_old",
        sourceUrl: "https://northstar.example/news/series-c",
        publishedAt: "2026-08-02T10:00:00+10:00",
        amountMinor: 90_000_000_000,
        roundLabel: "Series C financing",
      }),
      observation({
        id: "official_current",
        sourceUrl: "https://northstar.example/news/series-c",
        publishedAt: "2026-08-02T01:00:00Z",
        amountMinor: 100_000_000_000,
        roundLabel: "Series C",
      }),
      observation({
        id: "regulatory",
        sourceUrl: "https://filings.example/series-c",
        publishedAt: "2026-08-02T11:00:00Z",
        amountMinor: 100_000_000_000,
        roundLabel: "Series C round",
        sourceClass: "regulatory_filing",
      }),
    ];

    const [forward] = reconcileFinancingSignals(reports);
    const [reversed] = reconcileFinancingSignals([...reports].reverse());

    expect(forward).toEqual(reversed);
    expect(forward).toMatchObject({
      id: "co_northstar:series-c",
      roundLabel: "Series C",
      status: "corroborated",
      pendingReviewCount: 2,
      canCreateProposal: false,
      proposedCompanyValuation: { amountMinor: 100_000_000_000 },
    });
    expect(forward?.recommendedReviewEventIds).toEqual([
      "evt_official_current",
      "evt_regulatory",
    ]);
    expect(
      forward?.reports.map((report) => [
        report.observationId,
        report.relationship,
      ]),
    ).toEqual([
      ["official_current", "corroborating"],
      ["regulatory", "corroborating"],
      ["official_old", "superseded"],
    ]);
  });

  it("flags conflicting current terms and unlocks only a reviewed valuation", () => {
    const conflicting = reconcileFinancingSignals([
      observation({
        id: "official",
        sourceUrl: "https://northstar.example/news/series-c",
        publishedAt: "2026-08-02T10:00:00Z",
        amountMinor: 100_000_000_000,
      }),
      observation({
        id: "reporting",
        sourceUrl: "https://reporting.example/northstar-series-c",
        publishedAt: "2026-08-02T11:00:00Z",
        amountMinor: 110_000_000_000,
        sourceClass: "reputable_reporting",
      }),
    ])[0];
    expect(conflicting).toMatchObject({
      status: "conflicting",
      canCreateProposal: false,
      proposedCompanyValuation: null,
    });
    expect(
      conflicting?.reports.every(
        (report) => report.relationship === "conflicting",
      ),
    ).toBe(true);

    const reviewed = reconcileFinancingSignals([
      observation({
        id: "official",
        sourceUrl: "https://northstar.example/news/series-c",
        publishedAt: "2026-08-02T10:00:00Z",
        amountMinor: 100_000_000_000,
        evidenceStatus: "accepted",
      }),
      observation({
        id: "regulatory",
        sourceUrl: "https://filings.example/series-c",
        publishedAt: "2026-08-02T11:00:00Z",
        amountMinor: 100_000_000_000,
        evidenceStatus: "scenario_only",
        sourceClass: "regulatory_filing",
      }),
    ])[0];
    expect(reviewed).toMatchObject({
      status: "corroborated",
      pendingReviewCount: 0,
      canCreateProposal: true,
      proposedCompanyValuation: { amountMinor: 100_000_000_000 },
    });
  });
});

describe("deterministic financial calculations", () => {
  it("multiplies money by integer parts per million without floating point", () => {
    expect(multiplyMinorByPpm(12_345, 333_333)).toBe(4_115);
    expect(multiplyMinorByPpm(10_001, 500_000)).toBe(5_001);
  });

  it("summarizes annual cumulative liquidity paths", () => {
    const summary = summarizeLiquidityPaths(
      [2027, 2028],
      [
        [0, 100_00],
        [0, 200_00],
        [100_00, 400_00],
        [300_00, 800_00],
      ],
    );

    expect(summary[0]).toEqual({
      year: 2027,
      p25Minor: 0,
      p50Minor: 0,
      p75Minor: 100_00,
      expectedMinor: 100_00,
      probabilityZeroPpm: 500_000,
    });
    expect(summary[1]?.p50Minor).toBe(200_00);
  });

  it("computes threshold probability as integer ppm", () => {
    expect(
      probabilityMeetingThresholdPpm(
        [1_000_00, 2_000_00, 3_000_00, 4_000_00],
        3_000_00,
      ),
    ).toBe(500_000);
  });

  it("estimates a threshold probability from ordered outcome bands", () => {
    expect(
      estimateThresholdProbabilityPpm(
        325_000_000,
        276_500_000,
        392_500_000,
        536_500_000,
      ),
    ).toBe(645_475);
  });

  it("builds FI goal forecasts from current value plus saved liquidity", () => {
    expect(
      createGoalPreview(
        {
          templateKey: "financial_independence",
          name: "Financial independence",
          metricKey: "fi_eligible_liquid",
          metricLabel: "FI-eligible liquid assets",
          targetValueInteger: 325_000_000,
          targetUnit: "minor_units",
          targetDate: null,
          currentValueInteger: 182_500_000,
          makePrimary: true,
          changeNote: "Preview synthetic goal",
        },
        {
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          horizonDate: "2031-12-31",
        },
      ),
    ).toMatchObject({
      modelStatus: "modeled",
      lowerValueInteger: 276_500_000,
      middleValueInteger: 392_500_000,
      higherValueInteger: 536_500_000,
      successProbabilityPpm: 645_475,
    });
  });

  it("previews a portfolio baseline with integer runway and FI outcomes", () => {
    expect(
      createPortfolioBaselineImpact(
        {
          currentFiEligibleLiquidMinor: 182_500_000,
          protectedCashFloorMinor: 10_300_000,
          householdBurnMonthlyMinor: 2_850_000,
          businessBurnMonthlyMinor: 1_250_000,
          fiTargetMinor: 325_000_000,
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          forecastHorizonDate: "2031-12-31",
        },
        200_000_000,
      ),
    ).toEqual({
      fiEligibleLiquidMinor: 200_000_000,
      fiEligibleChangeMinor: 17_500_000,
      protectedRunwayMonths: 46,
      fiGapMinor: 125_000_000,
      lowerTotalAvailableMinor: 294_000_000,
      middleTotalAvailableMinor: 410_000_000,
      higherTotalAvailableMinor: 554_000_000,
      probabilityCrossingFiPpm: 683_190,
    });
  });

  it("accepts only an explicit other-liquid amount for baseline confirmation", () => {
    const base = {
      sourceRevision: "a".repeat(64),
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Replace the FI liquid baseline.",
    };

    expect(
      PortfolioBaselineConfirmInputSchema.safeParse({
        ...base,
        otherFiEligibleLiquidMinor: 0,
      }).success,
    ).toBe(true);
    expect(
      PortfolioBaselineConfirmInputSchema.safeParse({
        ...base,
        fiEligibleLiquidMinor: 182_500_000,
      }).success,
    ).toBe(false);
  });

  it("previews runway plan inputs with integer-only money arithmetic", () => {
    expect(
      createPlanInputImpact(
        {
          householdBurnMonthlyMinor: 3_000_000,
          businessBurnMonthlyMinor: 1_500_000,
          protectedCashFloorMinor: 15_000_000,
        },
        182_500_000,
      ),
    ).toEqual({
      totalMonthlyBurnMinor: 4_500_000,
      liquidAfterCashFloorMinor: 167_500_000,
      protectedRunwayMonths: 37,
    });
    expect(
      createPlanInputImpact(
        {
          householdBurnMonthlyMinor: 0,
          businessBurnMonthlyMinor: 0,
          protectedCashFloorMinor: 200_000_000,
        },
        182_500_000,
      ),
    ).toEqual({
      totalMonthlyBurnMinor: 0,
      liquidAfterCashFloorMinor: 0,
      protectedRunwayMonths: 0,
    });
  });

  it("requires a pinned plan and forecast revision before saving inputs", () => {
    const input = {
      baseCashFlowPlanId: "cf_fi",
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
      protectedCashFloorMinor: 15_000_000,
      changeNote: "Updated synthetic runway inputs.",
    };

    expect(PlanInputSaveSchema.safeParse(input).success).toBe(true);
    expect(
      PlanInputSaveSchema.safeParse({
        ...input,
        householdBurnMonthlyMinor: 30_000.5,
      }).success,
    ).toBe(false);
    expect(
      PlanInputSaveSchema.safeParse({ ...input, baseCashFlowPlanId: "" })
        .success,
    ).toBe(false);
  });

  it("proposes observed burn with debt already in the plan preserved", () => {
    expect(
      createCashFlowComparison(
        {
          baseCashFlowPlanId: "cf_fi",
          baseForecastSnapshotId: "snap_fi_v3",
          baseForecastSnapshotVersion: 3,
          householdBurnMonthlyMinor: 300_000,
          businessBurnMonthlyMinor: 100_000,
          debtPaymentContextMonthlyMinor: 20_000,
          protectedCashFloorMinor: 1_000_000,
          fiEligibleLiquidMinor: 20_000_000,
        },
        350_000,
        80_000,
      ),
    ).toEqual({
      observedHouseholdMonthlyMinor: 350_000,
      observedBusinessMonthlyMinor: 80_000,
      proposedHouseholdBurnMonthlyMinor: 370_000,
      proposedBusinessBurnMonthlyMinor: 80_000,
      householdChangeMinor: 70_000,
      businessChangeMinor: -20_000,
      totalChangeMinor: 50_000,
      currentRunwayMonths: 47,
      proposedRunwayMonths: 42,
      material: true,
    });
  });

  it("does not propose noise below the absolute and proportional thresholds", () => {
    expect(
      createCashFlowComparison(
        {
          baseCashFlowPlanId: "cf_fi",
          baseForecastSnapshotId: "snap_fi_v3",
          baseForecastSnapshotVersion: 3,
          householdBurnMonthlyMinor: 300_000,
          businessBurnMonthlyMinor: 100_000,
          debtPaymentContextMonthlyMinor: 20_000,
          protectedCashFloorMinor: 1_000_000,
          fiEligibleLiquidMinor: 20_000_000,
        },
        285_000,
        105_000,
      ).material,
    ).toBe(false);
  });

  it("does not add reviewed debt context when observed loan burn represents it", () => {
    expect(
      createCashFlowComparison(
        {
          baseCashFlowPlanId: "cf_fi",
          baseForecastSnapshotId: "snap_fi_v3",
          baseForecastSnapshotVersion: 3,
          householdBurnMonthlyMinor: 300_000,
          businessBurnMonthlyMinor: 100_000,
          debtPaymentContextMonthlyMinor: 20_000,
          protectedCashFloorMinor: 1_000_000,
          fiEligibleLiquidMinor: 20_000_000,
        },
        320_000,
        100_000,
        false,
      ).proposedHouseholdBurnMonthlyMinor,
    ).toBe(320_000);
  });

  it("does not invent a forecast for an unconfigured goal template", () => {
    expect(
      createGoalPreview(
        {
          templateKey: "cash_runway",
          name: "Protect runway",
          metricKey: "protected_runway_months",
          metricLabel: "Months of protected runway",
          targetValueInteger: 36,
          targetUnit: "months",
          targetDate: null,
          currentValueInteger: 42,
          makePrimary: false,
          changeNote: "Preview synthetic goal",
        },
        {
          p25FiveYearLiquidityMinor: 94_000_000,
          p50FiveYearLiquidityMinor: 210_000_000,
          p75FiveYearLiquidityMinor: 354_000_000,
          horizonDate: "2031-12-31",
        },
      ),
    ).toMatchObject({
      modelStatus: "not_configured",
      progressPpm: 1_000_000,
      lowerValueInteger: null,
      successProbabilityPpm: null,
    });
  });

  it("projects scenario drafts with integer sensitivity and preserves no-op values", () => {
    const base = {
      id: "scn_fi",
      name: "FI Underwriting",
      description: "Synthetic FI scenario",
      isSandbox: false,
      conditionalValueMinor: 168_000_000,
      timingAdjustedLiquidityMinor: 92_500_000,
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          label: "Liquidity probability",
          value: 430_000,
          unit: "ppm" as const,
          provenance: "Synthetic policy",
        },
        {
          id: "asm_delay",
          key: "timing_delay_months",
          label: "Timing delay",
          value: 18,
          unit: "months" as const,
          provenance: "Synthetic policy",
        },
      ],
      liquidityCurve: [
        {
          year: 2031,
          p25Minor: 94_000_000,
          p50Minor: 210_000_000,
          p75Minor: 354_000_000,
          expectedMinor: 246_000_000,
          probabilityZeroPpm: 70_000,
        },
      ],
    };
    const unchanged = projectScenario(base, {
      scenarioId: "scn_fi",
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          value: 430_000,
        },
        { id: "asm_delay", key: "timing_delay_months", value: 18 },
      ],
      changeNote: "No-op preview",
    });
    expect(unchanged.timingAdjustedLiquidityMinor).toBe(92_500_000);
    expect(unchanged.liquidityCurve[0]?.p50Minor).toBe(210_000_000);

    const upside = projectScenario(base, {
      scenarioId: "scn_fi",
      assumptions: [
        {
          id: "asm_probability",
          key: "liquidity_probability",
          value: 800_000,
        },
        { id: "asm_delay", key: "timing_delay_months", value: 6 },
      ],
      changeNote: "Test upside sensitivity",
    });
    expect(upside.liquidityScalePpm).toBeGreaterThan(1_000_000);
    expect(upside.timingAdjustedLiquidityMinor).toBeGreaterThan(
      unchanged.timingAdjustedLiquidityMinor,
    );
    expect(upside.liquidityCurve[0]?.p50Minor).toBeGreaterThan(210_000_000);
  });
});
