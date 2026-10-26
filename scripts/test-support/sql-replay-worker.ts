import { replaySql, sqlReplayChunkSchema } from "./sql-replay";

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    try {
      return Response.json(
        await replaySql(
          bindings.DB,
          sqlReplayChunkSchema.parse(await request.json()),
        ),
      );
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  },
};
