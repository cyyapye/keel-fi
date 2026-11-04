import { fstatSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import type { TestProject } from "vitest/node";
import { withFixtureImage } from "./sqlite-fixture";
import {
  fixtureDigest,
  fixtureSourceKey,
  maxImageBytes,
  maxPackedBytes,
  type SqliteFixtureSnapshot,
} from "./sqlite-snapshot";

export function prepareFixtureSnapshot(
  directory: string,
  files: readonly string[],
): SqliteFixtureSnapshot | null {
  const owner = lstatSync(directory);
  if (
    !owner.isDirectory() ||
    (owner.mode & 0o777) !== 0o700 ||
    owner.uid !== process.getuid?.()
  ) {
    throw new Error(
      "SQLite snapshot needs the native phase's private directory",
    );
  }
  const sources = files.map((file) => readFileSync(file));
  const image = withFixtureImage(directory, sources, (fd) =>
    fstatSync(fd).size > maxImageBytes ? null : readFileSync(fd),
  );
  if (!image) return null;
  const packed = deflateSync(image);
  if (packed.length > maxPackedBytes) return null;
  return {
    keys: [
      fixtureSourceKey(files, sources),
      fixtureSourceKey(
        files.map((file) => resolve(file)),
        sources,
      ),
    ],
    bytes: image.length,
    sha256: fixtureDigest(image),
    packed: packed.toString("base64"),
  };
}

export default function setup(project: TestProject) {
  const directory = process.env.KEEL_TEST_SQLITE_SNAPSHOT_ROOT;
  if (!directory) throw new Error("Missing native SQLite snapshot owner");
  const migrations = "packages/database/migrations";
  const files = readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => join(migrations, name));
  files.push("packages/database/seed/synthetic.sql");
  project.provide(
    "keelSqliteFixtureSnapshot",
    prepareFixtureSnapshot(directory, files),
  );
}
