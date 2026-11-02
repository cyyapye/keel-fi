import { z } from "zod";
import { D1ManualHoldingRepository } from "../../packages/database/src/manual-holdings";
import { ManualHoldingInputSchema } from "../../packages/domain/src/manual-holdings";
import { measureD1 } from "./d1-meter";

const batchSchema = z
  .object({
    subject: z.string().min(1).max(200),
    time: z.iso.datetime(),
    inputs: z.array(ManualHoldingInputSchema).length(120),
  })
  .strict();
export type ManualHoldingCostBatch = z.input<typeof batchSchema>;

let creating = false;

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const parsed = batchSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json({ error: parsed.error.flatten() }, { status: 400 });
    if (creating)
      return Response.json(
        { error: "Overlapping manual cost setup" },
        { status: 409 },
      );
    creating = true;
    const originalDate = Date;
    let index = 0;
    try {
      globalThis.Date = new Proxy(originalDate, {
        construct(target, args): Date {
          return Reflect.construct(
            target,
            args.length ? args : [parsed.data.time],
          ) as Date;
        },
        get(target, key, receiver): unknown {
          return key === "now"
            ? () => originalDate.parse(parsed.data.time)
            : Reflect.get(target, key, receiver);
        },
      });
      const measured = measureD1(bindings.DB);
      const repository = new D1ManualHoldingRepository(measured.database, {
        put: () => Promise.resolve(undefined),
      });
      for (; index < parsed.data.inputs.length; index++)
        await repository.create(
          parsed.data.subject,
          parsed.data.inputs[index]!,
        );
      return Response.json({ ...measured.cost });
    } catch (error) {
      return Response.json(
        {
          error: `Manual cost setup failed at input ${index}`,
          cause: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    } finally {
      globalThis.Date = originalDate;
      creating = false;
    }
  },
};
