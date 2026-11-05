import { inject } from "vitest";
import { snapshotSchema, type SqliteFixtureSnapshot } from "./sqlite-snapshot";

declare module "vitest" {
  interface ProvidedContext {
    keelSqliteFixtureSnapshot: SqliteFixtureSnapshot | null;
  }
}

Object.defineProperty(globalThis, "keelSqliteFixtureSnapshot", {
  value: snapshotSchema.nullable().parse(inject("keelSqliteFixtureSnapshot")),
  configurable: true,
});
