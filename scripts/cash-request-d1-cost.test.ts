import { expect, it, vi } from "vitest";
import { build } from "esbuild";
import { createApp } from "../apps/api/src/app";
import { handleRequest } from "../apps/web/src/worker";
import { loadCashAccounts, refreshDueCashAccounts } from "../apps/web/src/api";
import type { PlaidCashClient } from "../apps/api/src/plaid-cash-sync";
import type { Env } from "../apps/api/src/types";
import { D1CashAccountsRepository } from "../packages/database/src/cash-accounts";
import { createCostDatabase } from "./test-support/d1-cost";
import { createSqliteTrace } from "./test-support/sqlite-trace";
import {
  COST_SUBJECT,
  COST_TIME,
  seedCostProposals,
} from "./test-support/cost-fixtures";

const replayWorker = build({
  entryPoints: ["scripts/test-support/sql-replay-worker.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["browser", "module", "main"],
  external: ["node:*", "cloudflare:*"],
  logLevel: "silent",
}).then((result) => result.outputFiles[0]!.text);

async function replayD1(trace: ReturnType<typeof createSqliteTrace>) {
  const fixture = await createCostDatabase(await replayWorker);
  let bridgeRequests = 0;
  try {
    const cost = await trace.replay((body) => {
      bridgeRequests++;
      return fixture.dispatchFetch("https://synthetic-replay.invalid", {
        method: "POST",
        body,
      });
    });
    return { ...cost, bridgeRequests };
  } finally {
    await fixture.close();
  }
}

it("bounds a day of real cash GET/POST requests with 100 accepted accounts, exceptions and historical proposals", async () => {
  const trace = createSqliteTrace();
  try {
    await seedCostProposals(trace.database);
    await trace.database
      .prepare(
        `INSERT INTO cash_balance_review_decisions
      (id, household_id, proposal_id, proposal_row_id, reviewer_user_id, decision, change_note, decided_at, immutable)
      SELECT 'cost-accepted-' || value, 'hh_demo', 'cost-cash-proposal-' || (value % 20),
        'cost-cash-row-' || value, 'usr_demo', 'accepted', 'Synthetic review', ?, 1 FROM json_each(?)`,
      )
      .bind(
        COST_TIME,
        JSON.stringify(Array.from({ length: 100 }, (_, index) => index)),
      )
      .run();
    const repository = new D1CashAccountsRepository(trace.database);
    const objectGet = vi.fn(() =>
      Promise.reject(new Error("Synthetic object-store outage")),
    );
    const getAccounts = vi.fn(() =>
      Promise.reject(new Error("Idle path contacted provider")),
    );
    const client = { getAccounts } as unknown as PlaidCashClient;
    const env = {
      DB: trace.database,
      ENVIRONMENT: "preview",
      DOCUMENTS: { get: objectGet },
      INGESTION_QUEUE: {},
    } as unknown as Env;
    let authenticated = 0;
    const app = createApp({
      cashAccountsRepository: repository,
      cashPlaidClient: client,
      verifyAccess: () => {
        authenticated++;
        return Promise.resolve({
          kind: "user" as const,
          subject: COST_SUBJECT,
          email: null,
        });
      },
    });
    let http = 0;
    vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
      http++;
      return handleRequest(
        new Request(new URL(path, "https://keel.example"), {
          ...init,
          headers: { "Cf-Access-Jwt-Assertion": "synthetic-test-assertion" },
        }),
        {
          API: { fetch: async (request) => app.fetch(request, env) },
          ASSETS: {
            fetch: () => {
              throw new Error("Cash request fetched assets");
            },
          },
        },
      );
    });
    const log = console.info.bind(console);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.useFakeTimers({ toFake: ["Date"] });
    for (const failed of [false, true]) {
      const start = Date.parse(COST_TIME) + (failed ? 8 * 86_400_000 : 0);
      await trace.database
        .prepare(
          "UPDATE connector_accounts SET last_synced_at = ? WHERE connector_type = 'plaid-cash'",
        )
        .bind(COST_TIME)
        .run();
      trace.reset();
      objectGet.mockClear();
      http = 0;
      authenticated = 0;
      for (let hour = 0; hour < 24; hour++) {
        vi.setSystemTime(start + hour * 3_600_000);
        const state = await loadCashAccounts();
        expect(state.connections).toHaveLength(20);
        expect(state.acceptedAccounts).toHaveLength(100);
        await refreshDueCashAccounts();
      }
      expect(http).toBe(48);
      expect(authenticated).toBe(48);
      // Every SQL operation, binding, result and consumed admission count is
      // replayed beside real D1. Keep production trips separate from transport.
      const cost = await replayD1(trace);
      expect(cost.roundTrips).toBe(trace.roundTrips);
      expect(cost.rowsRead).toBeLessThanOrEqual(250_000);
      expect(cost.roundTrips).toBeLessThanOrEqual(600);
      expect(cost.rowsWritten).toBeLessThanOrEqual(failed ? 400 : 0);
      expect(cost.bridgeRequests).toBeLessThanOrEqual(failed ? 2 : 1);
      expect(objectGet).toHaveBeenCalledTimes(failed ? 20 : 0);
      expect(getAccounts).not.toHaveBeenCalled();
      log(
        JSON.stringify({
          syntheticCashRequestDay: {
            failed,
            http,
            workerInvocations: http * 2,
            ...cost,
          },
        }),
      );
    }
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    trace.close();
  }
}, 60_000);
