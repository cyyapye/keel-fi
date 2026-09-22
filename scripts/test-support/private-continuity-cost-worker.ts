import { COST_SUBJECT, COST_TIME, seedCostHoldings } from "./cost-fixtures";

// Synthetic-only unmeasured fixture setup runs beside D1 to avoid repeated
// Node-to-D1 RPC overhead. This worker is test support and has no app runtime.
export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const operation = await request.text();
    if (operation === "initial") {
      await seedCostHoldings(bindings.DB, COST_SUBJECT, 1, true, {
        status: "Realized",
      });
    } else if (operation === "history") {
      for (let revision = 3; revision < 6; revision++) {
        await seedCostHoldings(bindings.DB, COST_SUBJECT, revision, false, {
          status: "Realized",
          investedMinor: 130_000,
          allocationMinor: 170_000,
        });
      }
    } else if (operation === "unrelated") {
      await bindings.DB.batch([
        bindings.DB.prepare(
          "INSERT INTO users VALUES ('continuity-other-user', 'synthetic-continuity-other-subject', 'other@example.invalid', 'Synthetic user', ?)",
        ).bind(COST_TIME),
        bindings.DB.prepare(
          "INSERT INTO households VALUES ('continuity-other-household', 'continuity-other-user', 'Synthetic household', 'USD', ?)",
        ).bind(COST_TIME),
      ]);
      await seedCostHoldings(bindings.DB, "synthetic-continuity-other-subject");
    } else {
      return new Response(`Unknown setup operation: ${operation}`, {
        status: 400,
      });
    }
    return new Response(null, { status: 204 });
  },
};
