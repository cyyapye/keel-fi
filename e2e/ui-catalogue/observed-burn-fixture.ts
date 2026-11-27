import {
  addMinorUnits,
  createCashFlowComparison,
  createPlanInputImpact,
  type CashFlowProposal,
  type CashFlowReviewInput,
  type CashFlowState,
  type CashFlowTreatment,
  type PlanInputSave,
  type PlanInputState,
} from "../../packages/domain/src/index";
import {
  evaluatePlanActualMonitoring,
  type PlanActualMonitoringInput,
  type PlanActualSnoozeInput,
} from "../../packages/domain/src/plan-actual-monitoring";

const august = {
  id: "demo-burn-aug",
  observedAt: "2026-08-15T12:00:00Z",
  months: ["2026-05", "2026-06", "2026-07"],
  household: 500_000,
  business: 300_000,
};
const november = {
  id: "demo-burn-nov",
  observedAt: "2026-11-15T12:00:00Z",
  months: ["2026-08", "2026-09", "2026-10"],
  household: 700_000,
  business: 300_000,
};
const initialValues = {
  householdBurnMonthlyMinor: 400_000,
  businessBurnMonthlyMinor: 200_000,
  protectedCashFloorMinor: 1_000_000,
};
const fiEligibleLiquidMinor = 13_000_000;

type PlanBase = Pick<
  PlanInputState,
  | "baseCashFlowPlanId"
  | "baseForecastSnapshotId"
  | "baseForecastSnapshotVersion"
>;

function samePlanBase(left: PlanBase, right: PlanBase) {
  return (
    left.baseCashFlowPlanId === right.baseCashFlowPlanId &&
    left.baseForecastSnapshotId === right.baseForecastSnapshotId &&
    left.baseForecastSnapshotVersion === right.baseForecastSnapshotVersion
  );
}

function proposalFor(
  report: typeof august,
  plan: PlanInputState,
): CashFlowProposal {
  const planning = {
    baseCashFlowPlanId: plan.baseCashFlowPlanId,
    baseForecastSnapshotId: plan.baseForecastSnapshotId,
    baseForecastSnapshotVersion: plan.baseForecastSnapshotVersion,
    ...plan.values,
    fiEligibleLiquidMinor,
    debtPaymentContextMonthlyMinor: 0,
  };
  const categories = [
    {
      category: "FOOD_AND_DRINK",
      label: "Food and drink",
      amount: report.household,
    },
    {
      category: "GENERAL_SERVICES",
      label: "General services",
      amount: report.business,
    },
  ] as const;
  return {
    id: report.id,
    observedAt: report.observedAt,
    status: "pending_review",
    periodStartMonth: report.months[0]!,
    periodEndMonth: report.months[2]!,
    coveredConnectionCount: 1,
    transactionCount: 24,
    pendingExcludedCount: 1,
    unsupportedExcludedCount: 0,
    unreviewedAccountExcludedCount: 0,
    planning,
    comparison: createCashFlowComparison(
      planning,
      addMinorUnits(report.household, report.business),
      0,
    ),
    months: report.months.map((month) => ({
      month,
      outflowMinor: addMinorUnits(report.household, report.business),
      transactionCount: 8,
    })),
    categories: categories.map(({ category, label, amount }) => ({
      id: report.id + "-" + category,
      category,
      label,
      averageMonthlyMinor: amount,
      totalMinor: addMinorUnits(amount, amount, amount),
      transactionCount: 12,
      defaultTreatment: "household",
      reviewedTreatment: null,
    })),
    planSuggestion: null,
  };
}

function review(proposal: CashFlowProposal, input: CashFlowReviewInput) {
  const categories = proposal.categories.map((category) => {
    const decision = input.decisions.find(
      (row) => row.categoryId === category.id,
    );
    if (!decision) throw new Error("Choose a treatment for every category.");
    return { ...category, reviewedTreatment: decision.treatment };
  });
  const monthly = (treatment: CashFlowTreatment) =>
    addMinorUnits(
      ...categories
        .filter((row) => row.reviewedTreatment === treatment)
        .map((row) => row.averageMonthlyMinor),
    );
  const comparison = createCashFlowComparison(
    proposal.planning,
    monthly("household"),
    monthly("business"),
  );
  const planSuggestion = comparison.material
    ? {
        proposalId: proposal.id,
        householdBurnMonthlyMinor: comparison.proposedHouseholdBurnMonthlyMinor,
        businessBurnMonthlyMinor: comparison.proposedBusinessBurnMonthlyMinor,
        changeNote: ("Observed cash flow review: " + input.changeNote).slice(
          0,
          500,
        ),
      }
    : null;
  return {
    ...proposal,
    status: "ready_for_plan" as const,
    categories,
    comparison,
    planSuggestion,
  };
}

function bankManagementOutsideCapture(): Promise<never> {
  return Promise.reject(
    new Error("This walkthrough uses recorded observations only."),
  );
}

export function createObservedBurnExample() {
  let plan: PlanInputState = {
    baseCashFlowPlanId: "demo-plan-3",
    baseForecastSnapshotId: "demo-forecast-3",
    baseForecastSnapshotVersion: 3,
    values: initialValues,
    fiEligibleLiquidMinor,
    fiTargetMinor: 80_000_000,
    forecastHorizonDate: "2031-12-31",
    impact: createPlanInputImpact(initialValues, fiEligibleLiquidMinor),
  };
  let report = august;
  let proposal: CashFlowProposal | null = proposalFor(report, plan);
  let reviewed: CashFlowProposal | null = null;
  let linkedAugustVersion: number | null = null;
  const canOpenLaterObservation = () =>
    report === november ||
    linkedAugustVersion === plan.baseForecastSnapshotVersion;
  const cooldowns: PlanActualMonitoringInput["cooldowns"] = [];
  const cashFlow = (): CashFlowState => ({
    version: 1,
    configured: true,
    status: proposal ? "review_required" : "ready",
    latestOutcome: proposal ? "proposal_ready" : "no_material_change",
    connections: [
      {
        id: "demo-bank",
        institutionLabel: "Demo Bank",
        status: "ready",
        acceptedAccountCount: 1,
        pricingConfirmedAt: august.observedAt,
        lastCheckedAt: report.observedAt,
        dailyCheckLimit: 4,
        dailyChecksUsed: 1,
        dailyChecksRemaining: 3,
      },
    ],
    pendingProposals: proposal ? [proposal] : [],
    errorCode: null,
  });
  const monitoring = () =>
    evaluatePlanActualMonitoring({
      evaluatedAt: report.observedAt,
      sourceRevision:
        plan.baseForecastSnapshotVersion.toString(16).padStart(63, "0") +
        (report === august ? "a" : "b"),
      plan: {
        id: plan.baseCashFlowPlanId,
        ...plan.values,
        fiEligibleLiquidMinor,
      },
      cash: {
        enabled: true,
        baselineMinor: fiEligibleLiquidMinor,
        actualMinor: fiEligibleLiquidMinor,
        observedAt: report.observedAt,
        pendingReviewCount: 0,
        unknownCount: 0,
      },
      debt: {
        enabled: true,
        priorMinor: 0,
        actualMinor: 0,
        observedAt: report.observedAt,
        pendingReviewCount: 0,
        unknownCount: 0,
        overdueCount: 0,
      },
      burn: {
        enabled: true,
        status: reviewed?.comparison.material
          ? "reviewed_material"
          : reviewed
            ? "reviewed_no_change"
            : "pending_review",
        actualHouseholdMonthlyMinor:
          reviewed?.comparison.proposedHouseholdBurnMonthlyMinor ?? null,
        actualBusinessMonthlyMinor:
          reviewed?.comparison.proposedBusinessBurnMonthlyMinor ?? null,
        observedAt: report.observedAt,
      },
      cooldowns,
    });
  return {
    hasProposal: () => proposal !== null,
    canOpenLaterObservation,
    comparisonBase: () =>
      proposal && !samePlanBase(proposal.planning, plan)
        ? {
            source: proposal.planning.baseForecastSnapshotVersion,
            saved: plan.baseForecastSnapshotVersion,
          }
        : null,
    cashFlowRequests: {
      loadCashFlow: () => Promise.resolve(cashFlow()),
      reviewCashFlow: (id: string, input: CashFlowReviewInput) =>
        Promise.resolve().then(() => {
          if (
            !proposal ||
            id !== proposal.id ||
            proposal.status !== "pending_review"
          )
            throw new Error("Observed cash-flow proposal is stale.");
          if (!samePlanBase(proposal.planning, plan))
            throw new Error(
              "The runway plan changed. Check cash flow again against the latest plan.",
            );
          reviewed = review(proposal, input);
          proposal = reviewed.planSuggestion ? reviewed : null;
          return {
            proposalId: id,
            comparison: reviewed.comparison,
            planSuggestion: reviewed.planSuggestion,
          };
        }),
      syncCashFlow: bankManagementOutsideCapture,
      disconnectCashAccount: bankManagementOutsideCapture,
    },
    planRequests: {
      loadPlanInputs: () => Promise.resolve(plan),
      savePlanInputs: (input: PlanInputSave) =>
        Promise.resolve().then(() => {
          if (!samePlanBase(input, plan))
            throw new Error("Plan inputs are stale.");
          if (
            input.cashFlowProposalId !== undefined &&
            (proposal?.planSuggestion?.proposalId !==
              input.cashFlowProposalId ||
              !samePlanBase(proposal.planning, input) ||
              input.householdBurnMonthlyMinor !==
                proposal.planSuggestion.householdBurnMonthlyMinor ||
              input.businessBurnMonthlyMinor !==
                proposal.planSuggestion.businessBurnMonthlyMinor ||
              input.protectedCashFloorMinor !==
                proposal.planning.protectedCashFloorMinor)
          )
            throw new Error("Observed cash-flow proposal is stale.");
          const version = plan.baseForecastSnapshotVersion + 1;
          const values = {
            householdBurnMonthlyMinor: input.householdBurnMonthlyMinor,
            businessBurnMonthlyMinor: input.businessBurnMonthlyMinor,
            protectedCashFloorMinor: input.protectedCashFloorMinor,
          };
          const priorImpact = plan.impact;
          plan = {
            ...plan,
            baseCashFlowPlanId: "demo-plan-" + version,
            baseForecastSnapshotId: "demo-forecast-" + version,
            baseForecastSnapshotVersion: version,
            values,
            impact: createPlanInputImpact(values, fiEligibleLiquidMinor),
          };
          if (proposal && input.cashFlowProposalId === proposal.id) {
            if (report === august) linkedAugustVersion = version;
            proposal = null;
          }
          return {
            plan,
            priorImpact,
            createdAt: report.observedAt,
            createdBy: "Demo owner",
          };
        }),
    },
    openLaterObservation: () => {
      if (report === november) return;
      if (!canOpenLaterObservation())
        throw new Error(
          "Save the reviewed August proposal to continue the example.",
        );
      report = november;
      const later = proposalFor(report, plan);
      reviewed = review(later, {
        changeNote: "Reviewed the later three-month period.",
        decisions: later.categories.map((row) => ({
          categoryId: row.id,
          treatment:
            row.category === "GENERAL_SERVICES" ? "business" : "household",
        })),
      });
      proposal = reviewed.planSuggestion ? reviewed : null;
    },
    monitoringRequests: {
      loadPlanActualMonitoring: () => Promise.resolve().then(monitoring),
      snoozePlanActualMonitoring: (
        input: Pick<PlanActualSnoozeInput, "itemKey" | "sourceRevision">,
      ) =>
        Promise.resolve().then(() => {
          cooldowns.push({ ...input, until: "2026-11-22T12:00:00Z" });
          return monitoring();
        }),
    },
  };
}
