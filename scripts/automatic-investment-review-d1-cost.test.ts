import { expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app";
import { handleRequest } from "../apps/web/src/worker";
import {
  loadLegalEntities,
  resolveInvestmentReviews,
} from "../apps/web/src/api";
import type { Env } from "../apps/api/src/types";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { seedAutomaticInvestments } from "./test-support/automatic-investments";
import { D1AutomaticInvestmentReviewRepository } from "../packages/database/src/automatic-investment-review";

it("bounds automatic review, unchanged page visits, history and an outage through the real client, proxy, auth and D1", async () => {
  const fixture = await createCostDatabase();
  try {
    const ids = await seedAutomaticInvestments(fixture.database, 120);
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
    for (let version = 2; version <= 121; version++) {
      await fixture.database
        .prepare(
          `INSERT INTO automatic_investment_reviews
        (id, household_id, position_id, snapshot_id, policy_version, source_revision, expected_guard_json, result_guard_json, summary_json, details_json, version, supersedes_id, recorded_by_user_id, recorded_at)
        SELECT printf('00000000-0000-4000-9000-%012x', ? * 1000 + keys.key), previous.household_id, previous.position_id, previous.snapshot_id, previous.policy_version,
          printf('%064x', ? * 1000 + keys.key), previous.result_guard_json, previous.result_guard_json,
          json_set(previous.summary_json, '$.id', printf('00000000-0000-4000-9000-%012x', ? * 1000 + keys.key)), '{}', ?, previous.id, previous.recorded_by_user_id, previous.recorded_at
        FROM json_each(?) keys JOIN automatic_investment_reviews previous ON previous.position_id = keys.value AND previous.version = ?`,
        )
        .bind(
          version,
          version,
          version,
          version,
          JSON.stringify(ids),
          version - 1,
        )
        .run();
    }
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
  const fixture = await createCostDatabase();
  try {
    const measured = measureD1(fixture.database);
    let sourceWrites = 0;
    // The capture boundary admits at most 24 documents per provider run.
    await seedAutomaticInvestments(
      measured.database,
      120,
      [],
      false,
      "synthetic-access-subject",
      () => {
        sourceWrites = measured.cost.rowsWritten;
      },
      24,
    );
    const captureWrites = measured.cost.rowsWritten;
    measured.reset();
    const result = await new D1AutomaticInvestmentReviewRepository(
      measured.database,
    ).resolve("synthetic-access-subject");
    expect(result.resolvedCount).toBe(24);
    expect(result.exceptionCount).toBe(96);
    expect(captureWrites + measured.cost.rowsWritten).toBeLessThanOrEqual(
      8_000,
    );
    console.info(
      JSON.stringify({
        sourceCaptureAndAutomaticReview: {
          sourceWrites,
          captureWrites,
          review: measured.cost,
        },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 60_000);
