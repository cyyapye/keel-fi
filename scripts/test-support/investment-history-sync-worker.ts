import { z } from "zod";
import { D1HoldingImportRepository } from "../../packages/database/src/holding-imports";
import { D1InvestmentConnectionsRepository } from "../../packages/database/src/investment-connections";
import { D1InvestmentHistoryRepository } from "../../packages/database/src/investment-history";
import { measureD1 } from "./d1-meter";
import {
  connectInvestmentConnection,
  syncInvestmentConnection,
  type PlaidInvestmentsClient,
} from "../../apps/api/src/plaid-investments-sync";
import type { Env } from "../../apps/api/src/types";
import { COST_SUBJECT } from "./cost-fixtures";
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
const status = {
  item: {
    item_id: "synthetic-history-item",
    institution_id: "synthetic-history-institution",
    error: null,
  },
  status: {
    investments: {
      last_successful_update: "2026-09-01T00:00:00.000Z",
      last_failed_update: null,
    },
  },
  request_id: "synthetic-status",
};
const security = (index: number) => ({
  security_id: "synthetic-history-security-" + index,
  name: "Synthetic history security " + index,
  ticker_symbol: "SYN" + index,
  type: "equity",
  cusip: null,
  isin: null,
  sedol: null,
  iso_currency_code: "USD",
  unofficial_currency_code: null,
});
const holdings = {
  accounts: [
    {
      account_id: "synthetic-history-account",
      persistent_account_id: null,
      name: "Synthetic brokerage",
      official_name: null,
      type: "investment",
      subtype: "brokerage",
    },
  ],
  holdings: Array.from({ length: 120 }, (_, index) => ({
    account_id: "synthetic-history-account",
    security_id: security(index).security_id,
    institution_value: 1200,
    cost_basis: 1000,
    quantity: 10,
    institution_price_as_of: "2026-09-01",
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    tax_lots: [
      {
        institution_lot_id: null,
        original_purchase_datetime: "2025-01-01T00:00:00Z",
        quantity: 10,
        purchase_price: 100,
        cost_basis: 1000,
        current_value: 1200,
        position_type: "LONG",
      },
    ],
  })),
  securities: Array.from({ length: 120 }, (_, index) => security(index)),
  item: {
    item_id: status.item.item_id,
    institution_id: status.item.institution_id,
  },
  request_id: "synthetic-holdings",
};

holdings.securities.push({
  ...security(120),
  security_id: "synthetic-history-cash",
  name: "US Dollar",
  type: "cash",
  ticker_symbol: "USD",
});
holdings.holdings.push({
  ...holdings.holdings[0]!,
  security_id: "synthetic-history-cash",
  institution_value: 10000,
  cost_basis: 10000,
  quantity: 10000,
  tax_lots: [],
});
export default {
  async fetch(request: Request, bindings: { DB: D1Database }) {
    const { mode, retiredAccounts } = z
      .object({
        mode: z.enum(["success", "outage", "correction", "bounded"]),
        retiredAccounts: z.union([z.literal(12), z.literal(120)]).default(12),
      })
      .parse(await request.json());
    const currentHoldings =
      mode === "bounded"
        ? {
            ...holdings,
            accounts: [
              ...holdings.accounts,
              {
                ...holdings.accounts[0]!,
                account_id: "synthetic-history-empty-account",
                name: "Synthetic empty brokerage",
                balances: {
                  current: 0,
                  iso_currency_code: "USD",
                  unofficial_currency_code: null,
                },
              },
            ],
          }
        : holdings;
    const meter = measureD1(bindings.DB),
      repository = new D1InvestmentConnectionsRepository(meter.database);
    const objects = new Map<string, Uint8Array>();
    const bucket = {
      put(key: string, value: Uint8Array) {
        objects.set(key, new Uint8Array(value));
        return Promise.resolve(null);
      },
      get(key: string) {
        const value = objects.get(key);
        return Promise.resolve(
          value
            ? {
                size: value.byteLength,
                body: new Response(new Uint8Array(value).buffer).body,
                arrayBuffer: () => Promise.resolve(value.buffer),
                text: () => Promise.resolve(new TextDecoder().decode(value)),
              }
            : null,
        );
      },
      delete(key: string) {
        objects.delete(key);
        return Promise.resolve();
      },
    };
    // Existing connector secrets from a prior request are carried in the worker,
    // exactly as R2 survives separate sync invocations.
    const secret = await bindings.DB.prepare(
      "SELECT value FROM investment_sync_fixture_secrets WHERE key='credential'",
    )
      .first<{ value: string }>()
      .catch(() => null);
    if (secret) {
      const entries = z
        .array(z.tuple([z.string(), z.array(z.number())]))
        .parse(JSON.parse(secret.value));
      for (const [key, value] of entries)
        objects.set(key, new Uint8Array(value));
    }
    const rawPages: string[] = [];
    let transactionRequests = 0,
      statusRequests = 0;
    const client: PlaidInvestmentsClient = {
      createLinkToken() {
        throw new Error("Unused synthetic link request");
      },
      exchangeInvestmentToken() {
        return Promise.resolve({
          version: 1,
          accessToken: "synthetic-access-token",
          itemId: status.item.item_id,
          institutionKey: status.item.institution_id,
          institutionLabel: "Synthetic Brokerage",
        });
      },
      async removeItem() {},
      async updateItemWebhook() {},
      getWebhookVerificationKey() {
        throw new Error("Unused synthetic webhook request");
      },
      getInvestmentStatus() {
        statusRequests++;
        return Promise.resolve({ bytes: bytes(status), parsed: status });
      },
      getHoldings() {
        return Promise.resolve({
          bytes: bytes(currentHoldings),
          parsed: currentHoldings,
        });
      },
      getInvestmentTransactions(_token, query) {
        transactionRequests++;
        if (mode === "outage")
          return Promise.reject(new Error("Synthetic activity outage"));
        const value = {
          accounts: currentHoldings.accounts,
          securities: [security(0)],
          item: holdings.item,
          request_id: "synthetic-history-page",
          total_investment_transactions:
            mode === "bounded" ? 500 : mode === "correction" ? 29 : 30,
          investment_transactions: Array.from(
            {
              length: Math.min(
                250,
                (mode === "bounded" ? 500 : mode === "correction" ? 29 : 30) -
                  query.offset,
              ),
            },
            (_, offset) => {
              const ordinal = query.offset + offset;
              const index =
                mode === "correction" && ordinal >= 1 ? ordinal + 1 : ordinal;
              return {
                investment_transaction_id:
                  "synthetic-history-transaction-" + index,
                account_id: holdings.accounts[0]!.account_id,
                security_id: security(0).security_id,
                date: query.through,
                transaction_datetime: null,
                name: "Synthetic purchase",
                type: "buy" as const,
                subtype: "buy",
                quantity: mode === "correction" && index === 0 ? 4 : 1,
                amount: mode === "correction" && index === 0 ? 400 : 100,
                price: 100,
                fees: 0,
                iso_currency_code: "USD",
                unofficial_currency_code: null,
              };
            },
          ),
        };
        const originalPage = JSON.stringify(value, null, 2) + "\n";
        rawPages.push(originalPage);
        return Promise.resolve({
          bytes: new TextEncoder().encode(originalPage),
          parsed: value,
        });
      },
    };
    const env = {
      ENVIRONMENT: "local",
      DB: meter.database,
      DOCUMENTS: bucket,
      CONNECTOR_CREDENTIAL_KEY: btoa("k".repeat(32)).replace(/=+$/u, ""),
      PLAID_CLIENT_ID: "synthetic-client",
      PLAID_SECRET: "synthetic-secret",
      PLAID_ENVIRONMENT: "sandbox",
      PLAID_REDIRECT_URI: "https://keel.synthetic.invalid/holdings/sources",
      PLAID_WEBHOOK_URL:
        "https://keel-webhooks.synthetic.invalid/webhooks/plaid",
    } as unknown as Env;
    const prior = await repository.getState(COST_SUBJECT, true);
    const connection =
      prior.connections.find(
        (c) => c.institutionKey === status.item.institution_id,
      ) ??
      (await connectInvestmentConnection({
        env,
        repository,
        client,
        accessSubject: COST_SUBJECT,
        publicToken: "synthetic-public-token",
      }));
    if (mode === "bounded") {
      await bindings.DB.prepare(
        `INSERT INTO ownership_containers
        (id,household_id,connection_id,protected_account_key,created_by_user_id,created_at,immutable)
        SELECT 'synthetic-history-retired-account-'||j.key,c.household_id,c.id,j.value,h.owner_user_id,'2025-01-01T00:00:00Z',1
        FROM investment_connections c JOIN households h ON h.id=c.household_id
        CROSS JOIN json_each(?) j WHERE c.id=?`,
      )
        .bind(
          JSON.stringify(
            Array.from(
              { length: retiredAccounts },
              (_, index) =>
                "e".repeat(60) + index.toString(16).padStart(4, "0"),
            ),
          ),
          connection.connectionId,
        )
        .run();
    }
    meter.reset();
    await syncInvestmentConnection({
      env,
      repository,
      client,
      accessSubject: COST_SUBJECT,
      connectionId: connection.connectionId,
      holdingImports: new D1HoldingImportRepository(meter.database),
    });
    const syncCost = { ...meter.cost };
    const accountLookup = [...meter.byQuery].find(([sql]) =>
      sql.includes("a.protected_account_key key,prior.context_json"),
    );
    if (!accountLookup)
      throw new Error("History account lookup was not measured.");
    const historyCost = [...meter.byQuery]
      .filter(([sql]) =>
        /investment_history_|investment_transaction_|investment_tax_lots/u.test(
          sql,
        ),
      )
      .reduce(
        (sum, [, cost]) => ({
          rowsRead: sum.rowsRead + cost.rowsRead,
          rowsWritten: sum.rowsWritten + cost.rowsWritten,
        }),
        { rowsRead: 0, rowsWritten: 0 },
      );
    const reservation = await bindings.DB.prepare(
      "SELECT reserved_writes reserved,write_cost_bound bound FROM investment_history_admissions a JOIN investment_history_captures c ON c.admission_run_id=a.run_id ORDER BY c.sequence DESC LIMIT 1",
    ).first();
    if (!reservation)
      return Response.json(
        { error: "admitted_history_missing" },
        { status: 500 },
      );
    await bindings.DB.prepare(
      "CREATE TABLE IF NOT EXISTS investment_sync_fixture_secrets(key TEXT PRIMARY KEY,value TEXT)",
    ).run();
    await bindings.DB.prepare(
      "INSERT OR REPLACE INTO investment_sync_fixture_secrets VALUES('credential',?)",
    )
      .bind(
        JSON.stringify(
          [...objects.entries()].map(([key, value]) => [key, [...value]]),
        ),
      )
      .run();
    const row = await bindings.DB.prepare(
      `SELECT a.id containerId,p.position_id positionId,s.quantity_micros quantity FROM ownership_containers a
    JOIN public_holding_security_heads p ON p.container_id=a.id JOIN holding_import_application_heads h ON h.position_id=p.position_id
    JOIN holding_position_snapshots s ON s.id=h.snapshot_id WHERE a.connection_id=? AND lower(trim(s.instrument_type))<>'cash' ORDER BY p.position_id LIMIT 1`,
    )
      .bind(connection.connectionId)
      .first<{ containerId: string; positionId: string; quantity: number }>();
    if (!row) {
      const positions = await bindings.DB.prepare(
        "SELECT provider,COUNT(*) count FROM holding_positions WHERE household_id='hh_demo' GROUP BY provider",
      ).all();
      const runs = await bindings.DB.prepare(
        "SELECT auto_applied_count,quarantined_count,discovered_count FROM connector_sync_runs WHERE household_id='hh_demo' ORDER BY started_at DESC LIMIT 1",
      ).all();
      const scopes = await bindings.DB.prepare(
        "SELECT COUNT(*) count FROM ownership_containers WHERE connection_id=?",
      )
        .bind(connection.connectionId)
        .all();
      throw new Error(
        "Synthetic sync has no accepted public position: " +
          JSON.stringify({
            positions: positions.results,
            runs: runs.results,
            scopes: scopes.results,
          }),
      );
    }
    const history = new D1InvestmentHistoryRepository(bindings.DB);
    const activity = await history.transactions("hh_demo", {
      accountId: "container:" + row.containerId,
    });
    const recordedAccounts = await bindings.DB.prepare(
      `SELECT COUNT(*) count,
      SUM(CASE WHEN a.id LIKE 'synthetic-history-retired-account-%' THEN 1 ELSE 0 END) retired,
      SUM(CASE WHEN NOT EXISTS(SELECT 1 FROM holding_position_ownerships o WHERE o.container_id=a.id) THEN 1 ELSE 0 END) empty
      FROM investment_history_accounts history JOIN ownership_containers a ON a.id=history.container_id WHERE history.capture_id=?`,
    )
      .bind(activity!.context.readContextId)
      .first<{ count: number; retired: number; empty: number }>();
    const accountKeys = await bindings.DB.prepare(
      `SELECT protected_account_key key FROM ownership_containers
      WHERE connection_id=? AND id NOT LIKE 'synthetic-history-retired-account-%'`,
    )
      .bind(connection.connectionId)
      .all<{ key: string }>();
    const accountLookupPlan = await bindings.DB.prepare(
      "EXPLAIN QUERY PLAN " + accountLookup[0],
    )
      .bind(
        JSON.stringify(accountKeys.results.map((row) => row.key)),
        connection.connectionId,
        "hh_demo",
      )
      .all<{ detail: string }>();
    const targetTransactions = [...activity!.items];
    let next = activity!.nextAfter;
    while (next) {
      const page = await history.transactions("hh_demo", {
        accountId: "container:" + row.containerId,
        after: next,
      });
      targetTransactions.push(...page!.items);
      next = page!.nextAfter;
    }
    const lots = await history.taxLots("hh_demo", {
      positionId: row.positionId,
    });
    const evidenceEnvelope = z
      .object({ pages: z.array(z.string()) })
      .parse(
        JSON.parse(
          new TextDecoder().decode(
            objects.get(
              "investment-history/" + activity!.context.readContextId + ".json",
            ),
          ),
        ),
      );
    return Response.json({
      transactionRequests,
      statusRequests,
      syncCost,
      historyCost,
      rawPagesPreserved:
        JSON.stringify(evidenceEnvelope.pages) === JSON.stringify(rawPages),
      reservation,
      recordedAccountCount: recordedAccounts!.count,
      retiredAccountHistoryCount: recordedAccounts!.retired,
      emptyAccountHistoryCaptured: recordedAccounts!.empty > 0,
      accountLookupCost: accountLookup[1],
      accountLookupPlan: accountLookupPlan.results.map((row) => row.detail),
      quantity: row.quantity,
      activity,
      targets: targetTransactions.filter((transaction) =>
        [
          "synthetic-history-transaction-0",
          "synthetic-history-transaction-1",
        ].includes(transaction.providerTransactionId),
      ),
      lots,
      connectionId: connection.connectionId,
    });
  },
};
