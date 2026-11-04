import { COST_SUBJECT, COST_TIME, seedCostHoldings } from "./cost-fixtures";
import { measureD1 } from "./d1-meter";

const realizedHolding = {
  status: "Realized",
  investedMinor: 130_000,
  allocationMinor: 170_000,
} as const;

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
    } else if (operation === "second-import") {
      const measured = measureD1(bindings.DB);
      await seedCostHoldings(
        measured.database,
        COST_SUBJECT,
        2,
        false,
        realizedHolding,
      );
      return Response.json({
        operation,
        cost: measured.cost,
        queries: [...measured.queries].map((sql) => [
          sql,
          measured.byQuery.get(sql)?.calls ?? 0,
        ]),
      });
    } else if (operation === "history") {
      for (let revision = 3; revision < 6; revision++) {
        await seedCostHoldings(
          bindings.DB,
          COST_SUBJECT,
          revision,
          false,
          realizedHolding,
        );
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
