import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NormalizedCashFlowDelta } from "@keel/connectors";

import { D1CashAccountsRepository } from "./cash-accounts";
import { D1CashFlowRepository } from "./cash-flow";
import { D1PlanInputsRepository } from "./plan-inputs";

const migrationFiles = [
  "packages/database/migrations/0001_keel_core.sql",
  "packages/database/migrations/0002_versioned_goals.sql",
  "packages/database/migrations/0003_evidence_applications.sql",
  "packages/database/migrations/0004_portfolio_watch.sql",
  "packages/database/migrations/0005_portfolio_watch_sources.sql",
  "packages/database/migrations/0006_evidence_claim_integrity.sql",
  "packages/database/migrations/0007_holding_imports.sql",
  "packages/database/migrations/0008_signal_update_proposals.sql",
  "packages/database/migrations/0009_angellist_mac_agent.sql",
  "packages/database/migrations/0010_public_holdings.sql",
  "packages/database/migrations/0011_portfolio_baselines.sql",
  "packages/database/migrations/0012_append_only_cash_flow_plans.sql",
  "packages/database/migrations/0013_plaid_holdings_webhooks.sql",
  "packages/database/migrations/0014_robinhood_auto_adjudication.sql",
  "packages/database/migrations/0015_reviewed_cash_accounts.sql",
  "packages/database/migrations/0016_reviewed_liabilities.sql",
  "packages/database/migrations/0017_reviewed_cash_flow.sql",
  "packages/database/migrations/0025_retired_asset_lots.sql",
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0033_provider_portfolio_agents.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/seed/synthetic.sql",
] as const;

class TestD1Statement {
  public constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
    private readonly values: readonly SQLInputValue[] = [],
  ) {}

  public bind(...values: SQLInputValue[]): TestD1Statement {
    return new TestD1Statement(this.database, this.sql, values);
  }

  public first<T>(): Promise<T | null> {
    return Promise.resolve(
      (this.database.prepare(this.sql).get(...this.values) as T) ?? null,
    );
  }

  public all<T>(): Promise<{ results: T[] }> {
    return Promise.resolve({
      results: this.database.prepare(this.sql).all(...this.values) as T[],
    });
  }

  public run(): Promise<{ meta: { changes: number } }> {
    const result = this.database.prepare(this.sql).run(...this.values);
    return Promise.resolve({ meta: { changes: Number(result.changes) } });
  }

  public execute(): void {
    this.database.prepare(this.sql).run(...this.values);
  }
}

class TestD1Database {
  public readonly batchSizes: number[] = [];

  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
    this.batchSizes.push(statements.length);
    this.database.exec("BEGIN");
    try {
      statements.forEach((statement) => statement.execute());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return Promise.resolve();
  }
}

function installAcceptedCashAccount(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO connector_accounts (
      id, household_id, connector_type, display_label, secret_reference,
      status, last_synced_at, provider_account_key, created_at
    ) VALUES (
      'cash_connection', 'hh_demo', 'plaid-cash', 'Synthetic Community Bank',
      'connector-secrets/synthetic.enc', 'active',
      '2026-08-14T18:00:00.000Z', '${"1".repeat(64)}',
      '2026-08-14T18:00:00.000Z'
    );
    INSERT INTO connector_sync_runs (
      id, household_id, connector_account_id, status, started_at,
      finished_at, cursor, discovered_count, proposed_count, error_code
    ) VALUES (
      'cash_balance_run', 'hh_demo', 'cash_connection', 'succeeded',
      '2026-08-14T18:00:00.000Z', '2026-08-14T18:00:01.000Z',
      'cash-initial-v1', 1, 1, NULL
    );
    INSERT INTO cash_balance_proposals (
      id, household_id, connector_account_id, sync_run_id, source_object_key,
      source_sha256, normalized_fingerprint, refresh_kind, observed_at,
      retrieved_at, status, created_at
    ) VALUES (
      'cash_balance_proposal', 'hh_demo', 'cash_connection',
      'cash_balance_run', 'cash-observations/synthetic.json',
      '${"2".repeat(64)}', '${"3".repeat(64)}', 'initial',
      '2026-08-14T18:00:00.000Z', '2026-08-14T18:00:00.000Z',
      'pending_review', '2026-08-14T18:00:00.000Z'
    );
    INSERT INTO cash_balance_proposal_rows (
      id, household_id, proposal_id, natural_key_sha256,
      item_account_key_sha256, institution_label, account_label, subtype,
      available_minor, current_minor, value_minor, value_state,
      balance_source, observed_at, issues_json, created_at
    ) VALUES (
      'cash_balance_row', 'hh_demo', 'cash_balance_proposal',
      '${"a".repeat(64)}', '${"a".repeat(64)}',
      'Synthetic Community Bank', 'Household checking', 'checking',
      1000000, 1000000, 1000000, 'reported', 'available',
      '2026-08-14T18:00:00.000Z', '[]', '2026-08-14T18:00:00.000Z'
    );
    INSERT INTO cash_balance_review_decisions (
      id, household_id, proposal_id, proposal_row_id, reviewer_user_id,
      decision, change_note, decided_at, immutable
    ) VALUES (
      'cash_balance_decision', 'hh_demo', 'cash_balance_proposal',
      'cash_balance_row', 'usr_demo', 'accepted', 'Reviewed synthetic cash.',
      '2026-08-14T18:01:00.000Z', 1
    );
    UPDATE cash_balance_proposals SET status = 'applied'
    WHERE id = 'cash_balance_proposal';
  `);
}

function mutation(
  sequence: number,
  month: "2026-05" | "2026-06" | "2026-07",
  category: "FOOD_AND_DRINK" | "GENERAL_SERVICES" | "LOAN_PAYMENTS",
  amountMinor: number,
) {
  return {
    sequence,
    mutation: "added" as const,
    transactionKeySha256: sequence.toString(16).padStart(64, "0"),
    accountKeySha256: "a".repeat(64),
    effectiveDate: `${month}-15`,
    month,
    amountMinor,
    pending: false,
    category,
    currencySupported: true,
  };
}

function completeDelta(): NormalizedCashFlowDelta {
  const months = ["2026-05", "2026-06", "2026-07"] as const;
  const mutations = months.flatMap((month, monthIndex) => [
    mutation(monthIndex * 3 + 1, month, "FOOD_AND_DRINK", 3_000_000),
    mutation(monthIndex * 3 + 2, month, "GENERAL_SERVICES", 1_500_000),
    mutation(monthIndex * 3 + 3, month, "LOAN_PAYMENTS", 200_000),
  ]);
  return {
    normalizedFingerprint: "d".repeat(64),
    retrievedAt: "2026-08-15T12:00:00.000Z",
    nextCursor: "cursor-initial",
    mutations,
  };
}

describe("reviewed observed cash flow", () => {
  let sqlite: DatabaseSync;
  let d1: D1Database;
  let testD1: TestD1Database;
  let repository: D1CashFlowRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    installAcceptedCashAccount(sqlite);
    testD1 = new TestD1Database(sqlite);
    d1 = testD1 as unknown as D1Database;
    repository = new D1CashFlowRepository(d1);
  });

  afterEach(() => sqlite.close());

  it("requires cost confirmation, aggregates three complete months, and reuses plan save", async () => {
    await expect(
      repository.beginSync("synthetic-access-subject", "cash_connection", {
        policyVersion: "observed-cash-flow-v1",
        pricingConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: "consent_required" });

    const run = await repository.beginSync(
      "synthetic-access-subject",
      "cash_connection",
      {
        policyVersion: "observed-cash-flow-v1",
        pricingConfirmed: true,
      },
    );
    expect(run).toMatchObject({ initial: true, plaidCursor: null });
    await repository.completeSync(
      "synthetic-access-subject",
      run.id,
      completeDelta(),
    );

    const state = await repository.getState("synthetic-access-subject", true);
    expect(state).toMatchObject({
      status: "review_required",
      latestOutcome: "proposal_ready",
      connections: [
        expect.objectContaining({
          pricingConfirmedAt: expect.any(String),
          lastCheckedAt: "2026-08-15T12:00:00.000Z",
        }),
      ],
    });
    const proposal = state.pendingProposals[0];
    if (proposal === undefined) {
      throw new Error("Expected an observed cash-flow proposal.");
    }
    expect(proposal.months).toEqual([
      { month: "2026-05", outflowMinor: 4_700_000, transactionCount: 3 },
      { month: "2026-06", outflowMinor: 4_700_000, transactionCount: 3 },
      { month: "2026-07", outflowMinor: 4_700_000, transactionCount: 3 },
    ]);
    expect(proposal.categories).toHaveLength(3);
    expect(
      proposal.categories.find((row) => row.category === "LOAN_PAYMENTS"),
    ).toMatchObject({
      averageMonthlyMinor: 200_000,
      defaultTreatment: "debt_payment",
    });

    const review = await repository.reviewProposal(
      "synthetic-access-subject",
      proposal.id,
      {
        changeNote: "Reviewed three synthetic complete months.",
        decisions: proposal.categories.map((category) => ({
          categoryId: category.id,
          treatment:
            category.category === "GENERAL_SERVICES"
              ? ("business" as const)
              : category.category === "LOAN_PAYMENTS"
                ? ("debt_payment" as const)
                : ("household" as const),
        })),
      },
    );
    expect(review.planSuggestion).toMatchObject({
      proposalId: proposal.id,
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
    });

    const planRepository = new D1PlanInputsRepository(d1);
    const plan = await planRepository.getState("synthetic-access-subject");
    if (review.planSuggestion === null) {
      throw new Error("Expected a material plan suggestion.");
    }
    const saved = await planRepository.save("synthetic-access-subject", {
      baseCashFlowPlanId: plan.baseCashFlowPlanId,
      baseForecastSnapshotId: plan.baseForecastSnapshotId,
      baseForecastSnapshotVersion: plan.baseForecastSnapshotVersion,
      householdBurnMonthlyMinor:
        review.planSuggestion.householdBurnMonthlyMinor,
      businessBurnMonthlyMinor: review.planSuggestion.businessBurnMonthlyMinor,
      protectedCashFloorMinor: plan.values.protectedCashFloorMinor,
      changeNote: review.planSuggestion.changeNote,
      cashFlowProposalId: review.planSuggestion.proposalId,
    });
    expect(saved.plan.values).toMatchObject({
      householdBurnMonthlyMinor: 3_000_000,
      businessBurnMonthlyMinor: 1_500_000,
    });
    expect(
      sqlite
        .prepare(
          "SELECT status, applied_cash_flow_plan_id FROM cash_flow_proposals WHERE id = ?",
        )
        .get(proposal.id),
    ).toEqual({
      status: "applied",
      applied_cash_flow_plan_id: saved.plan.baseCashFlowPlanId,
    });

    await expect(
      repository.beginSync("synthetic-access-subject", "cash_connection", {
        policyVersion: "observed-cash-flow-v1",
        pricingConfirmed: false,
      }),
    ).rejects.toMatchObject({ code: "daily_limit_reached" });

    const cashAccounts = new D1CashAccountsRepository(d1);
    await cashAccounts.beginDisconnect(
      "synthetic-access-subject",
      "cash_connection",
    );
    await cashAccounts.completeDisconnect(
      "synthetic-access-subject",
      "cash_connection",
    );
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM cash_flow_transaction_revisions",
        )
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM cash_flow_connections")
        .get(),
    ).toEqual({ count: 0 });
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS count FROM cash_flow_activation_events")
        .get(),
    ).toEqual({ count: 1 });
    expect(
      sqlite
        .prepare("SELECT status FROM cash_flow_proposals WHERE id = ?")
        .get(proposal.id),
    ).toEqual({ status: "applied" });
  });

  it("withholds a proposal when a complete month is missing", async () => {
    const run = await repository.beginSync(
      "synthetic-access-subject",
      "cash_connection",
      {
        policyVersion: "observed-cash-flow-v1",
        pricingConfirmed: true,
      },
    );
    const delta = completeDelta();
    await repository.completeSync("synthetic-access-subject", run.id, {
      ...delta,
      mutations: delta.mutations.filter((item) => item.month !== "2026-06"),
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "ready",
      latestOutcome: "history_incomplete",
      pendingProposals: [],
    });
  });

  it("stores provider pages with bounded D1 bulk statements", async () => {
    const run = await repository.beginSync(
      "synthetic-access-subject",
      "cash_connection",
      {
        policyVersion: "observed-cash-flow-v1",
        pricingConfirmed: true,
      },
    );
    const months = ["2026-05", "2026-06", "2026-07"] as const;
    await repository.completeSync("synthetic-access-subject", run.id, {
      normalizedFingerprint: "e".repeat(64),
      retrievedAt: "2026-08-15T12:00:00.000Z",
      nextCursor: "cursor-bulk",
      mutations: Array.from({ length: 501 }, (_, index) =>
        mutation(
          index + 1,
          months[index % months.length] ?? "2026-05",
          "FOOD_AND_DRINK",
          100,
        ),
      ),
    });

    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM cash_flow_transaction_revisions",
        )
        .get(),
    ).toEqual({ count: 501 });
    expect(testD1.batchSizes.at(-1)).toBe(8);
  });

  it("requires a reviewed Item account key after migration or reconnect", async () => {
    sqlite.exec(`
      INSERT INTO connector_sync_runs (
        id, household_id, connector_account_id, status, started_at,
        finished_at, cursor, discovered_count, proposed_count, error_code
      ) VALUES (
        'legacy_cash_run', 'hh_demo', 'cash_connection', 'succeeded',
        '2026-08-14T19:00:00.000Z', '2026-08-14T19:00:01.000Z',
        'cash-live-v1', 1, 1, NULL
      );
      INSERT INTO cash_balance_proposals (
        id, household_id, connector_account_id, sync_run_id, source_object_key,
        source_sha256, normalized_fingerprint, refresh_kind, observed_at,
        retrieved_at, status, created_at
      ) VALUES (
        'legacy_cash_proposal', 'hh_demo', 'cash_connection',
        'legacy_cash_run', 'cash-observations/legacy.json',
        '${"4".repeat(64)}', '${"5".repeat(64)}', 'live',
        '2026-08-14T19:00:00.000Z', '2026-08-14T19:00:00.000Z',
        'pending_review', '2026-08-14T19:00:00.000Z'
      );
      INSERT INTO cash_balance_proposal_rows (
        id, household_id, proposal_id, natural_key_sha256, institution_label,
        account_label, subtype, available_minor, current_minor, value_minor,
        value_state, balance_source, observed_at, issues_json, created_at
      ) VALUES (
        'legacy_cash_row', 'hh_demo', 'legacy_cash_proposal',
        '${"a".repeat(64)}', 'Synthetic Community Bank', 'Household checking',
        'checking', 1000000, 1000000, 1000000, 'reported', 'available',
        '2026-08-14T19:00:00.000Z', '[]', '2026-08-14T19:00:00.000Z'
      );
      INSERT INTO cash_balance_review_decisions (
        id, household_id, proposal_id, proposal_row_id, reviewer_user_id,
        decision, change_note, decided_at, immutable
      ) VALUES (
        'legacy_cash_decision', 'hh_demo', 'legacy_cash_proposal',
        'legacy_cash_row', 'usr_demo', 'accepted',
        'Reviewed before transaction account keys were retained.',
        '2026-08-14T19:01:00.000Z', 1
      );
      UPDATE cash_balance_proposals SET status = 'applied'
      WHERE id = 'legacy_cash_proposal';
    `);

    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      status: "waiting_for_cash_review",
      connections: [
        expect.objectContaining({
          acceptedAccountCount: 0,
          status: "cash_review_required",
        }),
      ],
    });
  });
});
