import { expect, it } from "vitest";
import { D1AlphaRepository } from "../packages/database/src/index";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { COST_SUBJECT } from "./test-support/cost-fixtures";

it("keeps latest holding reads bounded with 120 older captures for each of 120 positions", async () => {
  const fixture = await createCostFixtureDatabase({ operation: "holdings" });
  try {
    if (fixture.initialResult?.operation !== "holdings") {
      throw new Error("Expected the holdings cost fixture");
    }
    const importId = fixture.initialResult.importId;
    const measured = measureD1(fixture.database);
    const alpha = new D1AlphaRepository(measured.database);
    const positions = new D1InvestmentPositionViewRepository(measured.database);
    const before = await alpha.getAlphaData(COST_SUBJECT);
    const alphaReads = measured.cost.rowsRead;
    measured.reset();
    const beforePositions = await positions.listForHousehold("hh_demo");
    const positionReads = measured.cost.rowsRead;

    // Clone only fabricated, already-accepted fixtures. Every provenance,
    // ownership and append-only trigger stays enabled. The source observation
    // date is unchanged across captures, as with repeated same-day exports.
    const history = JSON.stringify(Array.from({ length: 120 }, (_, i) => i));
    const prefix = (column: string) =>
      `'history-' || history.value || '-' || original.${column}`;
    const historicalTime =
      "strftime('%Y-%m-%dT%H:%M:%fZ', '2026-09-02T12:00:00Z', '+' || history.value || ' seconds')";
    const fingerprint = (rowNumber: string) =>
      `printf('%064x', 8000000 + history.value * 1000 + ${rowNumber})`;
    const statements: D1PreparedStatement[] = [];
    const clone = async (
      table: string,
      scope: string,
      overrides: Record<string, string>,
    ) => {
      const columns = (
        await fixture.database
          .prepare(`PRAGMA table_info(${table})`)
          .all<{ name: string }>()
      ).results.map((row) => row.name);
      statements.push(
        fixture.database
          .prepare(
            `INSERT INTO ${table} (${columns.join(", ")}) SELECT ${columns.map((column) => overrides[column] ?? (column === "id" ? prefix("id") : `original.${column}`)).join(", ")}
         FROM ${table} original CROSS JOIN json_each(?) history WHERE ${scope}`,
          )
          .bind(history, importId),
      );
    };
    await clone(
      "source_documents",
      "original.id = (SELECT source_document_id FROM holding_imports WHERE id = ?)",
      {
        id: prefix("id"),
        sha256: "printf('%064x', 9000000 + history.value)",
        object_key: "'synthetic-history/' || history.value",
        retrieved_at: historicalTime,
        created_at: historicalTime,
      },
    );
    await clone("holding_imports", "original.id = ?", {
      id: prefix("id"),
      source_document_id: prefix("source_document_id"),
      normalized_fingerprint: "printf('%064x', 9100000 + history.value)",
      created_at: historicalTime,
    });
    await clone("holding_import_connections", "original.import_id = ?", {
      import_id: prefix("import_id"),
      created_at: historicalTime,
    });
    await clone("holding_import_rows", "original.import_id = ?", {
      id: prefix("id"),
      import_id: prefix("import_id"),
      snapshot_fingerprint: fingerprint("original.source_row_number"),
      created_at: historicalTime,
    });
    const rowScope =
      "original.import_row_id IN (SELECT id FROM holding_import_rows WHERE import_id = ?)";
    await clone("holding_import_coverages", "original.import_id = ?", {
      id: prefix("id"),
      import_id: prefix("import_id"),
      created_at: historicalTime,
    });
    await clone("holding_import_row_containers", rowScope, {
      import_row_id: prefix("import_row_id"),
      created_at: historicalTime,
    });
    await clone("holding_import_row_decisions", rowScope, {
      id: prefix("id"),
      import_row_id: prefix("import_row_id"),
      reviewed_snapshot_fingerprint: fingerprint(
        "(SELECT source_row_number FROM holding_import_rows WHERE id = original.import_row_id)",
      ),
      decided_at: historicalTime,
    });
    await clone(
      "holding_position_snapshots",
      "original.source_import_row_id IN (SELECT id FROM holding_import_rows WHERE import_id = ?)",
      {
        id: prefix("id"),
        source_document_id: prefix("source_document_id"),
        source_import_row_id: prefix("source_import_row_id"),
        snapshot_fingerprint: fingerprint(
          "(SELECT source_row_number FROM holding_import_rows WHERE id = original.source_import_row_id)",
        ),
        created_at: historicalTime,
      },
    );
    await clone("holding_import_applications", rowScope, {
      id: prefix("id"),
      import_row_id: prefix("import_row_id"),
      decision_id: prefix("decision_id"),
      snapshot_id: prefix("snapshot_id"),
      outcome: "'appended_snapshot'",
      applied_at: historicalTime,
    });
    await fixture.database.batch(statements);
    expect(
      await fixture.database
        .prepare("SELECT COUNT(*) AS count FROM holding_position_snapshots")
        .first<number>("count"),
    ).toBe(14_520);
    measured.reset();
    const after = await alpha.getAlphaData(COST_SUBJECT);
    const afterAlpha = { ...measured.cost };
    expect(after.holdings).toEqual(before.holdings);
    expect(afterAlpha.rowsWritten).toBe(0);
    console.info(
      JSON.stringify({
        syntheticHoldingHistory: { beforeReads: alphaReads, after: afterAlpha },
      }),
    );
    expect(afterAlpha.rowsRead).toBeLessThanOrEqual(alphaReads + 2_000);
    measured.reset();
    const afterPositions = await positions.listForHousehold("hh_demo");
    const latestSnapshots = (view: typeof beforePositions) =>
      view.connections.flatMap((connection) =>
        connection.containers.flatMap((container) =>
          container.positions.map((position) => position.snapshot.id),
        ),
      );
    expect(latestSnapshots(afterPositions)).toEqual(
      latestSnapshots(beforePositions),
    );
    expect(measured.cost.rowsWritten).toBe(0);
    console.info(
      JSON.stringify({
        syntheticPositionHistory: {
          beforeReads: positionReads,
          after: measured.cost,
        },
      }),
    );
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(positionReads + 2_000);
  } finally {
    await fixture.close();
  }
}, 90_000);
