import { z } from "zod";
import { D1AutomaticInvestmentReviewRepository } from "../../packages/database/src/automatic-investment-review";
import { D1InvestmentReviewRepository } from "../../packages/database/src/investment-review";
import { seedAutomaticInvestments } from "./automatic-investments";
import { measureD1 } from "./d1-meter";

const positionIdsSchema = z.array(z.string().uuid()).min(1).max(120);
const setupOperationSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("source-capture-cost") }),
  z.object({
    operation: z.literal("seed"),
    count: z.number().int().min(1).max(120),
    capturedCount: z.number().int().min(0).max(120).optional(),
    sharedName: z.boolean().optional(),
    subject: z.string().min(1).max(200).optional(),
  }),
  z.object({
    operation: z.literal("resolve-automatic-reviews"),
    subject: z.string().min(1).max(200),
  }),
  z.object({
    operation: z.literal("participation-reviews"),
    ids: positionIdsSchema,
    subject: z.string().min(1).max(200),
    historicalCount: z.number().int().min(0).max(120),
    amountMinor: z.number().int().nonnegative(),
  }),
  z.object({
    operation: z.literal("automatic-review-history"),
    ids: positionIdsSchema,
  }),
]);
export type AutomaticInvestmentSetupOperation = z.input<
  typeof setupOperationSchema
>;

// Synthetic fixture setup and explicitly metered cost scenarios run beside D1
// to avoid repeated host RPC overhead. This worker has no application runtime.
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
    if (input.operation === "source-capture-cost") {
      const measured = measureD1(bindings.DB);
      let sourceWrites = 0;
      await seedAutomaticInvestments(
        measured.database,
        120,
        [],
        false,
        "synthetic-access-subject",
        () => {
          sourceWrites = measured.cost.rowsWritten;
        },
        24,
      );
      const captureWrites = measured.cost.rowsWritten;
      measured.reset();
      const result = await new D1AutomaticInvestmentReviewRepository(
        measured.database,
      ).resolve("synthetic-access-subject");
      return Response.json({
        sourceWrites,
        captureWrites,
        resolvedCount: result.resolvedCount,
        exceptionCount: result.exceptionCount,
        review: { ...measured.cost },
      });
    }
    if (input.operation === "seed") {
      const capturedCount = input.capturedCount ?? input.count;
      if (capturedCount > input.count)
        return new Response("capturedCount exceeds count", { status: 400 });
      const ids = await seedAutomaticInvestments(
        bindings.DB,
        input.count,
        [],
        input.sharedName,
        input.subject,
        undefined,
        capturedCount,
      );
      return Response.json({ ids });
    }
    if (input.operation === "resolve-automatic-reviews") {
      await new D1AutomaticInvestmentReviewRepository(bindings.DB).resolve(
        input.subject,
      );
      return Response.json({ completed: true });
    }
    if (input.operation === "participation-reviews") {
      if (input.historicalCount > input.ids.length)
        return new Response("historicalCount exceeds ids length", {
          status: 400,
        });
      const reviews = new D1InvestmentReviewRepository(bindings.DB);
      for (const [index, id] of input.ids.entries()) {
        const context = await reviews.getContext(input.subject, id);
        await reviews.review(input.subject, id, {
          requestId: crypto.randomUUID(),
          expectedReviewId: null,
          expectedSnapshotId: context.snapshotId,
          expectedEvidenceRevision: context.evidenceRevision,
          participationStatus:
            index < input.historicalCount ? "historical" : "current",
          amountCorrection: {
            amountMinor: input.amountMinor,
            note: "Synthetic personal commitment",
          },
        });
      }
      return Response.json({ completed: true });
    }
    for (let version = 2; version <= 121; version++) {
      await bindings.DB.prepare(
        `INSERT INTO automatic_investment_reviews
        (id, household_id, position_id, snapshot_id, policy_version, source_revision, expected_guard_json, result_guard_json, summary_json, details_json, version, supersedes_id, recorded_by_user_id, recorded_at)
        SELECT printf('00000000-0000-4000-9000-%012x', ? * 1000 + keys.key), previous.household_id, previous.position_id, previous.snapshot_id, previous.policy_version,
          printf('%064x', ? * 1000 + keys.key), previous.result_guard_json, previous.result_guard_json,
          json_set(previous.summary_json, '$.id', printf('00000000-0000-4000-9000-%012x', ? * 1000 + keys.key)), '{}', ?, previous.id, previous.recorded_by_user_id, previous.recorded_at
        FROM json_each(?) keys JOIN automatic_investment_reviews previous ON previous.position_id = keys.value AND previous.version = ?`,
      )
        .bind(
          version,
          version,
          version,
          version,
          JSON.stringify(input.ids),
          version - 1,
        )
        .run();
    }
    return Response.json({ completed: true });
  },
};
