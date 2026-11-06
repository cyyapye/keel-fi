import * as z from "zod/mini";

const queriesSchema = z
  .array(
    z.strictObject({
      index: z.int().check(z.nonnegative()),
      sql: z.string().check(z.minLength(1)),
      bindings: z.array(z.null()),
    }),
  )
  .check(z.minLength(1), z.maxLength(64));

export default {
  async fetch(request: Request, { DB }: { DB: D1Database }) {
    try {
      const queries = queriesSchema.parse(await request.json());
      const statements = queries.map(({ sql, bindings }) =>
        DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...bindings),
      );
      const results = await DB.batch(statements);
      if (results.length !== statements.length)
        throw new Error("Incomplete D1 EXPLAIN batch");
      return Response.json(
        results.map((result, i) => ({
          index: queries[i]!.index,
          success: result.success,
          results: result.results,
        })),
      );
    } catch (error) {
      return new Response(String(error), { status: 400 });
    }
  },
};
