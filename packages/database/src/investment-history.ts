import { z } from "zod";
import {
  InvestmentHistoryContextSchema,
  InvestmentReconciliationSchema,
  InvestmentTaxLotSchema,
  InvestmentTaxLotsPageSchema,
  InvestmentTransactionSchema,
  InvestmentTransactionsPageSchema,
  reconcileInvestmentQuantity,
  type InvestmentHistoryContext,
  type InvestmentHistoryQuery,
  type InvestmentTaxLot,
  type InvestmentTransaction,
} from "@keel/domain/investment-history";

export class InvestmentHistoryReadError extends Error {
  constructor(
    public readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}
export const investmentHistoryHash = async (value: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");

type AccountScope = { id: string; key: string; context: string | null };
type PositionScope = {
  id: string;
  containerId: string;
  key: string;
  snapshotId: string;
  quantityMicros: number | null;
  priceAsOf: string | null;
  acceptedImportId: string | null;
};
export type InvestmentHistoryScope = {
  householdId: string;
  accounts: AccountScope[];
  positions: PositionScope[];
};
export type InvestmentHistoryCapture = {
  id: string;
  connectionId: string;
  importId: string;
  admissionRunId?: string;
  capturedAt: string;
  providerUpdatedAt: string;
  evidence: {
    id: string;
    sha256: string;
    byteSize: number;
    objectKey: string;
  }[];
  contexts: InvestmentHistoryContext[];
  positions: {
    id: string;
    containerId: string;
    snapshotId: string;
    quantityMicros: number | null;
    lots: InvestmentTaxLot[];
    lotsAvailable: boolean;
    lotsComplete?: boolean;
    lotsUnavailableReason?: "not_provided" | "invalid_evidence";
  }[];
  transactions: (Omit<InvestmentTransaction, "revision" | "previous"> & {
    fingerprint: string;
  })[];
};

const emptyCoverage = {
  status: "not_synced" as const,
  requestedFrom: null,
  requestedThrough: null,
  lastSuccessfulSyncAt: null,
  missingPeriods: [],
  scope: "provider_reported_window" as const,
};
function blankContext(
  accountId: string,
  positionId: string | null,
  snapshotId: string | null,
): InvestmentHistoryContext {
  return {
    readContextId: null,
    accountId: "container:" + accountId,
    positionId,
    capturedAt: null,
    providerUpdatedAt: null,
    quantityEffectiveOn: null,
    priceAsOf: null,
    holdingsSnapshotId: snapshotId,
    coverage: emptyCoverage,
    lastAttemptStatus: "not_synced",
  };
}
function safeSum(values: (number | null)[]) {
  if (values.some((v) => v === null)) return null;
  const value = Number(values.reduce<bigint>((sum, v) => sum + BigInt(v!), 0n));
  return z.number().int().safe().nonnegative().parse(value);
}
function lotCoverage(
  lots: InvestmentTaxLot[],
  quantity: number | null,
  available: boolean,
  complete: boolean,
  unavailableReason: "not_provided" | "invalid_evidence",
) {
  const covered = safeSum(lots.map((l) => l.quantityMicros));
  const allBasisKnown =
    available &&
    lots.length > 0 &&
    lots.every((l) => l.costBasisMinor !== null);
  return {
    status: !available
      ? ("unavailable" as const)
      : complete &&
          lots.every(
            (l) =>
              l.quantityPrecision !== "rounded_to_millionths" &&
              l.positionType === "LONG",
          ) &&
          covered !== null &&
          quantity !== null &&
          covered === quantity
        ? ("complete" as const)
        : ("partial" as const),
    reportedQuantityMicros: quantity,
    coveredQuantityMicros: available ? covered : null,
    knownBasisMinor:
      available && lots.some((l) => l.costBasisMinor !== null)
        ? safeSum(
            lots
              .filter((l) => l.costBasisMinor !== null)
              .map((l) => l.costBasisMinor),
          )
        : null,
    allBasisKnown,
    reason: !available
      ? unavailableReason
      : !complete
        ? "capture_limit"
        : lots.some((l) => l.positionType !== "LONG")
          ? "unsupported_lot_type"
          : covered !== quantity
            ? "quantity_mismatch"
            : !allBasisKnown
              ? "unknown_basis"
              : "none",
  };
}
const batches = <T>(items: T[], size = 100) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

export class D1InvestmentHistoryRepository {
  constructor(private readonly db: D1Database) {}

  async admit(
    subject: string,
    connectionId: string,
    runId: string,
    at: string,
    bounds = { baseWriteCost: 14, maxTransactions: 250 },
  ) {
    z.object({
      baseWriteCost: z.number().int().min(14).max(4000),
      maxTransactions: z.number().int().min(0).max(250),
    }).parse(bounds);
    const result = await this.db
      .prepare(
        `INSERT INTO investment_history_admissions
      SELECT ?,c.household_id,c.id,?,?,? + MIN(?,(4000-used.cost-?)/20)*20,MIN(?,(4000-used.cost-?)/20)
      FROM investment_connections c
      JOIN households h ON h.id=c.household_id JOIN users u ON u.id=h.owner_user_id
      CROSS JOIN (SELECT COALESCE(SUM(COALESCE(capture.write_cost_bound,a.reserved_writes)),0) cost FROM investment_history_admissions a
        LEFT JOIN investment_history_captures capture ON capture.admission_run_id=a.run_id WHERE a.utc_day=?) used
      WHERE c.id=? AND u.access_subject=?
        AND NOT EXISTS(SELECT 1 FROM investment_history_admissions WHERE run_id=?)
        AND (SELECT COUNT(*) FROM investment_history_admissions WHERE utc_day=?)<3
        AND used.cost+?<=4000 RETURNING transaction_limit`,
      )
      .bind(
        runId,
        at.slice(0, 10),
        at,
        bounds.baseWriteCost,
        bounds.maxTransactions,
        bounds.baseWriteCost,
        bounds.maxTransactions,
        bounds.baseWriteCost,
        at.slice(0, 10),
        connectionId,
        subject,
        runId,
        at.slice(0, 10),
        bounds.baseWriteCost,
      )
      .first<{ transaction_limit: number }>();
    return result ? { transactionLimit: result.transaction_limit } : null;
  }

  async scope(
    subject: string,
    connectionId: string,
    importId: string,
    keys: { accountKey: string; positionKey: string }[],
  ): Promise<InvestmentHistoryScope> {
    const identity = await this.db
      .prepare(
        `SELECT c.household_id id FROM investment_connections c
      JOIN households h ON h.id=c.household_id JOIN users u ON u.id=h.owner_user_id
      WHERE c.id=? AND u.access_subject=?`,
      )
      .bind(connectionId, subject)
      .first<{ id: string }>();
    if (!identity) throw new Error("Investment history household unavailable.");
    const householdId = identity.id;
    const results = await this.db.batch([
      this.db
        .prepare(
          `SELECT a.id,a.protected_account_key key,prior.context_json context FROM ownership_containers a
        LEFT JOIN investment_history_account_heads h ON h.container_id=a.id
        LEFT JOIN investment_history_accounts prior ON prior.capture_id=h.capture_id AND prior.container_id=a.id
        WHERE a.household_id=? AND a.connection_id=?`,
        )
        .bind(householdId, connectionId),
      this.db
        .prepare(
          `SELECT p.id,o.container_id containerId,o.protected_position_key key,s.id snapshotId,
        s.quantity_micros quantityMicros,NULL priceAsOf,
        CASE WHEN accepted.id IS NOT NULL THEN ? ELSE NULL END acceptedImportId
        FROM json_each(?) requested
        JOIN ownership_containers a ON a.connection_id=? AND a.protected_account_key=json_extract(requested.value,'$.accountKey') AND a.household_id=?
        JOIN holding_position_ownerships o ON o.container_id=a.id AND o.protected_position_key=json_extract(requested.value,'$.positionKey') AND o.household_id=?
        JOIN holding_positions p ON p.id=o.position_id AND p.household_id=?
        JOIN holding_import_application_heads head ON head.position_id=p.id
        JOIN holding_position_snapshots s ON s.id=head.snapshot_id AND s.household_id=?
        LEFT JOIN holding_import_rows r ON r.import_id=? AND r.position_fingerprint=o.protected_position_key
        LEFT JOIN holding_import_applications accepted ON accepted.import_row_id=r.id AND accepted.position_id=p.id
        WHERE NOT EXISTS(SELECT 1 FROM holding_position_ownerships newer WHERE newer.position_id=p.id AND newer.version>o.version)`,
        )
        .bind(
          importId,
          JSON.stringify(keys),
          connectionId,
          householdId,
          householdId,
          householdId,
          householdId,
          importId,
        ),
    ]);
    const accounts = z
      .array(
        z.object({
          id: z.string(),
          key: z.string(),
          context: z.string().nullable(),
        }),
      )
      .parse(results[0]!.results);
    const positions = z
      .array(
        z.object({
          id: z.string(),
          containerId: z.string(),
          key: z.string(),
          snapshotId: z.string(),
          quantityMicros: z.number().int().nullable(),
          priceAsOf: z.string().nullable(),
          acceptedImportId: z.string().nullable(),
        }),
      )
      .parse(results[1]!.results);
    return { householdId, accounts, positions };
  }

  async record(scope: InvestmentHistoryScope, input: InvestmentHistoryCapture) {
    if (
      input.transactions.length > 500 ||
      input.positions.length > 500 ||
      input.positions.reduce((n, p) => n + p.lots.length, 0) > 500 ||
      input.contexts.length > 100
    )
      throw new Error(
        "Investment history capture exceeds its admitted workload.",
      );
    const allowed = new Set(scope.accounts.map((a) => a.id));
    const contexts = input.contexts.map((context) =>
      InvestmentHistoryContextSchema.parse(context),
    );
    const statement = this.db
      .prepare(
        `INSERT OR IGNORE INTO investment_history_captures
      VALUES(?,?,?,?,?,?,?,'investment-history-v1',COALESCE((SELECT MAX(sequence) FROM investment_history_captures),0)+1,?,?)`,
      )
      .bind(
        input.id,
        scope.householdId,
        input.connectionId,
        input.importId,
        input.capturedAt,
        input.providerUpdatedAt,
        JSON.stringify(input.evidence),
        input.admissionRunId ?? null,
        14 +
          input.contexts.length * 6 +
          input.positions.length * 4 +
          input.positions.reduce((count, p) => count + p.lots.length, 0) * 3 +
          input.transactions.length * 20,
      );
    const statements = [statement];
    const contextsByAccount = new Map(
      contexts.map((c) => [c.accountId.replace(/^container:/u, ""), c]),
    );
    for (const context of contexts) {
      const account = context.accountId.replace(/^container:/u, "");
      if (!allowed.has(account) || context.readContextId !== input.id)
        throw new Error("History account scope mismatch.");
    }
    statements.push(
      this.db
        .prepare(
          `INSERT OR IGNORE INTO investment_history_accounts
      SELECT ?,json_extract(value,'$.accountId'),json_extract(value,'$.context') FROM json_each(?)`,
        )
        .bind(
          input.id,
          JSON.stringify(
            contexts.map((c) => ({
              accountId: c.accountId.replace(/^container:/u, ""),
              context: JSON.stringify(c),
            })),
          ),
        ),
    );
    statements.push(
      this.db
        .prepare(
          `INSERT INTO investment_history_account_heads
      SELECT json_extract(value,'$.accountId'),? FROM json_each(?) WHERE 1
      ON CONFLICT(container_id) DO UPDATE SET capture_id=excluded.capture_id
      WHERE (SELECT provider_updated_at FROM investment_history_captures WHERE id=excluded.capture_id)>=
        (SELECT provider_updated_at FROM investment_history_captures WHERE id=investment_history_account_heads.capture_id)
      AND (SELECT sequence FROM investment_history_captures WHERE id=excluded.capture_id)>
        (SELECT sequence FROM investment_history_captures WHERE id=investment_history_account_heads.capture_id)`,
        )
        .bind(
          input.id,
          JSON.stringify(
            contexts.map((c) => ({
              accountId: c.accountId.replace(/^container:/u, ""),
            })),
          ),
        ),
    );

    const positions = input.positions.map((p) => {
      if (
        !allowed.has(p.containerId) ||
        !scope.positions.some(
          (owned) =>
            owned.id === p.id &&
            owned.containerId === p.containerId &&
            owned.snapshotId === p.snapshotId &&
            owned.acceptedImportId === input.importId,
        )
      )
        throw new Error("History position is not accepted in this report.");
      const context = InvestmentHistoryContextSchema.parse({
        ...contextsByAccount.get(p.containerId),
        positionId: p.id,
        holdingsSnapshotId: p.snapshotId,
      });
      const previous = scope.accounts.find(
        (a) => a.id === p.containerId,
      )?.context;
      const opening = previous
        ? InvestmentHistoryContextSchema.parse(JSON.parse(previous))
        : null;
      const reconciliation = reconcileInvestmentQuantity({
        context,
        openingSnapshotId: opening?.holdingsSnapshotId ?? null,
        openingOn: null,
        openingQuantityMicros: null,
        closingOn: null,
        closingQuantityMicros: p.quantityMicros,
        quantityDateBasis: "unknown",
        transactions: [],
      });
      if (context.coverage.status === "complete") {
        reconciliation.status = "insufficient_timing";
        reconciliation.reason =
          "Transactions and holdings are recorded separately. The broker does not supply a comparable quantity-effective date, so inclusion is not established.";
      }
      const lots = p.lots.map((l) => InvestmentTaxLotSchema.parse(l));
      if (
        lots.some(
          (l) =>
            l.positionId !== p.id ||
            l.accountId !== "container:" + p.containerId ||
            l.evidenceId !== input.id,
        )
      )
        throw new Error("Lot scope mismatch.");
      return {
        ...p,
        lots,
        reconciliation,
        coverage: lotCoverage(
          lots,
          p.quantityMicros,
          p.lotsAvailable,
          p.lotsComplete ?? true,
          p.lotsUnavailableReason ?? "not_provided",
        ),
      };
    });
    statements.push(
      this.db
        .prepare(
          `INSERT OR IGNORE INTO investment_history_positions
      SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.containerId'),json_extract(value,'$.snapshotId'),
        json_extract(value,'$.reconciliation'),json_extract(value,'$.coverage') FROM json_each(?)`,
        )
        .bind(
          input.id,
          JSON.stringify(
            positions.map((p) => ({
              ...p,
              lots: undefined,
              reconciliation: JSON.stringify({
                ...p.reconciliation,
                context: undefined,
              }),
              coverage: JSON.stringify(p.coverage),
            })),
          ),
        ),
    );
    const lots = positions.flatMap((p) => {
      const oldest = [...p.lots].sort(
        (a, b) =>
          (a.acquiredAt ? Date.parse(a.acquiredAt) : Number.MAX_SAFE_INTEGER) -
            (b.acquiredAt
              ? Date.parse(b.acquiredAt)
              : Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
      );
      const byBasis = [...p.lots].sort((a, b) => {
        if (a.costBasisMinor === null || !a.quantityMicros)
          return b.costBasisMinor === null || !b.quantityMicros
            ? a.id.localeCompare(b.id)
            : 1;
        if (b.costBasisMinor === null || !b.quantityMicros) return -1;
        const diff =
          BigInt(b.costBasisMinor) * BigInt(a.quantityMicros) -
          BigInt(a.costBasisMinor) * BigInt(b.quantityMicros);
        return diff < 0n ? -1 : diff > 0n ? 1 : a.id.localeCompare(b.id);
      });
      return byBasis.map((lot, rank) => ({
        positionId: p.id,
        rank,
        oldest: oldest.findIndex((l) => l.id === lot.id),
        record: JSON.stringify(lot),
      }));
    });
    for (const chunk of batches(lots))
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO investment_tax_lots
      SELECT ?,json_extract(value,'$.positionId'),json_extract(value,'$.rank'),json_extract(value,'$.oldest'),json_extract(value,'$.record') FROM json_each(?)`,
          )
          .bind(input.id, JSON.stringify(chunk)),
      );

    for (const chunk of batches(input.transactions)) {
      const records = chunk.map((t) => {
        const account = t.accountId.replace(/^container:/u, "");
        if (
          !allowed.has(account) ||
          t.evidenceId !== input.id ||
          (t.positionId &&
            !scope.positions.some(
              (p) => p.id === t.positionId && p.containerId === account,
            ))
        )
          throw new Error("Transaction scope mismatch.");
        const base = InvestmentTransactionSchema.omit({
          revision: true,
          previous: true,
        }).parse(t);
        return {
          key: t.id,
          container: account,
          id: input.id + ":" + t.id,
          fingerprint: t.fingerprint,
          positionId: t.positionId,
          date: t.postedOn,
          type: t.type,
          record: JSON.stringify(base),
        };
      });
      const json = JSON.stringify(records);
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO investment_transaction_observations
        SELECT json_extract(j.value,'$.id'),?,json_extract(j.value,'$.container'),json_extract(j.value,'$.key'),json_extract(j.value,'$.fingerprint'),
          json_set(json_extract(j.value,'$.record'),'$.revision',COALESCE(json_extract(old.record_json,'$.revision'),0)+1,
            '$.previous',CASE WHEN old.id IS NULL THEN json('null') ELSE json_object('evidenceId',json_extract(old.record_json,'$.evidenceId'),
              'quantityMicros',json_extract(old.record_json,'$.quantityMicros'),'cashDeltaMinor',json_extract(old.record_json,'$.cashDeltaMinor'),'postedOn',json_extract(old.record_json,'$.postedOn')) END)
        FROM json_each(?) j
        JOIN investment_history_account_heads current ON current.container_id=json_extract(j.value,'$.container') AND current.capture_id=?
        LEFT JOIN investment_transaction_heads head ON head.container_id=json_extract(j.value,'$.container') AND head.transaction_key=json_extract(j.value,'$.key')
        LEFT JOIN investment_transaction_observations old ON old.id=head.observation_id
        WHERE old.fingerprint IS NULL OR old.fingerprint<>json_extract(j.value,'$.fingerprint')`,
          )
          .bind(input.id, json, input.id),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO investment_transaction_heads
        SELECT json_extract(j.value,'$.container'),json_extract(j.value,'$.key'),COALESCE(o.id,prior.observation_id),json_extract(j.value,'$.positionId'),json_extract(j.value,'$.date'),json_extract(j.value,'$.type'),current.capture_id
        FROM json_each(?) j
        JOIN investment_history_account_heads current ON current.container_id=json_extract(j.value,'$.container') AND current.capture_id=?
        LEFT JOIN investment_transaction_observations o ON o.id=json_extract(j.value,'$.id')
        LEFT JOIN investment_transaction_heads prior ON prior.container_id=current.container_id AND prior.transaction_key=json_extract(j.value,'$.key')
        WHERE COALESCE(o.id,prior.observation_id) IS NOT NULL
        ON CONFLICT(container_id,transaction_key) DO UPDATE SET observation_id=excluded.observation_id,
          position_id=excluded.position_id,posted_on=excluded.posted_on,transaction_type=excluded.transaction_type,last_seen_capture_id=excluded.last_seen_capture_id
        WHERE investment_transaction_heads.observation_id<>excluded.observation_id OR investment_transaction_heads.last_seen_capture_id<>excluded.last_seen_capture_id`,
          )
          .bind(json, input.id),
      );
    }
    await this.db.batch(statements);
  }

  private scopeQuery(position: boolean) {
    return this.db.prepare(
      position
        ? `SELECT a.id containerId,p.id positionId,head.snapshot_id snapshotId,
      current.capture_id captureId,history.context_json context,detail.reconciliation_json reconciliation,detail.lot_coverage_json lots,detail.snapshot_id historySnapshotId
      FROM holding_positions p JOIN public_holding_security_heads security ON security.position_id=p.id AND security.household_id=p.household_id
      JOIN ownership_containers a ON a.id=security.container_id AND a.household_id=p.household_id
      LEFT JOIN holding_import_application_heads head ON head.position_id=p.id
      LEFT JOIN investment_history_account_heads current ON current.container_id=a.id
      LEFT JOIN investment_history_accounts history ON history.capture_id=current.capture_id AND history.container_id=a.id
      LEFT JOIN investment_history_positions detail ON detail.capture_id=current.capture_id AND detail.position_id=p.id
      WHERE p.household_id=? AND p.id=?`
        : `SELECT a.id containerId,NULL positionId,NULL snapshotId,current.capture_id captureId,
      history.context_json context,NULL reconciliation,NULL lots,NULL historySnapshotId FROM ownership_containers a
      LEFT JOIN investment_history_account_heads current ON current.container_id=a.id
      LEFT JOIN investment_history_accounts history ON history.capture_id=current.capture_id AND history.container_id=a.id
      WHERE a.household_id=? AND a.id=?`,
    );
  }
  private async readScope(household: string, q: InvestmentHistoryQuery) {
    const row = await this.scopeQuery(Boolean(q.positionId))
      .bind(household, q.positionId ?? q.accountId!.replace(/^container:/u, ""))
      .first<{
        containerId: string;
        positionId: string | null;
        snapshotId: string | null;
        captureId: string | null;
        context: string | null;
        reconciliation: string | null;
        lots: string | null;
        historySnapshotId: string | null;
      }>();
    if (!row) return null;
    if (q.readContextId && q.readContextId !== row.captureId)
      throw new InvestmentHistoryReadError(
        409,
        "History changed. Restart the read with a new readContextId.",
      );
    const context = InvestmentHistoryContextSchema.parse(
      row.context
        ? {
            ...JSON.parse(row.context),
            positionId: row.positionId,
            holdingsSnapshotId: row.snapshotId,
          }
        : blankContext(row.containerId, row.positionId, row.snapshotId),
    );
    return { ...row, context };
  }
  private cursor(
    q: InvestmentHistoryQuery,
    context: InvestmentHistoryContext,
    kind: string,
  ) {
    const binding = [
      kind,
      context.accountId,
      context.positionId,
      context.readContextId,
      q.from ?? null,
      q.through ?? null,
      q.type ?? null,
      q.sort ?? null,
    ];
    let key: unknown = null;
    if (q.after) {
      try {
        const value = z
          .tuple([z.array(z.unknown()), z.unknown()])
          .parse(JSON.parse(decodeURIComponent(q.after)));
        if (JSON.stringify(value[0]) !== JSON.stringify(binding))
          throw new Error();
        key = value[1];
      } catch {
        throw new InvestmentHistoryReadError(
          400,
          "The cursor does not match this history request.",
        );
      }
    }
    return {
      key,
      encode: (next: unknown) =>
        encodeURIComponent(JSON.stringify([binding, next])),
    };
  }
  async reconciliation(household: string, q: InvestmentHistoryQuery) {
    const scope = await this.readScope(household, q);
    if (!scope) return null;
    if (scope.reconciliation && scope.historySnapshotId === scope.snapshotId)
      return InvestmentReconciliationSchema.parse({
        ...JSON.parse(scope.reconciliation),
        context: scope.context,
      });
    return InvestmentReconciliationSchema.parse({
      context: scope.context,
      status: scope.captureId ? "insufficient_coverage" : "not_synced",
      reason: scope.captureId
        ? "This accepted holding has no matching history projection. Its value remains unchanged."
        : "Investment history has not been captured for this account.",
      openingSnapshotId: null,
      closingSnapshotId: scope.snapshotId,
      openingQuantityMicros: null,
      activityQuantityMicros: null,
      expectedQuantityMicros: null,
      reportedQuantityMicros: null,
      unexplainedQuantityMicros: null,
      cashStatus: "not_established",
      basisStatus: "broker_reported_not_reconstructed",
    });
  }
  private transactionPageQuery(
    position: boolean,
    type: boolean,
    from: boolean,
    through: boolean,
    after: boolean,
  ) {
    return this.db
      .prepare(`SELECT o.record_json,t.last_seen_capture_id FROM investment_transaction_heads t
      JOIN investment_transaction_observations o ON o.id=t.observation_id
      WHERE t.container_id=?${position ? " AND t.position_id=?" : ""}${type ? " AND t.transaction_type=?" : ""}${from ? " AND t.posted_on>=?" : ""}${through ? " AND t.posted_on<=?" : ""}${after ? " AND (t.posted_on,t.transaction_key)<(?,?)" : ""}
      ORDER BY t.posted_on DESC,t.transaction_key DESC LIMIT 51`);
  }
  private lotPageQuery(oldest: boolean) {
    return this.db.prepare(
      `SELECT record_json,${oldest ? "acquisition_rank" : "basis_rank"} rank FROM investment_tax_lots WHERE capture_id=? AND position_id=? AND ${oldest ? "acquisition_rank" : "basis_rank"}>? ORDER BY ${oldest ? "acquisition_rank" : "basis_rank"} LIMIT 51`,
    );
  }
  async transactions(household: string, q: InvestmentHistoryQuery) {
    const scope = await this.readScope(household, q);
    if (!scope) return null;
    const cursor = this.cursor(q, scope.context, "transactions");
    const key =
      cursor.key === null
        ? null
        : z.tuple([z.iso.date(), z.string()]).safeParse(cursor.key);
    if (key && !key.success)
      throw new InvestmentHistoryReadError(400, "Invalid transaction cursor.");
    const bindings: (string | number | null)[] = [scope.containerId];
    if (q.positionId) {
      bindings.push(q.positionId);
    }
    if (q.type) {
      bindings.push(q.type);
    }
    if (q.from) {
      bindings.push(q.from);
    }
    if (q.through) {
      bindings.push(q.through);
    }
    if (key && key.success) {
      bindings.push(...key.data);
    }
    const [head, rows] = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          "SELECT capture_id FROM investment_history_account_heads WHERE container_id=?",
        )
        .bind(scope.containerId),
      this.transactionPageQuery(
        Boolean(q.positionId),
        Boolean(q.type),
        Boolean(q.from),
        Boolean(q.through),
        Boolean(key),
      ).bind(...bindings),
    ]);
    if ((head!.results[0]?.capture_id ?? null) !== scope.captureId)
      throw new InvestmentHistoryReadError(
        409,
        "History changed. Restart the read.",
      );
    const items = rows!.results.map((r) => {
      const record = InvestmentTransactionSchema.parse(
        JSON.parse(z.string().parse(r.record_json)),
      );
      const coverage = scope.context.coverage;
      return InvestmentTransactionSchema.parse({
        ...record,
        lastSeenEvidenceId: r.last_seen_capture_id,
        presence:
          r.last_seen_capture_id === (coverage.evidenceId ?? scope.captureId)
            ? "reported"
            : coverage.status === "complete" &&
                coverage.requestedFrom &&
                coverage.requestedThrough &&
                record.postedOn >= coverage.requestedFrom &&
                record.postedOn <= coverage.requestedThrough
              ? "not_in_latest_complete_report"
              : "not_checked",
      });
    });
    return InvestmentTransactionsPageSchema.parse({
      context: scope.context,
      items: items.slice(0, 50),
      nextAfter:
        items.length > 50
          ? cursor.encode([items[49]!.postedOn, items[49]!.id])
          : null,
    });
  }
  async taxLots(household: string, q: InvestmentHistoryQuery) {
    const scope = await this.readScope(household, q);
    if (!scope) return null;
    if (!scope.positionId)
      throw new InvestmentHistoryReadError(
        400,
        "Tax lots require a positionId.",
      );
    const cursor = this.cursor(q, scope.context, "lots");
    const parsed = z.number().int().nonnegative().safe().safeParse(cursor.key);
    if (cursor.key !== null && !parsed.success)
      throw new InvestmentHistoryReadError(400, "Invalid tax-lot cursor.");
    const [head, rows] = await this.db.batch<Record<string, unknown>>([
      this.db
        .prepare(
          "SELECT capture_id FROM investment_history_account_heads WHERE container_id=?",
        )
        .bind(scope.containerId),
      this.lotPageQuery(q.sort === "oldest").bind(
        scope.captureId,
        scope.positionId,
        cursor.key === null ? -1 : parsed.data!,
      ),
    ]);
    if ((head!.results[0]?.capture_id ?? null) !== scope.captureId)
      throw new InvestmentHistoryReadError(
        409,
        "History changed. Restart the read.",
      );
    const matching = scope.historySnapshotId === scope.snapshotId;
    return InvestmentTaxLotsPageSchema.parse({
      context: scope.context,
      coverage:
        scope.lots && matching
          ? InvestmentTaxLotsPageSchema.shape.coverage.parse(
              JSON.parse(scope.lots),
            )
          : {
              status: "not_synced",
              reportedQuantityMicros: null,
              coveredQuantityMicros: null,
              knownBasisMinor: null,
              allBasisKnown: false,
            },
      items: matching
        ? rows!.results
            .slice(0, 50)
            .map((r) =>
              InvestmentTaxLotSchema.parse(
                JSON.parse(z.string().parse(r.record_json)),
              ),
            )
        : [],
      nextAfter:
        matching && rows!.results.length > 50
          ? cursor.encode(rows!.results[49]!.rank)
          : null,
    });
  }
}
