import { z } from "zod";

const IsoTimestampSchema = z.iso.datetime({ offset: true });
const MoneyMinorSchema = z.number().int().safe();
const NonNegativeMoneyMinorSchema = MoneyMinorSchema.nonnegative();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);

export const PLAN_ACTUAL_MONITORING_POLICY_VERSION = "plan-actual-v1";
export const PLAN_ACTUAL_FRESHNESS_DAYS = 45;
export const PLAN_ACTUAL_COOLDOWN_DAYS = 7;

const CASH_DRIFT_FLOOR_MINOR = 500_000;
const DEBT_DRIFT_FLOOR_MINOR = 500_000;
const VALUE_DRIFT_PPM = 50_000;
const BURN_DRIFT_FLOOR_MINOR = 50_000;
const BURN_DRIFT_PPM = 100_000;
const RUNWAY_DRIFT_MONTHS = 3;
const RUNWAY_URGENT_MONTHS = 12;

export const PlanActualMetricSchema = z.enum([
  "cash",
  "debt",
  "burn",
  "runway",
]);

export const PlanActualItemKeySchema = z.enum([
  "cash_review",
  "cash_freshness",
  "cash_drift",
  "debt_review",
  "debt_overdue",
  "debt_freshness",
  "debt_drift",
  "burn_review",
  "burn_freshness",
  "burn_drift",
  "runway_drift",
]);

export const PlanActualRouteSchema = z.enum([
  "holdings",
  "obligations",
  "scenarios",
]);

export const PlanActualCooldownSchema = z
  .object({
    itemKey: PlanActualItemKeySchema,
    sourceRevision: Sha256Schema,
    until: IsoTimestampSchema,
  })
  .strict();

export const PlanActualMonitoringInputSchema = z
  .object({
    evaluatedAt: IsoTimestampSchema,
    sourceRevision: Sha256Schema,
    plan: z
      .object({
        id: z.string().min(1),
        fiEligibleLiquidMinor: NonNegativeMoneyMinorSchema,
        protectedCashFloorMinor: NonNegativeMoneyMinorSchema,
        householdBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
        businessBurnMonthlyMinor: NonNegativeMoneyMinorSchema,
      })
      .strict(),
    cash: z
      .object({
        enabled: z.boolean(),
        baselineMinor: NonNegativeMoneyMinorSchema,
        actualMinor: NonNegativeMoneyMinorSchema.nullable(),
        observedAt: IsoTimestampSchema.nullable(),
        pendingReviewCount: z.number().int().nonnegative(),
        unknownCount: z.number().int().nonnegative(),
      })
      .strict(),
    debt: z
      .object({
        enabled: z.boolean(),
        priorMinor: NonNegativeMoneyMinorSchema.nullable(),
        actualMinor: NonNegativeMoneyMinorSchema.nullable(),
        observedAt: IsoTimestampSchema.nullable(),
        pendingReviewCount: z.number().int().nonnegative(),
        unknownCount: z.number().int().nonnegative(),
        overdueCount: z.number().int().nonnegative(),
      })
      .strict(),
    burn: z
      .object({
        enabled: z.boolean(),
        status: z.enum([
          "unavailable",
          "incomplete",
          "pending_review",
          "reviewed_no_change",
          "reviewed_material",
        ]),
        actualHouseholdMonthlyMinor: NonNegativeMoneyMinorSchema.nullable(),
        actualBusinessMonthlyMinor: NonNegativeMoneyMinorSchema.nullable(),
        observedAt: IsoTimestampSchema.nullable(),
      })
      .strict()
      .superRefine((burn, context) => {
        const hasActuals =
          burn.actualHouseholdMonthlyMinor !== null &&
          burn.actualBusinessMonthlyMinor !== null;
        if (
          ["reviewed_no_change", "reviewed_material"].includes(burn.status) !==
          hasActuals
        ) {
          context.addIssue({
            code: "custom",
            message: "Reviewed burn status and actual values must agree.",
            path: ["status"],
          });
        }
      }),
    cooldowns: z.array(PlanActualCooldownSchema).max(20),
  })
  .strict();

export const PlanActualActionItemSchema = z
  .object({
    key: PlanActualItemKeySchema,
    metric: PlanActualMetricSchema,
    severity: z.enum(["attention", "decision"]),
    title: z.string().trim().min(1).max(120),
    reason: z.string().trim().min(1).max(500),
    nextAction: z.string().trim().min(1).max(120),
    route: PlanActualRouteSchema,
    observedAt: IsoTimestampSchema.nullable(),
    plannedValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    actualValueMinor: NonNegativeMoneyMinorSchema.nullable(),
    differenceMinor: MoneyMinorSchema.nullable(),
    thresholdMinor: NonNegativeMoneyMinorSchema.nullable(),
    plannedMonths: z.number().int().nonnegative().nullable(),
    actualMonths: z.number().int().nonnegative().nullable(),
    sourceRevision: Sha256Schema,
    cooldownUntil: IsoTimestampSchema.nullable(),
  })
  .strict();

export const PlanActualCoverageSchema = z.enum([
  "not_configured",
  "pending_review",
  "missing",
  "stale",
  "current",
]);

export const PlanActualMonitoringStateSchema = z
  .object({
    version: z.literal(1),
    policyVersion: z.literal(PLAN_ACTUAL_MONITORING_POLICY_VERSION),
    evaluatedAt: IsoTimestampSchema,
    sourceRevision: Sha256Schema,
    planId: z.string().min(1),
    status: z.enum(["needs_action", "deferred", "clear", "limited"]),
    coverage: z
      .object({
        cash: PlanActualCoverageSchema,
        debt: PlanActualCoverageSchema,
        burn: PlanActualCoverageSchema,
        runway: z.enum(["available", "limited"]),
      })
      .strict(),
    actionItems: z.array(PlanActualActionItemSchema).max(4),
    deferredItems: z.array(PlanActualActionItemSchema).max(4),
  })
  .strict()
  .superRefine((state, context) => {
    const metrics = [...state.actionItems, ...state.deferredItems].map(
      (item) => item.metric,
    );
    if (new Set(metrics).size !== metrics.length) {
      context.addIssue({
        code: "custom",
        message: "Monitoring may return only one item per metric.",
        path: ["actionItems"],
      });
    }
    if (
      [...state.actionItems, ...state.deferredItems].some(
        (item) => item.sourceRevision !== state.sourceRevision,
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "Monitoring items must use the state source revision.",
        path: ["sourceRevision"],
      });
    }
  });

export const PlanActualSnoozeInputSchema = z
  .object({
    itemKey: PlanActualItemKeySchema,
    sourceRevision: Sha256Schema,
    durationDays: z.literal(PLAN_ACTUAL_COOLDOWN_DAYS),
  })
  .strict();

function addMinor(left: number, right: number): number {
  return MoneyMinorSchema.parse(Number(BigInt(left) + BigInt(right)));
}

function subtractMinor(left: number, right: number): number {
  return MoneyMinorSchema.parse(Number(BigInt(left) - BigInt(right)));
}

function proportionalThreshold(
  baseMinor: number,
  ppm: number,
  floorMinor: number,
): number {
  const proportional = Number(
    (BigInt(baseMinor) * BigInt(ppm) + 999_999n) / 1_000_000n,
  );
  return Math.max(floorMinor, proportional);
}

function ageDays(
  evaluatedAt: string,
  observedAt: string | null,
): number | null {
  if (observedAt === null) {
    return null;
  }
  return Math.max(
    Math.floor((Date.parse(evaluatedAt) - Date.parse(observedAt)) / 86_400_000),
    0,
  );
}

function isStale(evaluatedAt: string, observedAt: string | null): boolean {
  const age = ageDays(evaluatedAt, observedAt);
  return age === null || age > PLAN_ACTUAL_FRESHNESS_DAYS;
}

type MonitoringInput = z.infer<typeof PlanActualMonitoringInputSchema>;
type ActionItem = z.infer<typeof PlanActualActionItemSchema>;

function item(
  input: MonitoringInput,
  value: Omit<ActionItem, "sourceRevision" | "cooldownUntil">,
): ActionItem {
  return PlanActualActionItemSchema.parse({
    ...value,
    sourceRevision: input.sourceRevision,
    cooldownUntil: null,
  });
}

function cashCandidate(input: MonitoringInput): ActionItem | null {
  if (!input.cash.enabled) {
    return null;
  }
  if (input.cash.pendingReviewCount > 0) {
    return item(input, {
      key: "cash_review",
      metric: "cash",
      severity: "decision",
      title: "Review cash before comparing it with the plan",
      reason: `${input.cash.pendingReviewCount} cash balance ${input.cash.pendingReviewCount === 1 ? "update is" : "updates are"} waiting. Unreviewed balances do not enter monitoring.`,
      nextAction: "Review cash balances",
      route: "holdings",
      observedAt: input.cash.observedAt,
      plannedValueMinor: input.cash.baselineMinor,
      actualValueMinor: null,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  if (
    input.cash.actualMinor === null ||
    isStale(input.evaluatedAt, input.cash.observedAt)
  ) {
    return item(input, {
      key: "cash_freshness",
      metric: "cash",
      severity: "attention",
      title: "Cash needs a current reviewed balance",
      reason:
        input.cash.observedAt === null
          ? "No reviewed cash balance is available for this plan."
          : `The oldest included cash balance is more than ${PLAN_ACTUAL_FRESHNESS_DAYS} days old.`,
      nextAction: "Check cash balances",
      route: "holdings",
      observedAt: input.cash.observedAt,
      plannedValueMinor: input.cash.baselineMinor,
      actualValueMinor: input.cash.actualMinor,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  const differenceMinor = subtractMinor(
    input.cash.actualMinor,
    input.cash.baselineMinor,
  );
  const thresholdMinor = proportionalThreshold(
    input.cash.baselineMinor,
    VALUE_DRIFT_PPM,
    CASH_DRIFT_FLOOR_MINOR,
  );
  if (Math.abs(differenceMinor) < thresholdMinor) {
    return null;
  }
  return item(input, {
    key: "cash_drift",
    metric: "cash",
    severity: "decision",
    title: "Reviewed cash moved beyond the plan guardrail",
    reason:
      input.cash.unknownCount === 0
        ? "Reviewed cash differs from the accepted portfolio baseline by at least the larger of 5% or $5,000."
        : `Reviewed cash differs from the accepted portfolio baseline by at least the larger of 5% or $5,000. ${input.cash.unknownCount} included ${input.cash.unknownCount === 1 ? "account has" : "accounts have"} no reported value.`,
    nextAction: "Reconcile cash and baseline",
    route: "holdings",
    observedAt: input.cash.observedAt,
    plannedValueMinor: input.cash.baselineMinor,
    actualValueMinor: input.cash.actualMinor,
    differenceMinor,
    thresholdMinor,
    plannedMonths: null,
    actualMonths: null,
  });
}

function debtCandidate(input: MonitoringInput): ActionItem | null {
  if (!input.debt.enabled) {
    return null;
  }
  if (input.debt.pendingReviewCount > 0) {
    return item(input, {
      key: "debt_review",
      metric: "debt",
      severity: "decision",
      title: "Review debt changes before using them",
      reason: `${input.debt.pendingReviewCount} obligation ${input.debt.pendingReviewCount === 1 ? "update is" : "updates are"} waiting. The accepted debt record and plan are unchanged.`,
      nextAction: "Review obligations",
      route: "obligations",
      observedAt: input.debt.observedAt,
      plannedValueMinor: input.debt.priorMinor,
      actualValueMinor: null,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  if (input.debt.overdueCount > 0) {
    return item(input, {
      key: "debt_overdue",
      metric: "debt",
      severity: "decision",
      title: "An accepted obligation is overdue",
      reason: `${input.debt.overdueCount} accepted ${input.debt.overdueCount === 1 ? "obligation is" : "obligations are"} marked overdue. Keel has not changed its payment treatment or the plan.`,
      nextAction: "Review payment treatment",
      route: "obligations",
      observedAt: input.debt.observedAt,
      plannedValueMinor: input.debt.priorMinor,
      actualValueMinor: input.debt.actualMinor,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  if (
    input.debt.actualMinor === null ||
    isStale(input.evaluatedAt, input.debt.observedAt)
  ) {
    return item(input, {
      key: "debt_freshness",
      metric: "debt",
      severity: "attention",
      title: "Debt needs a current reviewed value",
      reason:
        input.debt.observedAt === null
          ? "No reviewed debt value is available for monitoring."
          : `The oldest included debt value is more than ${PLAN_ACTUAL_FRESHNESS_DAYS} days old.`,
      nextAction: "Check obligations",
      route: "obligations",
      observedAt: input.debt.observedAt,
      plannedValueMinor: input.debt.priorMinor,
      actualValueMinor: input.debt.actualMinor,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  if (input.debt.priorMinor === null) {
    return null;
  }
  const differenceMinor = subtractMinor(
    input.debt.actualMinor,
    input.debt.priorMinor,
  );
  const thresholdMinor = proportionalThreshold(
    input.debt.priorMinor,
    VALUE_DRIFT_PPM,
    DEBT_DRIFT_FLOOR_MINOR,
  );
  if (Math.abs(differenceMinor) < thresholdMinor) {
    return null;
  }
  return item(input, {
    key: "debt_drift",
    metric: "debt",
    severity: "decision",
    title: "Reviewed debt changed materially",
    reason:
      input.debt.unknownCount === 0
        ? "Accepted debt changed by at least the larger of 5% or $5,000 since its prior reviewed state."
        : `Accepted debt changed by at least the larger of 5% or $5,000 since its prior reviewed state. ${input.debt.unknownCount} ${input.debt.unknownCount === 1 ? "balance remains" : "balances remain"} unavailable.`,
    nextAction: "Review debt impact",
    route: "obligations",
    observedAt: input.debt.observedAt,
    plannedValueMinor: input.debt.priorMinor,
    actualValueMinor: input.debt.actualMinor,
    differenceMinor,
    thresholdMinor,
    plannedMonths: null,
    actualMonths: null,
  });
}

function burnCandidate(input: MonitoringInput): ActionItem | null {
  if (!input.burn.enabled) {
    return null;
  }
  if (input.burn.status === "pending_review") {
    return item(input, {
      key: "burn_review",
      metric: "burn",
      severity: "decision",
      title: "Review observed burn before comparing it",
      reason:
        "Observed categories are waiting for review. They cannot change the accepted plan or forecast.",
      nextAction: "Review observed cash flow",
      route: "scenarios",
      observedAt: input.burn.observedAt,
      plannedValueMinor: addMinor(
        input.plan.householdBurnMonthlyMinor,
        input.plan.businessBurnMonthlyMinor,
      ),
      actualValueMinor: null,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  if (
    input.burn.status === "unavailable" ||
    input.burn.status === "incomplete" ||
    isStale(input.evaluatedAt, input.burn.observedAt)
  ) {
    return item(input, {
      key: "burn_freshness",
      metric: "burn",
      severity: "attention",
      title: "Burn needs a complete current review",
      reason:
        input.burn.status === "incomplete"
          ? "The latest cash-flow check did not cover three complete reviewed months."
          : input.burn.observedAt === null
            ? "No reviewed observed-burn period is available for monitoring."
            : `The latest reviewed burn period is more than ${PLAN_ACTUAL_FRESHNESS_DAYS} days old.`,
      nextAction: "Check observed cash flow",
      route: "scenarios",
      observedAt: input.burn.observedAt,
      plannedValueMinor: addMinor(
        input.plan.householdBurnMonthlyMinor,
        input.plan.businessBurnMonthlyMinor,
      ),
      actualValueMinor: null,
      differenceMinor: null,
      thresholdMinor: null,
      plannedMonths: null,
      actualMonths: null,
    });
  }
  const actualHousehold = input.burn.actualHouseholdMonthlyMinor;
  const actualBusiness = input.burn.actualBusinessMonthlyMinor;
  if (actualHousehold === null || actualBusiness === null) {
    return null;
  }
  const plannedValueMinor = addMinor(
    input.plan.householdBurnMonthlyMinor,
    input.plan.businessBurnMonthlyMinor,
  );
  const actualValueMinor = addMinor(actualHousehold, actualBusiness);
  const differenceMinor = subtractMinor(actualValueMinor, plannedValueMinor);
  const thresholdMinor = proportionalThreshold(
    plannedValueMinor,
    BURN_DRIFT_PPM,
    BURN_DRIFT_FLOOR_MINOR,
  );
  if (Math.abs(differenceMinor) < thresholdMinor) {
    return null;
  }
  return item(input, {
    key: "burn_drift",
    metric: "burn",
    severity: "decision",
    title: "Reviewed burn differs from the saved plan",
    reason:
      "Reviewed monthly burn differs by at least the larger of 10% or $500. This is a comparison, not a plan change.",
    nextAction: "Review plan inputs",
    route: "scenarios",
    observedAt: input.burn.observedAt,
    plannedValueMinor,
    actualValueMinor,
    differenceMinor,
    thresholdMinor,
    plannedMonths: null,
    actualMonths: null,
  });
}

function runwayCandidate(
  input: MonitoringInput,
  coverage: {
    cash: z.infer<typeof PlanActualCoverageSchema>;
    burn: z.infer<typeof PlanActualCoverageSchema>;
  },
): ActionItem | null {
  if (
    coverage.cash !== "current" ||
    coverage.burn !== "current" ||
    input.cash.actualMinor === null ||
    input.burn.actualHouseholdMonthlyMinor === null ||
    input.burn.actualBusinessMonthlyMinor === null
  ) {
    return null;
  }
  const plannedBurnMinor = addMinor(
    input.plan.householdBurnMonthlyMinor,
    input.plan.businessBurnMonthlyMinor,
  );
  const actualBurnMinor = addMinor(
    input.burn.actualHouseholdMonthlyMinor,
    input.burn.actualBusinessMonthlyMinor,
  );
  const plannedLiquidAfterFloor = Math.max(
    subtractMinor(
      input.plan.fiEligibleLiquidMinor,
      input.plan.protectedCashFloorMinor,
    ),
    0,
  );
  const cashDifferenceMinor = subtractMinor(
    input.cash.actualMinor,
    input.cash.baselineMinor,
  );
  const actualFiEligibleLiquidMinor = Math.max(
    addMinor(input.plan.fiEligibleLiquidMinor, cashDifferenceMinor),
    0,
  );
  const actualLiquidAfterFloor = Math.max(
    subtractMinor(
      actualFiEligibleLiquidMinor,
      input.plan.protectedCashFloorMinor,
    ),
    0,
  );
  const plannedMonths =
    plannedBurnMinor === 0
      ? 0
      : Number(BigInt(plannedLiquidAfterFloor) / BigInt(plannedBurnMinor));
  const actualMonths =
    actualBurnMinor === 0
      ? 0
      : Number(BigInt(actualLiquidAfterFloor) / BigInt(actualBurnMinor));
  const differenceMonths = actualMonths - plannedMonths;
  const material =
    Math.abs(differenceMonths) >= RUNWAY_DRIFT_MONTHS ||
    (plannedMonths >= RUNWAY_URGENT_MONTHS &&
      actualMonths < RUNWAY_URGENT_MONTHS);
  if (!material) {
    return null;
  }
  return item(input, {
    key: "runway_drift",
    metric: "runway",
    severity: "decision",
    title: "Current cash and burn changed protected runway",
    reason:
      actualMonths < RUNWAY_URGENT_MONTHS
        ? "Reviewed actuals put protected runway below 12 months. No forecast was changed."
        : "Reviewed actuals move protected runway by at least three whole months. No forecast was changed.",
    nextAction: "Review the runway decision",
    route: "scenarios",
    observedAt:
      Date.parse(input.cash.observedAt ?? "") <
      Date.parse(input.burn.observedAt ?? "")
        ? input.cash.observedAt
        : input.burn.observedAt,
    plannedValueMinor: null,
    actualValueMinor: null,
    differenceMinor: null,
    thresholdMinor: null,
    plannedMonths,
    actualMonths,
  });
}

function coverageFor(
  evaluatedAt: string,
  enabled: boolean,
  pendingReviewCount: number,
  actual: number | null,
  observedAt: string | null,
): z.infer<typeof PlanActualCoverageSchema> {
  if (!enabled) {
    return "not_configured";
  }
  if (pendingReviewCount > 0) {
    return "pending_review";
  }
  if (actual === null || observedAt === null) {
    return "missing";
  }
  return isStale(evaluatedAt, observedAt) ? "stale" : "current";
}

export function evaluatePlanActualMonitoring(
  rawInput: z.input<typeof PlanActualMonitoringInputSchema>,
): z.infer<typeof PlanActualMonitoringStateSchema> {
  const input = PlanActualMonitoringInputSchema.parse(rawInput);
  const cashCoverage = coverageFor(
    input.evaluatedAt,
    input.cash.enabled,
    input.cash.pendingReviewCount,
    input.cash.actualMinor,
    input.cash.observedAt,
  );
  const debtCoverage = coverageFor(
    input.evaluatedAt,
    input.debt.enabled,
    input.debt.pendingReviewCount,
    input.debt.actualMinor,
    input.debt.observedAt,
  );
  const burnActual =
    input.burn.actualHouseholdMonthlyMinor === null ||
    input.burn.actualBusinessMonthlyMinor === null
      ? null
      : addMinor(
          input.burn.actualHouseholdMonthlyMinor,
          input.burn.actualBusinessMonthlyMinor,
        );
  const burnCoverage = coverageFor(
    input.evaluatedAt,
    input.burn.enabled,
    input.burn.status === "pending_review" ? 1 : 0,
    input.burn.status === "incomplete" ? null : burnActual,
    input.burn.observedAt,
  );
  const coverage = {
    cash: cashCoverage,
    debt: debtCoverage,
    burn: burnCoverage,
    runway:
      cashCoverage === "current" && burnCoverage === "current"
        ? ("available" as const)
        : ("limited" as const),
  };
  const candidates = [
    cashCandidate(input),
    debtCandidate(input),
    burnCandidate(input),
    runwayCandidate(input, coverage),
  ].filter((candidate): candidate is ActionItem => candidate !== null);
  const activeCooldowns = new Map(
    input.cooldowns
      .filter(
        (cooldown) =>
          cooldown.sourceRevision === input.sourceRevision &&
          Date.parse(cooldown.until) > Date.parse(input.evaluatedAt),
      )
      .map((cooldown) => [cooldown.itemKey, cooldown.until]),
  );
  const actionItems: ActionItem[] = [];
  const deferredItems: ActionItem[] = [];
  candidates.forEach((candidate) => {
    const cooldownUntil = activeCooldowns.get(candidate.key);
    if (cooldownUntil === undefined) {
      actionItems.push(candidate);
    } else {
      deferredItems.push({ ...candidate, cooldownUntil });
    }
  });
  const allConfigured = [cashCoverage, debtCoverage, burnCoverage].every(
    (value) => value !== "not_configured",
  );
  const status =
    actionItems.length > 0
      ? "needs_action"
      : deferredItems.length > 0
        ? "deferred"
        : allConfigured && coverage.runway === "available"
          ? "clear"
          : "limited";

  return PlanActualMonitoringStateSchema.parse({
    version: 1,
    policyVersion: PLAN_ACTUAL_MONITORING_POLICY_VERSION,
    evaluatedAt: input.evaluatedAt,
    sourceRevision: input.sourceRevision,
    planId: input.plan.id,
    status,
    coverage,
    actionItems,
    deferredItems,
  });
}

export type PlanActualActionItem = z.infer<typeof PlanActualActionItemSchema>;
export type PlanActualMonitoringInput = z.infer<
  typeof PlanActualMonitoringInputSchema
>;
export type PlanActualMonitoringState = z.infer<
  typeof PlanActualMonitoringStateSchema
>;
export type PlanActualSnoozeInput = z.infer<typeof PlanActualSnoozeInputSchema>;
