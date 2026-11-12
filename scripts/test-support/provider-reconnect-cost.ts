import { z } from "zod";
import { D1ProviderBrowserSessionRepository } from "../../packages/database/src/provider-browser-sessions";
import { D1ProviderPortfolioAgentRepository } from "../../packages/database/src/provider-portfolio-agent";
import { measureD1 } from "./d1-meter";

const cost = z
  .object({
    roundTrips: z.number().int().nonnegative(),
    statements: z.number().int().nonnegative(),
    rowsRead: z.number().int().nonnegative(),
    rowsWritten: z.number().int().nonnegative(),
  })
  .strict();
export const reconnectCostResultSchema = z
  .array(
    z
      .object({
        history: z.union([z.literal(120), z.literal(1200)]),
        createdSessionId: z.string(),
        leasedSessionId: z.string().nullable(),
        viewerSubject: z.string().nullable(),
        positive: cost,
        plan: z.string(),
        foreignEmpty: z.boolean(),
        foreign: cost,
        empty: z.boolean(),
        emptyCost: cost,
      })
      .strict(),
  )
  .length(2);

export async function setupProviderReconnectCost(database: D1Database) {
  const agents = new D1ProviderPortfolioAgentRepository(
    database,
    () => new Date("2026-10-01T12:00:00.000Z"),
  );
  await agents.register("synthetic-access-subject", "tokenfolio");
  await database.batch([
    database.prepare(
      "INSERT INTO users VALUES ('usr_foreign', 'synthetic-foreign', 'foreign@example.com', 'Synthetic foreign user', '2026-01-01T00:00:00Z')",
    ),
    database.prepare(
      "INSERT INTO households VALUES ('hh_foreign', 'usr_foreign', 'Synthetic foreign household', 'USD', '2026-01-01T00:00:00Z')",
    ),
  ]);
  await agents.register("synthetic-foreign", "tokenfolio");
  return providerReconnectCost(database);
}

// Run every original repository operation beside real D1. Only transport changes;
// the host test still judges every result, billing budget and query plan.
export async function providerReconnectCost(database: D1Database) {
  const results = [];
  for (const history of [120, 1200] as const) {
    await database
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
    const meter = measureD1(database);
    const repository = new D1ProviderBrowserSessionRepository(
      meter.database,
      () => new Date("2026-10-01T12:00:00.000Z"),
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
    const positive = { ...meter.cost };
    const query = [...meter.queries].find((sql) =>
      sql.includes("viewer.access_subject"),
    );
    if (query === undefined)
      throw new Error("Reconnect subject query was not observed");
    const plan = await database
      .prepare(`EXPLAIN QUERY PLAN ${query}`)
      .bind(session.id, "hh_demo", "tokenfolio", "a".repeat(64))
      .all<{ detail: string }>();
    meter.reset();
    const foreign = await repository.lease("synthetic-foreign", "tokenfolio");
    const foreignCost = { ...meter.cost };
    await repository.cancel("synthetic-access-subject", session.id);
    meter.reset();
    const empty = await repository.lease(
      "synthetic-access-subject",
      "tokenfolio",
    );
    results.push({
      history,
      createdSessionId: session.id,
      leasedSessionId: lease.session?.id ?? null,
      viewerSubject: lease.session?.viewerSubject ?? null,
      positive,
      plan: plan.results.map((row) => row.detail).join("\n"),
      foreignEmpty: foreign.session === null,
      foreign: foreignCost,
      empty: empty.session === null,
      emptyCost: { ...meter.cost },
    });
  }
  return reconnectCostResultSchema.parse(results);
}
