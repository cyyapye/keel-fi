import { expect, it } from "vitest";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import { seedAutomaticInvestments } from "./test-support/automatic-investments";
import { D1CompanyIdentityRepository } from "../packages/database/src/company-identity";
import { D1AutomaticInvestmentReviewRepository } from "../packages/database/src/automatic-investment-review";
import { D1InvestmentReviewRepository } from "../packages/database/src/investment-review";

it("bounds company catalog and 120-position alias review including actual D1 history and unrelated-household costs", async () => {
  const fixture = await createCostDatabase();
  const subject = "synthetic-access-subject";
  try {
    const positions = await seedAutomaticInvestments(
      fixture.database,
      120,
      [],
      true,
    );
    await new D1AutomaticInvestmentReviewRepository(fixture.database).resolve(
      subject,
    );
    const details = await new D1InvestmentReviewRepository(
      fixture.database,
    ).getContext(subject, positions[0]!);
    const source = details.mappings.find((m) => m.status === "active")!;
    await fixture.execute(
      `INSERT INTO companies VALUES ('alias-canonical', 'hh_demo', 'Synthetic Orchard', NULL, 'active', '2026-09-01', '2026-09-01')`,
    );
    await fixture.database
      .prepare(
        `INSERT INTO companies SELECT 'cost-company-' || value, 'hh_demo', 'Synthetic Company ' || value, NULL, 'active', '2026-09-01', '2026-09-01' FROM json_each(?)`,
      )
      .bind(JSON.stringify(Array.from({ length: 120 }, (_, i) => i)))
      .run();
    const measured = measureD1(fixture.database);
    const repository = new D1CompanyIdentityRepository(measured.database);
    await repository.getCatalog(subject);
    expect(measured.cost).toMatchObject({ roundTrips: 3, rowsWritten: 0 });
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(1000);
    measured.reset();
    const proposal = {
      companyId: "alias-canonical",
      sourceCompanyId: source.companyId!,
      aliasName: source.companyName,
    };
    const preview = await repository.preview(subject, proposal);
    expect(preview.positions).toHaveLength(120);
    expect(measured.cost.roundTrips).toBe(4);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(4000);
    const base = measured.cost.rowsRead;
    // Grow complete mapping histories at a tied effective timestamp, and add
    // unrelated company rows. Head seeks must remain independent of history.
    for (let version = 2; version <= 12; version++) {
      await fixture.database
        .prepare(
          `INSERT INTO holding_position_exposure_mappings
        SELECT 'alias-history-' || ? || '-' || m.position_id, m.household_id, m.position_id, m.exposure_id, m.relationship_kind, m.allocation_ppm, m.status, m.decision_source, m.decision_reference, m.evidence_sha256, m.effective_at, m.version + 1, m.id, m.accepted_by_user_id, m.accepted_at, 1
        FROM canonical_exposures e JOIN holding_position_exposure_mappings root ON root.exposure_id = e.id AND root.supersedes_mapping_id IS NULL
        JOIN holding_position_exposure_mappings m ON m.id = (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1)
        WHERE e.company_id = ?`,
        )
        .bind(version, source.companyId)
        .run();
    }
    await fixture.execute(
      `INSERT INTO users VALUES ('cost-other-user', 'cost-other-subject', 'other@example.invalid', 'Synthetic Other', '2026-09-01'); INSERT INTO households VALUES ('cost-other', 'cost-other-user', 'Synthetic Other', 'USD', '2026-09-01')`,
    );
    await fixture.database
      .prepare(
        `INSERT INTO companies SELECT 'unrelated-' || value, 'cost-other', 'Synthetic Unrelated ' || value, NULL, 'active', '2026-09-01', '2026-09-01' FROM json_each(?)`,
      )
      .bind(JSON.stringify(Array.from({ length: 1200 }, (_, i) => i)))
      .run();
    measured.reset();
    const current = await repository.preview(subject, proposal);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(base + 120);
    measured.reset();
    const request = {
      ...proposal,
      requestId: crypto.randomUUID(),
      expectedRevision: current.revision,
      reason: "Reviewed synthetic aliases.",
    };
    await repository.review(subject, request);
    console.info(
      JSON.stringify({
        companyAliasAcceptance: measured.cost,
        largestQueries: [...measured.byQuery]
          .map(([sql, cost]) => ({ sql: sql.slice(0, 160), ...cost }))
          .sort((a, b) => b.rowsRead - a.rowsRead)
          .slice(0, 5),
      }),
    );
    expect(measured.cost.roundTrips).toBeLessThanOrEqual(6);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(18000);
    expect(measured.cost.rowsWritten).toBeLessThanOrEqual(5000);
    measured.reset();
    await repository.review(subject, request);
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.roundTrips).toBe(2);
    measured.reset();
    await repository.getCatalog(subject);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(1100);
    measured.reset();
    // Empty matches on a household with growing unrelated history are cheap.
    await repository.preview(subject, {
      companyId: "alias-canonical",
      sourceCompanyId: null,
      aliasName: "Synthetic Orchard Alternative",
    });
    expect(measured.cost.rowsWritten).toBe(0);
    expect(measured.cost.rowsRead).toBeLessThanOrEqual(4000);
  } finally {
    await fixture.close();
  }
}, 120_000);
