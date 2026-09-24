import { expect, it } from "vitest";
import { createAutomaticInvestmentCostDatabase } from "./test-support/automatic-investment-cost-database";
import { measureD1 } from "./test-support/d1-cost";
import { D1PublicCompanyLinkRepository } from "../packages/database/src/public-company-links";

it("bounds issuer recommendations across 120 holdings, tied mapping history and unrelated households", async () => {
  const fixture = await createAutomaticInvestmentCostDatabase();
  const subject = "synthetic-access-subject";
  try {
    await fixture.seed({ count: 120 });
    await fixture.resolveAutomaticReviews(subject);
    await fixture.execute(`INSERT INTO canonical_exposures
      SELECT 'listed-' || head.position_id, e.household_id, 'public_instrument', e.canonical_name || ' - Ordinary Shares',
        printf('%064x', row_number() OVER (ORDER BY head.position_id) + 900000), NULL, 'strong_identifier', e.evidence_sha256, e.created_by_user_id, e.created_at, 1
      FROM canonical_exposures e JOIN holding_position_exposure_heads head ON head.exposure_id = e.id WHERE e.exposure_kind = 'private_company' AND e.household_id = 'hh_demo';
      INSERT INTO holding_position_exposure_mappings
      SELECT 'listed-' || m.id, m.household_id, m.position_id, 'listed-' || m.position_id, 'look_through', NULL, 'active', 'review', 'Synthetic issuer source', m.evidence_sha256, m.effective_at, 1, NULL, m.accepted_by_user_id, m.accepted_at, 1
      FROM holding_position_exposure_heads head JOIN holding_position_exposure_mappings m ON m.id = head.mapping_id
      JOIN canonical_exposures e ON e.id = m.exposure_id WHERE e.exposure_kind = 'private_company' AND e.household_id = 'hh_demo';`);
    const meter = measureD1(fixture.database);
    const repository = new D1PublicCompanyLinkRepository(meter.database);
    const catalog = await repository.getCatalog(subject);
    expect(catalog.securities.length).toBeGreaterThanOrEqual(120);
    expect(meter.cost.roundTrips).toBe(3);
    expect(meter.cost.rowsWritten).toBe(0);
    const baseReads = meter.cost.rowsRead;
    for (let version = 2; version <= 10; version++) {
      await fixture.database
        .prepare(
          `INSERT INTO holding_position_exposure_mappings
        SELECT 'issuer-history-' || ? || '-' || m.id, m.household_id, m.position_id, m.exposure_id, m.relationship_kind, m.allocation_ppm, m.status, m.decision_source, m.decision_reference, m.evidence_sha256, m.effective_at, m.version + 1, m.id, m.accepted_by_user_id, m.accepted_at, 1
        FROM holding_position_exposure_heads head JOIN holding_position_exposure_mappings m ON m.id = head.mapping_id WHERE m.household_id = 'hh_demo'`,
        )
        .bind(version)
        .run();
    }
    await fixture.execute(
      `INSERT INTO users VALUES ('issuer-other-user', 'issuer-other-subject', 'other@example.test', 'Synthetic Other', '2026-09-01'); INSERT INTO households VALUES ('issuer-other', 'issuer-other-user', 'Synthetic Other', 'USD', '2026-09-01');`,
    );
    await fixture.database
      .prepare(
        `INSERT INTO companies SELECT 'issuer-unrelated-' || value, 'issuer-other', 'Synthetic Unrelated ' || value, NULL, 'active', '2026-09-01', '2026-09-01' FROM json_each(?)`,
      )
      .bind(JSON.stringify(Array.from({ length: 1200 }, (_, i) => i)))
      .run();
    meter.reset();
    await repository.getCatalog(subject);
    expect(meter.cost).toMatchObject({ roundTrips: 3, rowsWritten: 0 });
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(baseReads + 120);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(4000);
    for (const sql of meter.queries) {
      const params = sql.includes("user.access_subject") ? subject : "hh_demo";
      const plan = await fixture.database
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .bind(params)
        .all<{ detail: string }>();
      expect(
        plan.results.filter((row) =>
          /SCAN (?:mapping|alias|later|continuity)\b/u.test(row.detail),
        ),
      ).toEqual([]);
    }
    const exposureId = catalog.securities.find((item) =>
      item.name.includes("Synthetic"),
    )!.exposureId;
    meter.reset();
    const match = await repository.recommend(subject, exposureId);
    expect(match.status).toBe("recommended");
    expect(meter.cost.roundTrips).toBe(6);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(4200);
    expect(meter.cost.rowsWritten).toBeLessThanOrEqual(8);
    meter.reset();
    expect(await repository.recommend(subject, exposureId)).toEqual(match);
    expect(meter.cost).toMatchObject({ roundTrips: 4, rowsWritten: 0 });
    meter.reset();
    const accepted = await repository.approveRecommendation(subject, match.id);
    expect(accepted.companyId).toBe(match.companyId);
    expect(meter.cost.roundTrips).toBe(4);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(100);
    expect(meter.cost.rowsWritten).toBeLessThanOrEqual(12);
    meter.reset();
    expect(await repository.approveRecommendation(subject, match.id)).toEqual(
      accepted,
    );
    expect(meter.cost.rowsWritten).toBe(0);
    meter.reset();
    expect(
      (await repository.getCatalog("issuer-other-subject")).securities,
    ).toEqual([]);
    expect(meter.cost.rowsRead).toBeLessThanOrEqual(4000);
    expect(meter.cost).toMatchObject({ roundTrips: 3, rowsWritten: 0 });
    await fixture.execute(`INSERT INTO canonical_exposures
      SELECT 'unknown-' || e.id, e.household_id, 'public_instrument', 'Unfamiliar synthetic issuer ' || row_number() OVER (ORDER BY e.id), printf('%064x', row_number() OVER (ORDER BY e.id) + 1900000), NULL, 'strong_identifier', e.evidence_sha256, e.created_by_user_id, e.created_at, 1
      FROM canonical_exposures e WHERE e.id LIKE 'listed-%' LIMIT 21;
      INSERT INTO holding_position_exposure_mappings
      SELECT 'unknown-' || m.id, m.household_id, m.position_id, e.id, 'look_through', NULL, 'active', 'review', 'Synthetic unknown issuer', m.evidence_sha256, m.effective_at, 1, NULL, m.accepted_by_user_id, m.accepted_at, 1
      FROM canonical_exposures e JOIN holding_position_exposure_heads head ON 'unknown-' || head.exposure_id = e.id JOIN holding_position_exposure_mappings m ON m.id = head.mapping_id WHERE e.id LIKE 'unknown-%';`);
    const unknown = (await repository.getCatalog(subject)).securities.filter(
      (item) => item.exposureId.startsWith("unknown-"),
    );
    expect(unknown).toHaveLength(21);
    let calls = 0;
    const outage = () => {
      calls++;
      return Promise.reject(new Error("synthetic outage"));
    };
    const results = await Promise.all(
      unknown.map((item) =>
        repository.recommend(subject, item.exposureId, outage),
      ),
    );
    expect(calls).toBe(20);
    expect(results.every((result) => result.status === "unavailable")).toBe(
      true,
    );
    expect(results.some((result) => result.reason.includes("limit"))).toBe(
      true,
    );
    await Promise.all(
      unknown.map((item) =>
        repository.recommend(subject, item.exposureId, outage),
      ),
    );
    expect(calls).toBe(20);
    await fixture.execute(
      "UPDATE companies SET updated_at = '2026-09-24' WHERE household_id = 'hh_demo'",
    );
    expect(
      (await repository.recommend(subject, unknown[0]!.exposureId, outage))
        .reason,
    ).toContain("limit");
    expect(calls).toBe(20);
  } finally {
    await fixture.close();
  }
}, 180_000);
