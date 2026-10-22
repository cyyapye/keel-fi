import { createSqliteFixture } from "../../../scripts/test-support/sqlite-fixture";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { NormalizedLiabilities } from "@keel/connectors";

import { D1LiabilitiesRepository } from "./liabilities";

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
  "packages/database/migrations/0025_retired_asset_lots.sql",
  "packages/database/migrations/0041_reported_position_economics.sql",
  "packages/database/migrations/0046_reviewed_legal_entity_inventory.sql",
  "packages/database/migrations/0033_provider_portfolio_agents.sql",
  "packages/database/migrations/0047_provider_legal_document_evidence.sql",
  "packages/database/migrations/0048_private_document_access.sql",
  "packages/database/migrations/0049_legal_name_resolutions.sql",
  "packages/database/migrations/0050_agreement_rechecks.sql",
  "packages/database/migrations/0051_legal_structure_review_guard.sql",
  "packages/database/migrations/0052_reviewed_structure_entity_type.sql",
  "packages/database/migrations/0053_connected_investment_reviews.sql",
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
  rows: NormalizedLiabilities["rows"],
  fingerprint = "f".repeat(64),
): NormalizedLiabilities {
  return {
    normalizedFingerprint: fingerprint,
    observedAt: "2026-08-14T18:00:00.000Z",
    rows,
  };
}

function reportedRow(
  overrides: Partial<NormalizedLiabilities["rows"][number]> = {},
): NormalizedLiabilities["rows"][number] {
  return {
    naturalKeySha256: "a".repeat(64),
    institutionLabel: "Synthetic Community Bank",
    accountLabel: "Everyday card",
    kind: "credit_card",
    classification: "revolving",
    balanceMinor: 240_000,
    valueState: "reported",
    paymentMinor: 12_500,
    interestRatePpm: 219_900,
    nextPaymentDueDate: "2026-09-01",
    isOverdue: false,
    effectiveDate: "2026-08-01",
    observedAt: "2026-08-14T18:00:00.000Z",
    issues: [],
    ...overrides,
  };
}

describe("reviewed liabilities", () => {
  let sqlite: DatabaseSync;
  let repository: D1LiabilitiesRepository;

  beforeEach(() => {
    sqlite = createSqliteFixture(migrationFiles);
    repository = new D1LiabilitiesRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    );
  });

  afterEach(() => sqlite.close());

  it("keeps provider facts proposed until every obligation is reviewed", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "Synthetic Community Bank",
      "connector-secrets/synthetic-liabilities.enc",
      "1".repeat(64),
    );
    const run = await repository.beginRefresh(
      "synthetic-access-subject",
      connection.id,
      "initial",
    );
    const planCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM cash_flow_plans")
      .get();
    const forecastCount = sqlite
      .prepare("SELECT COUNT(*) AS count FROM forecast_snapshots")
      .get();
    const staged = await repository.stageProposal(
      "synthetic-access-subject",
      run.id,
      {
        objectKey: "liability-observations/synthetic.json",
        sourceSha256: "2".repeat(64),
        normalized: normalized([
          reportedRow(),
          reportedRow({
            naturalKeySha256: "b".repeat(64),
            accountLabel: "Graduate loan",
            kind: "student_loan",
            classification: "scheduled",
            balanceMinor: 4_800_000,
            paymentMinor: 45_000,
            interestRatePpm: 62_500,
            nextPaymentDueDate: "2026-09-12",
          }),
          reportedRow({
            naturalKeySha256: "c".repeat(64),
            accountLabel: "Unmapped loan",
            kind: "mortgage",
            classification: "scheduled",
            balanceMinor: null,
            valueState: "unsupported",
            paymentMinor: null,
            interestRatePpm: null,
            nextPaymentDueDate: null,
            isOverdue: null,
            issues: ["This account type is not supported."],
          }),
        ]),
      },
    );
    expect(staged.proposal?.summary).toEqual({
      rowCount: 3,
      reportedCount: 2,
      needsAttentionCount: 1,
      notReportedCount: 0,
      totalReportedMinor: 5_040_000,
    });
    await repository.completeRefresh(
      "synthetic-access-subject",
      run.id,
      staged.proposal?.id ?? null,
      3,
    );
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM cash_flow_plans").get(),
    ).toEqual(planCount);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get(),
    ).toEqual(forecastCount);

    const state = await repository.getState("synthetic-access-subject", true);
    const proposal = state.pendingProposals[0];
    if (proposal === undefined) {
      throw new Error("Expected an obligation proposal.");
    }
    await expect(
      repository.applyProposal("synthetic-access-subject", proposal.id, {
        changeNote: "Invalid treatment attempt.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          paymentTreatment: "reserve_from_liquidity" as const,
        })),
      }),
    ).rejects.toThrow();

    const result = await repository.applyProposal(
      "synthetic-access-subject",
      proposal.id,
      {
        changeNote: "Reviewed synthetic obligations and planning treatment.",
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision:
            row.valueState === "unsupported"
              ? ("excluded" as const)
              : ("accepted" as const),
          paymentTreatment:
            row.valueState === "unsupported"
              ? null
              : row.classification === "revolving"
                ? ("reserve_from_liquidity" as const)
                : ("add_to_household_burn" as const),
        })),
      },
    );
    expect(result).toMatchObject({
      acceptedCount: 2,
      excludedCount: 1,
      impact: {
        liabilityCount: 2,
        totalOutstandingMinor: 5_040_000,
        reservedPaymentMinor: 12_500,
        addedHouseholdBurnMinor: 45_000,
        netLiquidityMinor: 182_487_500,
        adjustedHouseholdBurnMonthlyMinor: 2_895_000,
      },
    });
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM cash_flow_plans").get(),
    ).toEqual(planCount);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM forecast_snapshots").get(),
    ).toEqual(forecastCount);
  });

  it("keeps missing provider values unknown until a reviewer accepts them", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "Synthetic Community Bank",
      "connector-secrets/synthetic-liabilities.enc",
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
        objectKey: "liability-observations/first.json",
        sourceSha256: "4".repeat(64),
        normalized: normalized([reportedRow()], "5".repeat(64)),
      },
    );
    await repository.completeRefresh(
      "synthetic-access-subject",
      initial.id,
      first.proposal?.id ?? null,
      1,
    );
    const firstProposal = first.proposal;
    if (firstProposal === null) throw new Error("Expected first proposal.");
    await repository.applyProposal(
      "synthetic-access-subject",
      firstProposal.id,
      {
        changeNote: "Accepted the synthetic card.",
        decisions: [
          {
            rowId: firstProposal.rows[0]?.id ?? "missing",
            decision: "accepted",
            paymentTreatment: "reserve_from_liquidity",
          },
        ],
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
        objectKey: "liability-observations/missing.json",
        sourceSha256: "6".repeat(64),
        normalized: normalized([], "7".repeat(64)),
      },
    );
    await repository.completeRefresh(
      "synthetic-access-subject",
      live.id,
      missing.proposal?.id ?? null,
      0,
    );
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedLiabilities[0],
    ).toMatchObject({ valueState: "reported", balanceMinor: 240_000 });
    const missingProposal = missing.proposal;
    if (missingProposal === null) throw new Error("Expected missing proposal.");
    expect(missingProposal.rows[0]).toMatchObject({
      action: "not_reported",
      valueState: "not_reported",
      balanceMinor: null,
      paymentMinor: null,
    });
    await repository.applyProposal(
      "synthetic-access-subject",
      missingProposal.id,
      {
        changeNote: "Confirmed that the provider no longer reports this card.",
        decisions: [
          {
            rowId: missingProposal.rows[0]?.id ?? "missing",
            decision: "accepted",
            paymentTreatment: "already_in_plan",
          },
        ],
      },
    );
    expect(
      (await repository.getState("synthetic-access-subject", true))
        .acceptedLiabilities[0],
    ).toMatchObject({
      valueState: "not_reported",
      balanceMinor: null,
      paymentMinor: null,
      paymentTreatment: "already_in_plan",
    });
  });

  it("supports reviewed manual fallback and protects its history", async () => {
    const proposal = await repository.stageManualProposal(
      "synthetic-access-subject",
      {
        institutionLabel: "Manual entry",
        accountLabel: "Family mortgage",
        kind: "mortgage",
        balanceMinor: 38_000_000,
        paymentMinor: 220_000,
        interestRatePpm: 51_250,
        nextPaymentDueDate: "2026-09-01",
        isOverdue: false,
        effectiveDate: "2026-08-14",
      },
    );
    await repository.applyProposal("synthetic-access-subject", proposal.id, {
      changeNote: "Reviewed the manual synthetic mortgage.",
      decisions: [
        {
          rowId: proposal.rows[0]?.id ?? "missing",
          decision: "accepted",
          paymentTreatment: "already_in_plan",
        },
      ],
    });
    const state = await repository.getState("synthetic-access-subject", false);
    expect(state).toMatchObject({
      status: "setup_required",
      acceptedLiabilities: [
        {
          source: "manual",
          connectionId: null,
          balanceMinor: 38_000_000,
          paymentTreatment: "already_in_plan",
        },
      ],
    });
    expect(() =>
      sqlite
        .prepare("UPDATE liability_review_decisions SET change_note = 'x'")
        .run(),
    ).toThrow("liability review decisions are immutable");
    expect(() =>
      sqlite.prepare("DELETE FROM liability_proposals").run(),
    ).toThrow("liability proposals are immutable");

    const revision = await repository.stageManualProposal(
      "synthetic-access-subject",
      {
        institutionLabel: "Manual entry",
        accountLabel: "Family mortgage",
        kind: "mortgage",
        balanceMinor: 37_500_000,
        paymentMinor: 215_000,
        interestRatePpm: 51_250,
        nextPaymentDueDate: "2026-10-01",
        isOverdue: false,
        effectiveDate: "2026-09-14",
      },
    );
    expect(revision.rows[0]).toMatchObject({
      action: "update_obligation",
      priorBalanceMinor: 38_000_000,
      balanceMinor: 37_500_000,
    });
    await expect(
      repository.stageManualProposal("synthetic-access-subject", {
        institutionLabel: "Manual entry",
        accountLabel: "Family mortgage",
        kind: "mortgage",
        balanceMinor: 37_500_000,
        paymentMinor: 215_000,
        interestRatePpm: 51_250,
        nextPaymentDueDate: "2026-10-01",
        isOverdue: false,
        effectiveDate: "2026-09-14",
      }),
    ).rejects.toMatchObject({ code: "review_required" });
    await repository.applyProposal("synthetic-access-subject", revision.id, {
      changeNote: "Reviewed the updated synthetic mortgage.",
      decisions: [
        {
          rowId: revision.rows[0]?.id ?? "missing",
          decision: "accepted",
          paymentTreatment: "already_in_plan",
        },
      ],
    });
    const revisedState = await repository.getState(
      "synthetic-access-subject",
      false,
    );
    expect(revisedState.acceptedLiabilities).toHaveLength(1);
    expect(revisedState.acceptedLiabilities[0]).toMatchObject({
      balanceMinor: 37_500_000,
      effectiveDate: "2026-09-14",
    });
    expect(
      sqlite
        .prepare(
          "SELECT COUNT(*) AS count FROM liability_review_decisions WHERE decision = 'accepted'",
        )
        .get(),
    ).toEqual({ count: 2 });
  });

  it("requires explicit disconnect before replacing provider access", async () => {
    const connection = await repository.upsertConnection(
      "synthetic-access-subject",
      "Synthetic Community Bank",
      "connector-secrets/original.enc",
      "8".repeat(64),
    );
    await expect(
      repository.upsertConnection(
        "synthetic-access-subject",
        "Synthetic Community Bank",
        "connector-secrets/replacement.enc",
        "9".repeat(64),
      ),
    ).rejects.toMatchObject({ code: "connection_invalid" });
    await expect(
      repository.getConnection("synthetic-access-subject", connection.id),
    ).resolves.toMatchObject({
      secretReference: "connector-secrets/original.enc",
      providerAccountKey: "8".repeat(64),
    });
  });
});
