export type D1Cost = {
  roundTrips: number;
  statements: number;
  rowsRead: number;
  rowsWritten: number;
};

export function emptyD1Cost(): D1Cost {
  return { roundTrips: 0, statements: 0, rowsRead: 0, rowsWritten: 0 };
}

/** Real workerd counters, including scans and index writes; never row counts. */
export function measureD1(database: D1Database) {
  const cost = emptyD1Cost();
  const queries = new Set<string>();
  const byQuery = new Map<
    string,
    { calls: number; rowsRead: number; rowsWritten: number }
  >();
  const record = (results: D1Result[], sql: string[]) => {
    cost.roundTrips++;
    for (const [index, result] of results.entries()) {
      if (
        !Number.isSafeInteger(result.meta.rows_read) ||
        !Number.isSafeInteger(result.meta.rows_written)
      ) {
        throw new Error(
          "D1 cost metadata is missing; refusing an unmeasured pass.",
        );
      }
      const query = sql[index]!;
      const entry = byQuery.get(query) ?? {
        calls: 0,
        rowsRead: 0,
        rowsWritten: 0,
      };
      entry.calls++;
      entry.rowsRead += result.meta.rows_read;
      entry.rowsWritten += result.meta.rows_written;
      byQuery.set(query, entry);
      cost.statements++;
      cost.rowsRead += result.meta.rows_read;
      cost.rowsWritten += result.meta.rows_written;
    }
  };
  const statements = new WeakMap<
    object,
    { statement: D1PreparedStatement; sql: string }
  >();
  const wrap = (
    statement: D1PreparedStatement,
    sql: string,
  ): D1PreparedStatement => {
    const wrapped = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      all: async <T>() => {
        const result = await statement.all<T>();
        record([result], [sql]);
        return result;
      },
      first: async <T>(column?: string): Promise<T | null> => {
        const result = await statement.all<Record<string, unknown>>();
        record([result], [sql]);
        const row = result.results[0];
        return row === undefined
          ? null
          : ((column === undefined ? row : row[column]) as T);
      },
      run: async <T>() => {
        const result = await statement.run<T>();
        record([result], [sql]);
        return result;
      },
      raw: () => {
        throw new Error("Unmeasured raw D1 operation");
      },
    } as D1PreparedStatement;
    statements.set(wrapped, { statement, sql });
    return wrapped;
  };
  const measured = {
    prepare: (sql: string) => {
      queries.add(sql);
      return wrap(database.prepare(sql), sql);
    },
    batch: async (batch: D1PreparedStatement[]) => {
      const result = await database.batch(
        batch.map((statement) => {
          const underlying = statements.get(statement);
          if (underlying === undefined)
            throw new Error("Unmeasured D1 statement");
          return underlying.statement;
        }),
      );
      record(
        result,
        batch.map((statement) => statements.get(statement)!.sql),
      );
      return result;
    },
  } as D1Database;
  return {
    database: measured,
    cost,
    queries,
    byQuery,
    reset: () => {
      byQuery.clear();
      Object.assign(cost, emptyD1Cost());
    },
  };
}
