import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test as base } from "@playwright/test";
import { getPlatformProxy } from "wrangler";
import { normalizePlaidInvestmentsHoldings } from "../packages/connectors/src/plaid-investments-holdings";
import { buildPlaidInvestmentsCanonicalScope } from "../apps/api/src/plaid-investments-sync";
import { plaidInvestmentsSourceKey } from "../apps/api/src/investment-identity";
import { D1RetainedPublicExposureReconciler } from "../apps/api/src/retained-public-exposure";
import type { Env } from "../apps/api/src/types";
import { D1InvestmentConnectionsRepository } from "../packages/database/src/investment-connections";
import {
  D1HoldingImportRepository,
  type PlaidInvestmentsHoldingImportStageInput,
} from "../packages/database/src/holding-imports";

const subject = "synthetic-access-subject";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function decimal(value: number, scale: bigint) {
  const integer = BigInt(value);
  return `${integer / scale}.${(integer % scale).toString().padStart(scale.toString().length - 1, "0")}`;
}
async function createPublicSourceFixture(
  env: Env,
  label: string,
  verified = false,
  addition = false,
  inventory = false,
): Promise<{
  connectionId: string;
  importId: string;
  nonce: string;
  next?: (mode: "returned" | "empty" | "partial") => Promise<string>;
}> {
  if (inventory) return createInventoryFixture(env, label);
  if (addition) return createAdditionFixture(env, label);
  const db = env.DB;
  const nonce = randomUUID();
  const connections = new D1InvestmentConnectionsRepository(db);
  const imports = new D1HoldingImportRepository(db);
  const connection = await connections.upsertConnection(
    subject,
    "synthetic-browser-secret-reference",
    hash(nonce),
    `synthetic-${nonce}`,
    label,
  );
  const account = hash(`${nonce}:account`);
  const input = (
    date: string,
    next: boolean,
  ): PlaidInvestmentsHoldingImportStageInput => {
    const entries = [
      ...Array.from({ length: 12 }, (_, index) => ({
        key: `clear-${index}`,
        name: `Synthetic public ${index + 1}`,
        ticker: `S${index + 1}`,
        value: index === 11 ? 8_447_500 : 1_000_000,
        quantity: 1_000_000,
        identity: `clear-${index}`,
      })),
      {
        key: next ? "msft-new" : "msft-old",
        name: "Microsoft",
        ticker: "MSFT",
        value: next ? 1_062_500 : 1_037_500,
        quantity: 25_000_000,
        identity: next && !verified ? null : "msft",
      },
      ...(next
        ? []
        : [
            {
              key: "vxus",
              name: "Vanguard Total International Stock ETF",
              ticker: "VXUS",
              value: 1_000_000,
              quantity: 100_000_000,
              identity: "vxus",
            },
          ]),
    ];
    return {
      objectKey: `synthetic/browser/${nonce}/${date}.json`,
      sha256: hash(`${nonce}:${date}`),
      byteSize: 24000,
      normalizedFingerprint: hash(`${nonce}:normalized:${date}`),
      effectiveDate: date,
      retrievedAt: `${date}T12:00:00.000Z`,
      rows: entries.map((entry, index) => ({
        rowNumber: index + 1,
        naturalKeySha256: hash(`${nonce}:${entry.key}`),
        securityName: entry.name,
        ticker: entry.ticker,
        securityType: entry.ticker === "VXUS" ? "etf" : "equity",
        accountLabel: `${label} brokerage`,
        quantityMicros: entry.quantity,
        costBasisMinor: null,
        marketValueMinor: entry.value,
        observedOn: date,
        currency: "USD",
        issues: ["Cost basis is unavailable."],
      })),
      canonicalScope: {
        connection: { mode: "existing", connectionId: connection.id },
        containers: [
          {
            protectedAccountKey: account,
            displayLabel: `${label} brokerage`,
            containerKind: "brokerage",
            taxTreatment: "taxable",
            completeness: "complete",
          },
        ],
        rows: entries.map((entry, index) => ({
          sourceRowNumber: index + 1,
          protectedAccountKey: account,
          protectedPositionKey: hash(`${nonce}:position:${entry.key}`),
          publicExposureIdentityKind: entry.identity ? "cusip" : null,
          protectedExposureKey: entry.identity
            ? hash(`${nonce}:security:${entry.identity}`)
            : null,
        })),
      },
    };
  };
  for (const [date, next] of [
    ["2026-10-31", false],
    ["2026-11-07", true],
  ] as const) {
    const run = await connections.beginSync(subject, connection.id);
    const report = input(date, next);
    // Keep original, checksum-bound source evidence available for completion.
    const raw = JSON.stringify({
      accounts: [
        {
          account_id: account,
          name: `${label} brokerage`,
          official_name: null,
          subtype: "brokerage",
          type: "investment",
        },
      ],
      item: { item_id: nonce, institution_id: "synthetic-browser" },
      request_id: `synthetic-${date}`,
      holdings: report.rows.map((row, index) => ({
        account_id: account,
        security_id: report.canonicalScope.rows[index]!.protectedPositionKey,
        institution_value: decimal(row.marketValueMinor, 100n),
        cost_basis: null,
        quantity: decimal(row.quantityMicros, 1_000_000n),
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      })),
      securities: report.rows.map((row, index) => ({
        security_id: report.canonicalScope.rows[index]!.protectedPositionKey,
        name: row.securityName,
        ticker_symbol: row.ticker,
        type: row.securityType,
        cusip: null,
        isin: null,
        sedol: null,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      })),
    });
    await env.DOCUMENTS.put(report.objectKey, raw);
    const staged = await imports.stagePlaidInvestmentsHoldingImport(subject, {
      ...report,
      sha256: hash(raw),
      byteSize: Buffer.byteLength(raw),
    });
    const adjudication =
      await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
        subject,
        staged.preview.id,
      );
    await connections.completeSync(subject, run.id, {
      discoveredCount: staged.preview.rows.length,
      proposedCount: staged.preview.rows.length,
      importId: staged.preview.id,
      adjudication: {
        policyVersion: adjudication.policyVersion,
        autoAppliedCount: adjudication.autoAppliedCount,
        quarantinedCount: adjudication.quarantinedCount,
        preservedPositionCount: adjudication.preservedPositionCount,
        baselineRefreshStatus: "not_needed",
        portfolioBaselineId: null,
      },
    });
    if (next) {
      // Keep the visible check date deterministic across midnight and later
      // replays. This mutates only this isolated synthetic browser account.
      await db
        .prepare(
          "UPDATE connector_accounts SET last_synced_at = ? WHERE id = ?",
        )
        .bind("2026-11-07T12:00:00.000Z", connection.connectorAccountId)
        .run();
      return {
        connectionId: connection.id,
        importId: staged.preview.id,
        nonce,
      };
    }
  }
  throw new Error("Synthetic report was not created.");
}

async function createAdditionFixture(env: Env, label: string) {
  const nonce = randomUUID();
  const sourceKey = await plaidInvestmentsSourceKey(env, nonce);
  const connections = new D1InvestmentConnectionsRepository(env.DB);
  const imports = new D1HoldingImportRepository(env.DB);
  const connection = await connections.upsertConnection(
    subject,
    "synthetic-browser-secret-reference",
    sourceKey,
    `synthetic-${nonce}`,
    label,
  );
  for (const [date, next] of [
    ["2026-10-31", false],
    ["2026-11-07", true],
  ] as const) {
    const response = {
      item: { item_id: nonce, institution_id: `synthetic-${nonce}` },
      request_id: `synthetic-${date}`,
      accounts: [
        {
          account_id: "brokerage",
          persistent_account_id: `brokerage-${nonce}`,
          name: `${label} brokerage`,
          official_name: null,
          subtype: "brokerage",
          type: "investment",
        },
        {
          account_id: "ira",
          persistent_account_id: `ira-${nonce}`,
          name: `${label} IRA`,
          official_name: null,
          subtype: "ira",
          type: "investment",
        },
      ],
      securities: [
        {
          security_id: "orbital",
          name: "Synthetic Orbital Systems",
          ticker_symbol: "ORBT",
          type: "equity",
          cusip: null,
          isin: null,
          sedol: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          security_id: "photon",
          name: "Synthetic Photon Components",
          ticker_symbol: "PHOT",
          type: "equity",
          cusip: null,
          isin: null,
          sedol: null,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      ],
      holdings: [
        {
          account_id: "brokerage",
          security_id: next ? "photon" : "orbital",
          institution_value: next ? "2250.00" : "6500.00",
          cost_basis: next ? "2000.00" : "6000.00",
          quantity: next ? "15.0" : "40.0",
          institution_price_as_of: date,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
        {
          account_id: "ira",
          security_id: "photon",
          institution_value: "1500.00",
          cost_basis: "1000.00",
          quantity: "10.0",
          institution_price_as_of: date,
          iso_currency_code: "USD",
          unofficial_currency_code: null,
        },
      ],
    };
    const raw = JSON.stringify(response);
    const normalized = await normalizePlaidInvestmentsHoldings(
      response,
      `${date}T12:00:00.000Z`,
      label,
    );
    const objectKey = `synthetic/browser/${nonce}/${date}.json`;
    await env.DOCUMENTS.put(objectKey, raw);
    const run = await connections.beginSync(subject, connection.id);
    const staged = await imports.stagePlaidInvestmentsHoldingImport(subject, {
      objectKey,
      sha256: hash(raw),
      byteSize: Buffer.byteLength(raw),
      normalizedFingerprint: normalized.normalizedFingerprint,
      effectiveDate: normalized.effectiveDate,
      retrievedAt: `${date}T12:00:00.000Z`,
      rows: normalized.rows,
      canonicalScope: await buildPlaidInvestmentsCanonicalScope({
        env,
        connectionId: connection.id,
        expectedSourceKey: sourceKey,
        institutionKey: `synthetic-${nonce}`,
        institutionLabel: label,
        response,
      }),
    });
    const adjudication =
      await imports.autoAdjudicatePlaidInvestmentsHoldingImport(
        subject,
        staged.preview.id,
      );
    if (!next)
      await new D1RetainedPublicExposureReconciler(env).reconcile(
        subject,
        staged.preview.id,
      );
    await connections.completeSync(subject, run.id, {
      discoveredCount: normalized.rows.length,
      proposedCount: normalized.rows.length,
      importId: staged.preview.id,
      adjudication: {
        policyVersion: adjudication.policyVersion,
        autoAppliedCount: adjudication.autoAppliedCount,
        quarantinedCount: adjudication.quarantinedCount,
        preservedPositionCount: adjudication.preservedPositionCount,
        baselineRefreshStatus: "not_needed",
        portfolioBaselineId: null,
      },
    });
    if (next)
      return {
        connectionId: connection.id,
        importId: staged.preview.id,
        nonce,
      };
  }
  throw new Error("Synthetic addition report was not created.");
}

async function createInventoryFixture(env: Env, label: string) {
  const nonce = randomUUID();
  const connections = new D1InvestmentConnectionsRepository(env.DB);
  const imports = new D1HoldingImportRepository(env.DB);
  const connection = await connections.upsertConnection(
    subject,
    "synthetic-browser-secret-reference",
    await plaidInvestmentsSourceKey(env, nonce),
    `synthetic-${nonce}`,
    label,
  );
  const entries = {
    core: {
      key: "core",
      name: "Synthetic Core Index",
      ticker: "CORE",
      type: "etf",
      quantity: "20",
      value: "2000",
      cusip: "000000001",
    },
    syn: {
      key: "syn",
      name: "Synthetic Systems",
      ticker: "SYN",
      type: "equity",
      quantity: "100",
      value: "5000",
      cusip: "000000002",
    },
    nova: {
      key: "nova",
      name: "Synthetic Nova Technologies",
      ticker: "NOVA",
      type: "equity",
      quantity: "10",
      value: "1200",
      cusip: "000000003",
    },
    cash: {
      key: "cash",
      name: "US Dollar",
      ticker: "USD",
      type: "cash",
      quantity: "1000",
      value: "1000",
      cusip: null,
    },
  };
  const capture = async (
    day: number,
    rows: readonly (typeof entries)[keyof typeof entries][],
    partial = false,
  ) => {
    const date = `2026-11-${String(day).padStart(2, "0")}`;
    const retrievedAt = `${date}T12:00:00.000Z`;
    const response = {
      item: { item_id: nonce, institution_id: `synthetic-${nonce}` },
      request_id: `synthetic-${date}`,
      accounts: [
        {
          account_id: "brokerage",
          persistent_account_id: `brokerage-${nonce}`,
          name: `${label} brokerage`,
          official_name: null,
          subtype: "brokerage",
          type: "investment",
        },
      ],
      holdings: rows.map((row) => ({
        account_id: "brokerage",
        security_id: row.key,
        institution_value: row.value,
        cost_basis: row.type === "cash" ? null : row.value,
        quantity: row.quantity,
        institution_price_as_of: date,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      })),
      securities: rows.map((row) => ({
        security_id: row.key,
        name: row.name,
        ticker_symbol: row.ticker,
        type: row.type,
        cusip: row.cusip,
        isin: null,
        sedol: null,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
      })),
    };
    const raw = JSON.stringify(response);
    const objectKey = `synthetic/browser-inventory/${nonce}/${day}.json`;
    const manifestKey = `synthetic/browser-inventory/${nonce}/${day}-capture.json`;
    const manifest = JSON.stringify({
      version: 1,
      retrievedAt,
      holdings: {
        objectKey,
        sha256: hash(raw),
        byteSize: Buffer.byteLength(raw),
      },
      status: {
        investments: {
          last_successful_update: retrievedAt,
          last_failed_update: null,
        },
      },
    });
    await env.DOCUMENTS.put(objectKey, raw);
    await env.DOCUMENTS.put(manifestKey, manifest);
    const normalized = await normalizePlaidInvestmentsHoldings(
      response,
      retrievedAt,
      label,
    );
    const canonicalScope = await buildPlaidInvestmentsCanonicalScope({
      env,
      connectionId: connection.id,
      expectedSourceKey: await plaidInvestmentsSourceKey(env, nonce),
      institutionKey: `synthetic-${nonce}`,
      institutionLabel: label,
      response,
    });
    if (partial) canonicalScope.containers[0]!.completeness = "partial";
    const report = await imports.stagePlaidInvestmentsHoldingImport(subject, {
      objectKey,
      sha256: hash(raw),
      byteSize: Buffer.byteLength(raw),
      normalizedFingerprint: hash(
        `${normalized.normalizedFingerprint}:${retrievedAt}`,
      ),
      effectiveDate: date,
      retrievedAt,
      rows: normalized.rows,
      canonicalScope,
      inventoryEvidence: {
        sourceUpdatedAt: retrievedAt,
        zeroCashAccountKeys:
          rows.length === 0
            ? [canonicalScope.containers[0]!.protectedAccountKey]
            : [],
        objectKey: manifestKey,
        sha256: hash(manifest),
        byteSize: Buffer.byteLength(manifest),
      },
    });
    return report.preview.id;
  };
  const first = await capture(4, [entries.core, entries.syn, entries.cash]);
  const run = await connections.beginSync(subject, connection.id);
  const adjudication =
    await imports.autoAdjudicatePlaidInvestmentsHoldingImport(subject, first);
  await new D1RetainedPublicExposureReconciler(env).reconcile(subject, first);
  await connections.completeSync(subject, run.id, {
    discoveredCount: 3,
    proposedCount: 3,
    importId: first,
    adjudication: {
      policyVersion: adjudication.policyVersion,
      autoAppliedCount: adjudication.autoAppliedCount,
      quarantinedCount: adjudication.quarantinedCount,
      preservedPositionCount: adjudication.preservedPositionCount,
      baselineRefreshStatus: "not_needed",
      portfolioBaselineId: null,
    },
  });
  // This isolated browser account keeps its visible check date stable.
  await env.DB.prepare(
    "UPDATE connector_accounts SET last_synced_at=? WHERE id=?",
  )
    .bind("2026-11-08T12:00:00.000Z", connection.connectorAccountId)
    .run();
  const after = [
    { ...entries.syn, quantity: "80", value: "4400" },
    entries.nova,
    { ...entries.cash, quantity: "2500", value: "2500" },
  ];
  const importId = await capture(5, after);
  return {
    connectionId: connection.id,
    importId,
    nonce,
    next: async (mode: "returned" | "empty" | "partial") =>
      mode === "returned"
        ? capture(6, [
            { ...entries.core, quantity: "5", value: "500" },
            after[0]!,
            entries.nova,
            { ...entries.cash, quantity: "2000", value: "2000" },
          ])
        : mode === "empty"
          ? capture(7, [])
          : capture(8, [entries.nova, entries.cash], true),
  };
}

// Each worker already owns an isolated D1 profile. Reuse its bridge rather than
// starting and stopping another workerd for every synthetic source; each source
// still has independent connection, import, evidence and position identities.
export const test = base.extend<
  Record<never, never>,
  {
    publicSourceFixture: (
      label: string,
      verified?: boolean,
      addition?: boolean,
      inventory?: boolean,
    ) => ReturnType<typeof createPublicSourceFixture>;
  }
>({
  publicSourceFixture: [
    // Playwright requires dependency destructuring even with no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const persist = process.env.KEEL_LOCAL_PERSIST_TO;
      if (
        !persist ||
        (resolve(persist) !== resolve(".keel-local/e2e") &&
          !resolve(persist).startsWith(resolve(".keel-local/e2e-lanes") + "/"))
      )
        throw new Error(
          "Public source browser fixtures require an isolated E2E profile.",
        );
      const platform = await getPlatformProxy<Env>({
        environment: "local",
        configPath: resolve("apps/api/wrangler.jsonc"),
        envFiles: [],
        persist: { path: resolve(persist, "v3") },
        remoteBindings: false,
      });
      try {
        await use((label, verified, addition, inventory) =>
          createPublicSourceFixture(
            platform.env,
            label,
            verified,
            addition,
            inventory,
          ),
        );
      } finally {
        await platform.dispose();
      }
    },
    { scope: "worker" },
  ],
});
