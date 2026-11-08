import { z } from "zod";
import {
  type baselineRow,
  type debtRow,
  type goalRow,
  outlook,
  type planRow,
  type PreviewInput,
} from "./contract";

export const GOAL_PAGE = 120;
export const DEBT_WINDOW = 512;
export type Records = {
  baselines: z.infer<typeof baselineRow>[];
  plans: z.infer<typeof planRow>[];
  goals: z.infer<typeof goalRow>[];
  decisions: z.infer<typeof debtRow>[];
};
const DAY = 86_400_000;
const dayNumber = (date: string) => Date.parse(date + "T00:00:00Z") / DAY;
const daysApart = (from: string, to: string) => dayNumber(to) - dayNumber(from);
function numberOf(n: bigint) {
  return z.int().parse(Number(n));
}
function ceilRatio(n: bigint, d: bigint) {
  return n <= 0n ? n / d : (n + d - 1n) / d;
}
function gap(target: number, value: number) {
  return Math.max(0, numberOf(BigInt(target) - BigInt(value)));
}
function currentDebts(rows: Records["decisions"]) {
  const latest = new Map<string, Records["decisions"][number]>();
  for (const row of rows) {
    if (row.decision !== "accepted") continue;
    const old = latest.get(row.key);
    if (
      !old ||
      row.decidedAt > old.decidedAt ||
      (row.decidedAt === old.decidedAt && row.id > old.id)
    )
      latest.set(row.key, row);
  }
  return [...latest.values()];
}
export function projectOutlook(
  data: Records,
  evaluatedOn: string,
  input: PreviewInput,
) {
  const [head, previous] = data.baselines;
  const ambiguous =
    head !== undefined && head.recordedAt === previous?.recordedAt;
  const baseline = ambiguous ? null : (head ?? null);
  const plan = data.plans[0] ?? null;
  const exceeded = data.decisions.length > DEBT_WINDOW;
  const debts = exceeded ? [] : currentDebts(data.decisions);
  const reasons: z.infer<typeof outlook>["wealth"]["reasons"] = [];
  if (!baseline)
    reasons.push(
      ambiguous ? "ambiguous_baseline_date" : "no_accepted_baseline",
    );
  if (baseline && (baseline.unknownPositions || baseline.unknownCashAccounts))
    reasons.push("incomplete_asset_values");
  if (baseline?.potentialDuplicates) reasons.push("overlapping_positions");
  const assumedNoDebt =
    !exceeded && debts.length === 0 && input.assumeNoDebt === true;
  if (exceeded) reasons.push("debt_history_limit");
  else if (!debts.length && !assumedNoDebt) reasons.push("no_reviewed_debt");
  else if (debts.some((d) => d.balanceMinor === null))
    reasons.push("unknown_debt_balance");
  const reviewedDebtMinor =
    !exceeded && debts.length > 0 && debts.every((d) => d.balanceMinor !== null)
      ? numberOf(debts.reduce((n, d) => n + BigInt(d.balanceMinor!), 0n))
      : null;
  const net =
    baseline && reasons.length === 0
      ? numberOf(
          BigInt(baseline.liquidMinor) +
            BigInt(baseline.privatePaperMinor) -
            BigInt(reviewedDebtMinor ?? 0),
        )
      : null;
  const goals = data.goals
    .slice(0, GOAL_PAGE)
    .filter((g) => !g.archivedAt)
    .map((g) => ({
      goalId: g.goalId,
      versionId: g.versionId,
      name: g.name,
      metric: g.metric,
      unit: g.unit,
      isPrimary: g.primaryGoal === 1,
      current: g.current,
      currentSource: g.currentSource,
      recordedAt: g.recordedAt,
      target: g.target,
      targetDate: g.targetDate,
      currentShortfall: g.target === null ? null : gap(g.target, g.current),
      forecastId: g.forecastId,
      forecastDate: g.forecastDate,
      forecastMiddle: g.forecastMiddle,
      projectedShortfallAtTarget:
        g.target !== null &&
        g.forecastMode === "modeled" &&
        g.targetDate !== null &&
        g.targetDate === g.forecastDate &&
        g.forecastMiddle !== null
          ? gap(g.target, g.forecastMiddle)
          : null,
    }));
  const targets = [
    ...goals.flatMap((g) =>
      g.metric === "net_worth" &&
      g.unit === "minor_units" &&
      g.target !== null &&
      g.targetDate
        ? [{ goalId: g.goalId, date: g.targetDate, amountMinor: g.target }]
        : [],
    ),
    ...(input.targets ?? []).map((t) => ({ ...t, goalId: null })),
  ];
  const netWorthTargets = targets.map((t) => {
    const days = daysApart(evaluatedOn, t.date);
    const change = input.annualNetWorthChangeMinor;
    const projected =
      net !== null && change !== undefined && days >= 0
        ? numberOf(BigInt(net) + (BigInt(change) * BigInt(days)) / 365n)
        : null;
    return {
      goalId: t.goalId,
      date: t.date,
      targetMinor: t.amountMinor,
      currentShortfallMinor: net === null ? null : gap(t.amountMinor, net),
      projectedNetWorthMinor: projected,
      projectedShortfallMinor:
        projected === null ? null : gap(t.amountMinor, projected),
      requiredAnnualNetIncreaseMinor:
        net !== null && days > 0
          ? numberOf(
              ceilRatio(BigInt(gap(t.amountMinor, net)) * 365n, BigInt(days)),
            )
          : null,
      annualChangeAssumptionMinor: change ?? null,
    };
  });
  const days = daysApart(evaluatedOn, input.through);
  const immediate = input.immediateCashOutflowMinor ?? 0;
  const payments = (kind: string) =>
    debts
      .filter((d) => d.treatment === kind)
      .reduce((n, d) => n + BigInt(d.paymentMinor!), 0n);
  const reserved = payments("reserve_from_liquidity");
  const canModel = plan !== null && !exceeded;
  const burn = canModel
    ? BigInt(plan.householdBurnMinor) +
      BigInt(plan.businessBurnMinor) +
      payments("add_to_household_burn")
    : null;
  const start = canModel
    ? BigInt(plan.liquidMinor) - reserved - BigInt(immediate)
    : null;
  const headroom =
    start !== null && plan ? start - BigInt(plan.floorMinor) : null;
  const end =
    start !== null && burn !== null
      ? numberOf(start - ceilRatio(burn * 12n * BigInt(days), 365n))
      : null;
  const firstBreach =
    headroom === null || burn === null
      ? null
      : headroom < 0n
        ? 0n
        : burn === 0n
          ? null
          : (headroom * 365n) / (burn * 12n) + 1n;
  const maximumBurn =
    headroom !== null && days > 0 && headroom >= 0n
      ? numberOf((headroom * 365n) / (BigInt(days) * 12n))
      : null;
  return outlook.parse({
    version: "1",
    currency: "USD",
    evaluatedOn,
    baseline,
    cashPlan: plan,
    wealth: {
      scope: "accepted_portfolio_baseline_less_reviewed_debt",
      trackedNetWorthMinor: net,
      reviewedDebtMinor,
      reasons,
      assumedNoDebt,
      debtEvidence: debts.map((d) => ({
        decisionId: d.id,
        effectiveDate: d.effectiveDate,
      })),
    },
    goals,
    nextAfterGoal:
      data.goals.length > GOAL_PAGE
        ? String(data.goals[GOAL_PAGE - 1]!.cursor)
        : null,
    netWorthTargets,
    liquidity: {
      basis: "saved_fi_liquid_plan",
      through: input.through,
      days,
      startingLiquidMinor: plan?.liquidMinor ?? null,
      reserveMinor: plan?.floorMinor ?? null,
      monthlyBurnMinor: burn === null ? null : numberOf(burn),
      reservedDebtPaymentMinor: canModel ? numberOf(reserved) : null,
      immediateCashOutflowMinor: immediate,
      projectedEndMinor: end,
      reserveShortfallMinor:
        end !== null && plan ? gap(plan.floorMinor, end) : null,
      lastsThroughDate: end !== null && plan ? end >= plan.floorMinor : null,
      maximumMonthlyBurnMinor: maximumBurn,
      monthlyBurnReductionNeededMinor:
        maximumBurn !== null && burn !== null
          ? gap(numberOf(burn), maximumBurn)
          : null,
      obligationCoverage: exceeded
        ? "debt_history_limit"
        : debts.length
          ? "reviewed_payments"
          : "no_reviewed_debt",
      firstBelowReserveDate:
        firstBreach !== null && firstBreach <= BigInt(days)
          ? new Date((dayNumber(evaluatedOn) + Number(firstBreach)) * DAY)
              .toISOString()
              .slice(0, 10)
          : null,
    },
    emailCoverage: "not_connected_by_this_api",
  });
}
