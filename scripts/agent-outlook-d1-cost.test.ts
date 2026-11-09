import { positionDetail } from "../apps/api/src/agent-api/resources";
import {
  debtWorkflow,
  goalWorkflow,
  portfolioReads,
} from "./test-support/owner-api-acceptance";
import { expect, it } from "vitest";
import { createApp } from "../apps/api/src/app";
import type { Env } from "../apps/api/src/types";
import { marksPage, outlook } from "../apps/api/src/agent-api/contract";
import { createCostFixtureDatabase } from "./test-support/cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { baselineCostRepositories } from "./test-support/portfolio-baseline-cost";
import { COST_SUBJECT } from "./test-support/cost-fixtures";

it("serves isolated versioned outlooks and evidence pages under fixed D1 budgets", async () => {
  const fixture = await createCostFixtureDatabase({ operation: "holdings" });
  try {
    const db = fixture.database;
    const { baseline } = baselineCostRepositories(db, () => false);
    const state = await baseline.getState(COST_SUBJECT);
    await baseline.confirm(COST_SUBJECT, {
      sourceRevision: state.sourceRevision!,
      baseForecastSnapshotId: state.baseForecastSnapshotId!,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion!,
      otherFiEligibleLiquidMinor: 100000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Synthetic API cost baseline.",
    });
    const meter = measureD1(db);
    const subject = "a".repeat(32) + ".access";
    const app = createApp({
      verifyAccess: (token) => {
        if (token !== "synthetic-assertion") throw Error();
        return Promise.resolve({ kind: "service", subject, email: null });
      },
    });
    const env = {
      ENVIRONMENT: "preview",
      DB: meter.database,
      AGENT_READ_SERVICE_SUBJECT: subject,
      AGENT_READ_HOUSEHOLD_ID: "hh_demo",
    } as Env;
    const headers = {
      "Cf-Access-Jwt-Assertion": "synthetic-assertion",
      "Content-Type": "application/json",
    };
    const get = (path: string, e = env) =>
      app.request("/api/v1/" + path, { headers }, e);
    expect((await get("openapi.json")).status).toBe(200);
    expect((await app.request("/api/v1/outlook", {}, env)).status).toBe(401);
    const revoked = { ...env };
    delete revoked.AGENT_READ_SERVICE_SUBJECT;
    expect((await get("outlook", revoked)).status).toBe(403);
    expect(
      (await app.request("/api/goals", { method: "POST", headers }, env))
        .status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "/api/deployment-smoke",
          { method: "POST", headers },
          env,
        )
      ).status,
    ).toBe(403);
    expect((await get("outlook?householdId=hh_demo")).status).toBe(400);
    await db
      .prepare(
        "INSERT INTO households (id,owner_user_id,name,base_currency,created_at) SELECT 'api-other',owner_user_id,'Synthetic second household',base_currency,created_at FROM households WHERE id='hh_demo'",
      )
      .run();
    const offsets = JSON.stringify(Array.from({ length: 120 }, (_, i) => i));
    await db.batch([
      db
        .prepare(
          "INSERT INTO goals SELECT 'api-goal-'||value,'hh_demo','custom',0,NULL,'2026-01-01' FROM json_each(?)",
        )
        .bind(offsets),
      db
        .prepare(
          `INSERT INTO goal_versions SELECT 'api-version-'||g.value,goals.household_id,goals.id,1,'Synthetic goal','net_worth','Tracked net worth',1000000,'minor_units','2036-01-01',100000,'Synthetic baseline','Synthetic test','2026-01-01','Synthetic',1 FROM json_each(?) g JOIN goals ON goals.id='api-goal-'||g.value`,
        )
        .bind(offsets),
    ]);
    async function compare() {
      meter.reset();
      const response = await get("outlook");
      expect(response.status).toBe(200);
      const result = outlook.parse(await response.json());
      expect(result.goals.length).toBe(120);
      expect(result.nextAfterGoal).toBeTruthy();
      expect(meter.cost).toMatchObject({
        roundTrips: 2,
        statements: 5,
        rowsWritten: 0,
      });
      expect(meter.cost.rowsRead).toBeLessThan(1800);
      return { result, cost: meter.cost.rowsRead };
    }
    const before = await compare();
    await db
      .prepare(
        `INSERT INTO goal_versions SELECT v.id||'-'||x.value,v.household_id,v.goal_id,2+x.value,v.name,v.metric_key,v.metric_label,v.target_value_integer,v.target_unit,v.target_date,v.current_value_integer,v.current_value_source,v.change_note,v.created_at,v.created_by,1 FROM goal_versions v CROSS JOIN json_each(?) x WHERE v.id LIKE 'api-version-%' AND v.version=1`,
      )
      .bind(JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7]))
      .run();
    const after = await compare();
    expect(after.cost).toBeLessThanOrEqual(before.cost + 4);
    expect(
      after.result.goals.find((g) => g.goalId === "api-goal-0")?.versionId,
    ).toBe("api-version-0-7");
    expect(
      (await get("outlook?afterGoal=" + after.result.nextAfterGoal)).status,
    ).toBe(200);
    const base = after.result.baseline!.id;
    const readPage = async (cursor: string) => {
      meter.reset();
      const r = await get(
        "marks?baselineId=" +
          base +
          (cursor ? "&after=" + encodeURIComponent(cursor) : ""),
      );
      expect(r.status).toBe(200);
      const p = marksPage.parse(await r.json());
      expect(meter.cost).toMatchObject({
        roundTrips: 2,
        statements: 3,
        rowsWritten: 0,
      });
      expect(meter.cost.rowsRead).toBeLessThan(1800);
      return p;
    };
    const first = await readPage("");
    const second = await readPage(first.nextAfter!);
    const third = await readPage(second.nextAfter!);
    expect(
      new Set(
        [...first.positions, ...second.positions, ...third.positions].map(
          (p) => p.positionId,
        ),
      ).size,
    ).toBe(120);
    expect(third.nextAfter).toBeNull();
    expect((await get("marks?baselineId=unknown")).status).toBe(404);
    const date = new Date(Date.now() + 365 * 86400000)
      .toISOString()
      .slice(0, 10);
    const preview = () =>
      app.request(
        "/api/v1/outlook/preview",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            through: date,
            targets: [{ date, amountMinor: 1000000 }],
            annualNetWorthChangeMinor: 0,
            assumeNoDebt: true,
          }),
        },
        env,
      );
    meter.reset();
    const modeled = outlook.parse(await (await preview()).json());
    expect(meter.cost).toMatchObject({
      roundTrips: 2,
      statements: 5,
      rowsWritten: 0,
    });
    const initialWorth = modeled.netWorthTargets.at(-1)!.projectedNetWorthMinor;
    expect(initialWorth).toBeTypeOf("number");
    await fixture.setup({ operation: "holdings", revision: 2 });
    const changed = await readPage("");
    expect(changed.positions[0]).toMatchObject({
      baselineValueMinor: 100001,
      latestReportedUnrealizedMinor: 100002,
      sourceChangedSinceBaseline: true,
    });
    const updated = await baseline.getState(COST_SUBJECT);
    await baseline.confirm(COST_SUBJECT, {
      sourceRevision: updated.sourceRevision!,
      baseForecastSnapshotId: updated.baseForecastSnapshotId!,
      baseForecastSnapshotVersion: updated.baseForecastSnapshotVersion!,
      otherFiEligibleLiquidMinor: 100000,
      duplicateReviewConfirmed: false,
      cashOverlapReviewConfirmed: false,
      changeNote: "Accept revised synthetic marks.",
    });
    const revised = outlook.parse(await (await preview()).json());
    expect(revised.wealth.trackedNetWorthMinor).toBe(initialWorth! + 120);
    expect(revised.liquidity).toEqual(modeled.liquidity);
    await db
      .prepare(
        "INSERT INTO asset_accounts(id,household_id,name,account_type,created_at) SELECT 'directory-'||value,'hh_demo','Synthetic account '||value,'cash','2026-01-01' FROM json_each(?)",
      )
      .bind(offsets)
      .run();
    await portfolioReads(app, env, headers, meter, base);
    await goalWorkflow(app, env, headers, subject);
    const fundId = first.positions[0]!.positionId;
    const exposureNumbers = JSON.stringify(
      Array.from({ length: 121 }, (_, i) => i),
    );
    await db.batch([
      db
        .prepare(
          `INSERT INTO canonical_exposures(id,household_id,exposure_kind,canonical_name,resolution_method,evidence_sha256,created_by_user_id,created_at,immutable)
        SELECT 'fund-exposure-'||value,'hh_demo','unresolved','Underlying '||value,'unresolved',?,'usr_demo','2026-01-01',1 FROM json_each(?)`,
        )
        .bind("a".repeat(64), exposureNumbers),
      db
        .prepare(
          `INSERT INTO holding_position_exposure_mappings(id,household_id,position_id,exposure_id,relationship_kind,status,decision_source,decision_reference,evidence_sha256,effective_at,version,accepted_by_user_id,accepted_at,immutable)
        SELECT 'fund-mapping-'||value,'hh_demo',?,'fund-exposure-'||value,'look_through','active','review','Synthetic fund exposure',?,'2026-01-01',1,'usr_demo','2026-01-01',1 FROM json_each(?)`,
        )
        .bind(fundId, "a".repeat(64), exposureNumbers),
    ]);
    const exposures = new Set<string>();
    let afterExposure: string | null = null;
    do {
      meter.reset();
      const page = positionDetail.parse(
        await (
          await get(
            "positions/" +
              fundId +
              (afterExposure
                ? "?afterExposure=" + encodeURIComponent(afterExposure)
                : ""),
          )
        ).json(),
      );
      expect(meter.cost).toMatchObject({ roundTrips: 2, rowsWritten: 0 });
      expect(meter.cost.rowsRead).toBeLessThan(1050);
      for (const e of page.exposures) exposures.add(e.id);
      afterExposure = page.nextAfterExposure;
    } while (afterExposure);
    expect(exposures.has("fund-exposure-120")).toBe(true);
    expect(
      [...exposures].filter((id) => id.startsWith("fund-exposure-")),
    ).toHaveLength(121);
    await debtWorkflow(db, app, env, headers, meter);
    // EXPLAIN the actual SQL used by the paged operations, including composed queries.
    const statements = [...meter.queries].filter((q) =>
      /^(?:SELECT|WITH) /i.test(q.trim()),
    );
    const plans = await db.batch<{ detail: string }>(
      statements.map((q) =>
        db
          .prepare("EXPLAIN QUERY PLAN " + q)
          .bind(...Array.from(q.matchAll(/\?/g), () => null)),
      ),
    );
    for (const [i, plan] of plans.entries())
      for (const row of plan.results) {
        const sql = statements[i]!;
        if (
          (row.detail === "SCAN g" ||
            row.detail === "SCAN d" ||
            row.detail === "SCAN i") &&
          /FROM (?:page|mapped) (?:g|d|i)\b/.test(sql)
        )
          continue;
        expect(row.detail, sql).not.toMatch(
          /^(?:SCAN (?:g|v|d|r|p|c|i|s|iv|ih|e|h|o|k|a|f)\b|USE TEMP B-TREE FOR RIGHT PART OF ORDER BY)/,
        );
      }

    expect(
      (
        await get("marks?baselineId=" + base, {
          ...env,
          AGENT_READ_HOUSEHOLD_ID: "api-other",
        })
      ).status,
    ).toBe(404);
  } finally {
    await fixture.close();
  }
}, 90000);
