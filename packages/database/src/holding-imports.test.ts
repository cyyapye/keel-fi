import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
  type RobinhoodHoldingImportStageInput,
} from "./holding-imports";
import { D1AlphaRepository } from "./index";
import { D1CashAccountsRepository } from "./cash-accounts";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";

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

function stageInput(
  documentFingerprint: string,
  changes: Partial<HoldingImportStageInput["rows"][number]> = {},
): HoldingImportStageInput {
  return {
    objectKey: `holding-imports/${documentFingerprint.slice(0, 8)}`,
    sha256: documentFingerprint,
    byteSize: 1_024,
    effectiveDate: "2026-06-14",
    retrievedAt: "2026-06-14T12:00:00.000Z",
    rows: [
      {
        rowNumber: 3,
        naturalKeySha256: "a".repeat(64),
        companyOrFund: "Synthetic Navigation Systems",
        status: "Live",
        investDate: "2025-04-12",
        investedMinor: 2_500_000,
        unrealizedValueMinor: null,
        unrealizedValueState: "locked",
        realizedValueMinor: 0,
        netValueMinor: null,
        netValueState: "locked",
        multiplePpm: null,
        investmentEntity: "Synthetic Family Trust",
        lead: "Synthetic Ventures",
        investmentType: "Syndicate",
        source: null,
        round: "Seed",
        market: "Navigation",
        fundName: "Synthetic Navigation SPV",
        dealMetadata: {
          allocationMinor: 2_500_000,
          instrument: "safe",
          roundSizeMinor: 25_000_000,
          valuationOrCapType: "Post-money",
          valuationOrCapMinor: 100_000_000,
          discount: null,
          carry: "20%",
          shareClass: null,
        },
        ...changes,
      },
    ],
  };
}

function robinhoodStageInput(
  normalizedFingerprint = "9".repeat(64),
): RobinhoodHoldingImportStageInput {
  return {
    objectKey: "holding-imports/synthetic-robinhood.json",
    sha256: "8".repeat(64),
    byteSize: 2_048,
    normalizedFingerprint,
    effectiveDate: "2026-08-08",
    retrievedAt: "2026-08-10T12:00:00.000Z",
    rows: [
      {
        rowNumber: 1,
        naturalKeySha256: "7".repeat(64),
        securityName: "Synthetic Public Company",
        ticker: "SYN",
        securityType: "equity",
        accountLabel: "Robinhood brokerage",
        quantityMicros: 12_345_678,
        costBasisMinor: 100_000,
        marketValueMinor: 123_457,
        observedOn: "2026-08-08",
        currency: "USD",
        issues: [],
      },
    ],
  };
}

describe("AngelList holding import persistence", () => {
  let sqlite: DatabaseSync;
  let repository: D1HoldingImportRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    repository = new D1HoldingImportRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("stages once, preserves a locked NAV, and applies an SPV position without quantity", async () => {
    const input = stageInput("f".repeat(64));
    const staged = await repository.stageHoldingImport(
      "synthetic-access-subject",
      input,
    );

    expect(staged.created).toBe(true);
    expect(staged.preview).toMatchObject({
      provider: "angellist",
      status: "pending_review",
      summary: {
        rowCount: 1,
        lockedValueCount: 1,
        createCount: 1,
      },
      rows: [
        {
          positionName: "Synthetic Navigation SPV",
          exposureName: "Synthetic Navigation Systems",
          administratorNavMinor: null,
          administratorNavState: "locked",
          action: "create_position",
        },
      ],
    });
    await expect(
      repository.listPendingHoldingImports("synthetic-access-subject"),
    ).resolves.toEqual([
      expect.objectContaining({
        id: staged.preview.id,
        provider: "angellist",
        status: "pending_review",
        rowCount: 1,
      }),
    ]);

    const duplicate = await repository.stageHoldingImport(
      "synthetic-access-subject",
      input,
    );
    expect(duplicate.created).toBe(false);
    expect(duplicate.preview.id).toBe(staged.preview.id);

    const decision = {
      currency: "USD" as const,
      decisions: [
        {
          rowId: staged.preview.rows[0]!.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic AngelList position.",
        },
      ],
    };
    const applied = await repository.applyHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
      decision,
    );
    expect(applied).toEqual({
      importId: staged.preview.id,
      createdCount: 1,
      updatedCount: 0,
      unchangedCount: 0,
      rejectedCount: 0,
      lockedValueCount: 1,
    });
    await expect(
      repository.listPendingHoldingImports("synthetic-access-subject"),
    ).resolves.toEqual([]);
    await expect(
      repository.applyHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
        decision,
      ),
    ).resolves.toEqual(applied);

    const position = sqlite
      .prepare(
        `SELECT position_kind, legal_vehicle_name
         FROM holding_positions`,
      )
      .get() as { position_kind: string; legal_vehicle_name: string };
    expect(position).toEqual({
      position_kind: "spv_interest",
      legal_vehicle_name: "Synthetic Navigation SPV",
    });
    const positionColumns = sqlite
      .prepare("PRAGMA table_info(holding_positions)")
      .all() as Array<{ name: string }>;
    expect(positionColumns.map((column) => column.name)).not.toContain(
      "quantity_scaled",
    );

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.holdings).toHaveLength(4);
    expect(alpha.holdings).toContainEqual(
      expect.objectContaining({
        id: expect.any(String),
        positionName: "Synthetic Navigation SPV",
        exposureName: "Synthetic Navigation Systems",
        ownerLabel: "Synthetic Family Trust",
        positionKind: "spv_interest",
        administratorNavMinor: null,
        administratorNavState: "locked",
        externalMarkMinor: null,
        underwritingValueMinor: null,
        scenarioValueMinor: null,
        usableLiquidityMinor: null,
        sourceLabel: "AngelList export",
        confidencePpm: null,
      }),
    );
  });

  it("appends a revised snapshot and records a repeated observation as no change", async () => {
    const first = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("1".repeat(64)),
    );
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      first.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: first.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed initial synthetic position.",
          },
        ],
      },
    );

    const reportedChanges = {
      unrealizedValueMinor: 3_100_000,
      unrealizedValueState: "reported" as const,
      netValueMinor: 3_100_000,
      netValueState: "reported" as const,
      multiplePpm: 1_240_000,
    };
    const revised = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("2".repeat(64), reportedChanges),
    );
    expect(revised.preview.rows[0]?.action).toBe("append_snapshot");
    const revisedResult = await repository.applyHoldingImport(
      "synthetic-access-subject",
      revised.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: revised.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed revised synthetic value.",
          },
        ],
      },
    );
    expect(revisedResult.updatedCount).toBe(1);

    const repeated = await repository.stageHoldingImport(
      "synthetic-access-subject",
      stageInput("3".repeat(64), reportedChanges),
    );
    expect(repeated.preview.rows[0]?.action).toBe("no_change");
    const repeatedResult = await repository.applyHoldingImport(
      "synthetic-access-subject",
      repeated.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: repeated.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Confirmed repeated synthetic observation.",
          },
        ],
      },
    );
    expect(repeatedResult.unchangedCount).toBe(1);

    const counts = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM holding_positions) AS positions,
           (SELECT COUNT(*) FROM holding_position_snapshots) AS snapshots,
           (SELECT COUNT(*) FROM holding_import_applications) AS applications`,
      )
      .get() as { positions: number; snapshots: number; applications: number };
    expect(counts).toEqual({ positions: 1, snapshots: 2, applications: 3 });
  });

  it("stages and applies an exact Robinhood public-position snapshot", async () => {
    const staged = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      robinhoodStageInput(),
    );
    expect(staged).toMatchObject({
      created: true,
      preview: {
        provider: "robinhood",
        status: "pending_review",
        summary: {
          rowCount: 1,
          administratorValueCount: 1,
          createCount: 1,
        },
        rows: [
          {
            positionName: "Synthetic Public Company",
            exposureName: "SYN · Synthetic Public Company",
            ticker: "SYN",
            quantityMicros: 12_345_678,
            costBasisMinor: 100_000,
            administratorNavMinor: 123_457,
            action: "create_position",
          },
        ],
      },
    });

    const repeated = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      { ...robinhoodStageInput(), sha256: "6".repeat(64) },
    );
    expect(repeated.created).toBe(false);
    expect(repeated.preview.id).toBe(staged.preview.id);

    await repository.applyHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: staged.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed synthetic Robinhood position.",
          },
        ],
      },
    );

    const stored = sqlite
      .prepare(
        `SELECT
           position.position_kind,
           position.opened_on,
           snapshot.quantity_micros,
           snapshot.ticker,
           snapshot.cost_basis_minor
         FROM holding_positions position
         JOIN holding_position_snapshots snapshot
           ON snapshot.position_id = position.id
         WHERE position.provider = 'robinhood'`,
      )
      .get() as {
      position_kind: string;
      opened_on: string | null;
      quantity_micros: number;
      ticker: string;
      cost_basis_minor: number;
    };
    expect(stored).toEqual({
      position_kind: "direct",
      opened_on: null,
      quantity_micros: 12_345_678,
      ticker: "SYN",
      cost_basis_minor: 100_000,
    });

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.holdings).toContainEqual(
      expect.objectContaining({
        exposureName: "SYN · Synthetic Public Company",
        positionKind: "direct",
        administratorNavMinor: 123_457,
        sourceLabel: "Robinhood via Plaid",
        ticker: "SYN",
        quantityMicros: 12_345_678,
        costBasisMinor: 100_000,
      }),
    );

    const changedInput = robinhoodStageInput("a".repeat(64));
    changedInput.objectKey = "holding-imports/synthetic-robinhood-changed.json";
    changedInput.sha256 = "de".repeat(32);
    changedInput.effectiveDate = "2026-08-09";
    changedInput.retrievedAt = "2026-08-09T12:00:00.000Z";
    changedInput.rows[0] = {
      ...changedInput.rows[0]!,
      marketValueMinor: 130_000,
      observedOn: "2026-08-09",
    };
    const changed = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      changedInput,
    );
    expect(changed).toMatchObject({
      created: true,
      preview: { rows: [{ action: "append_snapshot" }] },
    });
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      changed.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: changed.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed changed synthetic Robinhood position.",
          },
        ],
      },
    );

    const returnedInput = robinhoodStageInput();
    returnedInput.objectKey =
      "holding-imports/synthetic-robinhood-returned.json";
    returnedInput.sha256 = "ef".repeat(32);
    returnedInput.effectiveDate = "2026-08-10";
    returnedInput.retrievedAt = "2026-08-10T12:00:00.000Z";
    returnedInput.rows[0] = {
      ...returnedInput.rows[0]!,
      observedOn: "2026-08-10",
    };
    const returned = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      returnedInput,
    );
    expect(returned).toMatchObject({
      created: true,
      preview: { rows: [{ action: "append_snapshot" }] },
    });
    await repository.applyHoldingImport(
      "synthetic-access-subject",
      returned.preview.id,
      {
        currency: "USD",
        decisions: [
          {
            rowId: returned.preview.rows[0]!.id,
            decision: "accepted",
            rationale: "Reviewed returned synthetic Robinhood position.",
          },
        ],
      },
    );

    const current = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(current.holdings).toContainEqual(
      expect.objectContaining({
        administratorNavMinor: 123_457,
        effectiveDate: "2026-08-10",
      }),
    );
  });

  it("reclassifies legacy crypto without creating an active FI exception", async () => {
    const legacyInput = robinhoodStageInput("b".repeat(64));
    legacyInput.objectKey = "holding-imports/synthetic-legacy-crypto.json";
    legacyInput.sha256 = "bc".repeat(32);
    legacyInput.rows[0] = {
      ...legacyInput.rows[0]!,
      naturalKeySha256: "c".repeat(64),
      securityName: "Synthetic Digital Asset",
      ticker: "SDA",
      securityType: "cryptocurrency",
      issues: ["cryptocurrency positions are not supported yet."],
    };
    const legacy = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      legacyInput,
    );
    await expect(
      repository.autoAdjudicateRobinhoodHoldingImport(
        "synthetic-access-subject",
        legacy.preview.id,
      ),
    ).resolves.toMatchObject({ autoAppliedCount: 0, quarantinedCount: 1 });

    const input = robinhoodStageInput("c".repeat(64));
    input.rows[0] = {
      ...input.rows[0]!,
      naturalKeySha256: "c".repeat(64),
      securityName: "Synthetic Digital Asset",
      ticker: "SDA",
      securityType: "cryptocurrency",
      issues: ["Crypto is recorded outside the FI plan."],
    };

    const staged = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      input,
    );
    const adjudication = await repository.autoAdjudicateRobinhoodHoldingImport(
      "synthetic-access-subject",
      staged.preview.id,
    );

    expect(adjudication).toEqual({
      importId: staged.preview.id,
      policyVersion: "robinhood-holdings-auto-v2",
      autoAppliedCount: 1,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        staged.preview.id,
      ),
    ).resolves.toMatchObject({
      status: "applied",
      rows: [
        {
          ticker: "SDA",
          adjudicationStatus: "auto_applied",
          reasonCodes: expect.arrayContaining(["excluded_from_fi_planning"]),
        },
      ],
    });

    const alpha = await new D1AlphaRepository(
      new TestD1Database(sqlite) as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.holdings).toContainEqual(
      expect.objectContaining({
        positionName: "Synthetic Digital Asset",
        ticker: "SDA",
        sourceLabel: "Robinhood via Plaid",
      }),
    );

    await expect(
      repository.hasAcceptedRobinhoodPlanningPositions(
        "synthetic-access-subject",
      ),
    ).resolves.toBe(false);

    const laterInput = robinhoodStageInput("d".repeat(64));
    laterInput.objectKey = "holding-imports/synthetic-later-robinhood.json";
    laterInput.sha256 = "d".repeat(64);
    const later = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      laterInput,
    );
    await expect(
      repository.autoAdjudicateRobinhoodHoldingImport(
        "synthetic-access-subject",
        later.preview.id,
      ),
    ).resolves.toMatchObject({
      autoAppliedCount: 1,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    expect(
      (
        sqlite
          .prepare("SELECT COUNT(*) AS count FROM holding_import_quarantines")
          .get() as { count: number }
      ).count,
    ).toBe(1);
    await expect(
      repository.hasAcceptedRobinhoodPlanningPositions(
        "synthetic-access-subject",
      ),
    ).resolves.toBe(true);
  });

  it("auto-applies clear Robinhood rows and quarantines only ambiguous changes", async () => {
    const initialInput = robinhoodStageInput();
    initialInput.rows[0] = {
      ...initialInput.rows[0]!,
      costBasisMinor: null,
      issues: ["Cost basis is unavailable."],
    };
    initialInput.rows.push({
      ...initialInput.rows[0],
      rowNumber: 2,
      naturalKeySha256: "6".repeat(64),
      securityName: "Synthetic Index Fund",
      ticker: "SIX",
      quantityMicros: 2_000_000,
      costBasisMinor: 18_000,
      marketValueMinor: 20_000,
      issues: [],
    });
    const initial = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      initialInput,
    );
    const initialAdjudication =
      await repository.autoAdjudicateRobinhoodHoldingImport(
        "synthetic-access-subject",
        initial.preview.id,
      );
    expect(initialAdjudication).toEqual({
      importId: initial.preview.id,
      policyVersion: "robinhood-holdings-auto-v2",
      autoAppliedCount: 2,
      quarantinedCount: 0,
      preservedPositionCount: 0,
    });
    await expect(
      repository.getHoldingImport(
        "synthetic-access-subject",
        initial.preview.id,
      ),
    ).resolves.toMatchObject({
      status: "applied",
      summary: { autoAppliedCount: 2, quarantinedCount: 0 },
      rows: [
        {
          costBasisMinor: null,
          adjudicationStatus: "auto_applied",
          decisionSource: "policy",
          reasonCodes: expect.arrayContaining(["cost_basis_unavailable"]),
        },
        { adjudicationStatus: "auto_applied" },
      ],
    });

    const changedInput = robinhoodStageInput("a".repeat(64));
    changedInput.objectKey = "holding-imports/synthetic-robinhood-shift.json";
    changedInput.sha256 = "ab".repeat(32);
    changedInput.retrievedAt = "2026-08-11T12:00:00.000Z";
    changedInput.effectiveDate = "2026-08-11";
    changedInput.rows[0] = {
      ...changedInput.rows[0]!,
      marketValueMinor: 130_000,
      observedOn: "2026-08-11",
    };
    changedInput.rows.push({
      ...changedInput.rows[0],
      rowNumber: 2,
      naturalKeySha256: "5".repeat(64),
      securityName: "Synthetic Renamed Fund",
      ticker: "SRF",
      marketValueMinor: 21_000,
    });
    const changed = await repository.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      changedInput,
    );
    const changedAdjudication =
      await repository.autoAdjudicateRobinhoodHoldingImport(
        "synthetic-access-subject",
        changed.preview.id,
      );
    expect(changedAdjudication).toEqual({
      importId: changed.preview.id,
      policyVersion: "robinhood-holdings-auto-v2",
      autoAppliedCount: 1,
      quarantinedCount: 2,
      preservedPositionCount: 1,
    });
    const preview = await repository.getHoldingImport(
      "synthetic-access-subject",
      changed.preview.id,
    );
    expect(preview).toMatchObject({
      status: "quarantined",
      summary: {
        autoAppliedCount: 1,
        quarantinedCount: 2,
        preservedPositionCount: 1,
      },
      rows: [
        { ticker: "SYN", adjudicationStatus: "auto_applied" },
        {
          ticker: "SRF",
          action: "needs_attention",
          adjudicationStatus: "quarantined",
        },
      ],
    });
    await expect(
      repository.listPendingHoldingImports("synthetic-access-subject"),
    ).resolves.toContainEqual(
      expect.objectContaining({
        id: changed.preview.id,
        status: "quarantined",
      }),
    );

    const stored = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM holding_positions
            WHERE provider = 'robinhood') AS positions,
           (SELECT COUNT(*) FROM holding_position_snapshots snapshot
            JOIN holding_positions position ON position.id = snapshot.position_id
            WHERE position.provider = 'robinhood') AS snapshots,
           (SELECT COUNT(*) FROM holding_import_row_decisions
            WHERE decision_source = 'policy') AS policy_decisions,
           (SELECT COUNT(*) FROM holding_import_quarantines) AS quarantines`,
      )
      .get() as {
      positions: number;
      snapshots: number;
      policy_decisions: number;
      quarantines: number;
    };
    expect(stored).toEqual({
      positions: 2,
      snapshots: 3,
      policy_decisions: 3,
      quarantines: 2,
    });
    expect(() =>
      sqlite
        .prepare("UPDATE holding_import_quarantines SET detail = 'changed'")
        .run(),
    ).toThrow("immutable");

    await expect(
      repository.autoAdjudicateRobinhoodHoldingImport(
        "synthetic-access-subject",
        changed.preview.id,
      ),
    ).resolves.toEqual(changedAdjudication);
  });
});

describe("reviewed portfolio baseline persistence", () => {
  let sqlite: DatabaseSync;
  let database: TestD1Database;
  let holdingImports: D1HoldingImportRepository;
  let baselines: D1PortfolioBaselineRepository;
  let cashAccounts: D1CashAccountsRepository;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    migrationFiles.forEach((file) => {
      sqlite.exec(readFileSync(resolve(process.cwd(), file), "utf8"));
    });
    database = new TestD1Database(sqlite);
    holdingImports = new D1HoldingImportRepository(
      database as unknown as D1Database,
    );
    baselines = new D1PortfolioBaselineRepository(
      database as unknown as D1Database,
    );
    cashAccounts = new D1CashAccountsRepository(
      database as unknown as D1Database,
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  it("atomically appends a reviewed FI baseline without treating unknown values as money", async () => {
    const angelListInput = stageInput("4".repeat(64), {
      companyOrFund: "Synthetic Public Company",
      fundName: "Synthetic Public Company SPV",
      unrealizedValueMinor: 2_500_000,
      unrealizedValueState: "reported",
      netValueMinor: 2_500_000,
      netValueState: "reported",
      multiplePpm: 1_000_000,
    });
    const firstAngelListRow = angelListInput.rows[0]!;
    angelListInput.rows.push({
      ...firstAngelListRow,
      rowNumber: 4,
      naturalKeySha256: "5".repeat(64),
      companyOrFund: "Synthetic Hidden Systems",
      fundName: "Synthetic Hidden Systems SPV",
      unrealizedValueMinor: null,
      unrealizedValueState: "locked",
      netValueMinor: null,
      netValueState: "locked",
      multiplePpm: null,
    });

    const angelList = await holdingImports.stageHoldingImport(
      "synthetic-access-subject",
      angelListInput,
    );
    await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      angelList.preview.id,
      {
        currency: "USD",
        decisions: angelList.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic AngelList position.",
        })),
      },
    );

    const robinhoodInput = robinhoodStageInput();
    robinhoodInput.rows.push({
      ...robinhoodInput.rows[0]!,
      rowNumber: 2,
      naturalKeySha256: "6".repeat(64),
      securityName: "Brokerage cash",
      ticker: null,
      securityType: "cash",
      quantityMicros: 100_000_000,
      costBasisMinor: 100_000,
      marketValueMinor: 100_000,
    });
    robinhoodInput.rows.push({
      ...robinhoodInput.rows[0]!,
      rowNumber: 3,
      naturalKeySha256: "b".repeat(64),
      securityName: "Synthetic Digital Asset",
      ticker: "SDA",
      securityType: "cryptocurrency",
      quantityMicros: 25_000_000,
      costBasisMinor: 2_000,
      marketValueMinor: 2_500,
      issues: ["Crypto is recorded outside the FI plan."],
    });
    const robinhood = await holdingImports.stageRobinhoodHoldingImport(
      "synthetic-access-subject",
      robinhoodInput,
    );
    await holdingImports.applyHoldingImport(
      "synthetic-access-subject",
      robinhood.preview.id,
      {
        currency: "USD",
        decisions: robinhood.preview.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted" as const,
          rationale: "Reviewed synthetic Robinhood position.",
        })),
      },
    );

    const cashConnection = await cashAccounts.upsertConnection(
      "synthetic-access-subject",
      "First Synthetic Bank",
      "connector-secrets/synthetic-cash.enc",
      "c".repeat(64),
    );
    const cashRun = await cashAccounts.beginRefresh(
      "synthetic-access-subject",
      cashConnection.id,
      "initial",
    );
    const cashStage = await cashAccounts.stageProposal(
      "synthetic-access-subject",
      cashRun.id,
      {
        objectKey: "cash-observations/synthetic-baseline.json",
        sourceSha256: "d".repeat(64),
        normalized: {
          normalizedFingerprint: "e".repeat(64),
          observedAt: "2026-08-14T18:00:00.000Z",
          rows: [
            {
              naturalKeySha256: "f".repeat(64),
              institutionLabel: "First Synthetic Bank",
              accountLabel: "Household checking",
              subtype: "checking",
              availableMinor: 300_000,
              currentMinor: 300_000,
              valueMinor: 300_000,
              valueState: "reported",
              balanceSource: "available",
              observedAt: "2026-08-14T18:00:00.000Z",
              issues: [],
            },
          ],
        },
      },
    );
    const cashProposal = cashStage.proposal;
    if (cashProposal === null) {
      throw new Error("Expected a synthetic cash proposal.");
    }
    await cashAccounts.completeRefresh(
      "synthetic-access-subject",
      cashRun.id,
      cashProposal.id,
      1,
    );
    await cashAccounts.applyProposal(
      "synthetic-access-subject",
      cashProposal.id,
      {
        changeNote: "Reviewed synthetic cash for the FI baseline.",
        decisions: cashProposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );

    const state = await baselines.getState("synthetic-access-subject");
    expect(state).toMatchObject({
      status: "ready",
      baseForecastSnapshotId: "snap_fi_v3",
      baseForecastSnapshotVersion: 3,
      summary: {
        positionCount: 4,
        publicMarketValueMinor: 223_457,
        privatePaperValueMinor: 2_500_000,
        cashAccountCount: 1,
        cashAccountValueMinor: 300_000,
        unknownCashAccountCount: 0,
        unknownValueCount: 1,
        potentialDuplicateCount: 2,
      },
      hasSourceChanges: true,
      hasCashAccountChanges: true,
      requiresDuplicateReview: true,
      requiresCashOverlapReview: true,
      canConfirm: true,
      suggestedOtherFiEligibleLiquidMinor: 0,
    });
    expect(state.cashAccounts).toEqual([
      expect.objectContaining({
        accountLabel: "Household checking",
        refreshKind: "initial",
      }),
    ]);
    expect(
      state.positions.filter((position) => position.potentialDuplicate),
    ).toHaveLength(2);
    expect(state.positions).not.toContainEqual(
      expect.objectContaining({ ticker: "SDA" }),
    );
    if (
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null
    ) {
      throw new Error("Expected a confirmable synthetic baseline.");
    }

    const confirmation = {
      sourceRevision: state.sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: 199_476_543,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Reviewed synced holdings for the FI plan.",
    };
    await expect(
      baselines.confirm("synthetic-access-subject", {
        ...confirmation,
        sourceRevision: "0".repeat(64),
      }),
    ).rejects.toThrow("stale");
    await expect(
      baselines.confirm("synthetic-access-subject", {
        ...confirmation,
        otherFiEligibleLiquidMinor: 0,
        duplicateReviewConfirmed: true,
      }),
    ).rejects.toThrow("cash overlaps");
    await expect(
      baselines.confirm("synthetic-access-subject", confirmation),
    ).rejects.toThrow("overlaps");

    await expect(
      baselines.confirm("synthetic-access-subject", {
        ...confirmation,
        duplicateReviewConfirmed: true,
      }),
    ).rejects.toThrow("cash overlaps");

    const confirmed = await baselines.confirm("synthetic-access-subject", {
      ...confirmation,
      duplicateReviewConfirmed: true,
      cashOverlapReviewConfirmed: true,
    });
    expect(confirmed).toMatchObject({
      baseline: {
        sourceRevision: state.sourceRevision,
        priorFiEligibleLiquidMinor: 182_500_000,
        fiEligibleLiquidMinor: 200_000_000,
        otherFiEligibleLiquidMinor: 199_476_543,
        forecastSnapshotVersion: 4,
        goalVersion: 2,
      },
      impact: {
        fiEligibleChangeMinor: 17_500_000,
        protectedRunwayMonths: 46,
        fiGapMinor: 125_000_000,
        lowerTotalAvailableMinor: 294_000_000,
        middleTotalAvailableMinor: 410_000_000,
        higherTotalAvailableMinor: 554_000_000,
        probabilityCrossingFiPpm: 683_190,
      },
    });

    const stored = sqlite
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM portfolio_baselines) AS baselines,
           (SELECT COUNT(*) FROM portfolio_baseline_items) AS baseline_items,
           (SELECT COUNT(*) FROM portfolio_baseline_cash_items)
             AS baseline_cash_items,
           (SELECT COUNT(*) FROM cash_flow_plans WHERE scenario_id = 'scn_fi')
             AS fi_plans,
           (SELECT MAX(version) FROM forecast_snapshots
            WHERE scenario_id = 'scn_fi') AS latest_forecast_version,
           (SELECT probability_ppm FROM forecast_outputs
            WHERE forecast_snapshot_id = ?
              AND metric_key = 'probability_crossing_fi') AS crossing_ppm,
           (SELECT MAX(version) FROM goal_versions
            WHERE goal_id = 'goal_fi') AS latest_goal_version`,
      )
      .get(confirmed.baseline.forecastSnapshotId) as {
      baselines: number;
      baseline_items: number;
      baseline_cash_items: number;
      fi_plans: number;
      latest_forecast_version: number;
      crossing_ppm: number;
      latest_goal_version: number;
    };
    expect(stored).toEqual({
      baselines: 1,
      baseline_items: 4,
      baseline_cash_items: 1,
      fi_plans: 2,
      latest_forecast_version: 4,
      crossing_ppm: 683_190,
      latest_goal_version: 2,
    });

    const alpha = await new D1AlphaRepository(
      database as unknown as D1Database,
    ).getAlphaData("synthetic-access-subject");
    expect(alpha.dashboard).toMatchObject({
      asOfDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/u),
      fiEligibleLiquidMinor: 200_000_000,
      protectedRunwayMonths: 46,
      fiGapMinor: 125_000_000,
      probabilityCrossingFiPpm: 683_190,
    });
    expect(alpha.goals[0]?.versions[0]).toMatchObject({
      version: 2,
      currentValueInteger: 200_000_000,
      currentValueSource: "Portfolio baseline",
      forecast: {
        lowerValueInteger: 294_000_000,
        middleValueInteger: 410_000_000,
        higherValueInteger: 554_000_000,
        successProbabilityPpm: 683_190,
      },
    });
    expect(alpha.forecastHistory[0]).toMatchObject({
      version: 4,
      trigger: "Portfolio baseline",
    });

    await expect(
      baselines.getState("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "current",
      hasSourceChanges: false,
      hasCashAccountChanges: false,
      canConfirm: false,
      suggestedOtherFiEligibleLiquidMinor: 199_476_543,
      latestBaseline: { id: confirmed.baseline.id },
    });

    const updatedCashRun = await cashAccounts.beginRefresh(
      "synthetic-access-subject",
      cashConnection.id,
      "live",
    );
    const updatedCashStage = await cashAccounts.stageProposal(
      "synthetic-access-subject",
      updatedCashRun.id,
      {
        objectKey: "cash-observations/synthetic-baseline-live.json",
        sourceSha256: "1".repeat(64),
        normalized: {
          normalizedFingerprint: "2".repeat(64),
          observedAt: "2026-08-14T20:00:00.000Z",
          rows: [
            {
              naturalKeySha256: "f".repeat(64),
              institutionLabel: "First Synthetic Bank",
              accountLabel: "Household checking",
              subtype: "checking",
              availableMinor: 350_000,
              currentMinor: 350_000,
              valueMinor: 350_000,
              valueState: "reported",
              balanceSource: "available",
              observedAt: "2026-08-14T20:00:00.000Z",
              issues: [],
            },
          ],
        },
      },
    );
    if (updatedCashStage.proposal === null) {
      throw new Error("Expected an updated synthetic cash proposal.");
    }
    await cashAccounts.completeRefresh(
      "synthetic-access-subject",
      updatedCashRun.id,
      updatedCashStage.proposal.id,
      1,
    );
    await cashAccounts.applyProposal(
      "synthetic-access-subject",
      updatedCashStage.proposal.id,
      {
        changeNote: "Reviewed the updated synthetic cash balance.",
        decisions: updatedCashStage.proposal.rows.map((row) => ({
          rowId: row.id,
          decision: "accepted",
        })),
      },
    );
    await expect(
      baselines.getState("synthetic-access-subject"),
    ).resolves.toMatchObject({
      status: "ready",
      hasSourceChanges: true,
      hasCashAccountChanges: true,
      summary: { cashAccountValueMinor: 350_000 },
      latestBaseline: { id: confirmed.baseline.id },
    });

    expect(() =>
      sqlite
        .prepare("UPDATE portfolio_baselines SET change_note = 'changed'")
        .run(),
    ).toThrow("immutable");
    expect(() =>
      sqlite
        .prepare(
          `UPDATE cash_flow_plans
           SET fi_eligible_liquid_minor = 0
           WHERE id = (
             SELECT cash_flow_plan_id FROM portfolio_baselines LIMIT 1
           )`,
        )
        .run(),
    ).toThrow("immutable");
  });
});
