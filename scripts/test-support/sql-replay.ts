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

/** Execute every operation in order, retaining write transactions and real counters. */
export async function replaySql(database: D1Database, chunk: SqlReplayChunk) {
  const measured = measureD1(database);
  let measuredSteps = 0;
  let replayRoundTrips = 0;
  for (let index = 0; index < chunk.steps.length;) {
    const step = chunk.steps[index]!;
    const measuring = chunk.offset + index >= chunk.measureFrom;
    const readOnly = (candidate: SqlReplayStep) =>
      !candidate.batch &&
      candidate.statements.length === 1 &&
      /^SELECT\b/iu.test(
        chunk.queries[candidate.statements[0]!.query]?.trimStart() ?? "",
      );
    const grouped = [step];
    // Only adjacent standalone SELECTs may share a replay transport call.
    // No write, original transaction, or setup/measurement boundary is crossed.
    // The fixture has a single owner, so no concurrent writer can be hidden.
    if (readOnly(step)) {
      while (
        grouped.length < 100 &&
        index + grouped.length < chunk.steps.length
      ) {
        const nextIndex = index + grouped.length;
        const next = chunk.steps[nextIndex]!;
        if (
          chunk.offset + nextIndex >= chunk.measureFrom !== measuring ||
          !readOnly(next)
        )
          break;
        grouped.push(next);
      }
    }
    const expected = grouped.flatMap((entry) => entry.statements);
    const statements = expected.map(({ query, bindings }) => {
      const sql = chunk.queries[query];
      if (sql === undefined) throw new Error("Unknown replay query");
      return measured.database.prepare(sql).bind(...bindings);
    });
    if (!step.batch && step.statements.length !== 1)
      throw new Error("Non-batch replay must contain one statement");
    const results =
      step.batch || grouped.length > 1
        ? await measured.database.batch(statements)
        : [await statements[0]!.all()];
    replayRoundTrips++;
    if (results.length !== expected.length)
      throw new Error("Incomplete D1 statement results");
    for (const [statementIndex, result] of results.entries()) {
      if (
        canonical(result.results) !== canonical(expected[statementIndex]!.rows)
      )
        throw new Error(
          `D1/SQLite result mismatch at operation ${chunk.offset + index + (grouped.length > 1 ? statementIndex : 0)}, statement ${grouped.length > 1 ? 0 : statementIndex}`,
        );
    }
    if (!measuring) measured.reset();
    else measuredSteps += grouped.length;
    index += grouped.length;
  }
  return {
    ...measured.cost,
    // Production round trips come from the complete original application trace;
    // replay transport optimization must never lower that workload budget.
    roundTrips: measuredSteps,
    replayRoundTrips,
    replayedSteps: chunk.steps.length,
    measuredSteps,
  };
}

export function addD1Cost(total: D1Cost, cost: D1Cost) {
  for (const key of Object.keys(emptyD1Cost()) as (keyof D1Cost)[]) {
    if (!Number.isSafeInteger(cost[key]) || cost[key] < 0)
      throw new Error("Invalid replay billing counters");
    total[key] += cost[key];
  }
}
