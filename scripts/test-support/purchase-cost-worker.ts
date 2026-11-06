import { z } from "zod";
import { D1PositionPurchaseRepository } from "../../packages/database/src/position-purchases";
import { D1InvestmentPositionViewRepository } from "../../packages/database/src/position-read-model";
import { measureD1 } from "./d1-meter";
import { seedCostHoldings } from "./cost-fixtures";

const position = z.object({
  id: z.string().uuid(),
  snapshotId: z.string().uuid(),
});
const setupOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("seed"),
    subject: z.string().min(1).max(200).optional(),
  }),
  z.object({
    operation: z.literal("purchase-history"),
    subject: z.string().min(1).max(200),
    householdId: z.string().min(1).max(200),
    positions: z.array(position).length(120),
  }),
  z.object({
    operation: z.literal("link-history"),
    count: z.union([z.literal(120), z.literal(240)]),
    source: position,
    target: position,
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
    if (input.operation === "link-history") {
      const costs = [];
      for (let i = 0; i < input.count; i++) {
        meter.reset();
        await meter.database
          .prepare(
            `INSERT INTO holding_position_link_reviews
          (id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,
            source_participation_review_id,target_participation_review_id,prior_id,relationship,state,
            use_source_value,note,reviewer_user_id,accepted_at)
          VALUES(?,'hh_demo',?,?,?,?,NULL,NULL,
            (SELECT review_id FROM holding_position_link_heads WHERE source_position_id=?),
            'same_investment',?,0,'Synthetic history decision','usr_demo','2026-10-01T12:00:00.000Z')`,
          )
          .bind(
            crypto.randomUUID(),
            input.source.id,
            input.target.id,
            input.source.snapshotId,
            input.target.snapshotId,
            input.source.id,
            i % 2 === 0 ? "linked" : "unlinked",
          )
          .run();
        costs.push({ ...meter.cost });
      }
      return Response.json(costs);
    }
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
    // Grow one position to a second history page using the same production
    // accept path. Keeping the loop here avoids hundreds of host RPCs.
    const target = input.positions[0]!;
    let deepHead = heads.get(target.id)!;
    for (let version = 0; version < 120; version++) {
      const receipt = await purchases.accept(input.subject, target.id, {
        expectedSnapshotId: target.snapshotId,
        expectedReceiptId: deepHead,
        details: { coversPosition: true, lots: [] },
      });
      deepHead = receipt.id;
    }
    return Response.json({
      deepHead,
      acceptances,
      reads,
      stored,
    });
  },
};
