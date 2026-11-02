import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Log, LogLevel, Miniflare } from "miniflare";
import { workerCapacityStore } from "../packages/database/src/d1-capacity-r2";
import {
  CAPACITY_MAX_BYTES,
  CapacityLedgerSchema,
  initialCapacityLedger,
  runCapacityWork,
  type CapacityAllowance,
} from "../packages/database/src/d1-capacity";
import { nodeCapacityStore } from "./d1-capacity-r2";

const time = Date.parse("2026-08-20T12:00:00.000Z");
const revision = "a".repeat(40);
const allowance: CapacityAllowance = {
  account: "synthetic-account",
  day: "2026-08-20",
  databases: ["synthetic-database"],
  revisions: [revision],
  inventoryHash: "b".repeat(64),
  bootstrapBasisHash: "c".repeat(64),
  priorUsageUpper: { reads: 0, writes: 0 },
  policies: [
    {
      producer: "watch-discovery",
      operation: { reads: 10, writes: 1 },
      daily: { reads: 1_000, writes: 100 },
      maxOperations: 10,
      maxDurationMs: 60_000,
      evidenceHash: "d".repeat(64),
    },
  ],
  usage: null,
};
let runtime: Miniflare;
let bucket: R2Bucket;
beforeAll(async () => {
  runtime = new Miniflare({
    modules: true,
    script:
      'export default { fetch() { return new Response("synthetic capacity test"); } }',
    compatibilityDate: "2026-07-28",
    r2Buckets: ["QUOTA"],
    log: new Log(LogLevel.NONE),
  });
  bucket = (await runtime.getR2Bucket("QUOTA")) as unknown as R2Bucket;
});
afterAll(async () => {
  await runtime?.dispose();
});

describe("capacity R2 transports", () => {
  it("uses real local R2 conditional create update and collision semantics", async () => {
    const store = workerCapacityStore(
      bucket,
      "operations/d1-capacity/synthetic-conditions.json",
    );
    const ledger = initialCapacityLedger(allowance, time);
    expect(await store.read()).toBeNull();
    expect(await store.compareAndWrite(null, ledger)).toBe("committed");
    const original = await store.read();
    expect(
      await store.compareAndWrite(null, { ...ledger, frozen: "cost_overrun" }),
    ).toBe("conflict");
    expect(
      await store.compareAndWrite(original!.version, {
        ...ledger,
        frozen: "cost_overrun",
      }),
    ).toBe("committed");
    expect(await store.compareAndWrite(original!.version, ledger)).toBe(
      "conflict",
    );
    expect((await store.read())!.value).toMatchObject({
      frozen: "cost_overrun",
    });
  });

  it("executes a duplicate once across independent clients sharing native R2", async () => {
    const key = "operations/d1-capacity/synthetic-race.json";
    await workerCapacityStore(bucket, key).compareAndWrite(
      null,
      initialCapacityLedger(allowance, time),
    );
    let executions = 0;
    const result = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        runCapacityWork(
          {
            store: workerCapacityStore(bucket, key),
            account: allowance.account,
            database: "synthetic-database",
            revision,
            producer: "watch-discovery",
            operationId: "synthetic-replayed-job",
            operationCreatedAt: new Date(time).toISOString(),
            now: () => time,
          },
          () => {
            return Promise.resolve().then(() => {
              executions++;
            });
          },
        ),
      ),
    );
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(executions).toBe(1);
    const reconnected = workerCapacityStore(bucket, key);
    expect((await reconnected.read())!.value).toMatchObject({
      charged: { reads: 10, writes: 1 },
    });
    await expect(
      runCapacityWork(
        {
          store: reconnected,
          account: allowance.account,
          database: "synthetic-database",
          revision,
          producer: "watch-discovery",
          operationId: "synthetic-replayed-job",
          operationCreatedAt: new Date(time).toISOString(),
          now: () => time,
        },
        () => {
          return Promise.resolve().then(() => {
            executions++;
          });
        },
      ),
    ).rejects.toMatchObject({ reason: "replay" });
    expect(executions).toBe(1);
  });

  it("sends S3 conditional headers and preserves opaque quoted versions", async () => {
    const calls: RequestInit[] = [];
    let status = 200;
    const store = nodeCapacityStore((_key, init = {}) => {
      return Promise.resolve().then(() => {
        calls.push(init);
        return new Response(
          init.method === "GET"
            ? JSON.stringify(initialCapacityLedger(allowance, time))
            : null,
          { status, headers: { ETag: '"synthetic-etag"' } },
        );
      });
    }, "operations/d1-capacity/synthetic-s3.json");
    const stored = await store.read();
    expect(stored?.version).toBe('"synthetic-etag"');
    expect(
      await store.compareAndWrite(null, initialCapacityLedger(allowance, time)),
    ).toBe("committed");
    expect(new Headers(calls[1]?.headers).get("If-None-Match")).toBe("*");
    status = 412;
    expect(
      await store.compareAndWrite(
        stored!.version,
        initialCapacityLedger(allowance, time),
      ),
    ).toBe("conflict");
    expect(new Headers(calls[2]?.headers).get("If-Match")).toBe(
      '"synthetic-etag"',
    );
  });

  it("refuses another operation at native R2 maximum ledger size before its callback", async () => {
    const store = workerCapacityStore(
      bucket,
      "operations/d1-capacity/synthetic-full.json",
    );
    await store.compareAndWrite(null, initialCapacityLedger(allowance, time));
    const work = {
      store,
      account: allowance.account,
      database: "synthetic-database",
      revision,
      producer: "watch-discovery" as const,
      operationId: "synthetic-first",
      operationCreatedAt: new Date(time).toISOString(),
      now: () => time,
    };
    await runCapacityWork(work, () => Promise.resolve("done"));
    const stored = await store.read();
    const ledger = CapacityLedgerSchema.parse(stored!.value);
    const template = ledger.entries[0]!;
    for (let index = 1; index < 1024; index++) {
      ledger.entries.push({
        ...template,
        id: index.toString(16).padStart(64, "0"),
      });
      ledger.charged = {
        reads: ledger.entries.length * 10,
        writes: ledger.entries.length,
      };
      ledger.producerCharges[0] = {
        producer: "watch-discovery",
        cost: ledger.charged,
        operations: ledger.entries.length,
      };
      if (
        new TextEncoder().encode(JSON.stringify(ledger)).length >
        CAPACITY_MAX_BYTES
      ) {
        ledger.entries.pop();
        ledger.charged = {
          reads: ledger.entries.length * 10,
          writes: ledger.entries.length,
        };
        ledger.producerCharges[0] = {
          producer: "watch-discovery",
          cost: ledger.charged,
          operations: ledger.entries.length,
        };
        break;
      }
    }
    ledger.allowance.policies[0]!.daily = { reads: 2_000_000, writes: 80_000 };
    ledger.allowance.policies[0]!.maxOperations = 1024;
    expect(await store.compareAndWrite(stored!.version, ledger)).toBe(
      "committed",
    );
    let executed = false;
    await expect(
      runCapacityWork(
        { ...work, operationId: "synthetic-full-rejection" },
        () => {
          executed = true;
          return Promise.resolve("done");
        },
      ),
    ).rejects.toMatchObject({ reason: "ledger_size" });
    expect(executed).toBe(false);
    const retained = await bucket.head(
      "operations/d1-capacity/synthetic-full.json",
    );
    expect(retained!.size).toBeLessThanOrEqual(CAPACITY_MAX_BYTES);
    expect(retained!.size).toBeGreaterThan(CAPACITY_MAX_BYTES - 1024);
    console.info(
      JSON.stringify({
        event: "capacity_full_ledger",
        bytes: retained!.size,
        entries: ledger.entries.length,
        limitBytes: CAPACITY_MAX_BYTES,
        storage: "native-local-R2",
      }),
    );
  });

  it("refuses absent versions oversized objects failed writes and unsafe prefixes", async () => {
    expect(() => workerCapacityStore(bucket, "backups/synthetic.json")).toThrow(
      "Invalid capacity owner key",
    );
    const noVersion = nodeCapacityStore(
      () => Promise.resolve(new Response("{}")),
      "operations/d1-capacity/synthetic-no-version.json",
    );
    await expect(noVersion.read()).rejects.toThrow("no version");
    const oversized = nodeCapacityStore(
      () =>
        Promise.resolve(
          new Response("{}", {
            headers: { ETag: "synthetic", "Content-Length": "262145" },
          }),
        ),
      "operations/d1-capacity/synthetic-oversized.json",
    );
    await expect(oversized.read()).rejects.toThrow("too large");
    const streamedOversized = nodeCapacityStore(
      () =>
        Promise.resolve(
          new Response(" ".repeat(CAPACITY_MAX_BYTES + 1), {
            headers: { ETag: '"synthetic-etag"' },
          }),
        ),
      "operations/d1-capacity/synthetic-streamed-oversized.json",
    );
    await expect(streamedOversized.read()).rejects.toThrow("too large");
    const weakVersion = nodeCapacityStore(
      () =>
        Promise.resolve(
          new Response("{}", { headers: { ETag: 'W/"synthetic"' } }),
        ),
      "operations/d1-capacity/synthetic-weak-version.json",
    );
    await expect(weakVersion.read()).rejects.toThrow("no version");
    const failed = nodeCapacityStore(() => {
      return Promise.resolve().then(() => {
        throw new Error("synthetic lost reply");
      });
    }, "operations/d1-capacity/synthetic-lost.json");
    expect(
      await failed.compareAndWrite(
        null,
        initialCapacityLedger(allowance, time),
      ),
    ).toBe("unknown");
  });
});
