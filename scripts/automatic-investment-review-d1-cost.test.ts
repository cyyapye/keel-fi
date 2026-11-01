import { expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app";
import { handleRequest } from "../apps/web/src/worker";
import {
  loadLegalEntities,
  resolveInvestmentReviews,
} from "../apps/web/src/api";
import type { Env } from "../apps/api/src/types";
import { measureD1 } from "./test-support/d1-cost";
import { D1AutomaticInvestmentReviewRepository } from "../packages/database/src/automatic-investment-review";
import { createAutomaticInvestmentCostDatabase } from "./test-support/automatic-investment-cost-database";
import { D1HoldingImportRepository } from "../packages/database/src/holding-imports";
import { syntheticWefunderImport } from "./test-support/wefunder-holdings";

it("bounds exact Wefunder entity links with current-name history and unrelated households", async () => {
  const fixture = await createAutomaticInvestmentCostDatabase();
  try {
    const identity = await fixture.database
      .prepare(
        "SELECT h.id household_id, h.owner_user_id user_id FROM households h JOIN users u ON u.id = h.owner_user_id WHERE u.access_subject = ?",
      )
      .bind("synthetic-access-subject")
      .first<{ household_id: string; user_id: string }>();
    if (identity === null) throw new Error("Synthetic household missing");
    const names = Array.from(
      { length: 120 },
      (_, index) => `Synthetic Wefunder Vehicle ${index} LLC`,
    );
    const targets = names.map((legalName) => ({
      entityId: crypto.randomUUID(),
      versionId: crypto.randomUUID(),
      legalName,
    }));
    const putEntities = async (
      household: string,
      user: string,
      records: typeof targets,
    ) =>
      fixture.database.batch([
        fixture.database
          .prepare(
            "INSERT INTO legal_entities(id, household_id, created_by_user_id, created_at, immutable) SELECT json_extract(value, '$.entityId'), ?, ?, '2026-08-20T12:00:00.000Z', 1 FROM json_each(?)",
          )
          .bind(household, user, JSON.stringify(records)),
        fixture.database
          .prepare(
            "INSERT INTO legal_entity_versions(id, household_id, legal_entity_id, version, legal_name, entity_type, relationship, interest_status, recorded_by_user_id, recorded_at, immutable) SELECT json_extract(value, '$.versionId'), ?, json_extract(value, '$.entityId'), 1, json_extract(value, '$.legalName'), 'llc', 'investment_vehicle', 'current', ?, '2026-08-20T12:00:00.000Z', 1 FROM json_each(?)",
          )
          .bind(household, user, JSON.stringify(records)),
      ]);
    await putEntities(identity.household_id, identity.user_id, targets);
    const imports = new D1HoldingImportRepository(fixture.database);
    const stage = async (
      prefix: string,
      missing = false,
      reviewedAdditionalPositions = false,
    ) => {
      const input = await syntheticWefunderImport({
        count: 120,
        positionType: "Direct",
        legalName: (index) =>
          missing ? `Synthetic Unmatched Vehicle ${index} LLC` : names[index]!,
        investmentPrefix: prefix,
      });
      const staged = await imports.stageHoldingImport(
        "synthetic-access-subject",
        input,
      );
      if (reviewedAdditionalPositions) {
        await imports.applyHoldingImport(
          "synthetic-access-subject",
          staged.preview.id,
          {
            currency: "USD",
            decisions: staged.preview.rows.map((row) => ({
              rowId: row.id,
              decision: "accepted",
              rationale:
                "Reviewed synthetic additional positions for the cost holdout.",
            })),
          },
        );
      } else {
        await imports.autoAdjudicatePrivateHoldingImport(
          "synthetic-access-subject",
          staged.preview.id,
        );
      }
      expect(
        (
          await imports.getHoldingImport(
            "synthetic-access-subject",
            staged.preview.id,
          )
        )?.status,
      ).toBe("applied");
      return staged.preview.id;
    };
    const measured = measureD1(fixture.database);
    const automatic = new D1AutomaticInvestmentReviewRepository(
      measured.database,
    );
    const resolve = (importId: string) =>
      automatic.resolve("synthetic-access-subject", null, importId);
    const initialImport = await stage("Synthetic Initial Position");
    measured.reset();
    expect(await resolve(initialImport)).toMatchObject({
      processedCount: 120,
      changedCount: 120,
      resolvedCount: 120,
    });
    console.info(JSON.stringify({ wefunderExactLinks: measured.cost }));
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(10);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(25_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(6_000);
    const namesQuery = [...measured.byQuery.keys()].find((sql) =>
      sql.includes("LEFT JOIN legal_entity_name_heads current"),
    )!;
    const plan = await fixture.database
      .prepare(`EXPLAIN QUERY PLAN ${namesQuery}`)
      .bind(identity.household_id, JSON.stringify(names), identity.household_id)
      .all<{ detail: string }>();
    expect(
      plan.results.some((row) =>
        row.detail.includes("legal_entity_name_heads_household_name_idx"),
      ),
    ).toBe(true);
    expect(
      plan.results.some((row) =>
        /SCAN (current|historical)\b/u.test(row.detail),
      ),
    ).toBe(false);

    // Grow a complete, tied-date profile chain per returned entity. Names stay
    // identical, so a name index over all versions alone would grow with history.
    await fixture.database.batch(
      Array.from({ length: 24 }, (_, offset) =>
        fixture.database
          .prepare(
            `INSERT INTO legal_entity_versions(id, household_id, legal_entity_id, version, legal_name, entity_type, relationship, interest_status, supersedes_version_id, recorded_by_user_id, recorded_at, immutable)
       SELECT printf('synthetic-wf-version-%d-%s', ?, v.legal_entity_id), v.household_id, v.legal_entity_id, v.version + 1, v.legal_name, v.entity_type, v.relationship, v.interest_status, v.id, v.recorded_by_user_id, v.recorded_at, 1
       FROM json_each(?) ids JOIN legal_entity_name_heads h ON h.legal_entity_id = json_extract(ids.value, '$.entityId') JOIN legal_entity_versions v ON v.id = h.version_id`,
          )
          .bind(offset + 2, JSON.stringify(targets)),
      ),
    );
    await fixture.database.batch([
      fixture.database.prepare(
        "INSERT INTO users VALUES ('wf-other-user', 'wf-other-subject', 'wf-other@example.test', 'Synthetic Other', '2026-08-20T12:00:00.000Z')",
      ),
      fixture.database.prepare(
        "INSERT INTO households VALUES ('wf-other-household', 'wf-other-user', 'Synthetic Other', 'USD', '2026-08-20T12:00:00.000Z')",
      ),
    ]);
    await putEntities(
      "wf-other-household",
      "wf-other-user",
      targets.map((item) => ({
        ...item,
        entityId: crypto.randomUUID(),
        versionId: crypto.randomUUID(),
      })),
    );
    const grownImport = await stage("Synthetic Later Position", false, true);
    measured.reset();
    expect(await resolve(grownImport)).toMatchObject({
      processedCount: 120,
      changedCount: 120,
      resolvedCount: 120,
    });
    console.info(
      JSON.stringify({ wefunderExactLinksWithHistory: measured.cost }),
    );
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(10);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(25_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(6_000);
    measured.reset();
    expect((await resolve(grownImport)).changedCount).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(8_000);
    expect(measured.cost.rowsWritten).toBe(0);
    const emptyImport = await stage("Synthetic No Entity Match", true);
    measured.reset();
    expect((await resolve(emptyImport)).processedCount).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(8_000);
    expect(measured.cost.rowsWritten).toBe(0);
  } finally {
    await fixture.close();
  }
}, 120_000);

it("bounds automatic review, unchanged page visits, history and an outage through the real client, proxy, auth and D1", async () => {
  const fixture = await createAutomaticInvestmentCostDatabase();
  try {
    const ids = await fixture.seed({ count: 120 });
    const measured = measureD1(fixture.database);
    const objectGet = vi.fn(() => {
      throw new Error("Automatic review requested a source object");
    });
    let failed = false;
    let unavailableReads = 0;
    const database = {
      prepare(sql: string) {
        if (failed) {
          unavailableReads++;
          throw new Error("Synthetic D1 outage");
        }
        return measured.database.prepare(sql);
      },
      batch: measured.database.batch.bind(measured.database),
    } as D1Database;
    const env = {
      DB: database,
      ENVIRONMENT: "preview",
      DOCUMENTS: { get: objectGet },
      INGESTION_QUEUE: {},
    } as unknown as Env;
    let authenticated = 0,
      requests = 0;
    const app = createApp({
      verifyAccess: () => {
        authenticated++;
        return Promise.resolve({
          kind: "user" as const,
          subject: "synthetic-access-subject",
          email: null,
        });
      },
    });
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      requests++;
      return handleRequest(
        new Request(new URL(path, "https://keel.example"), {
          ...init,
          headers: {
            ...init?.headers,
            "Cf-Access-Jwt-Assertion": "synthetic-test-assertion",
          },
        }),
        {
          API: { fetch: async (request) => app.fetch(request, env) },
          ASSETS: {
            fetch: () => {
              throw new Error("Automatic review fetched assets");
            },
          },
        },
      );
    });
    const result = await resolveInvestmentReviews();
    expect(result).toMatchObject({
      processedCount: 120,
      changedCount: 120,
      resolvedCount: 120,
      exceptionCount: 0,
      nextPositionId: null,
    });
    console.info(
      JSON.stringify({
        automaticAcceptance: measured.cost,
        queries: [...measured.byQuery]
          .map(([sql, cost]) => ({ sql: sql.slice(0, 180), ...cost }))
          .sort((a, b) => b.rowsRead - a.rowsRead),
      }),
    );
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(10);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(25_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(6_000);
    measured.reset();
    const before = await loadLegalEntities();
    expect(
      before.entities.filter((entity) =>
        entity.legalName.startsWith("Synthetic Orchard"),
      ),
    ).toHaveLength(120);
    expect(measured.cost.rowsWritten).toBe(0);
    const inventoryReads = measured.cost.rowsRead;
    measured.reset();
    await resolveInvestmentReviews();
    const repeatReads = measured.cost.rowsRead;
    expect(measured.cost.rowsWritten).toBe(0);
    expect(repeatReads).toBeLessThanOrEqual(8_000);

    // 120 prior policy decisions per returned investment, all on the same
    // source observation date. Append-only and concurrency triggers stay on.
    await fixture.growAutomaticReviewHistory(ids);
    measured.reset();
    expect((await resolveInvestmentReviews()).changedCount).toBe(0);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(repeatReads + 1_000);
    measured.reset();
    const after = await loadLegalEntities();
    expect(after.entities.map((entity) => entity.id)).toEqual(
      before.entities.map((entity) => entity.id),
    );
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(inventoryReads + 1_000);

    // Keep the same 120 investments while growing each mapping's version
    // history. Equal timestamps force the complete version ordering to work.
    await fixture.database.batch(
      Array.from({ length: 120 }, (_, offset) => {
        const version = offset + 2;
        return fixture.database
          .prepare(
            `INSERT INTO holding_position_exposure_mappings
        (id, household_id, position_id, exposure_id, relationship_kind, allocation_ppm, status, decision_source, decision_reference, evidence_sha256, effective_at, version, supersedes_mapping_id, accepted_by_user_id, accepted_at, immutable)
        SELECT printf('10000000-0000-4000-9000-%012x', ? * 1000 + keys.key), previous.household_id, previous.position_id, previous.exposure_id, previous.relationship_kind, previous.allocation_ppm, previous.status, previous.decision_source, previous.decision_reference, previous.evidence_sha256, previous.effective_at, ?, previous.id, previous.accepted_by_user_id, previous.accepted_at, 1
        FROM json_each(?) keys JOIN holding_position_exposure_mappings previous ON previous.position_id = keys.value AND previous.version = ?`,
          )
          .bind(version, version, JSON.stringify(ids), version - 1);
      }),
    );
    measured.reset();
    expect((await resolveInvestmentReviews()).resolvedCount).toBe(120);
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(10);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(25_000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(1_000);

    // An unrelated household cannot contribute rows to automatic recovery.
    await fixture.database.batch([
      fixture.database
        .prepare(
          "INSERT INTO users VALUES ('auto-other-user', 'auto-other-subject', 'auto-other@example.test', 'Synthetic Other', ?)",
        )
        .bind("2026-09-01T12:00:00.000Z"),
      fixture.database
        .prepare(
          "INSERT INTO households VALUES ('auto-other-household', 'auto-other-user', 'Synthetic Other', 'USD', ?)",
        )
        .bind("2026-09-01T12:00:00.000Z"),
    ]);
    measured.reset();
    expect(
      (
        await new D1AutomaticInvestmentReviewRepository(
          measured.database,
        ).resolve("auto-other-subject")
      ).processedCount,
    ).toBe(0);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(10);

    // This feature adds no timer. Twenty deliberate page visits in a virtual
    // day are the supported interaction envelope, including failure visits.
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const outage of [false, true]) {
      failed = outage;
      requests = 0;
      authenticated = 0;
      measured.reset();
      for (let visit = 0; visit < 20; visit++) {
        vi.setSystemTime(new Date(Date.UTC(2026, 8, 2, visit)));
        if (outage) await expect(resolveInvestmentReviews()).rejects.toThrow();
        else {
          await loadLegalEntities();
          await resolveInvestmentReviews();
        }
      }
      expect(requests).toBe(outage ? 20 : 40);
      expect(authenticated).toBe(outage ? 20 : 40);
      expect(unavailableReads).toBe(outage ? 20 : 0);
      expect(measured.cost.rowsWritten).toBe(0);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(outage ? 0 : 350_000);
      console.info(
        JSON.stringify({
          automaticReviewDay: { outage, requests, ...measured.cost },
        }),
      );
    }
    expect(objectGet).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await fixture.close();
  }
}, 90_000);

it("keeps normal source acceptance plus automatic review within the existing capture write budget", async () => {
  const fixture = await createAutomaticInvestmentCostDatabase();
  try {
    // The capture boundary admits at most 24 documents per provider run.
    // Every setup, capture and review write remains measured inside workerd.
    const result = await fixture.measureSourceCapture();
    expect(result.resolvedCount).toBe(24);
    expect(result.exceptionCount).toBe(96);
    expect(
      result.captureWrites + result.review.rowsWritten,
    ).toBeLessThanOrEqual(8_000);
    console.info(
      JSON.stringify({
        sourceCaptureAndAutomaticReview: {
          sourceWrites: result.sourceWrites,
          captureWrites: result.captureWrites,
          review: result.review,
        },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 60_000);
