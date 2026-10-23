import { readdirSync } from "node:fs";
import type { StatementSync } from "node:sqlite";
import { createSqliteFixture } from "./sqlite-fixture";
import { emptyD1Cost, type D1Cost } from "./d1-meter";
import {
  addD1Cost,
  type SqlReplayStatement,
  type SqlReplayStep,
} from "./sql-replay";

/** Fast SQL behavior fixture; D1 equivalence and billing require replay(). */
export function createSqliteTrace() {
  const sqlite = createSqliteFixture([
    ...readdirSync("packages/database/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => `packages/database/migrations/${file}`),
    "packages/database/seed/synthetic.sql",
  ]);
  const prepared = new Map<string, StatementSync>();
  const changes = sqlite.prepare("SELECT total_changes() AS count");
  const queries: string[] = [];
  const queryIds = new Map<string, number>();
  const steps: SqlReplayStep[] = [];
  let roundTrips = 0;
  let measureFrom = 0;
  let failed = false;
  const result = (rows: Record<string, unknown>[]) => ({
    results: rows,
    success: true,
    get meta(): never {
      failed = true;
      throw new Error("SQL trace does not emulate D1 metadata");
    },
  });
  class Statement {
    constructor(
      readonly sql: string,
      readonly bindings: (string | number | null)[] = [],
    ) {}
    bind(...values: unknown[]) {
      if (
        values.some(
          (value) =>
            value !== null &&
            typeof value !== "string" &&
            (typeof value !== "number" || !Number.isFinite(value)),
        )
      )
        throw new Error("Unsupported trace binding");
      return new Statement(this.sql, values as (string | number | null)[]);
    }
    capture(): SqlReplayStatement {
      let query = queryIds.get(this.sql);
      if (query === undefined) {
        query = queries.length;
        queries.push(this.sql);
        queryIds.set(this.sql, query);
      }
      let statement = prepared.get(this.sql);
      if (statement === undefined) {
        statement = sqlite.prepare(this.sql);
        prepared.set(this.sql, statement);
      }
      const update = /^UPDATE\b/iu.test(this.sql.trimStart());
      const before = update ? changes.get()!.count : undefined;
      const rows = statement.all(...this.bindings);
      const zeroWrite = update && changes.get()!.count === before;
      return {
        query,
        bindings: this.bindings,
        rows,
        ...(zeroWrite ? { zeroWrite: true as const } : {}),
      };
    }
    all() {
      try {
        const statement = this.capture();
        steps.push({ batch: false, statements: [statement] });
        roundTrips++;
        return Promise.resolve(result(statement.rows));
      } catch (error) {
        failed = true;
        throw error;
      }
    }
    async first(column?: string) {
      const row = (await this.all()).results[0];
      return row === undefined
        ? null
        : column === undefined
          ? row
          : row[column];
    }
    run() {
      return this.all();
    }
  }
  const database = {
    prepare: (sql: string) => new Statement(sql),
    batch: (statements: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const captured = statements.map((statement) => statement.capture());
        sqlite.exec("COMMIT");
        steps.push({ batch: true, statements: captured });
        roundTrips++;
        return Promise.resolve(
          captured.map((statement) => result(statement.rows)),
        );
      } catch (error) {
        sqlite.exec("ROLLBACK");
        failed = true;
        throw error;
      }
    },
  } as unknown as D1Database;
  return {
    database,
    get roundTrips() {
      return roundTrips;
    },
    reset() {
      measureFrom = steps.length;
      roundTrips = 0;
    },
    close: () => sqlite.close(),
    async replay(
      dispatch: (
        body: string,
      ) => Promise<Pick<Response, "ok" | "text" | "json">>,
    ): Promise<D1Cost & { replayRoundTrips: number }> {
      if (failed)
        throw new Error("Cannot replay a trace containing failed SQL");
      const cost = emptyD1Cost();
      let replayedSteps = 0;
      let measuredSteps = 0;
      let replayRoundTrips = 0;
      // Bound bridge payloads; SQL is interned and every result is checked in D1.
      // This is transport batching only: original transaction boundaries remain.
      for (let offset = 0; offset < steps.length; offset += 500) {
        const response = await dispatch(
          JSON.stringify({
            queries,
            steps: steps.slice(offset, offset + 500),
            offset,
            measureFrom,
          }),
        );
        if (!response.ok) throw new Error(await response.text());
        const result: D1Cost & {
          replayedSteps: number;
          measuredSteps: number;
          replayRoundTrips: number;
        } = await response.json();
        addD1Cost(cost, result);
        replayedSteps += result.replayedSteps;
        measuredSteps += result.measuredSteps;
        replayRoundTrips += result.replayRoundTrips;
      }
      if (
        replayedSteps !== steps.length ||
        measuredSteps !== steps.length - measureFrom ||
        cost.roundTrips !== roundTrips ||
        !Number.isSafeInteger(replayRoundTrips) ||
        replayRoundTrips < (steps.length > 0 ? 1 : 0) ||
        replayRoundTrips > steps.length
      )
        throw new Error("Incomplete D1 replay");
      return { ...cost, replayRoundTrips };
    },
  };
}
