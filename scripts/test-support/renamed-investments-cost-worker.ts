import { z } from "zod";
import {
  renamedCostScaleInput,
  seedReviewedRenameCostFixture,
  seedReviewedRenameCostImport,
} from "./renamed-investments-cost";
import { D1HoldingImportRepository } from "../../packages/database/src/holding-imports";

const setupSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("setup") }).strict(),
  z
    .object({
      operation: z.literal("history"),
      revision: z.union([z.literal(8), z.literal(9), z.literal(10)]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("foreign"),
      revision: z.union([z.literal(12), z.literal(13)]),
    })
    .strict(),
]);

// Synthetic-only fixture setup. This worker is never part of the application.
export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const parsed = setupSchema.safeParse(await request.json());
    if (!parsed.success)
      return new Response("Invalid synthetic setup", { status: 400 });
    const input = parsed.data;
    if (input.operation === "setup")
      return Response.json(await seedReviewedRenameCostFixture(bindings.DB));
    if (input.operation === "history") {
      const holdingImport = renamedCostScaleInput(false, input.revision);
      holdingImport.effectiveDate = "2026-09-01";
      const result = await seedReviewedRenameCostImport(
        bindings.DB,
        holdingImport,
      );
      if (result === undefined)
        throw new Error("Expected a fresh synthetic history import");
      return Response.json({ operation: input.operation, ...result });
    }
    const staged = await new D1HoldingImportRepository(
      bindings.DB,
    ).stageHoldingImport(
      "rename-other-subject",
      renamedCostScaleInput(true, input.revision),
    );
    return Response.json({
      operation: input.operation,
      importId: staged.preview.id,
      rowCount: staged.preview.rows.length,
      status: staged.preview.status,
    });
  },
};
