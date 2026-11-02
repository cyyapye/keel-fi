import { z } from "zod";

const CountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CapacityCostSchema = z
  .object({ reads: CountSchema, writes: CountSchema })
  .strict();
export type CapacityCost = z.infer<typeof CapacityCostSchema>;
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const RevisionSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const IdentitySchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const InstantSchema = z.iso.datetime();
const DaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);

export const CAPACITY_PRODUCERS = {
  "watch-discovery": {
    kind: "runtime",
    source: "scripts/portfolio-watch-d1-cost.test.ts",
  },
  "watch-consumer": {
    kind: "runtime",
    source: "scripts/portfolio-watch-d1-cost.test.ts",
  },
  "plaid-discovery": {
    kind: "runtime",
    source: "scripts/cash-request-d1-cost.test.ts",
  },
  "plaid-webhook": {
    kind: "runtime",
    source: "scripts/cash-request-d1-cost.test.ts",
  },
  "plaid-consumer": {
    kind: "runtime",
    source: "scripts/cash-request-d1-cost.test.ts",
  },
  "agent-maintenance": {
    kind: "runtime",
    source: "scripts/provider-agent-d1-cost.test.ts",
  },
  "agent-results": {
    kind: "runtime",
    source: "scripts/provider-agent-d1-cost.test.ts",
  },
  imports: {
    kind: "runtime",
    source: "scripts/provider-agent-d1-cost.test.ts",
  },
  "company-lookup": {
    kind: "runtime",
    source: "scripts/d1-read-budgets.test.ts",
  },
  "automatic-refresh": {
    kind: "runtime",
    source: "scripts/cash-request-d1-cost.test.ts",
  },
  "investment-sync": {
    kind: "runtime",
    source: "scripts/provider-agent-d1-cost.test.ts",
  },
  "deployment-smoke": {
    kind: "runtime",
    source: "apps/api/src/deployment-smoke.ts",
  },
  release: {
    kind: "maintenance",
    source: "scripts/populated-migration-d1-cost.test.ts",
  },
  "daily-backup": {
    kind: "maintenance",
    source: "scripts/private-document-backup.test.ts",
  },
} as const;
export type CapacityProducer = keyof typeof CAPACITY_PRODUCERS;
const ProducerSchema = z.enum(
  Object.keys(CAPACITY_PRODUCERS) as [CapacityProducer, ...CapacityProducer[]],
);
export const CAPACITY_POLICY = "keel-d1-capacity-v1";
export const CAPACITY_LIMITS = { reads: 5_000_000, writes: 100_000 } as const;
export const CAPACITY_INTERACTIVE_RESERVE = {
  reads: 3_000_000,
  writes: 20_000,
} as const;
export const CAPACITY_MAX_BYTES = 256 * 1024;
export const CAPACITY_MAX_ENTRIES = 1024;
export const CAPACITY_MAX_OPERATIONS = 4000;
function producerOperationLimit(producer: CapacityProducer) {
  return producer === "release"
    ? 2
    : producer === "daily-backup"
      ? 1
      : CAPACITY_MAX_OPERATIONS;
}
function producerStageLimit(producer: CapacityProducer) {
  return producer === "release" ? 24 : producer === "daily-backup" ? 6 : 0;
}
const MAX_CAS_ATTEMPTS = 3;
const MAX_OBSERVATION_AGE_MS = 5 * 60_000;
const MAX_OPERATION_MS = 45 * 60_000;

const ProducerPolicySchema = z
  .object({
    producer: ProducerSchema,
    operation: CapacityCostSchema,
    daily: CapacityCostSchema,
    maxOperations: CountSchema.min(1).max(CAPACITY_MAX_OPERATIONS),
    maxDurationMs: CountSchema.min(1).max(MAX_OPERATION_MS),
    evidenceHash: DigestSchema,
  })
  .strict();
const UsageSchema = z
  .object({
    account: IdentitySchema,
    day: DaySchema,
    observedAt: InstantSchema,
    coveredThrough: InstantSchema,
    upper: CapacityCostSchema,
    complete: z.literal(true),
    basisHash: DigestSchema,
  })
  .strict();
const AllowanceSchema = z
  .object({
    day: DaySchema,
    account: IdentitySchema,
    databases: z.array(IdentitySchema).min(1).max(16),
    revisions: z.array(RevisionSchema).min(1).max(8),
    inventoryHash: DigestSchema,
    bootstrapBasisHash: DigestSchema,
    priorUsageUpper: CapacityCostSchema,
    policies: z
      .array(ProducerPolicySchema)
      .min(1)
      .max(Object.keys(CAPACITY_PRODUCERS).length),
    usage: UsageSchema.nullable(),
  })
  .strict();
export type CapacityAllowance = z.infer<typeof AllowanceSchema>;
const EntrySchema = z
  .object({
    id: DigestSchema,
    fingerprint: DigestSchema,
    executor: z.uuid(),
    producer: ProducerSchema,
    charged: CapacityCostSchema,
    actual: CapacityCostSchema.nullable(),
    startedAt: InstantSchema,
    operationCreatedAt: InstantSchema,
    deadline: InstantSchema,
    completedAt: InstantSchema.nullable(),
    state: z.enum(["running", "completed", "unknown"]),
    stages: z.array(z.string().regex(/^[a-z][a-z0-9-]{0,47}$/u)).max(64),
  })
  .strict();
const ProducerChargeSchema = z
  .object({
    producer: ProducerSchema,
    cost: CapacityCostSchema,
    operations: CountSchema,
  })
  .strict();
export const CapacityLedgerSchema = z
  .object({
    format: z.literal(1),
    policy: z.literal(CAPACITY_POLICY),
    allowance: AllowanceSchema,
    charged: CapacityCostSchema,
    producerCharges: z
      .array(ProducerChargeSchema)
      .max(Object.keys(CAPACITY_PRODUCERS).length),
    entries: z.array(EntrySchema).max(CAPACITY_MAX_ENTRIES),
    frozen: z
      .enum(["cost_overrun", "unknown_metadata", "conflicting_settlement"])
      .nullable(),
  })
  .strict();
export type CapacityLedger = z.infer<typeof CapacityLedgerSchema>;
export interface CapacityStore {
  read(): Promise<{ version: string; value: unknown } | null>;
  compareAndWrite(
    expected: string | null,
    value: CapacityLedger,
  ): Promise<"committed" | "conflict" | "unknown">;
}

export class CapacityUnavailableError extends Error {
  readonly code: "d1_budget_unavailable" | "d1_quota_exhausted";
  constructor(
    readonly reason: string,
    readonly retryAt: string | null = null,
    readonly outcome: "not_started" | "unknown" = "not_started",
  ) {
    super("Database capacity is temporarily unavailable.");
    this.name = "CapacityUnavailableError";
    this.code =
      reason === "capacity" ? "d1_quota_exhausted" : "d1_budget_unavailable";
  }
}
const deny = (reason: string, retryAt: string | null = null): never => {
  throw new CapacityUnavailableError(reason, retryAt);
};
const zero = (): CapacityCost => ({ reads: 0, writes: 0 });
function add(a: CapacityCost, b: CapacityCost): CapacityCost {
  const cost = { reads: a.reads + b.reads, writes: a.writes + b.writes };
  if (
    Number.isSafeInteger(cost.reads) &&
    cost.reads >= 0 &&
    Number.isSafeInteger(cost.writes) &&
    cost.writes >= 0
  )
    return cost;
  return CapacityCostSchema.parse(cost);
}
const fits = (cost: CapacityCost, limit: CapacityCost) =>
  cost.reads <= limit.reads && cost.writes <= limit.writes;
const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
const resetAt = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString();
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
async function hash(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", encode(value));
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function validateLedger(raw: unknown): CapacityLedger {
  if (encode(raw).length > CAPACITY_MAX_BYTES) return deny("ledger_size");
  return validateLedgerInvariants(CapacityLedgerSchema.parse(raw));
}
function validateConstructedLedger(ledger: CapacityLedger): CapacityLedger {
  if (encode(ledger).length > CAPACITY_MAX_BYTES) return deny("ledger_size");
  return validateLedgerInvariants(ledger);
}
function validateLedgerInvariants(ledger: CapacityLedger): CapacityLedger {
  const { allowance } = ledger;
  if (
    allowance.policies.some(
      (item) => item.maxOperations > producerOperationLimit(item.producer),
    )
  )
    return deny("producer_policy");
  if (
    new Set(allowance.policies.map((item) => item.producer)).size !==
      allowance.policies.length ||
    new Set(ledger.entries.map((item) => item.id)).size !==
      ledger.entries.length ||
    new Set(ledger.producerCharges.map((item) => item.producer)).size !==
      ledger.producerCharges.length
  )
    return deny("duplicate_policy");
  if (
    !fits(
      add(allowance.priorUsageUpper, CAPACITY_INTERACTIVE_RESERVE),
      CAPACITY_LIMITS,
    )
  )
    return deny("allowance");
  const dayStart = Date.parse(`${allowance.day}T00:00:00.000Z`);
  const liabilities = ledger.entries.filter(
    (entry) =>
      entry.startedAt.slice(0, 10) === allowance.day ||
      entry.state !== "completed" ||
      entry.completedAt === null ||
      Date.parse(entry.completedAt) >= dayStart,
  );
  if (
    !fits(
      liabilities.reduce((sum, entry) => add(sum, entry.charged), zero()),
      ledger.charged,
    )
  )
    return deny("ledger_accounting");
  for (const producer of Object.keys(CAPACITY_PRODUCERS)) {
    const entries = liabilities.filter((entry) => entry.producer === producer);
    const charge = ledger.producerCharges.find(
      (item) => item.producer === producer,
    );
    if (
      entries.length > 0 &&
      (charge === undefined ||
        charge.operations < entries.length ||
        !fits(
          entries.reduce((sum, entry) => add(sum, entry.charged), zero()),
          charge.cost,
        ))
    )
      return deny("ledger_accounting");
  }
  return ledger;
}
async function load(store: CapacityStore) {
  try {
    const stored = await store.read();
    if (stored === null) return deny("owner_missing");
    return { version: stored.version, value: validateLedger(stored.value) };
  } catch (error) {
    if (error instanceof CapacityUnavailableError) throw error;
    return deny("owner_unavailable");
  }
}
function validateAllowance(allowance: CapacityAllowance, now: number) {
  if (allowance.day !== utcDay(now)) return deny("day");
  if (
    allowance.usage !== null &&
    (allowance.usage.account !== allowance.account ||
      allowance.usage.day !== allowance.day)
  )
    return deny("usage_identity");
}

export interface CapacityScope {
  check(): void;
  stage<T>(name: string, execute: () => Promise<T>): Promise<T>;
  record(cost: CapacityCost): void;
  recordUnknown(): void;
}
export interface CapacityWorkOptions {
  store: CapacityStore;
  account: string;
  database: string;
  revision: string;
  producer: CapacityProducer;
  operationId: string;
  operationCreatedAt: string;
  evidenceHash?: string;
  minimumCost?: CapacityCost;
  now?: () => number;
}
const CapacityWorkInputSchema = z
  .object({
    account: IdentitySchema,
    database: IdentitySchema,
    revision: RevisionSchema,
    producer: ProducerSchema,
    operationId: z.string().min(1).max(512),
    operationCreatedAt: InstantSchema,
    evidenceHash: DigestSchema.optional(),
    minimumCost: CapacityCostSchema.optional(),
  })
  .strict();

export async function runCapacityWork<T>(
  options: CapacityWorkOptions,
  execute: (scope: CapacityScope) => Promise<T>,
): Promise<T> {
  const parsed = CapacityWorkInputSchema.safeParse({
    account: options.account,
    database: options.database,
    revision: options.revision,
    producer: options.producer,
    operationId: options.operationId,
    operationCreatedAt: options.operationCreatedAt,
    ...(options.evidenceHash === undefined
      ? {}
      : { evidenceHash: options.evidenceHash }),
    ...(options.minimumCost === undefined
      ? {}
      : { minimumCost: options.minimumCost }),
  });
  if (!parsed.success) return deny("configuration");
  const input = parsed.data;
  const now = options.now ?? Date.now;
  const createdAt = Date.parse(input.operationCreatedAt);
  const validateRequestTime = (instant: number) => {
    if (
      createdAt > instant ||
      instant - createdAt >= MAX_OPERATION_MS ||
      utcDay(createdAt) !== utcDay(instant)
    )
      return deny("request_expired");
  };
  validateRequestTime(now());
  const id = await hash([
    input.producer,
    input.database,
    input.operationId,
    input.operationCreatedAt,
  ]);
  const fingerprint = await hash([
    input.account,
    input.database,
    input.revision,
    input.producer,
    input.evidenceHash ?? null,
    input.operationCreatedAt,
  ]);
  const executor = crypto.randomUUID();
  let admitted: z.infer<typeof EntrySchema> | undefined;
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await load(options.store);
    const instant = now();
    validateRequestTime(instant);
    const ledger = {
      ...stored.value,
      entries: stored.value.entries.filter(
        (entry) =>
          entry.state !== "completed" ||
          instant - Date.parse(entry.operationCreatedAt) < MAX_OPERATION_MS,
      ),
    };
    validateAllowance(ledger.allowance, instant);
    if (
      ledger.allowance.account !== input.account ||
      !ledger.allowance.databases.includes(input.database) ||
      !ledger.allowance.revisions.includes(input.revision)
    )
      return deny("identity");
    if (ledger.frozen !== null) return deny(ledger.frozen);
    if (
      CAPACITY_PRODUCERS[input.producer].kind === "maintenance" &&
      ledger.entries.some(
        (item) =>
          item.state !== "completed" &&
          CAPACITY_PRODUCERS[item.producer].kind === "maintenance",
      )
    )
      return deny("maintenance_reconciliation_required");
    if (ledger.entries.some((entry) => entry.id === id)) return deny("replay");
    if (ledger.entries.length >= CAPACITY_MAX_ENTRIES)
      return deny("ledger_full");
    const policy = ledger.allowance.policies.find(
      (item) => item.producer === input.producer,
    );
    if (policy === undefined) return deny("producer_uncertified");
    if (
      ledger.producerCharges.reduce((sum, item) => sum + item.operations, 0) >=
      CAPACITY_MAX_OPERATIONS
    )
      return deny("capacity", resetAt(ledger.allowance.day));
    if (input.minimumCost !== undefined) {
      if (
        CAPACITY_PRODUCERS[input.producer].kind !== "maintenance" ||
        !fits(input.minimumCost, policy.operation)
      )
        return deny("cost_evidence");
    }
    const deadline = Math.min(
      createdAt + policy.maxDurationMs,
      Date.parse(resetAt(ledger.allowance.day)),
    );
    if (
      deadline <= instant ||
      createdAt + policy.maxDurationMs >
        Date.parse(resetAt(ledger.allowance.day))
    )
      return deny("day_deadline", resetAt(ledger.allowance.day));
    if (CAPACITY_PRODUCERS[input.producer].kind === "maintenance") {
      const usage = ledger.allowance.usage;
      if (input.evidenceHash !== policy.evidenceHash) return deny("evidence");
      if (
        usage === null ||
        Date.parse(usage.observedAt) > instant ||
        Date.parse(usage.coveredThrough) > Date.parse(usage.observedAt) ||
        instant - Date.parse(usage.coveredThrough) > MAX_OBSERVATION_AGE_MS
      )
        return deny("usage_stale_or_unknown");
    }
    const observedUpper = ledger.allowance.usage?.upper;
    if (
      observedUpper !== undefined &&
      !fits(
        add(
          add(add(observedUpper, ledger.charged), policy.operation),
          CAPACITY_INTERACTIVE_RESERVE,
        ),
        CAPACITY_LIMITS,
      )
    )
      return deny("capacity", resetAt(ledger.allowance.day));
    const charged = add(ledger.charged, policy.operation);
    if (
      !fits(
        add(
          add(ledger.allowance.priorUsageUpper, charged),
          CAPACITY_INTERACTIVE_RESERVE,
        ),
        CAPACITY_LIMITS,
      )
    )
      return deny("capacity", resetAt(ledger.allowance.day));
    const producerCharge = ledger.producerCharges.find(
      (item) => item.producer === input.producer,
    ) ?? { producer: input.producer, cost: zero(), operations: 0 };
    const producerCost = add(producerCharge.cost, policy.operation);
    if (
      !fits(producerCost, policy.daily) ||
      producerCharge.operations >= policy.maxOperations
    )
      return deny("capacity", resetAt(ledger.allowance.day));
    const entry = EntrySchema.parse({
      id,
      fingerprint,
      executor,
      producer: input.producer,
      charged: policy.operation,
      actual: null,
      startedAt: new Date(instant).toISOString(),
      operationCreatedAt: input.operationCreatedAt,
      deadline: new Date(deadline).toISOString(),
      completedAt: null,
      state: "running" as const,
      stages: [],
    });
    const next = validateConstructedLedger({
      ...ledger,
      charged,
      producerCharges: [
        ...ledger.producerCharges.filter(
          (item) => item.producer !== input.producer,
        ),
        ProducerChargeSchema.parse({
          producer: input.producer,
          cost: producerCost,
          operations: producerCharge.operations + 1,
        }),
      ],
      entries: [...ledger.entries, EntrySchema.parse(entry)],
    });
    let result: "committed" | "conflict" | "unknown";
    try {
      result = await options.store.compareAndWrite(stored.version, next);
    } catch {
      result = "unknown";
    }
    if (result === "conflict") continue;
    if (result === "unknown") {
      const confirmed = (await load(options.store)).value.entries.find(
        (item) => item.id === id,
      );
      if (
        confirmed?.executor !== executor ||
        confirmed.fingerprint !== fingerprint ||
        confirmed.state !== "running"
      )
        throw new CapacityUnavailableError(
          "admission_unknown",
          null,
          "unknown",
        );
    }
    admitted = entry;
    break;
  }
  if (admitted === undefined) return deny("contention");
  const entry = admitted;
  let actual = zero();
  let actualKnown = CAPACITY_PRODUCERS[input.producer].kind !== "maintenance";
  let metadataUnknown = false;
  let overrun = false;
  let stageAttempts = 0;
  const check = () => {
    if (
      now() >= Date.parse(entry.deadline) ||
      utcDay(now()) !== entry.startedAt.slice(0, 10)
    )
      throw new CapacityUnavailableError("expired", null, "unknown");
    if (overrun)
      throw new CapacityUnavailableError("cost_overrun", null, "unknown");
    if (metadataUnknown)
      throw new CapacityUnavailableError("unknown_metadata", null, "unknown");
  };
  const update = async (
    change: (
      current: z.infer<typeof EntrySchema>,
    ) => z.infer<typeof EntrySchema>,
    freeze: CapacityLedger["frozen"] = null,
  ) => {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      const stored = await load(options.store);
      const current = stored.value.entries.find((item) => item.id === id);
      if (
        current === undefined ||
        current.executor !== executor ||
        current.fingerprint !== fingerprint
      )
        throw new CapacityUnavailableError(
          "operation_conflict",
          null,
          "unknown",
        );
      const nextEntry = EntrySchema.parse(change(current));
      const next = validateConstructedLedger({
        ...stored.value,
        frozen: freeze ?? stored.value.frozen,
        entries: stored.value.entries.map((item) =>
          item.id === id ? EntrySchema.parse(nextEntry) : item,
        ),
      });
      let result: "committed" | "conflict" | "unknown";
      try {
        result = await options.store.compareAndWrite(stored.version, next);
      } catch {
        result = "unknown";
      }
      if (result === "committed") return;
      if (result === "unknown") {
        const confirmed = (await load(options.store)).value;
        if (
          JSON.stringify(confirmed.entries.find((item) => item.id === id)) ===
            JSON.stringify(nextEntry) &&
          (freeze === null || confirmed.frozen === freeze)
        )
          return;
        throw new CapacityUnavailableError(
          "settlement_unknown",
          null,
          "unknown",
        );
      }
    }
    throw new CapacityUnavailableError("contention", null, "unknown");
  };
  const scope: CapacityScope = {
    check,
    record(cost) {
      const parsed = CapacityCostSchema.safeParse(cost);
      if (!parsed.success) {
        metadataUnknown = true;
        actualKnown = false;
        throw new CapacityUnavailableError("unknown_metadata", null, "unknown");
      }
      actual = add(actual, parsed.data);
      overrun = !fits(actual, entry.charged);
    },
    recordUnknown() {
      actualKnown = false;
      if (CAPACITY_PRODUCERS[input.producer].kind !== "maintenance") {
        metadataUnknown = true;
        throw new CapacityUnavailableError("unknown_metadata", null, "unknown");
      }
    },
    async stage(name, callback) {
      check();
      stageAttempts++;
      if (stageAttempts > producerStageLimit(input.producer))
        throw new CapacityUnavailableError("stage_limit", null, "unknown");
      const stage = z
        .string()
        .regex(/^[a-z][a-z0-9-]{0,47}$/u)
        .parse(name);
      await update((current) => {
        if (
          current.state !== "running" ||
          current.stages.includes(stage) ||
          current.stages.length >= producerStageLimit(input.producer)
        )
          throw new CapacityUnavailableError("stage_replay", null, "unknown");
        return { ...current, stages: [...current.stages, stage] };
      });
      check();
      return callback();
    },
  };
  let settlementAttempted = false;
  try {
    check();
    const result = await execute(scope);
    settlementAttempted = true;
    await update(
      (current) => ({
        ...current,
        actual: actualKnown ? actual : null,
        state: overrun || metadataUnknown ? "unknown" : "completed",
        completedAt: new Date(now()).toISOString(),
      }),
      overrun ? "cost_overrun" : metadataUnknown ? "unknown_metadata" : null,
    );
    if (overrun)
      throw new CapacityUnavailableError("cost_overrun", null, "unknown");
    if (metadataUnknown)
      throw new CapacityUnavailableError("unknown_metadata", null, "unknown");
    return result;
  } catch (error) {
    if (!settlementAttempted)
      await update(
        (current) => ({
          ...current,
          actual: actualKnown ? actual : null,
          state: "unknown",
        }),
        overrun ? "cost_overrun" : metadataUnknown ? "unknown_metadata" : null,
      ).catch(() => undefined);
    if (error instanceof CapacityUnavailableError)
      throw new CapacityUnavailableError(
        error.reason,
        error.retryAt,
        "unknown",
      );
    throw error;
  }
}

export function initialCapacityLedger(
  raw: unknown,
  now: number,
): CapacityLedger {
  const allowance = AllowanceSchema.parse(raw);
  validateAllowance(allowance, now);
  return validateLedger({
    format: 1,
    policy: CAPACITY_POLICY,
    allowance,
    charged: zero(),
    producerCharges: [],
    entries: [],
    frozen: null,
  });
}

export async function initializeCapacityOwner(
  store: CapacityStore,
  allowance: unknown,
  now: number,
): Promise<void> {
  const ledger = initialCapacityLedger(allowance, now);
  if ((await store.read()) !== null) return deny("owner_exists");
  if ((await store.compareAndWrite(null, ledger)) !== "committed")
    return deny("bootstrap_uncertain");
}

export async function rollCapacityDay(
  store: CapacityStore,
  raw: unknown,
  now: number,
): Promise<void> {
  const allowance = AllowanceSchema.parse(raw);
  validateAllowance(allowance, now);
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await load(store);
    if (
      allowance.account !== stored.value.allowance.account ||
      allowance.day <= stored.value.allowance.day
    )
      return deny("rollover_identity");
    const boundary = Date.parse(`${allowance.day}T00:00:00.000Z`);
    const liabilities = stored.value.entries.filter(
      (entry) =>
        entry.state !== "completed" ||
        entry.completedAt === null ||
        Date.parse(entry.completedAt) >= boundary,
    );
    const charged = liabilities.reduce(
      (sum, entry) => add(sum, entry.charged),
      zero(),
    );
    const producerCharges = Object.keys(CAPACITY_PRODUCERS).flatMap(
      (producer) => {
        const entries = liabilities.filter(
          (entry) => entry.producer === producer,
        );
        return entries.length === 0
          ? []
          : [
              {
                producer,
                cost: entries.reduce(
                  (sum, entry) => add(sum, entry.charged),
                  zero(),
                ),
                operations: entries.length,
              },
            ];
      },
    );
    const next = validateLedger({
      ...stored.value,
      allowance,
      charged,
      producerCharges,
      entries: stored.value.entries.filter(
        (entry) =>
          entry.state !== "completed" ||
          entry.completedAt === null ||
          Date.parse(entry.completedAt) >= boundary,
      ),
    });
    if ((await store.compareAndWrite(stored.version, next)) === "committed")
      return;
  }
  return deny("rollover_uncertain");
}

export async function publishCapacityUsage(
  store: CapacityStore,
  raw: unknown,
  now: number,
): Promise<void> {
  const usage = UsageSchema.parse(raw);
  if (
    usage.day !== utcDay(now) ||
    Date.parse(usage.observedAt) > now ||
    Date.parse(usage.coveredThrough) > Date.parse(usage.observedAt) ||
    now - Date.parse(usage.coveredThrough) > MAX_OBSERVATION_AGE_MS
  )
    return deny("usage_stale_or_unknown");
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const stored = await load(store);
    const current = stored.value.allowance.usage;
    if (
      stored.value.allowance.account !== usage.account ||
      stored.value.allowance.day !== usage.day
    )
      return deny("usage_identity");
    if (
      current !== null &&
      (Date.parse(usage.coveredThrough) < Date.parse(current.coveredThrough) ||
        !fits(current.upper, usage.upper))
    )
      return deny("usage_regression");
    const next = validateLedger({
      ...stored.value,
      allowance: { ...stored.value.allowance, usage },
    });
    if ((await store.compareAndWrite(stored.version, next)) === "committed")
      return;
  }
  return deny("usage_publication_uncertain");
}
