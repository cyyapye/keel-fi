import { emptyD1Cost, measureD1, type D1Cost } from "./d1-meter";

// Synthetic test traces only. Billing metadata is never synthesized by SQLite.
export type SqlReplayStatement = {
  query: number;
  bindings: (string | number | null)[];
  rows: Record<string, unknown>[];
};
export type SqlReplayStep = {
  batch: boolean;
  statements: SqlReplayStatement[];
};
export type SqlReplayChunk = {
  queries: string[];
  steps: SqlReplayStep[];
  offset: number;
  measureFrom: number;
};

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
        )
      : item,
  );
}

/** Execute every operation in order, retaining atomic batches and real counters. */
export async function replaySql(database: D1Database, chunk: SqlReplayChunk) {
  const measured = measureD1(database);
  let measuredSteps = 0;
  for (const [index, step] of chunk.steps.entries()) {
    const statements = step.statements.map(({ query, bindings }) => {
      const sql = chunk.queries[query];
      if (sql === undefined) throw new Error("Unknown replay query");
      return measured.database.prepare(sql).bind(...bindings);
    });
    if (!step.batch && statements.length !== 1)
      throw new Error("Non-batch replay must contain one statement");
    const results = step.batch
      ? await measured.database.batch(statements)
      : [await statements[0]!.all()];
    if (results.length !== step.statements.length)
      throw new Error("Incomplete D1 statement results");
    for (const [statementIndex, result] of results.entries()) {
      if (
        canonical(result.results) !==
        canonical(step.statements[statementIndex]!.rows)
      )
        throw new Error(
          `D1/SQLite result mismatch at operation ${chunk.offset + index}, statement ${statementIndex}`,
        );
    }
    if (chunk.offset + index < chunk.measureFrom) measured.reset();
    else measuredSteps++;
  }
  return { ...measured.cost, replayedSteps: chunk.steps.length, measuredSteps };
}

export function addD1Cost(total: D1Cost, cost: D1Cost) {
  for (const key of Object.keys(emptyD1Cost()) as (keyof D1Cost)[]) {
    if (!Number.isSafeInteger(cost[key]) || cost[key] < 0)
      throw new Error("Invalid replay billing counters");
    total[key] += cost[key];
  }
}
