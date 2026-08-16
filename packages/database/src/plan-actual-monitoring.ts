import {
  evaluatePlanActualMonitoring,
  PLAN_ACTUAL_COOLDOWN_DAYS,
  PlanActualItemKeySchema,
  PlanActualMonitoringInputSchema,
  PlanActualSnoozeInputSchema,
  type PlanActualMonitoringInput,
  type PlanActualMonitoringState,
  type PlanActualSnoozeInput,
} from "@keel/domain/plan-actual-monitoring";

import { D1CashAccountsRepository } from "./cash-accounts";
import { D1CashFlowRepository } from "./cash-flow";
import { D1LiabilitiesRepository } from "./liabilities";
import { D1PlanInputsRepository } from "./plan-inputs";

type IdentityRow = {
  household_id: string;
  user_id: string;
};

type BaselineCashRow = {
  cash_account_value_minor: number;
};

type PriorDebtRow = {
  prior_minor: number | null;
  prior_count: number;
};

type LatestBurnRow = {
  status:
    "pending_review" | "ready_for_plan" | "reviewed_no_change" | "applied";
  observed_at: string;
  actual_household_burn_monthly_minor: number | null;
  actual_business_burn_monthly_minor: number | null;
};

type LatestBurnProposalRow = {
  status: LatestBurnRow["status"];
  observed_at: string;
  suggested_household_burn_monthly_minor: number | null;
  suggested_business_burn_monthly_minor: number | null;
  debt_payment_context_monthly_minor: number;
};

type ReviewedBurnRow = {
  household_monthly_minor: number;
  business_monthly_minor: number;
  loan_reclassified: number;
};

type LatestCashFlowRunRow = {
  observed_at: string;
};

type CooldownRow = {
  item_key: string;
  source_revision: string;
  snoozed_until: string;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sumMinor(values: readonly number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  const result = Number(sum);
  if (!Number.isSafeInteger(result)) {
    throw new Error(
      "Monitoring money total is outside the safe integer range.",
    );
  }
  return result;
}

function oldestTimestamp(values: readonly (string | null)[]): string | null {
  return (
    values
      .filter((value): value is string => value !== null)
      .sort((left, right) => left.localeCompare(right))[0] ?? null
  );
}

export interface PlanActualMonitoringRepository {
  getState(
    accessSubject: string,
    evaluatedAt?: string,
  ): Promise<PlanActualMonitoringState>;
  snooze(
    accessSubject: string,
    input: PlanActualSnoozeInput,
    evaluatedAt?: string,
  ): Promise<PlanActualMonitoringState>;
}

export class D1PlanActualMonitoringRepository implements PlanActualMonitoringRepository {
  public constructor(private readonly db: D1Database) {}

  public async getState(
    accessSubject: string,
    evaluatedAt = new Date().toISOString(),
  ): Promise<PlanActualMonitoringState> {
    const identity = await this.findIdentity(accessSubject);
    const [plan, cashState, debtState, burnState, baselineCash, priorDebt] =
      await Promise.all([
        new D1PlanInputsRepository(this.db).getState(accessSubject),
        new D1CashAccountsRepository(this.db).getState(accessSubject, false),
        new D1LiabilitiesRepository(this.db).getState(accessSubject, false),
        new D1CashFlowRepository(this.db).getState(accessSubject, false),
        this.latestBaselineCash(identity.household_id),
        this.priorDebt(identity.household_id),
      ]);
    const latestBurn = await this.latestBurn(identity.household_id);
    const latestCashFlowRun = await this.latestCashFlowRun(
      identity.household_id,
    );
    const acceptedCashValues = cashState.acceptedAccounts
      .map((account) => account.valueMinor)
      .filter((value): value is number => value !== null);
    const acceptedDebtValues = debtState.acceptedLiabilities
      .map((liability) => liability.balanceMinor)
      .filter((value): value is number => value !== null);
    const pendingBurn = burnState.pendingProposals[0] ?? null;
    const burnEnabled =
      burnState.connections.some(
        (connection) => connection.pricingConfirmedAt !== null,
      ) || latestBurn !== null;
    const burnObservation = (() => {
      if (pendingBurn?.status === "pending_review") {
        return {
          enabled: true,
          status: "pending_review" as const,
          actualHouseholdMonthlyMinor: null,
          actualBusinessMonthlyMinor: null,
          observedAt: pendingBurn.observedAt,
        };
      }
      if (pendingBurn?.status === "ready_for_plan") {
        return {
          enabled: true,
          status: "reviewed_material" as const,
          actualHouseholdMonthlyMinor:
            pendingBurn.comparison.proposedHouseholdBurnMonthlyMinor,
          actualBusinessMonthlyMinor:
            pendingBurn.comparison.proposedBusinessBurnMonthlyMinor,
          observedAt: pendingBurn.observedAt,
        };
      }
      if (
        burnState.latestOutcome === "history_incomplete" ||
        burnState.latestOutcome === "coverage_incomplete"
      ) {
        return {
          enabled: burnEnabled,
          status: "incomplete" as const,
          actualHouseholdMonthlyMinor: null,
          actualBusinessMonthlyMinor: null,
          observedAt: latestCashFlowRun?.observed_at ?? null,
        };
      }
      if (latestBurn?.status === "reviewed_no_change") {
        return {
          enabled: true,
          status: "reviewed_no_change" as const,
          actualHouseholdMonthlyMinor:
            latestBurn.actual_household_burn_monthly_minor,
          actualBusinessMonthlyMinor:
            latestBurn.actual_business_burn_monthly_minor,
          observedAt: latestBurn.observed_at,
        };
      }
      if (
        latestBurn !== null &&
        latestBurn.actual_household_burn_monthly_minor !== null &&
        latestBurn.actual_business_burn_monthly_minor !== null
      ) {
        return {
          enabled: true,
          status: "reviewed_material" as const,
          actualHouseholdMonthlyMinor:
            latestBurn.actual_household_burn_monthly_minor,
          actualBusinessMonthlyMinor:
            latestBurn.actual_business_burn_monthly_minor,
          observedAt: latestBurn.observed_at,
        };
      }
      return {
        enabled: burnEnabled,
        status: "unavailable" as const,
        actualHouseholdMonthlyMinor: null,
        actualBusinessMonthlyMinor: null,
        observedAt:
          latestBurn?.observed_at ?? latestCashFlowRun?.observed_at ?? null,
      };
    })();
    const material = {
      plan: {
        id: plan.baseCashFlowPlanId,
        fiEligibleLiquidMinor: plan.fiEligibleLiquidMinor,
        protectedCashFloorMinor: plan.values.protectedCashFloorMinor,
        householdBurnMonthlyMinor: plan.values.householdBurnMonthlyMinor,
        businessBurnMonthlyMinor: plan.values.businessBurnMonthlyMinor,
      },
      cash: {
        enabled:
          cashState.connections.length > 0 ||
          cashState.acceptedAccounts.length > 0 ||
          cashState.pendingProposals.length > 0 ||
          baselineCash > 0,
        baselineMinor: baselineCash,
        actualMinor:
          cashState.acceptedAccounts.length === 0
            ? null
            : sumMinor(acceptedCashValues),
        observedAt: oldestTimestamp(
          cashState.acceptedAccounts.map((account) => account.observedAt),
        ),
        pendingReviewCount: cashState.pendingProposals.reduce(
          (count, proposal) => count + proposal.rows.length,
          0,
        ),
        unknownCount: cashState.acceptedAccounts.filter(
          (account) => account.valueMinor === null,
        ).length,
      },
      debt: {
        enabled:
          debtState.connections.length > 0 ||
          debtState.acceptedLiabilities.length > 0 ||
          debtState.pendingProposals.length > 0,
        priorMinor: priorDebt,
        actualMinor:
          debtState.acceptedLiabilities.length === 0
            ? null
            : sumMinor(acceptedDebtValues),
        observedAt: oldestTimestamp(
          debtState.acceptedLiabilities.map(
            (liability) => liability.observedAt,
          ),
        ),
        pendingReviewCount: debtState.pendingProposals.reduce(
          (count, proposal) => count + proposal.rows.length,
          0,
        ),
        unknownCount: debtState.acceptedLiabilities.filter(
          (liability) => liability.balanceMinor === null,
        ).length,
        overdueCount: debtState.acceptedLiabilities.filter(
          (liability) => liability.isOverdue === true,
        ).length,
      },
      burn: burnObservation,
    };
    const sourceRevision = await sha256(JSON.stringify(material));
    const cooldowns = await this.cooldowns(
      identity.household_id,
      sourceRevision,
    );
    const input: PlanActualMonitoringInput =
      PlanActualMonitoringInputSchema.parse({
        ...material,
        evaluatedAt,
        sourceRevision,
        cooldowns,
      });
    return evaluatePlanActualMonitoring(input);
  }

  public async snooze(
    accessSubject: string,
    rawInput: PlanActualSnoozeInput,
    evaluatedAt = new Date().toISOString(),
  ): Promise<PlanActualMonitoringState> {
    const input = PlanActualSnoozeInputSchema.parse(rawInput);
    const [identity, state] = await Promise.all([
      this.findIdentity(accessSubject),
      this.getState(accessSubject, evaluatedAt),
    ]);
    const currentItem = state.actionItems.find(
      (item) =>
        item.key === input.itemKey &&
        item.sourceRevision === input.sourceRevision,
    );
    if (currentItem === undefined) {
      throw new Error("Monitoring item changed or is already deferred.");
    }
    const until = new Date(
      Date.parse(evaluatedAt) + PLAN_ACTUAL_COOLDOWN_DAYS * 86_400_000,
    ).toISOString();
    await this.db
      .prepare(
        `INSERT INTO plan_actual_monitoring_cooldowns (
           id, household_id, item_key, source_revision, snoozed_until,
           created_by_user_id, created_at, immutable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .bind(
        crypto.randomUUID(),
        identity.household_id,
        input.itemKey,
        input.sourceRevision,
        until,
        identity.user_id,
        evaluatedAt,
      )
      .run();
    return this.getState(accessSubject, evaluatedAt);
  }

  private async findIdentity(accessSubject: string): Promise<IdentityRow> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id, user.id AS user_id
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<IdentityRow>();
    if (identity === null) {
      throw new Error("Household not found for the authenticated user.");
    }
    return identity;
  }

  private async latestBaselineCash(householdId: string): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT cash_account_value_minor
         FROM portfolio_baselines
         WHERE household_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(householdId)
      .first<BaselineCashRow>();
    return row?.cash_account_value_minor ?? 0;
  }

  private async priorDebt(householdId: string): Promise<number | null> {
    const row = await this.db
      .prepare(
        `WITH accepted AS (
           SELECT proposal_row.natural_key_sha256,
                  proposal_row.balance_minor, decision.decided_at,
                  decision.id
           FROM liability_review_decisions decision
           JOIN liability_proposal_rows proposal_row
             ON proposal_row.id = decision.proposal_row_id
           WHERE decision.household_id = ?
             AND decision.decision = 'accepted'
         ), latest_time AS (
           SELECT MAX(decided_at) AS decided_at FROM accepted
         ), prior_ranked AS (
           SELECT accepted.balance_minor,
                  ROW_NUMBER() OVER (
                    PARTITION BY accepted.natural_key_sha256
                    ORDER BY accepted.decided_at DESC, accepted.id DESC
                  ) AS recency
           FROM accepted, latest_time
           WHERE accepted.decided_at < latest_time.decided_at
         )
         SELECT SUM(CASE
                      WHEN recency = 1 AND balance_minor IS NOT NULL
                      THEN balance_minor ELSE 0
                    END) AS prior_minor,
                SUM(CASE WHEN recency = 1 THEN 1 ELSE 0 END) AS prior_count
         FROM prior_ranked`,
      )
      .bind(householdId)
      .first<PriorDebtRow>();
    return row === null || row.prior_count === 0 ? null : row.prior_minor;
  }

  private async latestBurn(householdId: string): Promise<LatestBurnRow | null> {
    const proposal = await this.db
      .prepare(
        `SELECT status, observed_at,
                suggested_household_burn_monthly_minor,
                suggested_business_burn_monthly_minor,
                debt_payment_context_monthly_minor
         FROM cash_flow_proposals
         WHERE household_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(householdId)
      .first<LatestBurnProposalRow>();
    if (proposal === null) {
      return null;
    }
    if (proposal.status !== "reviewed_no_change") {
      return {
        status: proposal.status,
        observed_at: proposal.observed_at,
        actual_household_burn_monthly_minor:
          proposal.suggested_household_burn_monthly_minor,
        actual_business_burn_monthly_minor:
          proposal.suggested_business_burn_monthly_minor,
      };
    }
    const reviewed = await this.db
      .prepare(
        `WITH totals AS (
           SELECT COALESCE(SUM(CASE WHEN decision.treatment = 'household'
                                    THEN category.total_minor ELSE 0 END), 0)
                    AS household_total_minor,
                  COALESCE(SUM(CASE WHEN decision.treatment = 'business'
                                    THEN category.total_minor ELSE 0 END), 0)
                    AS business_total_minor,
                  MAX(CASE WHEN category.category = 'LOAN_PAYMENTS'
                                 AND decision.treatment IN ('household', 'business')
                           THEN 1 ELSE 0 END) AS loan_reclassified
           FROM cash_flow_proposal_categories category
           JOIN cash_flow_review_decisions decision
             ON decision.proposal_category_id = category.id
           WHERE category.household_id = ? AND category.proposal_id = (
             SELECT id FROM cash_flow_proposals
             WHERE household_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1
           )
         ), months AS (
           SELECT COUNT(*) AS month_count
           FROM cash_flow_proposal_months
           WHERE household_id = ? AND proposal_id = (
             SELECT id FROM cash_flow_proposals
             WHERE household_id = ?
             ORDER BY created_at DESC, id DESC
             LIMIT 1
           )
         )
         SELECT CAST(
                  (household_total_minor + CAST(month_count / 2 AS INTEGER)) /
                    MAX(month_count, 1) AS INTEGER
                ) AS household_monthly_minor,
                CAST(
                  (business_total_minor + CAST(month_count / 2 AS INTEGER)) /
                    MAX(month_count, 1) AS INTEGER
                ) AS business_monthly_minor,
                loan_reclassified
         FROM totals, months`,
      )
      .bind(householdId, householdId, householdId, householdId)
      .first<ReviewedBurnRow>();
    if (reviewed === null) {
      throw new Error("Reviewed burn categories are unavailable.");
    }
    return {
      status: proposal.status,
      observed_at: proposal.observed_at,
      actual_household_burn_monthly_minor: sumMinor([
        reviewed.household_monthly_minor,
        reviewed.loan_reclassified === 0
          ? proposal.debt_payment_context_monthly_minor
          : 0,
      ]),
      actual_business_burn_monthly_minor: reviewed.business_monthly_minor,
    };
  }

  private latestCashFlowRun(
    householdId: string,
  ): Promise<LatestCashFlowRunRow | null> {
    return this.db
      .prepare(
        `SELECT COALESCE(finished_at, started_at) AS observed_at
         FROM connector_sync_runs
         WHERE household_id = ?
           AND cursor IN ('cash-flow-initial-v1', 'cash-flow-incremental-v1')
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      )
      .bind(householdId)
      .first<LatestCashFlowRunRow>();
  }

  private async cooldowns(
    householdId: string,
    sourceRevision: string,
  ): Promise<PlanActualMonitoringInput["cooldowns"]> {
    const result = await this.db
      .prepare(
        `SELECT item_key, source_revision,
                MAX(snoozed_until) AS snoozed_until
         FROM plan_actual_monitoring_cooldowns
         WHERE household_id = ? AND source_revision = ?
         GROUP BY item_key, source_revision
         ORDER BY item_key`,
      )
      .bind(householdId, sourceRevision)
      .all<CooldownRow>();
    return result.results.map((row) => ({
      itemKey: PlanActualItemKeySchema.parse(row.item_key),
      sourceRevision: row.source_revision,
      until: row.snoozed_until,
    }));
  }
}
