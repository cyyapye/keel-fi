import { z } from "zod";
import { D1PositionPurchaseRepository } from "../../packages/database/src/position-purchases";
import { D1InvestmentPositionViewRepository } from "../../packages/database/src/position-read-model";
import { measureD1 } from "./d1-meter";
import { seedCostHoldings } from "./cost-fixtures";

const setupOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("seed"),
    subject: z.string().min(1).max(200).optional(),
  }),
  z.object({
    operation: z.literal("purchase-history"),
    subject: z.string().min(1).max(200),
    householdId: z.string().min(1).max(200),
    positions: z
      .array(
        z.object({
          id: z.string().uuid(),
          snapshotId: z.string().uuid(),
        }),
      )
      .length(120),
  }),
]);
export type PurchaseCostSetupOperation = z.input<typeof setupOperationSchema>;

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const parsed = setupOperationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const input = parsed.data;
    if (input.operation === "seed") {
      return Response.json({
        importId: await seedCostHoldings(bindings.DB, input.subject),
      });
    }

    const meter = measureD1(bindings.DB);
    const purchases = new D1PositionPurchaseRepository(meter.database);
    const reader = new D1InvestmentPositionViewRepository(meter.database);
    const heads = new Map<string, string>();
    const acceptances = [];
    const reads = [];
    for (let version = 0; version < 8; version++) {
      for (const position of input.positions) {
        meter.reset();
        const receipt = await purchases.accept(input.subject, position.id, {
          expectedSnapshotId: position.snapshotId,
          expectedReceiptId: heads.get(position.id) ?? null,
          details: { coversPosition: true, lots: [] },
        });
        heads.set(position.id, receipt.id);
        acceptances.push({
          version,
          positionId: position.id,
          receiptId: receipt.id,
          cost: { ...meter.cost },
        });
      }
      meter.reset();
      const page = await reader.listForHousehold(input.householdId);
      reads.push({
        version,
        positionCount: page.connections.flatMap((connection) =>
          connection.containers.flatMap((container) => container.positions),
        ).length,
        cost: { ...meter.cost },
      });
    }
    const stored = await bindings.DB.prepare(
      `SELECT COUNT(*) AS receiptCount, COUNT(DISTINCT position_id) AS positionCount
       FROM holding_purchase_reviews WHERE household_id = ?`,
    )
      .bind(input.householdId)
      .first<{ receiptCount: number; positionCount: number }>();
    return Response.json({
      acceptances,
      reads,
      stored,
    });
  },
};
