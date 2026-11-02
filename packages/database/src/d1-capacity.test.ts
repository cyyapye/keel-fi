import { describe, expect, it, vi } from "vitest";
import {
  CAPACITY_MAX_BYTES,
  CAPACITY_MAX_ENTRIES,
  CapacityLedgerSchema,
  CapacityUnavailableError,
  initialCapacityLedger,
  initializeCapacityOwner,
  publishCapacityUsage,
  rollCapacityDay,
  runCapacityWork,
  type CapacityAllowance,
  type CapacityLedger,
  type CapacityStore,
} from "./d1-capacity";

const time = Date.parse("2026-08-20T12:00:00.000Z");
const revision = "a".repeat(40);
const evidenceHash = "b".repeat(64);
function allowance(day = "2026-08-20"): CapacityAllowance {
  return {
    day,
    account: "synthetic-account",
    databases: ["synthetic-database"],
    revisions: [revision],
    inventoryHash: "c".repeat(64),
    bootstrapBasisHash: "d".repeat(64),
    priorUsageUpper: { reads: 0, writes: 0 },
    policies: [
      "watch-discovery",
      "plaid-consumer",
      "release",
      "daily-backup",
    ].map((producer) => ({
      producer: producer as
        "watch-discovery" | "plaid-consumer" | "release" | "daily-backup",
      operation: { reads: 100, writes: 10 },
      daily: { reads: 2_000_000, writes: 80_000 },
      maxOperations:
        producer === "release" ? 2 : producer === "daily-backup" ? 1 : 4000,
      maxDurationMs: 60_000,
      evidenceHash,
    })),
    usage: {
      account: "synthetic-account",
      day,
      observedAt: `${day}T12:00:00.000Z`,
      coveredThrough: `${day}T12:00:00.000Z`,
      upper: { reads: 0, writes: 0 },
      complete: true,
      basisHash: "e".repeat(64),
    },
  };
}
class MemoryStore implements CapacityStore {
  version = 0;
  reads = 0;
  writes = 0;
  value: CapacityLedger | null;
  constructor(
    value: CapacityLedger | null = initialCapacityLedger(allowance(), time),
  ) {
    this.value = value;
  }
  read() {
    return Promise.resolve().then(() => {
      this.reads++;
      return this.value === null
        ? null
        : { version: String(this.version), value: structuredClone(this.value) };
    });
  }
  compareAndWrite(
    expected: string | null,
    value: CapacityLedger,
  ): ReturnType<CapacityStore["compareAndWrite"]> {
    return Promise.resolve().then(() => {
      this.writes++;
      if ((this.value === null ? null : String(this.version)) !== expected)
        return "conflict" as const;
      this.value = structuredClone(value);
      this.version++;
      return "committed" as const;
    });
  }
}
class JsonStore implements CapacityStore {
  version = 0;
  reads = 0;
  writes = 0;
  private body = JSON.stringify(initialCapacityLedger(allowance(), time));
  get value() {
    return CapacityLedgerSchema.parse(JSON.parse(this.body));
  }
  read() {
    this.reads++;
    return Promise.resolve({
      version: String(this.version),
      value: JSON.parse(this.body) as unknown,
    });
  }
  compareAndWrite(
    expected: string | null,
    value: CapacityLedger,
  ): ReturnType<CapacityStore["compareAndWrite"]> {
    this.writes++;
    if (String(this.version) !== expected)
      return Promise.resolve("conflict" as const);
    this.body = JSON.stringify(value);
    this.version++;
    return Promise.resolve("committed" as const);
  }
}
const options = (
  store: CapacityStore,
  operationId = "synthetic-operation",
) => ({
  store,
  account: "synthetic-account",
  database: "synthetic-database",
  revision,
  producer: "watch-discovery" as const,
  operationId,
  operationCreatedAt: new Date(time).toISOString(),
  now: () => time,
});

describe("shared D1 capacity owner", () => {
  it("charges full upper bounds before work and never refunds successful work", async () => {
    const store = new MemoryStore();
    const result = await runCapacityWork(options(store), (scope) => {
      return Promise.resolve().then(() => {
        expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
        scope.record({ reads: 5, writes: 1 });
        return "done";
      });
    });
    expect(result).toBe("done");
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
    expect(store.value?.entries[0]).toMatchObject({
      state: "completed",
      actual: { reads: 5, writes: 1 },
    });
    expect(JSON.stringify(store.value)).not.toContain("synthetic-operation");
  });

  it("serializes competing producers against shared reads and protected writes", async () => {
    const store = new MemoryStore();
    store.value!.allowance.priorUsageUpper = {
      reads: 1_999_800,
      writes: 79_980,
    };
    const execute = vi.fn(() => Promise.resolve("done"));
    const result = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        runCapacityWork(
          {
            ...options(store, `synthetic-race-${index}`),
            producer: index % 2 ? "watch-discovery" : "plaid-consumer",
          },
          execute,
        ),
      ),
    );
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      2,
    );
    expect(execute).toHaveBeenCalledTimes(2);
    expect(store.value?.charged).toEqual({ reads: 200, writes: 20 });
  });

  it("permits one executor for concurrent and changed-content duplicates", async () => {
    const store = new MemoryStore();
    const execute = vi.fn(() => Promise.resolve("done"));
    const result = await Promise.allSettled(
      Array.from({ length: 8 }, () => runCapacityWork(options(store), execute)),
    );
    expect(result.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    store.value!.allowance.revisions.push("f".repeat(40));
    await expect(
      runCapacityWork({ ...options(store), revision: "f".repeat(40) }, execute),
    ).rejects.toMatchObject({ reason: "replay" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("confirms a committed admission after a lost conditional-write response", async () => {
    const store = new MemoryStore();
    const write = store.compareAndWrite.bind(store);
    store.compareAndWrite = vi.fn(async (expected, value) => {
      const result = await write(expected, value);
      return store.writes === 1 ? "unknown" : result;
    });
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(runCapacityWork(options(store), execute)).resolves.toBe(
      "done",
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
  });

  it("does not execute an unconfirmed admission or refund failed work", async () => {
    const store = new MemoryStore();
    store.compareAndWrite = vi.fn(() => Promise.resolve("unknown" as const));
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(options(store), execute),
    ).rejects.toMatchObject({ outcome: "unknown" });
    expect(execute).not.toHaveBeenCalled();
    const failed = new MemoryStore();
    await expect(
      runCapacityWork(options(failed), () => {
        return Promise.resolve().then(() => {
          throw new Error("synthetic lost D1 response");
        });
      }),
    ).rejects.toThrow("synthetic lost D1 response");
    expect(failed.value?.charged).toEqual({ reads: 100, writes: 10 });
    expect(failed.value?.entries[0]?.state).toBe("unknown");
    await expect(
      runCapacityWork(options(failed), execute),
    ).rejects.toMatchObject({ reason: "replay" });
  });

  it("retains an uncertain settlement and never replays its callback", async () => {
    const store = new MemoryStore();
    const write = store.compareAndWrite.bind(store);
    const conditionalWrite = vi.fn(
      async (expected: string | null, value: CapacityLedger) =>
        store.writes > 0 ? "unknown" : write(expected, value),
    );
    store.compareAndWrite = conditionalWrite;
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(options(store), execute),
    ).rejects.toMatchObject({
      reason: "settlement_unknown",
      outcome: "unknown",
    });
    expect(conditionalWrite).toHaveBeenCalledTimes(2);
    await expect(
      runCapacityWork(options(store), execute),
    ).rejects.toMatchObject({ reason: "replay" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
    const mutating = new MemoryStore();
    const persist = mutating.compareAndWrite.bind(mutating);
    mutating.compareAndWrite = async (expected, value) => {
      const settlement = mutating.writes > 0;
      if (settlement) value.entries[0]!.actual = { reads: 6, writes: 1 };
      const result = await persist(expected, value);
      return settlement ? "unknown" : result;
    };
    let executed = 0;
    await expect(
      runCapacityWork(options(mutating), (scope) => {
        executed++;
        scope.record({ reads: 5, writes: 1 });
        return Promise.resolve("done");
      }),
    ).rejects.toMatchObject({
      reason: "settlement_unknown",
      outcome: "unknown",
    });
    expect(executed).toBe(1);
    expect(mutating.writes).toBe(2);
    expect(mutating.value?.charged).toEqual({ reads: 100, writes: 10 });
    await expect(
      runCapacityWork(options(mutating), execute),
    ).rejects.toMatchObject({ reason: "replay" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("fails before work for missing corrupt stale unknown or mismatched evidence", async () => {
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(options(new MemoryStore(null)), execute),
    ).rejects.toMatchObject({ reason: "owner_missing" });
    const corrupt: CapacityStore = {
      read: () => Promise.resolve({ version: "1", value: {} }),
      compareAndWrite: () => Promise.resolve("committed"),
    };
    await expect(
      runCapacityWork(options(corrupt), execute),
    ).rejects.toMatchObject({ reason: "owner_unavailable" });
    for (const change of [
      (ledger: CapacityLedger) => {
        ledger.allowance.usage = null;
      },
      (ledger: CapacityLedger) => {
        ledger.allowance.usage!.coveredThrough = "2026-08-20T11:54:59.999Z";
      },
      (ledger: CapacityLedger) => {
        ledger.allowance.usage!.account = "synthetic-other-account";
      },
      (ledger: CapacityLedger) => {
        ledger.allowance.day = "2026-08-19";
      },
      (ledger: CapacityLedger) => {
        ledger.allowance.revisions = ["f".repeat(40)];
      },
      (ledger: CapacityLedger) => {
        ledger.allowance.policies.find(
          (policy) => policy.producer === "release",
        )!.evidenceHash = "f".repeat(64);
      },
    ]) {
      const store = new MemoryStore();
      change(store.value!);
      await expect(
        runCapacityWork(
          { ...options(store), producer: "release", evidenceHash },
          execute,
        ),
      ).rejects.toBeInstanceOf(CapacityUnavailableError);
      expect(store.writes).toBe(0);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("freezes future admission on cost overruns and unknown runtime metadata", async () => {
    for (const record of [
      (scope: { record: (cost: { reads: number; writes: number }) => void }) =>
        scope.record({ reads: 101, writes: 0 }),
      (scope: { recordUnknown: () => void }) => scope.recordUnknown(),
    ]) {
      const store = new MemoryStore();
      await expect(
        runCapacityWork(options(store), (scope) => {
          return Promise.resolve().then(() => {
            record(scope);
          });
        }),
      ).rejects.toBeInstanceOf(CapacityUnavailableError);
      expect(store.value?.frozen).toMatch(/cost_overrun|unknown_metadata/u);
      await expect(
        runCapacityWork(options(store, "synthetic-next"), () =>
          Promise.resolve("done"),
        ),
      ).rejects.toBeInstanceOf(CapacityUnavailableError);
      expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
    }
  });

  it("reports uncertified external counters as unknown without inventing zero actuals", async () => {
    const store = new MemoryStore();
    await runCapacityWork(
      { ...options(store), producer: "release", evidenceHash },
      (scope) => {
        return Promise.resolve().then(() => {
          scope.recordUnknown();
        });
      },
    );
    expect(store.value?.entries[0]).toMatchObject({
      state: "completed",
      actual: null,
    });
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
  });

  it("requires maintenance charges to cover the exact plan minimum before work", async () => {
    const store = new MemoryStore();
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(
        {
          ...options(store),
          producer: "release",
          evidenceHash,
          minimumCost: { reads: 101, writes: 10 },
        },
        execute,
      ),
    ).rejects.toMatchObject({
      reason: "cost_evidence",
      outcome: "not_started",
    });
    await expect(
      runCapacityWork(
        { ...options(store), minimumCost: { reads: 0, writes: 0 } },
        execute,
      ),
    ).rejects.toMatchObject({ reason: "cost_evidence" });
    expect(execute).not.toHaveBeenCalled();
    expect(store.writes).toBe(0);
    await runCapacityWork(
      {
        ...options(store),
        producer: "release",
        evidenceHash,
        minimumCost: { reads: 100, writes: 10 },
      },
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
  });

  it("publishes fresh conservative usage without topping up or regressing capacity", async () => {
    const store = new MemoryStore();
    await runCapacityWork(options(store), () => Promise.resolve("done"));
    const usage = {
      ...allowance().usage!,
      coveredThrough: "2026-08-20T12:01:00.000Z",
      observedAt: "2026-08-20T12:01:00.000Z",
      upper: { reads: 1000, writes: 100 },
    };
    await publishCapacityUsage(store, usage, time + 60_000);
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
    expect(store.value?.allowance.usage?.upper).toEqual({
      reads: 1000,
      writes: 100,
    });
    await expect(
      publishCapacityUsage(
        store,
        { ...usage, upper: { reads: 999, writes: 100 } },
        time + 60_000,
      ),
    ).rejects.toMatchObject({ reason: "usage_regression" });
    await expect(
      publishCapacityUsage(
        store,
        { ...usage, account: "synthetic-other" },
        time + 60_000,
      ),
    ).rejects.toMatchObject({ reason: "usage_identity" });
    await publishCapacityUsage(
      store,
      { ...usage, upper: { reads: 2_000_000, writes: 80_000 } },
      time + 60_000,
    );
    await expect(
      runCapacityWork(options(store, "synthetic-observed-cap"), () =>
        Promise.resolve("done"),
      ),
    ).rejects.toMatchObject({ reason: "capacity" });
  });

  it("bounds a full virtual day of minute attempts without claiming unchanged freshness", async () => {
    const store = new JsonStore();
    let completed = 0;
    for (let minute = 0; minute < 1440; minute++) {
      try {
        await runCapacityWork(
          {
            ...options(store, `synthetic-minute-${minute}`),
            operationCreatedAt: new Date(
              Date.parse("2026-08-20T00:00:00.000Z") + minute * 60_000,
            ).toISOString(),
            now: () => Date.parse("2026-08-20T00:00:00.000Z") + minute * 60_000,
          },
          () => Promise.resolve("done"),
        );
        completed++;
      } catch (error) {
        expect(error).toBeInstanceOf(CapacityUnavailableError);
      }
    }
    expect(completed).toBeGreaterThan(120);
    expect(completed).toBe(1440);
    expect(store.reads).toBe(1440 + completed);
    expect(store.writes).toBe(2 * completed);
    expect(
      new TextEncoder().encode(JSON.stringify(store.value)).length,
    ).toBeLessThanOrEqual(CAPACITY_MAX_BYTES);
    expect(store.value?.charged).toEqual({
      reads: completed * 100,
      writes: completed * 10,
    });
    expect(store.value?.entries).toHaveLength(45);
    console.info(
      JSON.stringify({
        event: "capacity_virtual_day",
        attempts: 1440,
        admitted: completed,
        reads: store.reads,
        writes: store.writes,
        ledgerBytes: new TextEncoder().encode(JSON.stringify(store.value))
          .length,
        storage: "simulated-CAS",
      }),
    );
  });

  it("compacts expired completed entries atomically without refunds or executable old requests", async () => {
    const store = new MemoryStore();
    const execute = vi.fn(() => Promise.resolve("done"));
    await runCapacityWork(options(store), execute);
    const later = time + 46 * 60_000;
    const fresh = {
      operationCreatedAt: new Date(later).toISOString(),
      now: () => later,
    };
    const results = await Promise.allSettled(
      ["synthetic-new-a", "synthetic-new-b"].map((id) =>
        runCapacityWork({ ...options(store, id), ...fresh }, execute),
      ),
    );
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(store.value?.entries).toHaveLength(2);
    expect(
      store.value?.entries.every(
        (entry) => entry.operationCreatedAt === fresh.operationCreatedAt,
      ),
    ).toBe(true);
    expect(store.value?.charged).toEqual({ reads: 300, writes: 30 });
    expect(store.value?.producerCharges[0]?.operations).toBe(3);
    await expect(
      runCapacityWork({ ...options(store), now: () => later }, execute),
    ).rejects.toMatchObject({
      reason: "request_expired",
      outcome: "not_started",
    });
    await expect(
      runCapacityWork(
        {
          ...options(store, "synthetic-future"),
          operationCreatedAt: new Date(later + 1).toISOString(),
          now: () => later,
        },
        execute,
      ),
    ).rejects.toMatchObject({ reason: "request_expired" });
    expect(execute).toHaveBeenCalledTimes(3);
    await runCapacityWork({ ...options(store), ...fresh }, execute);
    expect(execute).toHaveBeenCalledTimes(4);
    expect(store.value?.charged).toEqual({ reads: 400, writes: 40 });
  });

  it("retains unknown liabilities through compaction and refuses automatic maintenance replay", async () => {
    const store = new MemoryStore();
    await expect(
      runCapacityWork(
        { ...options(store), producer: "release", evidenceHash },
        () => Promise.reject(new Error("synthetic unknown export")),
      ),
    ).rejects.toThrow("synthetic unknown export");
    const later = time + 46 * 60_000;
    const fresh = {
      operationCreatedAt: new Date(later).toISOString(),
      now: () => later,
    };
    await runCapacityWork(
      { ...options(store, "synthetic-new-runtime"), ...fresh },
      () => Promise.resolve("done"),
    );
    expect(store.value?.entries).toHaveLength(2);
    expect(store.value?.entries[0]?.state).toBe("unknown");
    const execute = vi.fn(() => Promise.resolve("done"));
    const writes = store.writes;
    await expect(
      runCapacityWork(
        {
          ...options(store, "synthetic-next-maintenance-attempt"),
          ...fresh,
          producer: "daily-backup",
          evidenceHash,
        },
        execute,
      ),
    ).rejects.toMatchObject({
      reason: "maintenance_reconciliation_required",
      outcome: "not_started",
    });
    expect(execute).not.toHaveBeenCalled();
    expect(store.writes).toBe(writes);
    expect(store.value?.charged).toEqual({ reads: 200, writes: 20 });
  });

  it("blocks another maintenance owner while a prior command may still be running", async () => {
    const store = new MemoryStore();
    let complete!: () => void;
    let announce!: () => void;
    const held = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const started = new Promise<void>((resolve) => {
      announce = resolve;
    });
    const running = runCapacityWork(
      { ...options(store), producer: "release", evidenceHash },
      () => {
        announce();
        return held;
      },
    );
    await started;
    const execute = vi.fn(() => Promise.resolve("done"));
    try {
      await expect(
        runCapacityWork(
          {
            ...options(store, "synthetic-overlapping-backup"),
            producer: "daily-backup",
            evidenceHash,
          },
          execute,
        ),
      ).rejects.toMatchObject({
        reason: "maintenance_reconciliation_required",
      });
      expect(execute).not.toHaveBeenCalled();
    } finally {
      complete();
      await running;
    }
    await runCapacityWork(
      {
        ...options(store, "synthetic-later-backup"),
        producer: "daily-backup",
        evidenceHash,
      },
      execute,
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(store.value?.charged).toEqual({ reads: 200, writes: 20 });
  });

  it("enforces account admission counts independently of retained entries and row costs", async () => {
    const store = new MemoryStore();
    store.value!.producerCharges = [
      {
        producer: "watch-discovery",
        cost: { reads: 0, writes: 0 },
        operations: 4000,
      },
    ];
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(options(store), execute),
    ).rejects.toMatchObject({ reason: "capacity" });
    expect(execute).not.toHaveBeenCalled();
    expect(store.writes).toBe(0);
  });

  it("fences stage retries deadlines and midnight without invoking denied commands", async () => {
    const store = new MemoryStore();
    const command = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(
        { ...options(store), producer: "release", evidenceHash },
        async (scope) => {
          await scope.stage("export", command);
          await scope.stage("export", command);
        },
      ),
    ).rejects.toMatchObject({ reason: "stage_replay" });
    expect(command).toHaveBeenCalledTimes(1);
    let clock = time;
    await expect(
      runCapacityWork(
        {
          ...options(new MemoryStore(), "synthetic-expiry"),
          producer: "release",
          evidenceHash,
          now: () => clock,
        },
        async (scope) => {
          clock += 60_000;
          await scope.stage("migration", command);
        },
      ),
    ).rejects.toMatchObject({ reason: "expired", outcome: "unknown" });
    expect(command).toHaveBeenCalledTimes(1);
    await expect(
      runCapacityWork(
        {
          ...options(store, "synthetic-midnight"),
          operationCreatedAt: "2026-08-20T23:59:30.000Z",
          now: () => Date.parse("2026-08-20T23:59:30.000Z"),
        },
        command,
      ),
    ).rejects.toMatchObject({ reason: "day_deadline" });
    const mutating = new MemoryStore();
    const persist = mutating.compareAndWrite.bind(mutating);
    mutating.compareAndWrite = async (expected, value) => {
      const result = await persist(expected, value);
      value.entries[0]!.deadline = new Date(time + 120_000).toISOString();
      return result;
    };
    clock = time;
    await expect(
      runCapacityWork(
        {
          ...options(mutating, "synthetic-mutated-deadline"),
          now: () => clock,
        },
        (scope) => {
          clock += 60_001;
          scope.check();
          return Promise.resolve("done");
        },
      ),
    ).rejects.toMatchObject({ reason: "expired", outcome: "unknown" });
    expect(mutating.value?.charged).toEqual({ reads: 100, writes: 10 });
    const jumpStore = new MemoryStore();
    clock = time;
    const jump = vi.fn(() => {
      clock = Date.parse("+010000-01-01T00:00:00.000Z");
      return Promise.resolve("done");
    });
    await expect(
      runCapacityWork(
        { ...options(jumpStore, "synthetic-clock-jump"), now: () => clock },
        jump,
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(jump).toHaveBeenCalledTimes(1);
    expect(jumpStore.writes).toBe(1);
    expect(jumpStore.value?.entries[0]).toMatchObject({
      state: "running",
      completedAt: null,
    });
    expect(jumpStore.value?.charged).toEqual({ reads: 100, writes: 10 });
  });

  it("requires explicit conditional bootstrap and carries unresolved midnight liabilities", async () => {
    const store = new MemoryStore(null);
    await initializeCapacityOwner(store, allowance(), time);
    await expect(
      initializeCapacityOwner(store, allowance(), time),
    ).rejects.toMatchObject({ reason: "owner_exists" });
    await runCapacityWork(options(store, "synthetic-complete"), () =>
      Promise.resolve("done"),
    );
    await expect(
      runCapacityWork(options(store, "synthetic-unknown"), () => {
        return Promise.resolve().then(() => {
          throw new Error("uncertain");
        });
      }),
    ).rejects.toThrow("uncertain");
    const tomorrow = Date.parse("2026-08-21T12:00:00.000Z");
    await expect(
      runCapacityWork(
        {
          ...options(store, "synthetic-no-rollover"),
          operationCreatedAt: new Date(tomorrow).toISOString(),
          now: () => tomorrow,
        },
        () => Promise.resolve("done"),
      ),
    ).rejects.toMatchObject({ reason: "day" });
    await rollCapacityDay(store, allowance("2026-08-21"), tomorrow);
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
    expect(store.value?.entries).toHaveLength(1);
    await expect(
      runCapacityWork(
        { ...options(store, "synthetic-complete"), now: () => tomorrow },
        () => Promise.resolve("done"),
      ),
    ).rejects.toMatchObject({ reason: "request_expired" });
  });

  it("carries work when rollover races completion or an old admission", async () => {
    const store = new MemoryStore();
    let clock = time;
    await runCapacityWork({ ...options(store), now: () => clock }, async () => {
      clock = Date.parse("2026-08-21T12:00:00.000Z");
      await rollCapacityDay(store, allowance("2026-08-21"), clock);
    });
    expect(store.value?.charged).toEqual({ reads: 100, writes: 10 });
    await rollCapacityDay(
      store,
      allowance("2026-08-22"),
      Date.parse("2026-08-22T12:00:00.000Z"),
    );
    expect(store.value?.charged).toEqual({ reads: 0, writes: 0 });
    const stale = new MemoryStore();
    const write = stale.compareAndWrite.bind(stale);
    let rolled = false;
    stale.compareAndWrite = async (expected, value) => {
      if (!rolled && value.entries.length === 1) {
        rolled = true;
        stale.value = initialCapacityLedger(
          allowance("2026-08-21"),
          Date.parse("2026-08-21T12:00:00.000Z"),
        );
        stale.version++;
      }
      return write(expected, value);
    };
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(options(stale), execute),
    ).rejects.toMatchObject({ reason: "day" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("bounds ledger bytes entries CAS retries and complete virtual-day object work", async () => {
    const store = new MemoryStore();
    for (let index = 0; index < 120; index++)
      await runCapacityWork(options(store, `synthetic-day-${index}`), () =>
        Promise.resolve("done"),
      );
    expect(store.reads).toBe(240);
    expect(store.writes).toBe(240);
    expect(store.value?.charged).toEqual({ reads: 12_000, writes: 1_200 });
    const template = store.value!.entries[0]!;
    store.value!.entries = Array.from(
      { length: CAPACITY_MAX_ENTRIES },
      (_, index) => ({ ...template, id: index.toString(16).padStart(64, "0") }),
    );
    const bytes = new TextEncoder().encode(JSON.stringify(store.value)).length;
    expect(bytes).toBeGreaterThan(CAPACITY_MAX_BYTES);
    const execute = vi.fn(() => Promise.resolve("done"));
    await expect(
      runCapacityWork(options(store, "synthetic-full"), execute),
    ).rejects.toMatchObject({ reason: "ledger_size" });
    expect(execute).not.toHaveBeenCalled();
    const contention = new MemoryStore();
    const conflict = vi.fn(() => Promise.resolve("conflict" as const));
    contention.compareAndWrite = conflict;
    await expect(
      runCapacityWork(options(contention), execute),
    ).rejects.toMatchObject({ reason: "contention" });
    expect(conflict).toHaveBeenCalledTimes(3);
  });
});
