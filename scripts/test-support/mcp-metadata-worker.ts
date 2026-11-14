import { z } from "zod";
import { COST_SUBJECT, seedCostHoldings } from "./cost-fixtures";

const inputSchema = z
  .object({ operation: z.literal("mcp-metadata-holding") })
  .strict();

// Keep the one-position setup beside D1 without loading unrelated cost cases.
export default {
  async fetch(request: Request, bindings: { DB: D1Database }) {
    if (!z.literal("POST").safeParse(request.method).success)
      return new Response("Unsupported fixture method", { status: 400 });
    const input = inputSchema.safeParse(await request.json());
    if (!input.success)
      return Response.json({ error: input.error.flatten() }, { status: 400 });
    return Response.json({
      operation: input.data.operation,
      importId: await seedCostHoldings(bindings.DB, COST_SUBJECT, 1, false, {
        positionCount: 1,
      }),
    });
  },
};
