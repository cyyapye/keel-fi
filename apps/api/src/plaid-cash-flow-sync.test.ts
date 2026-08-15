import { describe, expect, it, vi } from "vitest";

import { FetchPlaidCashFlowClient } from "./plaid-cash-flow-sync";

const config = {
  clientId: "synthetic-client",
  secret: "synthetic-secret",
  environment: "sandbox" as const,
  credentialKey: "synthetic-key",
  redirectUri: "https://keel.example/holdings",
};

function page(overrides: Record<string, unknown> = {}) {
  return {
    added: [],
    modified: [],
    removed: [],
    next_cursor: "cursor-next",
    has_more: false,
    transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
    request_id: "synthetic-request",
    ...overrides,
  };
}

describe("Plaid Transactions sync", () => {
  it("requests bounded initial history and follows the cursor without refresh", async () => {
    const bodies: unknown[] = [];
    const urls: string[] = [];
    const fetcher = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        urls.push(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url,
        );
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a JSON body.");
        }
        bodies.push(JSON.parse(init.body));
        return Promise.resolve(
          Response.json(
            bodies.length === 1
              ? page({ next_cursor: "cursor-page-two", has_more: true })
              : page({ next_cursor: "cursor-finished" }),
          ),
        );
      },
    );
    const pages = await new FetchPlaidCashFlowClient(
      config,
      fetcher,
    ).syncTransactions("access-synthetic", null);

    expect(pages).toHaveLength(2);
    expect(bodies).toEqual([
      {
        access_token: "access-synthetic",
        count: 500,
        options: {
          days_requested: 125,
          personal_finance_category_version: "v2",
        },
      },
      {
        access_token: "access-synthetic",
        count: 500,
        cursor: "cursor-page-two",
        options: { personal_finance_category_version: "v2" },
      },
    ]);
    expect(urls).toEqual([
      "https://sandbox.plaid.com/transactions/sync",
      "https://sandbox.plaid.com/transactions/sync",
    ]);
    expect(urls.join(" ")).not.toContain("transactions/refresh");
  });

  it("restarts from the original cursor after a pagination mutation", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        if (typeof init?.body !== "string") {
          throw new TypeError("Expected a JSON body.");
        }
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
        if (bodies.length === 1) {
          return Promise.resolve(
            Response.json(page({ next_cursor: "unstable", has_more: true })),
          );
        }
        if (bodies.length === 2) {
          return Promise.resolve(
            Response.json(
              {
                error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
              },
              { status: 400 },
            ),
          );
        }
        return Promise.resolve(
          Response.json(page({ next_cursor: "stable", has_more: false })),
        );
      },
    );
    await expect(
      new FetchPlaidCashFlowClient(config, fetcher).syncTransactions(
        "access-synthetic",
        "cursor-original",
      ),
    ).resolves.toHaveLength(1);
    expect(bodies[0]?.cursor).toBe("cursor-original");
    expect(bodies[1]?.cursor).toBe("unstable");
    expect(bodies[2]?.cursor).toBe("cursor-original");
  });

  it("keeps worst-case pagination below the Workers Free external subrequest limit", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json(page({ next_cursor: "cursor-more", has_more: true })),
      ),
    );

    await expect(
      new FetchPlaidCashFlowClient(config, fetcher).syncTransactions(
        "access-synthetic",
        "cursor-original",
      ),
    ).rejects.toMatchObject({ code: "response_invalid" });
    expect(fetcher).toHaveBeenCalledTimes(16);
  });

  it("keeps a not-ready history distinct from an invalid response", async () => {
    const client = new FetchPlaidCashFlowClient(config, () =>
      Promise.resolve(
        Response.json({ error_code: "PRODUCT_NOT_READY" }, { status: 400 }),
      ),
    );
    await expect(
      client.syncTransactions("access-synthetic", null),
    ).rejects.toMatchObject({
      code: "provider_not_ready",
    });

    const partialClient = new FetchPlaidCashFlowClient(config, () =>
      Promise.resolve(
        Response.json(
          page({ transactions_update_status: "INITIAL_UPDATE_COMPLETE" }),
        ),
      ),
    );
    await expect(
      partialClient.syncTransactions("access-synthetic", null),
    ).rejects.toMatchObject({
      code: "provider_not_ready",
    });
  });
});
