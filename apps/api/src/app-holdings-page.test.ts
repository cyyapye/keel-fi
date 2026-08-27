import type { HoldingsPageRepository } from "@keel/database";
import type { HoldingsPage } from "@keel/domain/holdings-page";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Env } from "./types";

const asOf = "2026-08-26T12:00:00.000Z";

const page: HoldingsPage = {
  version: 1,
  shell: {
    householdName: "Synthetic Household",
    pendingEvidenceCount: 2,
  },
  holdings: [],
  investmentHoldings: {
    version: 1,
    authorizationStatus: "configuration_required",
    positionView: { asOf, connections: [] },
    exposureView: { asOf, positions: [], exposures: [] },
  },
  acceptedCashAccounts: [],
  pendingImports: [],
};

function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}

describe("holdings page API", () => {
  it("returns one projection-only page response for the authenticated subject", async () => {
    const getPage = vi.fn().mockResolvedValue(page);
    const holdingsPageRepository = {
      getPage,
    } satisfies HoldingsPageRepository;
    const app = createApp({ holdingsPageRepository });

    const response = await app.request("/api/holdings-page", undefined, env());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(page);
    expect(getPage).toHaveBeenCalledOnce();
    expect(getPage).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "configuration_required",
    );
  });

  it("fails closed when the page projection is unavailable", async () => {
    const holdingsPageRepository = {
      getPage: vi.fn().mockRejectedValue(new Error("synthetic failure")),
    } satisfies HoldingsPageRepository;
    const app = createApp({ holdingsPageRepository });

    const response = await app.request("/api/holdings-page", undefined, env());

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Holdings are unavailable.",
    });
  });
});
