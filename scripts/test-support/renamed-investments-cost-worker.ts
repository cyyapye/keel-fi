import { z } from "zod";
import { seedReviewedRenameCostFixture } from "./renamed-investments-cost";

const setupSchema = z.object({ operation: z.literal("setup") }).strict();

// Synthetic-only fixture setup. This worker is never part of the application.
export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const parsed = setupSchema.safeParse(await request.json());
    if (!parsed.success)
      return new Response("Invalid synthetic setup", { status: 400 });
    return Response.json(await seedReviewedRenameCostFixture(bindings.DB));
  },
};
