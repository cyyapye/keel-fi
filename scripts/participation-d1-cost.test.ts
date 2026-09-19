import { expect, it } from "vitest";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { seedAutomaticInvestments } from "./test-support/automatic-investments";
import { D1AlphaRepository } from "../packages/database/src/index";
import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";
import { D1HoldingsPageRepository } from "../packages/database/src/holdings-page";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";

it("keeps 120 participation projections and closure saves bounded across tied history and unrelated households", async () => {
  const fixture = await createCostDatabase();
  try {
    const subject = "synthetic-access-subject";
    const ids = await seedAutomaticInvestments(
      fixture.database,
      120,
      [],
      false,
      subject,
      undefined,
      0,
    );
    const reviews = new D1InvestmentReviewRepository(fixture.database);
    for (const [index, id] of ids.entries()) {
      const context = await reviews.getContext(subject, id);
      await reviews.review(subject, id, {
        requestId: crypto.randomUUID(),
        expectedReviewId: null,
        expectedSnapshotId: context.snapshotId,
        expectedEvidenceRevision: context.evidenceRevision,
        participationStatus: index < 60 ? "historical" : "current",
      });
    }
    const measured = measureD1(fixture.database);
    const holdings = new D1HoldingsPageRepository(measured.database);
    const read = async () => {
      measured.reset();
      const page = await holdings.getPage(subject, "available");
      expect(page.investmentHoldings.exposureView.positions).toHaveLength(60);
      expect(
        page.investmentHoldings.positionView.connections.flatMap((c) =>
          c.containers.flatMap((item) => item.positions),
        ),
      ).toHaveLength(120);
      expect(measured.cost.roundTrips).toBeLessThanOrEqual(11);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(3_500);
      expect(measured.cost.rowsWritten).toBe(0);
      return { ...measured.cost };
    };
    const readLegacy = async () => {
      measured.reset();
      const alpha = await new D1AlphaRepository(measured.database).getAlphaData(
        subject,
      );
      expect(
        alpha.holdings.filter((item) => ids.includes(item.id)),
      ).toHaveLength(60);
      expect(measured.cost.roundTrips).toBeLessThanOrEqual(13);
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(3_000);
      expect(measured.cost.rowsWritten).toBe(0);
      return { ...measured.cost };
    };
    const before = await read();
    const legacyBefore = await readLegacy();
    // 120 versions per position share a timestamp: version ordering, not time,
    // must select the accepted decision. Every database guard remains enabled.
    const historyStatements: D1PreparedStatement[] = [];
    for (let version = 2; version <= 121; version++) {
      historyStatements.push(
        fixture.database
          .prepare(
            `INSERT INTO holding_investment_reviews
        (id,household_id,position_id,request_id,request_sha256,expected_snapshot_id,supersedes_review_id,version,state_json,reviewer_user_id,recorded_at,evidence_guard_json)
        SELECT printf('20000000-0000-4000-9000-%012x', ? * 1000 + keys.key), previous.household_id, previous.position_id,
          printf('30000000-0000-4000-9000-%012x', ? * 1000 + keys.key), printf('%064x', ? * 1000 + keys.key), previous.expected_snapshot_id, previous.id, ?,
          json_set(previous.state_json, '$.id', printf('20000000-0000-4000-9000-%012x', ? * 1000 + keys.key), '$.version', ?),
          previous.reviewer_user_id, previous.recorded_at, json_set(previous.evidence_guard_json, '$.reviewId', previous.id)
        FROM json_each(?) keys JOIN holding_investment_reviews previous ON previous.position_id = keys.value AND previous.version = ?`,
          )
          .bind(
            version,
            version,
            version,
            version,
            version,
            version,
            JSON.stringify(ids),
            version - 1,
          ),
      );
    }
    // Setup is outside the measured requests. Bound transport batches while
    // retaining statement order and every version/provenance trigger.
    for (let offset = 0; offset < historyStatements.length; offset += 20) {
      await fixture.database.batch(
        historyStatements.slice(offset, offset + 20),
      );
    }
    const history = await read();
    expect(history.rowsRead).toBeLessThanOrEqual(before.rowsRead + 1_000);
    await fixture.execute(
      "INSERT INTO users VALUES ('participation-other-user','participation-other-subject','other@example.invalid','Synthetic Other','2026-09-01'); INSERT INTO households VALUES ('participation-other','participation-other-user','Synthetic Other','USD','2026-09-01')",
    );
    await seedAutomaticInvestments(
      fixture.database,
      120,
      [],
      false,
      "participation-other-subject",
      undefined,
      0,
    );
    const unrelated = await read();
    const legacyAfter = await readLegacy();
    expect(legacyAfter.rowsRead).toBeLessThanOrEqual(
      legacyBefore.rowsRead + 1_000,
    );
    expect(unrelated.rowsRead).toBeLessThanOrEqual(history.rowsRead + 1_000);
    measured.reset();
    expect(
      (
        await new D1InvestmentPositionViewRepository(
          measured.database,
        ).listForHousehold("synthetic-empty-household")
      ).connections,
    ).toEqual([]);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(1_000);
    expect(measured.cost.rowsWritten).toBe(0);
    const empty = { ...measured.cost };
    const measuredReviews = new D1InvestmentReviewRepository(measured.database);
    const context = await measuredReviews.getContext(subject, ids[0]!);
    const request = {
      requestId: crypto.randomUUID(),
      expectedReviewId: context.review!.id,
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      participationStatus: "historical" as const,
      closure: {
        endedOn: "2026-09-01",
        reason: "unwound" as const,
        note: "Synthetic closure",
        replacementPositionId: ids[119]!,
      },
    };
    measured.reset();
    const saved = await measuredReviews.review(subject, ids[0]!, request);
    const save = { ...measured.cost };
    expect(save.roundTrips).toBeLessThanOrEqual(9);
    expect(save.rowsRead).toBeLessThanOrEqual(500);
    expect(save.rowsWritten).toBeLessThanOrEqual(6);
    measured.reset();
    expect(await measuredReviews.review(subject, ids[0]!, request)).toEqual(
      saved,
    );
    expect(measured.cost.roundTrips).toBe(2);
    expect(measured.cost.rowsWritten).toBe(0);
    const details: string[] = [];
    for (const sql of measured.queries) {
      if (!sql.trimStart().startsWith("SELECT")) continue;
      const plan = await fixture.database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(...Array.from({ length: sql.split("?").length - 1 }, () => null))
        .all<{ detail: string }>();
      details.push(...plan.results.map((row) => row.detail));
    }
    expect(
      details.filter((detail) =>
        /SCAN (holding_investment_reviews|review|previous|replacement|continuity)/u.test(
          detail,
        ),
      ),
    ).toEqual([]);
    console.info(
      JSON.stringify({
        syntheticParticipationCost: {
          before,
          history,
          unrelated,
          empty,
          save,
          legacyBefore,
          legacyAfter,
        },
      }),
    );
  } finally {
    await fixture.close();
  }
}, 90_000);
