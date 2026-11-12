import {
  D1InvestmentHistoryRepository,
  InvestmentHistoryReadError,
} from "@keel/database";
import { InvestmentHistoryQuerySchema } from "@keel/domain/investment-history";
import type { Hono } from "hono";
import type { AppEnvironment } from "../app";
import { GoalConflict } from "./goals";

export function registerInvestmentHistoryRoutes(app: Hono<AppEnvironment>) {
  for (const [path, method] of [
    ["investment-transactions", "transactions"],
    ["tax-lots", "taxLots"],
    ["investment-reconciliation", "reconciliation"],
  ] as const) {
    app.get("/api/v1/" + path, async (c) => {
      const search = new URL(c.req.url).searchParams;
      const query = InvestmentHistoryQuerySchema.safeParse(
        new Set(search.keys()).size === search.size
          ? Object.fromEntries(search)
          : null,
      );
      if (
        !query.success ||
        (method !== "transactions" && !query.data.positionId)
      )
        throw new GoalConflict(
          400,
          "invalid_request",
          "Supply one accountId or positionId and valid history filters. Lots and reconciliation require positionId.",
        );
      try {
        const result = await new D1InvestmentHistoryRepository(c.env.DB)[
          method
        ](c.get("agentReadHousehold"), query.data);
        return result
          ? c.json(result)
          : c.json({ code: "not_found", error: "Resource not found." }, 404);
      } catch (error) {
        if (error instanceof InvestmentHistoryReadError)
          throw new GoalConflict(
            error.status,
            error.status === 409 ? "stale_revision" : "invalid_request",
            error.message,
          );
        throw error;
      }
    });
  }
}
