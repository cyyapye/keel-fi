import { getPriority } from "node:os";
import { inject } from "vitest";
import { snapshotSchema, type SqliteFixtureSnapshot } from "./sqlite-snapshot";

declare module "vitest" {
  interface ProvidedContext {
    keelSqliteFixtureSnapshot: SqliteFixtureSnapshot | null;
  }
}

const expectedPriority = process.env.KEEL_MAIN_VITEST_NICE;
if (expectedPriority !== undefined) {
  const actualPriority = getPriority();
  if (String(actualPriority) !== expectedPriority)
    throw new Error(
      `Main Vitest worker nice ${actualPriority}, expected ${expectedPriority}`,
    );
}

Object.defineProperty(globalThis, "keelSqliteFixtureSnapshot", {
  value: snapshotSchema.nullable().parse(inject("keelSqliteFixtureSnapshot")),
  configurable: true,
});
