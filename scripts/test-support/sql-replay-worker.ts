import { replaySql, type SqlReplayChunk } from "./sql-replay";

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    try {
      return Response.json(
        await replaySql(bindings.DB, await request.json<SqlReplayChunk>()),
      );
    } catch (error) {
      return new Response(String(error), { status: 500 });
    }
  },
};
