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
});
