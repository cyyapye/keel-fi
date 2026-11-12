import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import {
  InvestmentHistoryContextSchema,
  InvestmentReconciliationSchema,
  InvestmentTransactionSchema,
  InvestmentTaxLotSchema,
} from "../../packages/domain/src/investment-history";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Populated terminal frontier: three tied-date evidence revisions for each of
 * 120 positions per household, on top of the full 12/24-capture OLD-schema
 * financial history. Deep 12/24 investment-history reads have their own D1
 * holdout; keep this transport below its unchanged 32 MiB resource bound. */
export function investmentMigrationHistory(db: DatabaseSync) {
  const rows = db
    .prepare(
      `SELECT p.id,p.household_id householdId,k.container_id containerId,a.connection_id connectionId,
    s.id snapshotId,s.quantity_micros quantityMicros,r.import_id importId
    FROM public_holding_security_heads k JOIN holding_positions p ON p.id=k.position_id
    JOIN ownership_containers a ON a.id=k.container_id
    JOIN holding_import_application_heads h ON h.position_id=p.id
    JOIN holding_position_snapshots s ON s.id=h.snapshot_id
    JOIN holding_import_applications applied ON applied.id=h.application_id
    JOIN holding_import_rows r ON r.id=applied.import_row_id
    WHERE a.connection_id LIKE 'synthetic_public_migration_%' ORDER BY p.household_id,p.id`,
    )
    .all();
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = String(row.householdId);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (
    groups.size !== 2 ||
    [...groups.values()].some((group) => group.length !== 120)
  )
    throw new Error(
      "Investment migration fixture requires 120 positions in each household.",
    );
  const capture = db.prepare(
    "INSERT INTO investment_history_captures VALUES(?,?,?,?,?,?,?,'investment-history-v1',COALESCE((SELECT MAX(sequence) FROM investment_history_captures),0)+1,NULL,14)",
  );
  const account = db.prepare(
    "INSERT INTO investment_history_accounts VALUES(?,?,?)",
  );
  const head = db.prepare(
    "INSERT INTO investment_history_account_heads VALUES(?,?) ON CONFLICT(container_id) DO UPDATE SET capture_id=excluded.capture_id",
  );
  const position = db.prepare(
    "INSERT INTO investment_history_positions VALUES(?,?,?,?,?,?)",
  );
  const observation = db.prepare(
    "INSERT INTO investment_transaction_observations VALUES(?,?,?,?,?,?)",
  );
  const transaction = db.prepare(
    "INSERT INTO investment_transaction_heads VALUES(?,?,?,?,?,?,?) ON CONFLICT(container_id,transaction_key) DO UPDATE SET observation_id=excluded.observation_id,last_seen_capture_id=excluded.last_seen_capture_id",
  );
  const lot = db.prepare("INSERT INTO investment_tax_lots VALUES(?,?,?,?,?)");
  for (const [householdId, group] of groups) {
    const root = group[0]!;
    for (let version = 1; version <= 3; version++) {
      const captureId = `synthetic-history:${householdId}:${version}`,
        at = "2026-08-20T12:00:00.000Z";
      capture.run(
        captureId,
        householdId,
        root.connectionId!,
        root.importId!,
        at,
        at,
        "[]",
      );
      const context = InvestmentHistoryContextSchema.parse({
        readContextId: captureId,
        accountId: "container:" + String(root.containerId),
        positionId: null,
        capturedAt: at,
        providerUpdatedAt: at,
        quantityEffectiveOn: null,
        priceAsOf: null,
        holdingsSnapshotId: null,
        coverage: {
          status: "complete",
          requestedFrom: "2024-08-20",
          requestedThrough: "2026-08-20",
          lastSuccessfulSyncAt: at,
          missingPeriods: [],
          scope: "provider_reported_window",
        },
        lastAttemptStatus: "succeeded",
      });
      account.run(captureId, root.containerId!, JSON.stringify(context));
      head.run(root.containerId!, captureId);
      for (const row of group) {
        const positionId = String(row.id),
          quantity = Number(row.quantityMicros ?? 0);
        const scoped = {
          ...context,
          positionId,
          holdingsSnapshotId: String(row.snapshotId),
        };
        const rec = InvestmentReconciliationSchema.parse({
          context: scoped,
          status: "insufficient_timing",
          reason: "Synthetic quantity effective date unavailable.",
          openingSnapshotId: null,
          closingSnapshotId: row.snapshotId,
          openingQuantityMicros: null,
          activityQuantityMicros: null,
          expectedQuantityMicros: null,
          reportedQuantityMicros: quantity,
          unexplainedQuantityMicros: null,
          cashStatus: "not_established",
          basisStatus: "broker_reported_not_reconstructed",
        });
        const coverage = {
          status: "complete",
          reportedQuantityMicros: quantity,
          coveredQuantityMicros: quantity,
          knownBasisMinor: 10000,
          allBasisKnown: true,
        };
        position.run(
          captureId,
          positionId,
          root.containerId!,
          row.snapshotId!,
          JSON.stringify({ ...rec, context: undefined }),
          JSON.stringify(coverage),
        );
        const key = hash(positionId + ":synthetic-transaction"),
          obs = captureId + ":" + key;
        const record = InvestmentTransactionSchema.parse({
          id: key,
          providerTransactionId: "synthetic-trade-" + positionId,
          accountId: context.accountId,
          positionId,
          securityId: positionId,
          securityName: "Synthetic public security",
          ticker: "SYN",
          type: "buy",
          subtype: "buy",
          postedOn: "2026-08-10",
          initiatedAt: null,
          initiationPrecision: "provider_supplied_unknown",
          quantityMicros: version * 1_000_000,
          unitPriceMicros: 100_000_000,
          feesMinor: 0,
          cashDeltaMinor: -10000 * version,
          currency: "USD",
          evidenceId: captureId,
          receivedAt: at,
          revision: version,
          previous: null,
        });
        observation.run(
          obs,
          captureId,
          root.containerId!,
          key,
          hash(JSON.stringify(record)),
          JSON.stringify(record),
        );
        transaction.run(
          root.containerId!,
          key,
          obs,
          positionId,
          record.postedOn,
          record.type,
          captureId,
        );
        const reportedLot = InvestmentTaxLotSchema.parse({
          id: captureId + ":" + positionId,
          providerLotId: null,
          positionId,
          accountId: context.accountId,
          origin: "broker_reported",
          acquiredAt: "2026-08-10T00:00:00Z",
          acquisitionPrecision: "provider_supplied_unknown",
          quantityMicros: quantity,
          purchasePriceMicros: 100_000_000,
          costBasisMinor: 10000,
          basisPerUnitMicros: 100_000_000,
          positionType: "LONG",
          currency: "USD",
          evidenceId: captureId,
        });
        lot.run(captureId, positionId, 0, 0, JSON.stringify(reportedLot));
      }
    }
  }
}
