import { build } from "esbuild";
import { expect, it } from "vitest";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  renamedCostSubject as subject,
  renamedCostScaleInput as scaleInput,
} from "./test-support/renamed-investments-cost";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "../packages/database/src/holding-imports";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { reviewedRenameScopes } from "../packages/database/src/reviewed-rename-scope";
it("bounds 120 reviewed rename aliases and projections across decision and repeated-date source history, empty results and unrelated households", async () => {
  const bundled = await build({
    entryPoints: ["scripts/test-support/renamed-investments-cost-worker.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    conditions: ["workerd", "worker", "browser"],
    mainFields: ["browser", "module", "main"],
    external: ["node:*", "cloudflare:*"],
    logLevel: "silent",
  });
  const fixture = await createCostDatabase(bundled.outputFiles[0]!.text);
  try {
    const imports = new D1HoldingImportRepository(fixture.database);
    const seed = async (input: HoldingImportStageInput) => {
      const staged = await imports.stageHoldingImport(subject, input);
      if (staged.preview.status !== "applied")
        await imports.applyHoldingImport(subject, staged.preview.id, {
          currency: "USD",
          decisions: staged.preview.rows.map((row) => ({
            rowId: row.id,
            decision: "accepted",
            rationale: "Synthetic reviewed identity.",
          })),
        });
    };
    const setupResponse = await fixture.dispatchFetch(
      "https://synthetic-fixture.invalid/reviewed-renames",
      {
        method: "POST",
        body: JSON.stringify({ operation: "setup" }),
      },
    );
    expect(setupResponse.ok).toBe(true);
    expect(await setupResponse.json()).toEqual({
      reviewedPositions: 240,
      renameLinks: 120,
    });
    const meter = measureD1(fixture.database);
    const ownership = await fixture.database
      .prepare(
        "SELECT id,protected_account_key FROM ownership_containers WHERE household_id='hh_demo' AND protected_account_key=?",
      )
      .bind(
        scaleInput(false, 1).canonicalScope.containers[0]!.protectedAccountKey,
      )
      .first<{ id: string; protected_account_key: string }>();
    const connection = await fixture.database
      .prepare("SELECT connection_id FROM ownership_containers WHERE id=?")
      .bind(ownership!.id)
      .first<{ connection_id: string }>();
    const containers = new Map([
      [ownership!.protected_account_key, { id: ownership!.id }],
    ]);
    const queryInput = scaleInput(true, 3, true);
    meter.reset();
    const resolved = await reviewedRenameScopes(
      meter.database,
      "hh_demo",
      connection!.connection_id,
      queryInput,
      containers,
    );
    expect(resolved).toHaveLength(120);
    expect(resolved.every((row) => row.renameReviewId != null)).toBe(true);
    expect(meter.cost.roundTrips).toBe(1);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(12_000);
    expect(meter.cost.rowsWritten).toBe(0);
    const positive = { ...meter.cost };
    const sql = [...meter.queries][0]!;
    const plan = (
      await fixture.database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(connection!.connection_id, "hh_demo", "angellist")
        .all<{ detail: string }>()
    ).results;
    expect(
      plan.filter((row) => /SCAN (link|r|so|tor|later)\b/u.test(row.detail)),
    ).toEqual([]);
    // More decisions do not add work to a head lookup. Source observations use
    // the same effective date to cover all latest/prior ordering keys.
    for (let version = 0; version < 4; version++) {
      await fixture.database
        .prepare(
          `INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at,company_renamed,company_name,former_company_name)
        SELECT review.id || ?,review.household_id,review.source_position_id,review.target_position_id,review.source_snapshot_id,review.target_snapshot_id,review.source_participation_review_id,review.target_participation_review_id,review.id,review.relationship,'linked',0,review.note,review.reviewer_user_id,review.accepted_at,1,review.company_name,review.former_company_name FROM holding_position_link_heads head JOIN holding_position_link_reviews review ON review.id=head.review_id WHERE head.household_id='hh_demo' AND review.company_renamed=1`,
        )
        .bind(`-synthetic-${version}`)
        .run();
      meter.reset();
      await reviewedRenameScopes(
        meter.database,
        "hh_demo",
        connection!.connection_id,
        queryInput,
        containers,
      );
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(positive.rowsRead + 10);
    }
    for (let revision = 8; revision < 11; revision++) {
      const input = scaleInput(false, revision);
      input.effectiveDate = "2026-09-01";
      await seed(input);
    }
    meter.reset();
    await reviewedRenameScopes(
      meter.database,
      "hh_demo",
      connection!.connection_id,
      queryInput,
      containers,
    );
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(positive.rowsRead + 10);
    const history = { ...meter.cost };
    meter.reset();
    const view = await new D1InvestmentPositionViewRepository(
      meter.database,
    ).listForHousehold("hh_demo");
    const survivors = view.connections
      .flatMap((c) => c.containers.flatMap((c) => c.positions))
      .filter((p) => p.legalVehicleName.startsWith("Synthetic Circuit SPV "));
    expect(survivors).toHaveLength(120);
    expect(
      survivors.every(
        (p) => p.renamedCompany?.name === "Synthetic Circuit Works",
      ),
    ).toBe(true);
    expect(meter.cost.roundTrips).toBe(3);
    expect(meter.cost.rowsWritten).toBe(0);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(20_000);
    const projection = { ...meter.cost };
    await fixture.execute(
      "INSERT INTO users VALUES('rename-other-user','rename-other-subject','rename-other@example.test','Synthetic other owner','2026-09-01T00:00:00.000Z'); INSERT INTO households VALUES('rename-other-household','rename-other-user','Synthetic other household','USD','2026-09-01T00:00:00.000Z');",
    );
    for (let revision = 12; revision < 14; revision++)
      await new D1HoldingImportRepository(fixture.database).stageHoldingImport(
        "rename-other-subject",
        scaleInput(true, revision),
      );
    meter.reset();
    await reviewedRenameScopes(
      meter.database,
      "hh_demo",
      connection!.connection_id,
      queryInput,
      containers,
    );
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(history.rowsRead + 10);
    meter.reset();
    expect(
      await reviewedRenameScopes(
        meter.database,
        "missing-household",
        "missing-connection",
        queryInput,
        containers,
      ),
    ).toHaveLength(120);
    expect(meter.cost.roundTrips).toBe(1);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(10);
    console.info(
      JSON.stringify({
        renamedInvestments: {
          positive,
          history,
          projection,
          empty: meter.cost,
        },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 300_000);
