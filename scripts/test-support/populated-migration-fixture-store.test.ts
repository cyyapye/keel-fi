import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { expect, it, vi } from "vitest";
import type * as MigrationSafety from "../d1-migration-safety";
import {
  POPULATED_FIXTURE_BYTE_LIMIT,
  PopulatedFixtureFrontierSchema,
  prepareExpectedFixtureStore,
  readExpectedFixtureStore,
} from "./populated-migration-fixture-store";
import { populatedMigrationFixtures } from "./populated-migration";

const source = vi.hoisted(() => ({ digest: "a".repeat(64) }));
vi.mock("../d1-migration-safety", async (importOriginal) => ({
  ...(await importOriginal<typeof MigrationSafety>()),
  migrationSourceDigest: () => source.digest,
}));

it("rejects stale, changed, unowned and incomplete expected migration inputs before D1 proof", async () => {
  const roots: string[] = [];
  const directory = () => {
    const root = mkdtempSync(join(tmpdir(), "keel-expected-fixtures-"));
    roots.push(root);
    return root;
  };
  const rows = Array.from({ length: 120 }, (_, index) => [
    `synthetic-${index}`,
    index,
  ]);
  const fixture = (history: 12 | 24, frontier: string, values = rows) => ({
    frontier,
    history,
    mainPositions: 120,
    unrelatedPositions: 120,
    tables: [
      {
        name: "synthetic_rows",
        columns: ["id", "value"],
        rows: values,
        sha256: createHash("sha256")
          .update(JSON.stringify(values))
          .digest("hex"),
      },
    ],
    triggers: [],
    objects: [],
    foreignKeys: [],
    counts: { synthetic_rows: values.length },
    hash: "synthetic-fixture",
  });
  const bundle = (history: 12 | 24) =>
    JSON.stringify(
      Object.fromEntries(
        PopulatedFixtureFrontierSchema.options.map((frontier) => [
          frontier,
          brotliCompressSync(
            JSON.stringify(fixture(history, frontier)),
          ).toString("base64"),
        ]),
      ),
    );
  try {
    const root = directory();
    const generated: number[] = [];
    await prepareExpectedFixtureStore(root, (history) => {
      generated.push(history);
      return Promise.resolve(bundle(history));
    });
    expect(generated).toEqual([12, 24]);
    vi.stubEnv("KEEL_TEST_POPULATED_MIGRATION_FIXTURES", root);
    expect(await populatedMigrationFixtures("0092")(12, "0092")).toEqual(
      fixture(12, "0092"),
    );
    await expect(
      populatedMigrationFixtures("0092")(24, "0093"),
    ).rejects.toThrow("outside the selected fixture");
    const manifestPath = join(root, "manifest.json");
    const manifest = readFileSync(manifestPath);
    const bodyPath = join(root, "12.json");
    const body = readFileSync(bodyPath);
    source.digest = "b".repeat(64);
    expect(() => readExpectedFixtureStore(root, 12)).toThrow("stale");
    source.digest = "a".repeat(64);
    const changedRuntime = JSON.parse(manifest.toString("utf8")) as {
      input: { runtime: { node: string } };
    };
    changedRuntime.input.runtime.node = "synthetic-other-runtime";
    writeFileSync(manifestPath, JSON.stringify(changedRuntime));
    expect(() => readExpectedFixtureStore(root, 12)).toThrow("stale");
    writeFileSync(manifestPath, manifest);
    writeFileSync(bodyPath, Buffer.concat([body, Buffer.from(" ")]));
    expect(() => readExpectedFixtureStore(root, 12)).toThrow("bundle changed");
    writeFileSync(bodyPath, body);
    chmodSync(bodyPath, 0o644);
    expect(() => readExpectedFixtureStore(root, 12)).toThrow("unowned");
    chmodSync(bodyPath, 0o600);
    const linked = join(directory(), "synthetic.json");
    writeFileSync(linked, body, { mode: 0o600 });
    unlinkSync(bodyPath);
    symlinkSync(linked, bodyPath);
    expect(() => readExpectedFixtureStore(root, 12)).toThrow();
    unlinkSync(bodyPath);
    writeFileSync(bodyPath, body, { mode: 0o600 });
    truncateSync(bodyPath, POPULATED_FIXTURE_BYTE_LIMIT + 1);
    expect(() => readExpectedFixtureStore(root, 12)).toThrow(
      "exceeds its bound",
    );
    writeFileSync(bodyPath, body);
    unlinkSync(join(root, "24.json"));
    expect(() => readExpectedFixtureStore(root, 12)).toThrow("incomplete");
    vi.stubEnv("KEEL_TEST_POPULATED_MIGRATION_FIXTURES", directory());
    await expect(populatedMigrationFixtures()(12, "0088")).rejects.toThrow(
      "incomplete",
    );

    const drifting = directory();
    await expect(
      prepareExpectedFixtureStore(drifting, (history) => {
        if (history === 24) source.digest = "b".repeat(64);
        return Promise.resolve(bundle(history));
      }),
    ).rejects.toThrow("sources changed");
    expect(existsSync(join(drifting, "manifest.json"))).toBe(false);
    source.digest = "a".repeat(64);

    const incomplete = directory();
    await expect(
      prepareExpectedFixtureStore(incomplete, () => Promise.resolve("{}")),
    ).rejects.toThrow();
    expect(existsSync(join(incomplete, "manifest.json"))).toBe(false);

    const inflated = directory();
    await prepareExpectedFixtureStore(inflated, (history) => {
      const packed = JSON.parse(bundle(history)) as Record<string, string>;
      packed["0088"] = brotliCompressSync(
        JSON.stringify(
          fixture(history, "0088", [
            ["synthetic", "x".repeat(POPULATED_FIXTURE_BYTE_LIMIT)],
          ]),
        ),
        { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } },
      ).toString("base64");
      return Promise.resolve(JSON.stringify(packed));
    });
    vi.stubEnv("KEEL_TEST_POPULATED_MIGRATION_FIXTURES", inflated);
    await expect(populatedMigrationFixtures()(12, "0088")).rejects.toThrow();
  } finally {
    source.digest = "a".repeat(64);
    vi.unstubAllEnvs();
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
