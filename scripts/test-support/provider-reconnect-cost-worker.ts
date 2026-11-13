import { z } from "zod";
import { setupProviderReconnectCost } from "./provider-reconnect-cost";

const requestSchema = z
  .object({ operation: z.literal("provider-reconnect") })
  .strict();

export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const parsed = requestSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    return Response.json({
      operation: parsed.data.operation,
      results: await setupProviderReconnectCost(env.DB),
    });
  },
};
