import { z } from "zod";
import positionSetup from "./owner-position-economics-worker";
import { publicInventoryCostInput } from "./public-inventory-cost-worker";
import { COST_SUBJECT, syntheticDigest } from "./cost-fixtures";
import { D1HoldingImportRepository } from "../../packages/database/src/holding-imports";
import {
  D1InvestmentHistoryRepository,
  investmentHistoryHash,
  type InvestmentHistoryScope,
  type InvestmentHistoryCapture,
} from "../../packages/database/src/investment-history";
import type {
  InvestmentHistoryContext,
  InvestmentTaxLot,
} from "../../packages/domain/src/investment-history";
const mainConnection = "synthetic_public_migration_hh_demo";
const foreignConnection = "synthetic_history_foreign_connection";
const scopes = async (db: D1Database) => {
  const repository = new D1InvestmentHistoryRepository(db);
  return Promise.all(
    [
      [COST_SUBJECT, mainConnection],
      ["synthetic-economics-other", foreignConnection],
    ].map(async ([subject, connectionId]) => {
      const row = await db
        .prepare(
          "SELECT import_id FROM public_holding_import_heads WHERE connection_id=?",
        )
        .bind(connectionId!)
        .first<{ import_id: string }>();
      const original = publicInventoryCostInput(0, false).canonicalScope;
      const keys = original.rows.map((r) => ({
        accountKey: r.protectedAccountKey,
        positionKey: r.protectedPositionKey,
      }));
      const scope = await repository.scope(
        subject!,
        connectionId!,
        row!.import_id,
        keys,
      );
      if (scope.positions.length !== 120)
        throw new Error(
          "Synthetic history fixture needs 120 accepted securities per household.",
        );
      return { scope, connectionId: connectionId!, importId: row!.import_id };
    }),
  );
};
async function append(
  db: D1Database,
  scope: InvestmentHistoryScope,
  connectionId: string,
  importId: string,
  version: number,
) {
  const id = await investmentHistoryHash([
    "synthetic-history",
    connectionId,
    version,
  ]);
  const capturedAt = `2026-09-01T12:${String(version).padStart(2, "0")}:00.000Z`;
  const account = scope.accounts[0]!;
  const context: InvestmentHistoryContext = {
    readContextId: id,
    accountId: "container:" + account.id,
    positionId: null,
    capturedAt,
    providerUpdatedAt: "2026-09-01T00:00:00Z",
    quantityEffectiveOn: null,
    priceAsOf: null,
    holdingsSnapshotId: null,
    coverage: {
      status: "complete",
      requestedFrom: "2024-09-01",
      requestedThrough: "2026-09-01",
      lastSuccessfulSyncAt: capturedAt,
      missingPeriods: [],
      scope: "provider_reported_window",
    },
    lastAttemptStatus: "succeeded",
  };
  const positions: InvestmentHistoryCapture["positions"] = scope.positions.map(
    (p, index) => {
      const lots: InvestmentTaxLot[] = Array.from(
        { length: index === 0 ? 120 : 1 },
        (_, lot) => ({
          id: id + ":" + p.id + ":" + lot,
          providerLotId: null,
          positionId: p.id,
          accountId: context.accountId,
          origin: "broker_reported",
          acquiredAt:
            lot === 0
              ? "2026-08-10T00:30:00+02:00"
              : lot === 1
                ? "2026-08-09T23:00:00Z"
                : `2026-08-${String(10 + (lot % 2)).padStart(2, "0")}T00:00:00Z`,
          acquisitionPrecision: "provider_supplied_unknown",
          quantityMicros: 1_000_000,
          purchasePriceMicros: 100_000_000,
          costBasisMinor: 10000 + lot,
          basisPerUnitMicros: 100_000_000 + lot * 10000,
          positionType: "LONG",
          currency: "USD",
          evidenceId: id,
        }),
      );
      return {
        id: p.id,
        containerId: p.containerId,
        snapshotId: p.snapshotId,
        quantityMicros: p.quantityMicros,
        lots,
        lotsAvailable: true,
      };
    },
  );
  const transactionPositions = [
    ...scope.positions,
    ...Array.from({ length: 120 }, () => scope.positions[0]!),
  ];
  const transactions: InvestmentHistoryCapture["transactions"] =
    await Promise.all(
      transactionPositions.map(async (p, index) => {
        const record = {
          id: await investmentHistoryHash([connectionId, index]),
          providerTransactionId: "synthetic-provider-transaction-" + index,
          accountId: context.accountId,
          positionId: p.id,
          securityId: p.key,
          securityName: "Synthetic public security",
          ticker: "SYN",
          type: "buy" as const,
          subtype: "buy",
          postedOn: "2026-08-10",
          initiatedAt: null,
          initiationPrecision: "provider_supplied_unknown" as const,
          quantityMicros: version * 1_000_000,
          unitPriceMicros: 100_000_000,
          feesMinor: 0,
          cashDeltaMinor: -10000 * version,
          currency: "USD" as const,
        };
        return {
          ...record,
          evidenceId: id,
          receivedAt: capturedAt,
          fingerprint: await investmentHistoryHash(record),
        };
      }),
    );
  await new D1InvestmentHistoryRepository(db).record(scope, {
    id,
    connectionId,
    importId,
    capturedAt,
    providerUpdatedAt: context.providerUpdatedAt!,
    evidence: [],
    contexts: [context],
    positions,
    transactions,
  });
}
export default {
  async fetch(request: Request, env: { DB: D1Database }) {
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("seed") }),
        z.object({
          action: z.literal("history"),
          from: z.number().int().min(1).max(24),
          through: z.number().int().min(1).max(24),
        }),
      ])
      .parse(await request.json());
    const db = env.DB;
    if (input.action === "seed") {
      await positionSetup.fetch(
        new Request("https://synthetic.invalid", {
          method: "POST",
          body: JSON.stringify({ round: 0 }),
        }),
        env,
      );
      await positionSetup.fetch(
        new Request("https://synthetic.invalid", {
          method: "POST",
          body: JSON.stringify({ round: 1 }),
        }),
        env,
      );
      await db.batch([
        db
          .prepare(
            `INSERT INTO investment_connections VALUES(?,'economics-other-household','plaid-investments',?,'economics-other-user','2026-08-01T00:00:00Z',1)`,
          )
          .bind(foreignConnection, syntheticDigest(29000)),
        db
          .prepare(
            `INSERT INTO investment_connection_versions(id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
          VALUES(?,'economics-other-household',?,1,'synthetic_public','Synthetic other broker','active','synthetic-secret-reference',NULL,'economics-other-user','2026-08-01T00:00:00Z',1)`,
          )
          .bind(foreignConnection + ":v1", foreignConnection),
      ]);
      const original = publicInventoryCostInput(1, false);
      delete original.inventoryEvidence;
      original.objectKey = "synthetic/history-foreign.json";
      original.sha256 = syntheticDigest(29001);
      original.normalizedFingerprint = syntheticDigest(29002);
      original.canonicalScope.connection = {
        mode: "existing",
        connectionId: foreignConnection,
      };
      const repository = new D1HoldingImportRepository(db);
      const staged = await repository.stagePlaidInvestmentsHoldingImport(
        "synthetic-economics-other",
        original,
      );
      await repository.applyHoldingImport(
        "synthetic-economics-other",
        staged.preview.id,
        {
          currency: "USD",
          decisions: staged.preview.rows.map((r) => ({
            rowId: r.id,
            decision: "accepted" as const,
            rationale: "Accept synthetic foreign history scope.",
          })),
        },
      );
    }
    const values = await scopes(db);
    if (input.action === "history")
      for (let version = input.from; version <= input.through; version++)
        for (const value of values)
          await append(
            db,
            value.scope,
            value.connectionId,
            value.importId,
            version,
          );
    return Response.json({
      positions: values[0]!.scope.positions.map((p) => p.id),
      foreignPosition: values[1]!.scope.positions[0]!.id,
      accountId: "container:" + values[0]!.scope.accounts[0]!.id,
    });
  },
};
