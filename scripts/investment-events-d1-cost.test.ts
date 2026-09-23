import { expect, it } from "vitest";
import { measureD1 } from "./test-support/d1-cost";
import { createAutomaticInvestmentCostDatabase } from "./test-support/automatic-investment-cost-database";
import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { investmentEvidenceRevision } from "../packages/domain/src/investment-review";

it("bounds event detail and atomic conversion writes with 120 positions and growing event history", async () => {
  const fixture = await createAutomaticInvestmentCostDatabase();
  try {
    const subject = "synthetic-access-subject";
    const ids = await fixture.seed({ count: 120, subject, capturedCount: 0 });
    const measured = measureD1(fixture.database);
    const repository = new D1InvestmentReviewRepository(measured.database);
    const before = await repository.getContext(subject, ids[0]!);
    expect(before.investmentEvents).toEqual([]);
    expect(measured.cost.roundTrips).toBe(8);
    const event = {
      eventId: crypto.randomUUID(),
      supersedesRevisionId: null,
      kind: "merger" as const,
      scope: "underlying_securities" as const,
      participationContinues: true as const,
      status: "completed" as const,
      predecessor: "Synthetic Orchard 0",
      successor: "Synthetic Orchard Successor",
      noticeDate: "2026-09-01",
      effectiveDate: null,
      sourceLabel: "Synthetic notice",
      sourceText:
        "Synthetic completed merger. The SPV retains successor shares.",
      documentId: null,
      lpDistribution: "unknown" as const,
      components: [],
      note: null,
      expectedMappingIds: before.mappings.map((m) => m.id),
    };
    const request = {
      requestId: crypto.randomUUID(),
      expectedReviewId: before.review?.id ?? null,
      expectedSnapshotId: before.snapshotId,
      expectedEvidenceRevision: before.evidenceRevision,
      participationStatus: "current" as const,
      investmentEvent: event,
    };
    measured.reset();
    const accepted = await repository.review(subject, ids[0]!, request);
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(11);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(700);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(50);
    measured.reset();
    await repository.review(subject, ids[0]!, request);
    expect(measured.cost.rowsWritten).toBe(0);
    const context = await repository.getContext(subject, ids[0]!);
    const original = context.investmentEvents![0]!;
    const scope = await fixture.database
      .prepare("SELECT household_id FROM holding_positions WHERE id = ?")
      .bind(ids[0]!)
      .first<{ household_id: string }>();
    // Exercise the documented 100-revision maximum, including tied timestamps.
    const statements = [];
    let previous = original.revisionId;
    for (let revision = 2; revision <= 100; revision++) {
      const id = crypto.randomUUID();
      const payload = {
        ...original,
        revisionId: id,
        revision,
        supersedesRevisionId: previous,
        note: `Synthetic amendment ${revision}`,
        contentSha256: await investmentEvidenceRevision({ revision }),
      };
      statements.push(
        fixture.database
          .prepare(
            "INSERT INTO investment_event_revisions (id, household_id, position_id, event_id, revision, supersedes_revision_id, review_id, content_sha256, payload_json, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            id,
            scope!.household_id,
            ids[0]!,
            event.eventId,
            revision,
            previous,
            accepted.id,
            payload.contentSha256,
            JSON.stringify(payload),
            original.recordedAt,
          ),
      );
      previous = id;
    }
    await fixture.database.batch(statements);
    measured.reset();
    const full = await repository.getContext(subject, ids[0]!);
    expect(full.investmentEvents).toHaveLength(100);
    expect(measured.cost.roundTrips).toBe(8);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(800);
    expect(measured.cost.rowsWritten).toBe(0);
    const scopedCost = { ...measured.cost };
    await fixture.execute(
      "INSERT INTO users VALUES ('events-other-user','events-other-subject','events-other@example.invalid','Synthetic Other','2026-09-01'); INSERT INTO households VALUES ('events-other','events-other-user','Synthetic Other','USD','2026-09-01')",
    );
    await fixture.seed({
      count: 120,
      subject: "events-other-subject",
      capturedCount: 0,
    });
    measured.reset();
    expect(
      (await repository.getContext(subject, ids[0]!)).investmentEvents,
    ).toHaveLength(100);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(
      scopedCost.rowsRead + 10,
    );
    await expect(
      repository.getContext("events-other-subject", ids[0]!),
    ).rejects.toMatchObject({ code: "not_found" });
    measured.reset();
    expect(
      (await repository.getContext(subject, ids[119]!)).investmentEvents,
    ).toEqual([]);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(500);
    const query = [...measured.queries].find((sql) =>
      sql.includes("SELECT payload_json FROM investment_event_revisions"),
    )!;
    const plan = await fixture.database
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .bind(scope!.household_id, ids[0]!)
      .all<{ detail: string }>();
    expect(
      plan.results.some((row) =>
        row.detail.includes("investment_event_position_idx"),
      ),
    ).toBe(true);
    expect(
      plan.results.filter((row) =>
        /SCAN investment_event_revisions/u.test(row.detail),
      ),
    ).toEqual([]);
  } finally {
    await fixture.close();
  }
}, 60_000);
