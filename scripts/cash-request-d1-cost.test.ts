import { expect, it, vi } from "vitest";
import { createApp } from "../apps/api/src/app";
import { handleRequest } from "../apps/web/src/worker";
import { loadCashAccounts, refreshDueCashAccounts } from "../apps/web/src/api";
import type { PlaidCashClient } from "../apps/api/src/plaid-cash-sync";
import type { Env } from "../apps/api/src/types";
import { D1CashAccountsRepository } from "../packages/database/src/cash-accounts";
import { createCostDatabase, measureD1 } from "./test-support/d1-cost";
import {
  COST_SUBJECT,
  COST_TIME,
  seedCostProposals,
} from "./test-support/cost-fixtures";

it("bounds a day of real cash GET/POST requests with 100 accepted accounts, exceptions and historical proposals", async () => {
  const fixture = await createCostDatabase();
  try {
    await seedCostProposals(fixture.database);
    await fixture.database
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
    const measured = measureD1(fixture.database);
    const repository = new D1CashAccountsRepository(measured.database);
    const objectGet = vi.fn(() =>
      Promise.reject(new Error("Synthetic object-store outage")),
    );
    const getAccounts = vi.fn(() =>
      Promise.reject(new Error("Idle path contacted provider")),
    );
    const client = { getAccounts } as unknown as PlaidCashClient;
    const env = {
      DB: measured.database,
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
      await fixture.database
        .prepare(
          "UPDATE connector_accounts SET last_synced_at = ? WHERE connector_type = 'plaid-cash'",
        )
        .bind(COST_TIME)
        .run();
      measured.reset();
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
      expect(measured.cost.rowsRead).toBeLessThanOrEqual(250_000);
      expect(measured.cost.roundTrips).toBeLessThanOrEqual(600);
      expect(measured.cost.rowsWritten).toBeLessThanOrEqual(failed ? 400 : 0);
      expect(objectGet).toHaveBeenCalledTimes(failed ? 20 : 0);
      expect(getAccounts).not.toHaveBeenCalled();
      log(
        JSON.stringify({
          syntheticCashRequestDay: {
            failed,
            http,
            workerInvocations: http * 2,
            ...measured.cost,
          },
        }),
      );
    }
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await fixture.close();
  }
}, 60_000);
