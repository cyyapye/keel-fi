import { z } from "zod";
import {
  normalizePlaidInvestmentTransaction,
  normalizePlaidTaxLot,
  plaidInvestmentSecurityIdentity,
  type PlaidInvestmentsHoldingsResponse,
  type PlaidInvestmentTransactionsResponse,
} from "@keel/connectors";
import {
  D1InvestmentHistoryRepository,
  investmentHistoryHash,
  type InvestmentHistoryCapture,
} from "@keel/database";
import {
  InvestmentHistoryContextSchema,
  type InvestmentHistoryContext,
  type InvestmentTaxLot,
} from "@keel/domain/investment-history";
import {
  type PlaidInvestmentsClient,
  certifyInventoryStatus,
} from "./plaid-investments-sync";
import {
  plaidInvestmentsAccountKey,
  plaidInvestmentsPositionKey,
} from "./investment-identity";
import type { Env } from "./types";

/** Completes one already-admitted holdings sync. No new timer, queue or retry owner. */
export async function capturePlaidInvestmentHistory(input: {
  env: Env;
  client: PlaidInvestmentsClient;
  accessSubject: string;
  connectionId: string;
  runId: string;
  sourceKey: string;
  institutionKey: string;
  itemId: string;
  accessToken: string;
  importId: string;
  holdings: PlaidInvestmentsHoldingsResponse;
  capturedAt: string;
  providerUpdatedAt: string;
}) {
  if (!input.client.getInvestmentTransactions) return;
  const repository = new D1InvestmentHistoryRepository(input.env.DB);
  const baseWriteCost =
    14 +
    input.holdings.accounts.length * 6 +
    Math.min(input.holdings.holdings.length, 120) * 4 +
    Math.min(
      input.holdings.holdings.reduce(
        (count, holding) =>
          count +
          (Array.isArray(holding.tax_lots) ? holding.tax_lots.length : 0),
        0,
      ),
      120,
    ) *
      3;
  const admission = await repository.admit(
    input.accessSubject,
    input.connectionId,
    input.runId,
    input.capturedAt,
    { baseWriteCost, maxTransactions: 250 },
  );
  if (!admission) return;
  const through = input.capturedAt.slice(0, 10);
  const start = new Date(input.capturedAt);
  start.setUTCFullYear(start.getUTCFullYear() - 2);
  const from = start.toISOString().slice(0, 10);
  const accounts = new Map(
    await Promise.all(
      input.holdings.accounts.map(
        async (a) =>
          [
            a.account_id,
            await plaidInvestmentsAccountKey(
              input.env,
              input.sourceKey,
              a.persistent_account_id ?? a.account_id,
            ),
          ] as const,
      ),
    ),
  );
  let securities = new Map(
    input.holdings.securities.map((s) => [s.security_id, s]),
  );
  let transactions: PlaidInvestmentTransactionsResponse["investment_transactions"] =
    [];
  const pages: string[] = [];
  let status: "complete" | "partial" | "failed" = "failed";
  try {
    let total: number | null = null;
    const seen = new Set<string>();
    for (let page = 0; page < 2; page++) {
      const response = await input.client.getInvestmentTransactions(
        input.accessToken,
        { from, through, offset: page * 250, count: 250 },
      );
      const value = response.parsed;
      if (
        value.item.item_id !== input.itemId ||
        value.item.institution_id !== input.institutionKey ||
        value.accounts.some((a) => !accounts.has(a.account_id)) ||
        (total !== null && total !== value.total_investment_transactions)
      )
        throw new Error("Unstable investment transaction scope.");
      total = value.total_investment_transactions;
      for (const row of value.investment_transactions) {
        if (
          !accounts.has(row.account_id) ||
          seen.has(row.investment_transaction_id) ||
          row.date < from ||
          row.date > through
        )
          throw new Error("Invalid or duplicate investment activity.");
        normalizePlaidInvestmentTransaction(row);
        seen.add(row.investment_transaction_id);
      }
      const pageSecurityIds = new Set<string>();
      for (const security of value.securities) {
        const previous = securities.get(security.security_id);
        if (
          pageSecurityIds.has(security.security_id) ||
          (previous &&
            plaidInvestmentSecurityIdentity(previous) !==
              plaidInvestmentSecurityIdentity(security))
        )
          throw new Error("Unstable investment security identity.");
        pageSecurityIds.add(security.security_id);
        securities.set(security.security_id, security);
      }
      if (
        value.investment_transactions.some(
          (row) => row.security_id !== null && !securities.has(row.security_id),
        )
      )
        throw new Error("Investment activity security unavailable.");
      // Keep the original UTF-8 page text, including decimal literals and
      // whitespace. Parsing and reserializing would lose source precision.
      pages.push(
        new TextDecoder("utf-8", { fatal: true }).decode(response.bytes),
      );
      transactions.push(...value.investment_transactions);
      if (transactions.length === total) {
        status = "complete";
        break;
      }
      if (value.investment_transactions.length !== 250)
        throw new Error("Incomplete investment transaction page.");
      status = "partial";
    }
    const after = await input.client.getInvestmentStatus(input.accessToken);
    if (
      after.parsed.status?.investments?.last_successful_update !==
        input.providerUpdatedAt &&
      new Date(
        after.parsed.status?.investments?.last_successful_update ?? 0,
      ).toISOString() !== input.providerUpdatedAt
    )
      throw new Error("Investment source changed while paging.");
    certifyInventoryStatus(
      after.parsed,
      after.parsed,
      { itemId: input.itemId, institutionKey: input.institutionKey },
      input.capturedAt,
    );
  } catch {
    transactions = [];
    pages.length = 0;
    status = "failed";
    securities = new Map(
      input.holdings.securities.map((security) => [
        security.security_id,
        security,
      ]),
    );
  }
  if (transactions.length > admission.transactionLimit) {
    transactions = transactions.slice(0, admission.transactionLimit);
    status = "partial";
  }
  const keys = await Promise.all(
    [
      ...input.holdings.holdings.map((h) => ({
        account: h.account_id,
        security: h.security_id,
      })),
      ...transactions
        .filter((t) => t.security_id !== null)
        .map((t) => ({ account: t.account_id, security: t.security_id! })),
    ].map(async (key) => {
      const security = securities.get(key.security);
      const accountKey = accounts.get(key.account);
      if (!security || !accountKey)
        throw new Error("Investment security scope unavailable.");
      return {
        accountKey,
        positionKey: await plaidInvestmentsPositionKey(
          input.env,
          accountKey,
          plaidInvestmentSecurityIdentity(security),
        ),
        providerAccount: key.account,
        providerSecurity: key.security,
      };
    }),
  );
  const uniqueKeys = [
    ...new Map(
      keys.map((k) => [k.accountKey + ":" + k.positionKey, k]),
    ).values(),
  ];
  const scope = await repository.scope(
    input.accessSubject,
    input.connectionId,
    input.importId,
    uniqueKeys,
  );
  const accountByKey = new Map(scope.accounts.map((a) => [a.key, a]));
  const keyByProvider = new Map(
    keys.map((k) => [k.providerAccount + ":" + k.providerSecurity, k]),
  );
  const positionByKey = new Map(
    scope.positions.map((p) => [p.containerId + ":" + p.key, p]),
  );
  const captureId = await investmentHistoryHash([
    "investment-history-v1",
    input.runId,
    input.importId,
    status,
  ]);
  const historyCapturedAt = new Date().toISOString();
  const contexts: InvestmentHistoryContext[] = scope.accounts.map((account) => {
    const prior = account.context
      ? InvestmentHistoryContextSchema.parse(JSON.parse(account.context))
      : null;
    return InvestmentHistoryContextSchema.parse({
      readContextId: captureId,
      accountId: "container:" + account.id,
      positionId: null,
      capturedAt: historyCapturedAt,
      providerUpdatedAt: input.providerUpdatedAt,
      quantityEffectiveOn: null,
      priceAsOf: null,
      holdingsSnapshotId: null,
      coverage:
        status === "failed" && prior
          ? prior.coverage
          : {
              status,
              evidenceId: captureId,
              requestedFrom: from,
              requestedThrough: through,
              lastSuccessfulSyncAt:
                status === "failed" ? null : historyCapturedAt,
              missingPeriods: status === "complete" ? [] : [{ from, through }],
              scope: "provider_reported_window",
            },
      lastAttemptStatus: status === "failed" ? "failed" : "succeeded",
    });
  });
  let remainingLots = 120;
  const positions: InvestmentHistoryCapture["positions"] = [];
  for (const holding of input.holdings.holdings.slice(0, 120)) {
    const key = keyByProvider.get(
      holding.account_id + ":" + holding.security_id,
    );
    const account = key ? accountByKey.get(key.accountKey) : undefined;
    const position =
      key && account
        ? positionByKey.get(account.id + ":" + key.positionKey)
        : undefined;
    if (!position || position.acceptedImportId !== input.importId) continue;
    let lots: InvestmentTaxLot[];
    let available: boolean;
    let complete: boolean;
    let unavailableReason: "not_provided" | "invalid_evidence";
    try {
      const raw = z
        .array(z.unknown())
        .max(10_000)
        .parse(holding.tax_lots ?? []);
      const retained = raw.slice(0, remainingLots);
      const normalized = retained.map(normalizePlaidTaxLot);
      const ids = normalized
        .map((l) => l.providerLotId)
        .filter((id) => id !== null);
      if (new Set(ids).size !== ids.length)
        throw new Error("Duplicate broker lot identity.");
      available = raw.length > 0;
      complete = retained.length === raw.length;
      unavailableReason = "not_provided";
      lots = normalized.map((lot, index) => ({
        ...lot,
        id: captureId + ":" + position.id + ":" + index,
        positionId: position.id,
        accountId: "container:" + account!.id,
        evidenceId: captureId,
      }));
      remainingLots -= lots.length;
    } catch {
      lots = [];
      available = false;
      complete = false;
      unavailableReason = "invalid_evidence";
    }
    positions.push({
      id: position.id,
      containerId: account!.id,
      snapshotId: position.snapshotId,
      quantityMicros: position.quantityMicros,
      lots,
      lotsAvailable: available,
      lotsComplete: complete,
      lotsUnavailableReason: unavailableReason,
    });
  }
  const records: InvestmentHistoryCapture["transactions"] = await Promise.all(
    transactions.map(async (raw) => {
      const accountKey = accounts.get(raw.account_id)!;
      const account = accountByKey.get(accountKey);
      if (!account) throw new Error("Investment account is not accepted.");
      const key = raw.security_id
        ? keyByProvider.get(raw.account_id + ":" + raw.security_id)
        : undefined;
      const position = key
        ? positionByKey.get(account.id + ":" + key.positionKey)
        : null;
      const security = raw.security_id ? securities.get(raw.security_id) : null;
      const normalized = normalizePlaidInvestmentTransaction(raw);
      const financial = {
        ...normalized,
        accountId: "container:" + account.id,
        positionId: position?.id ?? null,
        securityId: key?.positionKey ?? null,
        securityName: security?.name ?? null,
        ticker: security?.ticker_symbol ?? null,
      };
      return {
        ...financial,
        id: await investmentHistoryHash([
          accountKey,
          raw.investment_transaction_id,
        ]),
        evidenceId: captureId,
        receivedAt: historyCapturedAt,
        fingerprint: await investmentHistoryHash(financial),
      };
    }),
  );
  const bytes = new TextEncoder().encode(
    JSON.stringify({ version: 1, from, through, status, pages }),
  );
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Investment activity evidence exceeds its bound.");
  const key = "investment-history/" + captureId + ".json";
  // Conditional creation retains original bytes on an identical completion retry.
  await input.env.DOCUMENTS.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "application/json" },
  });
  const sha256 = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const evidence = [
    { id: captureId, sha256, byteSize: bytes.byteLength, objectKey: key },
  ];
  await repository.record(scope, {
    id: captureId,
    connectionId: input.connectionId,
    importId: input.importId,
    admissionRunId: input.runId,
    capturedAt: historyCapturedAt,
    providerUpdatedAt: input.providerUpdatedAt,
    evidence,
    contexts,
    positions,
    transactions: records,
  });
}
