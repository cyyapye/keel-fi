import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NormalizedCashAccounts } from "@keel/connectors";

import { D1CashAccountsRepository } from "./cash-accounts";

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
  public constructor(private readonly database: DatabaseSync) {}

  public prepare(sql: string): TestD1Statement {
    return new TestD1Statement(this.database, sql);
  }

  public batch(statements: readonly TestD1Statement[]): Promise<void> {
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

function normalized(
  rows: NormalizedCashAccounts["rows"],
): NormalizedCashAccounts {
  return {
    normalizedFingerprint: "f".repeat(64),
    observedAt: "2026-08-14T18:00:00.000Z",
    rows,
  };
}

function reportedRow(
  overrides: Partial<NormalizedCashAccounts["rows"][number]> = {},
) {
  return {
    naturalKeySha256: "a".repeat(64),
    institutionLabel: "First Synthetic Bank",
    accountLabel: "Household checking",
    subtype: "checking" as const,
    availableMinor: 120_000,
    currentMinor: 125_000,
    valueMinor: 120_000,
    valueState: "reported" as const,
    balanceSource: "available" as const,
    observedAt: "2026-08-14T18:00:00.000Z",
    issues: [],
    ...overrides,
  };
}

describe("reviewed cash accounts", () => {
  let sqlite: DatabaseSync;
  let repository: D1CashAccountsRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    repository = new D1CashAccountsRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("stages provider facts without changing the plan, then applies explicit row decisions", async () => {
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({ status: "disconnected" });
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "1".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const forecastCountBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM forecast_snapshots")
      .get() as { count: number };
    const planCountBefore = sqlite
      .prepare("SELECT COUNT(*) AS count FROM cash_flow_plans")
      .get() as { count: number };
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/synthetic-one.json",
        sourceSha256: "2".repeat(64),
        normalized: normalized([
          reportedRow(),
          reportedRow({
            naturalKeySha256: "b".repeat(64),
            accountLabel: "Foreign cash",
            availableMinor: 10_000,
            currentMinor: 10_000,
            valueMinor: null,
            valueState: "unsupported",
            balanceSource: null,
            issues: ["Only USD cash balances are supported."],
          }),
        ]),
      },
    );
    expect(staged.proposal?.summary).toEqual({
      rowCount: 2,
      reportedCount: 1,
      needsAttentionCount: 1,
      notReportedCount: 0,
      totalReportedMinor: 120_000,
    });
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      staged.proposal?.id ?? null,
      2,
    );
    await expect(
      repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      ),
    ).rejects.toMatchObject({ code: "review_required" });
    const state = await repository.getState("synthetic-access-subject", true);
    expect(state.pendingProposals).toHaveLength(1);
    expect(state.acceptedAccounts).toHaveLength(0);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get(),
    ).toEqual(forecastCountBefore);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM cash_flow_plans").get(),
    ).toEqual(planCountBefore);
    expect(
      sqlite
        .prepare("SELECT proposed_count FROM connector_sync_runs WHERE id = ?")
        .get(run.id),
    ).toEqual({ proposed_count: 2 });

    const proposal = state.pendingProposals[0];
    if (proposal === undefined) {
      throw new Error("Expected a pending cash proposal.");
    }
    await expect(
      repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Tried to accept an unsupported balance.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      }),
    ).rejects.toThrow("cannot be accepted");
    const result = await repository.applyProposal(
      "synthetic-access-subject",
      proposal.id,
      {
        changeNote: "Reviewed the synthetic cash balances.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision:
            row.valueState === "reported"
              ? ("accepted" as const)
              : ("excluded" as const),
        })),
      },
    );
    expect(result).toEqual({
      proposalId: proposal.id,
      acceptedCount: 1,
      excludedCount: 1,
      acceptedCashMinor: 120_000,
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      pendingProposals: [],
      acceptedAccounts: [
        expect.objectContaining({
          accountLabel: "Household checking",
          valueMinor: 120_000,
          valueState: "reported",
          refreshKind: "initial",
        }),
      ],
    });
  });

  it("treats a missing account as unknown only after review", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "3".repeat(64),
    );
    const initial = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const first = await repository.stageProposal(
      "synthetic-access-subject",
      initial.id,
      {
        objectKey: "cash-observations/synthetic-initial.json",
        sourceSha256: "4".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    const firstProposal = first.proposal;
    if (firstProposal === null) {
      throw new Error("Expected the initial proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      firstProposal.id,
      1,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      firstProposal.id,
      {
        changeNote: "Accepted initial synthetic checking.",
        decisions: firstProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const live = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "live",
    );
    const missing = await repository.stageProposal(
      "synthetic-access-subject",
      live.id,
      {
        objectKey: "cash-observations/synthetic-missing.json",
        sourceSha256: "5".repeat(64),
        normalized: normalized([]),
      },
    );
    expect(missing.proposal?.rows[0]).toMatchObject({
      action: "not_reported",
      valueMinor: null,
      valueState: "not_reported",
      priorValueMinor: 120_000,
    });
    const beforeReview = await repository.getState(
      "synthetic-access-subject",
      true,
    );
    expect(beforeReview.acceptedAccounts[0]?.valueMinor).toBe(120_000);
    const missingProposal = missing.proposal;
    if (missingProposal === null) {
      throw new Error("Expected the missing-account proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      live.id,
      missingProposal.id,
      0,
    );
    await repository.applyProposal(
      "synthetic-access-subject",
      missingProposal.id,
      {
        changeNote: "Confirmed the account was not reported.",
        decisions: missingProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      acceptedAccounts: [
        expect.objectContaining({
          valueMinor: null,
          valueState: "not_reported",
        }),
      ],
    });
  });

  it("counts every live provider attempt and enforces the monthly ceiling", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "6".repeat(64),
    );
    for (let index = 0; index < 4; index += 1) {
      const run = await repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      );
      await repository.failRefresh(
        "synthetic-access-subject",
        run.id,
        "provider_unavailable",
      );
    }

    await expect(
      repository.beginRefresh(
        "synthetic-access-subject",
        connection.id,
        "live",
      ),
    ).rejects.toMatchObject({
      code: "monthly_limit_reached",
    });
    await expect(
      repository.getState("synthetic-access-subject", true),
    ).resolves.toMatchObject({
      connections: [
        expect.objectContaining({
          liveRefreshesUsed: 4,
          liveRefreshesRemaining: 0,
        }),
      ],
    });
  });

  it("guards cash observations and decisions against rewriting", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "7".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "cash-observations/synthetic-immutable.json",
        sourceSha256: "8".repeat(64),
        normalized: normalized([reportedRow()]),
      },
    );
    const proposal = staged.proposal;
    if (proposal === null) {
      throw new Error("Expected a proposal.");
    }
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      proposal.id,
      1,
    );
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Accepted immutable synthetic cash.",
      decisions: proposal.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
      })),
    });

    expect(() =>
      sqlite
        .prepare(
          "UPDATE cash_balance_proposal_rows SET account_label = 'Changed'",
        )
        .run(),
    ).toThrow("cash proposal rows are immutable");
    expect(() =>
      sqlite.prepare("DELETE FROM cash_balance_review_decisions").run(),
    ).toThrow("cash review decisions are immutable");
  });
});
