import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import { D1InvestmentConnectionsRepository } from "../packages/database/src/investment-connections";
import {
  D1HoldingImportRepository,
  type PlaidInvestmentsHoldingImportStageInput,
} from "../packages/database/src/holding-imports";

const subject = "synthetic-access-subject";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function publicSourceFixture(label: string, verified = false) {
  const persist = process.env.KEEL_LOCAL_PERSIST_TO;
  if (
    !persist ||
    (resolve(persist) !== resolve(".keel-local/e2e") &&
      !resolve(persist).startsWith(resolve(".keel-local/e2e-lanes") + "/"))
  )
    throw new Error(
      "Public source browser fixtures require an isolated E2E profile.",
    );
  const platform = await getPlatformProxy<{ DB: D1Database }>({
    environment: "local",
    configPath: resolve("apps/api/wrangler.jsonc"),
    envFiles: [],
    persist: { path: resolve(persist, "v3") },
    remoteBindings: false,
  });
  const db = platform.env.DB;
  try {
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
      const staged = await imports.stagePlaidInvestmentsHoldingImport(
        subject,
        input(date, next),
      );
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
  } finally {
    await platform.dispose();
  }
}
