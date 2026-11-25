import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import {
  D1InvestmentHistoryRepository,
  investmentHistoryHash,
  type InvestmentHistoryCapture,
} from "../packages/database/src/investment-history";

const local = await getPlatformProxy<{ DB: D1Database }>({
  configPath: "apps/api/wrangler.jsonc",
  environment: "local",
  envFiles: [],
  remoteBindings: false,
  persist: { path: resolve(".keel-local/scenarios/default/v3") },
});

try {
  const db = local.env.DB;
  const repository = new D1InvestmentHistoryRepository(db);
  const positionId = "seed_position_fidelity_nvda";
  const importId = "seed_import_fidelity";
  const connectionId = "seed_connection_fidelity";
  const captureId = "seed_fidelity_nvda_history";
  const source = await db
    .prepare(
      "SELECT id, sha256, byte_size AS byteSize, object_key AS objectKey, retrieved_at AS capturedAt FROM source_documents WHERE id='seed_document_fidelity'",
    )
    .first<{
      id: string;
      sha256: string;
      byteSize: number;
      objectKey: string;
      capturedAt: string;
    }>();
  if (!source)
    throw new Error("Seed the default Fidelity holding before its history.");
  const { capturedAt, ...evidence } = source;
  const accountKey = (13).toString(16).padStart(64, "0");
  const positionKey = (204).toString(16).padStart(64, "0");
  const scope = await repository.scope(
    "synthetic-access-subject",
    connectionId,
    importId,
    [{ accountKey, positionKey }],
    [accountKey],
  );
  const position = scope.positions.find(
    (item) => item.id === positionId && item.acceptedImportId === importId,
  );
  if (!position)
    throw new Error(
      "The default Fidelity snapshot must be current to seed its history.",
    );
  const accountId = "container:" + position.containerId;
  const purchases = [
    {
      date: "2024-04-15",
      quantity: 8,
      priceMicros: 100_000_000,
      basisMinor: 80_000,
    },
    {
      date: "2024-08-12",
      quantity: 12,
      priceMicros: 120_000_000,
      basisMinor: 144_000,
    },
    {
      date: "2025-03-10",
      quantity: 10,
      priceMicros: 136_000_000,
      basisMinor: 136_000,
    },
  ];
  const transactions: InvestmentHistoryCapture["transactions"] = [];
  const lots: InvestmentHistoryCapture["positions"][number]["lots"] = [];
  for (const purchase of purchases) {
    const common = {
      accountId,
      positionId,
      evidenceId: captureId,
      currency: "USD" as const,
      quantityMicros: purchase.quantity * 1_000_000,
    };
    const tradeId = "seed_fidelity_buy_" + purchase.date;
    const lotId = "seed_fidelity_lot_" + purchase.date;
    transactions.push({
      ...common,
      id: tradeId,
      providerTransactionId: tradeId,
      type: "buy",
      subtype: "buy",
      securityId: "seed_nvda",
      securityName: "NVIDIA common stock",
      ticker: "NVDA",
      postedOn: purchase.date,
      receivedAt: capturedAt,
      initiatedAt: null,
      initiationPrecision: "provider_supplied_unknown",
      unitPriceMicros: purchase.priceMicros,
      feesMinor: 0,
      cashDeltaMinor: -purchase.basisMinor,
      fingerprint: await investmentHistoryHash(purchase),
    });
    // In this fabricated report each purchase remains an open, unadjusted lot.
    lots.push({
      ...common,
      id: lotId,
      providerLotId: lotId,
      origin: "broker_reported",
      acquiredAt: purchase.date + "T00:00:00Z",
      acquisitionPrecision: "provider_supplied_unknown",
      purchasePriceMicros: purchase.priceMicros,
      basisPerUnitMicros: purchase.priceMicros,
      costBasisMinor: purchase.basisMinor,
      positionType: "LONG",
    });
  }
  await repository.record(scope, {
    id: captureId,
    importId,
    connectionId,
    capturedAt,
    providerUpdatedAt: capturedAt,
    evidence: [evidence],
    contexts: [
      {
        readContextId: captureId,
        accountId,
        positionId: null,
        holdingsSnapshotId: null,
        capturedAt,
        providerUpdatedAt: capturedAt,
        quantityEffectiveOn: null,
        priceAsOf: null,
        lastAttemptStatus: "succeeded",
        coverage: {
          status: "complete",
          scope: "provider_reported_window",
          requestedFrom: "2024-04-15",
          requestedThrough: capturedAt.slice(0, 10),
          lastSuccessfulSyncAt: capturedAt,
          missingPeriods: [],
        },
      },
    ],
    positions: [
      {
        id: positionId,
        containerId: position.containerId,
        snapshotId: position.snapshotId,
        quantityMicros: position.quantityMicros,
        lotsAvailable: true,
        lots,
      },
    ],
    transactions,
  });
} finally {
  await local.dispose();
}
