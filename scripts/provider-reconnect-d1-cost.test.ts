import { expect, it } from "vitest";
import { D1ProviderBrowserSessionRepository } from "../packages/database/src/provider-browser-sessions";
import { D1ProviderPortfolioAgentRepository } from "../packages/database/src/provider-portfolio-agent";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";

it("keeps reconnect subject binding indexed across positive, empty, foreign and growing history", async () => {
  const fixture = await createCostDatabase();
  const now = () => new Date("2026-10-01T12:00:00.000Z");
  try {
    await new D1ProviderPortfolioAgentRepository(
      fixture.database,
      now,
    ).register("synthetic-access-subject", "tokenfolio");
    await fixture.execute(`INSERT INTO users VALUES ('usr_foreign', 'synthetic-foreign', 'foreign@example.com', 'Synthetic foreign user', '2026-01-01T00:00:00Z');
      INSERT INTO households VALUES ('hh_foreign', 'usr_foreign', 'Synthetic foreign household', 'USD', '2026-01-01T00:00:00Z');`);
    await new D1ProviderPortfolioAgentRepository(
      fixture.database,
      now,
    ).register("synthetic-foreign", "tokenfolio");
    const costs: number[] = [];
    for (const history of [120, 1200]) {
      await fixture.database
        .prepare(
          `INSERT INTO provider_browser_sessions (
        id, household_id, provider, requested_by_user_id, status, requested_at, expires_at, finished_at, updated_at
      ) SELECT 'history-' || ? || '-' || value, CASE WHEN value % 2 = 0 THEN 'hh_demo' ELSE 'hh_foreign' END,
        'tokenfolio', CASE WHEN value % 2 = 0 THEN 'usr_demo' ELSE 'usr_foreign' END,
        'cancelled', '2026-01-01T00:00:00.000Z', '2026-01-01T00:15:00.000Z', '2026-01-01T00:01:00.000Z', '2026-01-01T00:01:00.000Z'
        FROM json_each(?)`,
        )
        .bind(
          history,
          JSON.stringify(Array.from({ length: history }, (_, index) => index)),
        )
        .run();
      const meter = measureD1(fixture.database);
      const repository = new D1ProviderBrowserSessionRepository(
        meter.database,
        now,
        "https://keel-agents.example.com",
      );
      const session = await repository.create(
        "synthetic-access-subject",
        "tokenfolio",
      );
      meter.reset();
      const lease = await repository.lease(
        "synthetic-access-subject",
        "tokenfolio",
      );
      expect(lease.session).toMatchObject({
        id: session.id,
        viewerSubject: "synthetic-access-subject",
      });
      expect(meter.cost.roundTrips).toBeLessThanOrEqual(7);
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(40);
      costs.push(meter.cost.rowsRead);
      const query = [...meter.queries].find((sql) =>
        sql.includes("viewer.access_subject"),
      );
      expect(query).toBeDefined();
      const plan = await fixture.database
        .prepare(`EXPLAIN QUERY PLAN ${query}`)
        .bind(session.id, "hh_demo", "tokenfolio", "a".repeat(64))
        .all<{ detail: string }>();
      const details = plan.results.map((row) => row.detail).join("\n");
      expect(details).toMatch(/SEARCH session USING INDEX/u);
      expect(details).toMatch(/SEARCH viewer USING INDEX/u);
      expect(details).not.toMatch(/SCAN/u);
      meter.reset();
      expect(
        (await repository.lease("synthetic-foreign", "tokenfolio")).session,
      ).toBeNull();
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(12);
      expect(meter.cost.rowsWritten).toBe(0);
      expect(meter.cost.roundTrips).toBeLessThanOrEqual(4);
      await repository.cancel("synthetic-access-subject", session.id);
      meter.reset();
      expect(
        (await repository.lease("synthetic-access-subject", "tokenfolio"))
          .session,
      ).toBeNull();
      expect(meter.cost.rowsRead).toBeLessThanOrEqual(12);
      expect(meter.cost.rowsWritten).toBe(0);
    }
    expect(costs[1]).toBeLessThanOrEqual(costs[0]! + 1);
  } finally {
    await fixture.close();
  }
});
