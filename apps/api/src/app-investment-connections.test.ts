import type {
  InvestmentConnectionsRepository,
  InvestmentExposureViewRepository,
  InvestmentPositionViewRepository,
  PositionEconomicsRepository,
  PositionValueAdjustmentRepository,
  PrivateExposureReviewRepository,
} from "@keel/database";
import { PrivateExposureReviewError } from "@keel/database";
import type {
  InvestmentConnectionStatus,
  InvestmentConnectionsState,
} from "@keel/domain";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { PlaidInvestmentsClient } from "./plaid-investments-sync";
import type { Env } from "./types";

const connectionId = "11111111-1111-4111-8111-111111111111";

const readyStatus: InvestmentConnectionStatus = {
  version: 1,
  connectionId,
  institutionKey: "ins_fidelity",
  institutionLabel: "Fidelity",
  status: "ready",
  lastSyncedAt: "2026-08-10T12:00:00.000Z",
  automaticUpdatesEnabled: true,
  latestImportId: null,
  latestRunStatus: "succeeded",
  errorCode: null,
  latestAdjudication: null,
};

const state: InvestmentConnectionsState = {
  version: 1,
  configured: true,
  connections: [readyStatus],
  errorCode: null,
};

const asOf = "2026-08-16T12:00:00.000Z";

const positionView = {
  asOf,
  connections: [],
};

const exposureView = {
  asOf,
  positions: [],
  exposures: [],
};

function repository() {
  const value = {
    getState: vi.fn().mockResolvedValue(state),
    getConnectionStatus: vi.fn().mockResolvedValue(readyStatus),
    getConnection: vi.fn().mockResolvedValue(null),
    upsertConnection: vi.fn().mockResolvedValue({
      id: connectionId,
      connectorAccountId: "synthetic-connector",
      secretReference: "synthetic-reference",
      providerAccountKey: "a".repeat(64),
      institutionKey: "ins_fidelity",
      institutionLabel: "Fidelity",
      previousSecretReference: null,
    }),
    beginSync: vi.fn().mockResolvedValue({
      id: "synthetic-run",
      created: false,
      connection: {
        id: connectionId,
        connectorAccountId: "synthetic-connector",
        secretReference: "synthetic-reference",
        providerAccountKey: "a".repeat(64),
        institutionKey: "ins_fidelity",
        institutionLabel: "Fidelity",
      },
    }),
    beginAutomaticSync: vi.fn().mockResolvedValue(null),
    completeSync: vi.fn().mockResolvedValue(undefined),
    failSync: vi.fn().mockResolvedValue(undefined),
    disconnectConnection: vi.fn().mockResolvedValue(undefined),
    setConnectionPaused: vi.fn().mockResolvedValue(undefined),
    claimPlaidWebhookDelivery: vi.fn(),
    getPlaidWebhookDelivery: vi.fn(),
    markPlaidWebhookDelivery: vi.fn(),
  } satisfies InvestmentConnectionsRepository;
  return value;
}

function client() {
  const value = {
    createLinkToken: vi.fn().mockResolvedValue({
      linkToken: "link-synthetic-token",
      expiration: "2026-08-10T12:30:00.000Z",
    }),
    exchangeInvestmentToken: vi.fn(),
    removeItem: vi.fn(),
    updateItemWebhook: vi.fn(),
    getWebhookVerificationKey: vi.fn(),
    getInvestmentStatus: vi.fn(),
    getHoldings: vi.fn(),
  } satisfies PlaidInvestmentsClient;
  return value;
}

function privateExposureReviewRepository() {
  const value = {
    getPrivateExposureReviewState: vi.fn().mockResolvedValue({
      version: 2,
      positions: [
        {
          positionId: "position_synthetic_spv",
          snapshotId: "snapshot_synthetic_spv",
          legalVehicleName: "Synthetic Beacon SPV",
          reportedExposureName: "Synthetic Harbor Health",
          positionKind: "spv_interest",
          ownerLabel: "Synthetic Family LLC",
          observedAt: "2026-08-16T12:00:00.000Z",
        },
      ],
      companies: [
        {
          id: "company_synthetic_harbor",
          legalName: "Synthetic Harbor Health",
          websiteHost: "harbor.example",
          status: "active",
        },
      ],
      exactBatch: {
        revision: "a".repeat(64),
        positionCount: 1,
        companyCount: 1,
        existingCompanyCount: 1,
        newCompanyCount: 0,
        excludedPositionCount: 0,
      },
    }),
    assignPrivateCompanyExposure: vi.fn().mockResolvedValue({
      version: 1,
      positionId: "position_synthetic_spv",
      companyId: "company_synthetic_harbor",
      companyName: "Synthetic Harbor Health",
      exposureId: "exposure_synthetic_harbor",
      mappingId: "mapping_synthetic_spv_harbor",
    }),
    applyPrivateExposureExactBatch: vi.fn().mockResolvedValue({
      version: 1,
      assignedPositionCount: 1,
      companyCount: 1,
      existingCompanyCount: 1,
      createdCompanyCount: 0,
      remainingPositionCount: 0,
    }),
  } satisfies PrivateExposureReviewRepository;
  return value;
}

function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}

describe("investment-connections API", () => {
  it("rejects unsigned Plaid webhooks before repository state", async () => {
    const investmentConnectionsRepository = repository();
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient: client(),
    });
    const response = await app.request(
      "/webhooks/plaid",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhook_type: "HOLDINGS",
          webhook_code: "DEFAULT_UPDATE",
        }),
      },
      env(),
    );

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
    expect(
      investmentConnectionsRepository.claimPlaidWebhookDelivery,
    ).not.toHaveBeenCalled();
  });

  it("returns all configured connections and creates a Link token", async () => {
    const investmentConnectionsRepository = repository();
    const plaidClient = client();
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient,
      newInvestmentConnectionsAvailable: true,
    });

    const statusResponse = await app.request(
      "/api/investment-connections",
      undefined,
      env(),
    );
    expect(statusResponse.status).toBe(200);
    await expect(statusResponse.json()).resolves.toEqual(state);
    expect(investmentConnectionsRepository.getState).toHaveBeenCalledWith(
      "synthetic-access-subject",
      true,
    );

    const linkResponse = await app.request(
      "/api/investment-connections/link-token",
      { method: "POST", headers: { Origin: "http://localhost" } },
      env(),
    );
    expect(linkResponse.status).toBe(200);
    await expect(linkResponse.json()).resolves.toEqual({
      linkToken: "link-synthetic-token",
      expiration: "2026-08-10T12:30:00.000Z",
    });
    expect(plaidClient.createLinkToken).toHaveBeenCalledWith(
      "synthetic-access-subject",
    );
  });

  it("checks due investment connections through the server cooldown", async () => {
    const investmentConnectionsRepository = repository();
    const plaidClient = client();
    const retainedPublicExposureReconciler = {
      reconcile: vi.fn().mockResolvedValue({
        documentCount: 0,
        skippedDocumentCount: 0,
        identityCount: 0,
      }),
    };
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient,
      retainedPublicExposureReconciler,
    });

    const response = await app.request(
      "/api/investment-connections/auto-sync",
      { method: "POST", headers: { Origin: "http://localhost" } },
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(state);
    expect(
      investmentConnectionsRepository.beginAutomaticSync,
    ).toHaveBeenCalledWith(
      "synthetic-access-subject",
      connectionId,
      expect.any(String),
    );
    expect(plaidClient.getHoldings).not.toHaveBeenCalled();
    expect(retainedPublicExposureReconciler.reconcile).toHaveBeenCalledWith(
      "synthetic-access-subject",
    );
  });

  it("returns canonical position and exposure views with authorization status", async () => {
    const investmentPositionViewRepository = {
      list: vi.fn().mockResolvedValue(positionView),
    } satisfies InvestmentPositionViewRepository;
    const investmentExposureViewRepository = {
      list: vi.fn().mockResolvedValue(exposureView),
    } satisfies InvestmentExposureViewRepository;
    const retainedPublicExposureReconciler = {
      reconcile: vi.fn().mockResolvedValue({
        documentCount: 1,
        skippedDocumentCount: 0,
        identityCount: 2,
      }),
    };
    const app = createApp({
      investmentConnectionsRepository: repository(),
      investmentPositionViewRepository,
      investmentExposureViewRepository,
      retainedPublicExposureReconciler,
      plaidClient: client(),
    });

    const response = await app.request(
      "/api/investment-holdings",
      undefined,
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      version: 1,
      authorizationStatus: "provider_approval_required",
      positionView,
      exposureView,
    });
    expect(investmentPositionViewRepository.list).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.any(String),
    );
    expect(investmentExposureViewRepository.list).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.any(String),
      positionView,
    );
    expect(retainedPublicExposureReconciler.reconcile).not.toHaveBeenCalled();
  });

  it("keeps canonical holdings reads independent from retained-history repair", async () => {
    const investmentPositionViewRepository = {
      list: vi.fn().mockResolvedValue(positionView),
    } satisfies InvestmentPositionViewRepository;
    const investmentExposureViewRepository = {
      list: vi.fn().mockResolvedValue(exposureView),
    } satisfies InvestmentExposureViewRepository;
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const app = createApp({
      investmentPositionViewRepository,
      investmentExposureViewRepository,
      retainedPublicExposureReconciler: {
        reconcile: vi.fn().mockRejectedValue(new Error("synthetic failure")),
      },
      plaidClient: client(),
    });

    const response = await app.request(
      "/api/investment-holdings",
      undefined,
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      positionView,
      exposureView,
    });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("accepts reviewed position value evidence with the authenticated subject", async () => {
    const accepted = {
      id: "position-value-proposal-synthetic",
      positionId: "position-synthetic",
      snapshotId: "snapshot-synthetic",
      priorValueState: "reported" as const,
      priorValueMinor: 1_000_000,
      valueMinor: 1_250_000,
      currency: "USD",
      effectiveDate: "2026-08-16",
      sourceKind: "gp_update" as const,
      sourceLabel: "Synthetic Q2 GP update",
      sourceUrl: null,
      commentary: "No additional notes supplied.",
      acceptedAt: "2026-08-16T12:00:00.000Z",
    };
    const positionValueAdjustmentRepository = {
      accept: vi.fn().mockResolvedValue(accepted),
    } satisfies PositionValueAdjustmentRepository;
    const app = createApp({ positionValueAdjustmentRepository });

    const response = await app.request(
      "/api/investment-positions/position-synthetic/value-adjustments",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedSnapshotId: "snapshot-synthetic",
          expectedAdjustmentId: null,
          valueMinor: 1_250_000,
          currency: "USD",
          effectiveDate: "2026-08-16",
          sourceKind: "gp_update",
          sourceLabel: "Synthetic Q2 GP update",
          sourceUrl: null,
          commentary: "",
        }),
      },
      env(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(accepted);
    expect(positionValueAdjustmentRepository.accept).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "position-synthetic",
      expect.objectContaining({
        valueMinor: 1_250_000,
        sourceKind: "gp_update",
        commentary: "No additional notes supplied.",
      }),
    );
  });

  it("rejects a news value without an HTTPS source URL", async () => {
    const positionValueAdjustmentRepository = {
      accept: vi.fn(),
    } satisfies PositionValueAdjustmentRepository;
    const app = createApp({ positionValueAdjustmentRepository });

    const response = await app.request(
      "/api/investment-positions/position-synthetic/value-adjustments",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedSnapshotId: "snapshot-synthetic",
          expectedAdjustmentId: null,
          valueMinor: 1_250_000,
          currency: "USD",
          effectiveDate: "2026-08-16",
          sourceKind: "news_article",
          sourceLabel: "Synthetic news report",
          sourceUrl: null,
          commentary: "Synthetic report supports the reviewed mark.",
        }),
      },
      env(),
    );

    expect(response.status).toBe(400);
    expect(positionValueAdjustmentRepository.accept).not.toHaveBeenCalled();
  });

  it("accepts reviewed SPV economics with the authenticated subject", async () => {
    const accepted = {
      id: "position-economics-proposal-synthetic",
      positionId: "position-synthetic-spv",
      acceptedAgainstSnapshotId: "snapshot-synthetic-spv",
      commitmentMinorAtAcceptance: 10_000_000,
      fundedMinorAtAcceptance: 10_000_000,
      capitalBasis: "net_invested" as const,
      grossCommitmentMinor: 12_500_000,
      setupFeePpm: 50_000,
      annualAdminFeePpm: 15_000,
      adminFeeYears: 10,
      carryPpm: 200_000,
      note: "Synthetic reviewed subscription terms.",
      acceptedAt: "2026-08-24T12:00:00.000Z",
    };
    const positionEconomicsRepository = {
      accept: vi.fn().mockResolvedValue(accepted),
    } satisfies PositionEconomicsRepository;
    const app = createApp({ positionEconomicsRepository });

    const response = await app.request(
      "/api/investment-positions/position-synthetic-spv/economics",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedSnapshotId: "snapshot-synthetic-spv",
          expectedTermsId: null,
          capitalBasis: "net_invested" as const,
          grossCommitmentMinor: 12_500_000,
          setupFeePpm: 50_000,
          annualAdminFeePpm: 15_000,
          adminFeeYears: 10,
          carryPpm: 200_000,
          note: "Synthetic reviewed subscription terms.",
        }),
      },
      env(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(accepted);
    expect(positionEconomicsRepository.accept).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "position-synthetic-spv",
      expect.objectContaining({
        capitalBasis: "net_invested" as const,
        grossCommitmentMinor: 12_500_000,
        setupFeePpm: 50_000,
        annualAdminFeePpm: 15_000,
        adminFeeYears: 10,
        carryPpm: 200_000,
      }),
    );
  });

  it("rejects SPV economics whose total upfront fee exceeds commitment", async () => {
    const positionEconomicsRepository = {
      accept: vi.fn(),
    } satisfies PositionEconomicsRepository;
    const app = createApp({ positionEconomicsRepository });

    const response = await app.request(
      "/api/investment-positions/position-synthetic-spv/economics",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedSnapshotId: "snapshot-synthetic-spv",
          expectedTermsId: null,
          annualAdminFeePpm: 200_000,
          adminFeeYears: 6,
          carryPpm: 200_000,
          note: "Synthetic invalid subscription terms.",
        }),
      },
      env(),
    );

    expect(response.status).toBe(400);
    expect(positionEconomicsRepository.accept).not.toHaveBeenCalled();
  });

  it("loads and records an explicit private-company exposure review", async () => {
    const privateExposureReviewRepositoryValue =
      privateExposureReviewRepository();
    const app = createApp({
      privateExposureReviewRepository: privateExposureReviewRepositoryValue,
    });

    const stateResponse = await app.request(
      "/api/private-exposure-reviews",
      undefined,
      env(),
    );
    expect(stateResponse.status).toBe(200);
    expect(stateResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    await expect(stateResponse.json()).resolves.toMatchObject({
      version: 2,
      positions: [{ positionId: "position_synthetic_spv" }],
      companies: [{ id: "company_synthetic_harbor" }],
      exactBatch: { positionCount: 1, companyCount: 1 },
    });

    const input = {
      expectedSnapshotId: "snapshot_synthetic_spv",
      company: {
        mode: "existing" as const,
        companyId: "company_synthetic_harbor",
      },
    };
    const assignResponse = await app.request(
      "/api/private-exposure-reviews/position_synthetic_spv/assign",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
      env(),
    );
    expect(assignResponse.status).toBe(201);
    expect(
      privateExposureReviewRepositoryValue.assignPrivateCompanyExposure,
    ).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "position_synthetic_spv",
      input,
    );
    await expect(assignResponse.json()).resolves.toMatchObject({
      companyId: "company_synthetic_harbor",
      mappingId: "mapping_synthetic_spv_harbor",
    });

    const exactBatchResponse = await app.request(
      "/api/private-exposure-reviews/exact-batch",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expectedRevision: "a".repeat(64) }),
      },
      env(),
    );
    expect(exactBatchResponse.status).toBe(201);
    expect(
      privateExposureReviewRepositoryValue.applyPrivateExposureExactBatch,
    ).toHaveBeenCalledWith("synthetic-access-subject", {
      expectedRevision: "a".repeat(64),
    });
    await expect(exactBatchResponse.json()).resolves.toMatchObject({
      assignedPositionCount: 1,
      companyCount: 1,
      remainingPositionCount: 0,
    });
  });

  it("rejects text-only or stale private exposure assignments", async () => {
    const assignPrivateCompanyExposure = vi
      .fn()
      .mockRejectedValue(
        new PrivateExposureReviewError(
          "company_conflict",
          "Synthetic duplicate company.",
        ),
      );
    const app = createApp({
      privateExposureReviewRepository: {
        ...privateExposureReviewRepository(),
        assignPrivateCompanyExposure,
      },
    });

    const invalidResponse = await app.request(
      "/api/private-exposure-reviews/position_synthetic_spv/assign",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedSnapshotId: "snapshot_synthetic_spv",
          company: { legalName: "Synthetic Harbor Health" },
        }),
      },
      env(),
    );
    expect(invalidResponse.status).toBe(400);
    expect(assignPrivateCompanyExposure).not.toHaveBeenCalled();

    const conflictResponse = await app.request(
      "/api/private-exposure-reviews/position_synthetic_spv/assign",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedSnapshotId: "snapshot_synthetic_spv",
          company: {
            mode: "new",
            legalName: "Synthetic Harbor Health",
            websiteHost: "harbor.example",
          },
        }),
      },
      env(),
    );
    expect(conflictResponse.status).toBe(409);
    await expect(conflictResponse.json()).resolves.toEqual({
      error: "That reviewed company already exists. Choose it from the list.",
    });
  });

  it("does not open a new connection when authorization is disabled", async () => {
    const plaidClient = client();
    const app = createApp({
      investmentConnectionsRepository: repository(),
      plaidClient,
    });

    const response = await app.request(
      "/api/investment-connections/link-token",
      { method: "POST", headers: { Origin: "http://localhost" } },
      env(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "New investment connections are not enabled.",
    });
    expect(plaidClient.createLinkToken).not.toHaveBeenCalled();
  });

  it("does not exchange a valid new Item when authorization is disabled", async () => {
    const plaidClient = client();
    const app = createApp({
      investmentConnectionsRepository: repository(),
      plaidClient,
    });

    const response = await app.request(
      "/api/investment-connections/exchange",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicToken: "public-synthetic" }),
      },
      env(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "New investment connections are not enabled.",
    });
    expect(plaidClient.exchangeInvestmentToken).not.toHaveBeenCalled();
  });

  it("rejects a malformed exchange before calling Plaid", async () => {
    const plaidClient = client();
    const app = createApp({
      investmentConnectionsRepository: repository(),
      plaidClient,
    });
    const response = await app.request(
      "/api/investment-connections/exchange",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ publicToken: "" }),
      },
      env(),
    );

    expect(response.status).toBe(400);
    expect(plaidClient.exchangeInvestmentToken).not.toHaveBeenCalled();
  });

  it("treats an already disconnected exact connection as an idempotent delete", async () => {
    const investmentConnectionsRepository = repository();
    investmentConnectionsRepository.getConnectionStatus.mockResolvedValue({
      ...readyStatus,
      status: "disconnected",
      lastSyncedAt: null,
      automaticUpdatesEnabled: false,
      latestRunStatus: null,
    });
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient: client(),
    });

    const response = await app.request(
      `/api/investment-connections/${connectionId}`,
      { method: "DELETE", headers: { Origin: "http://localhost" } },
      env(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connectionId,
      status: "disconnected",
      automaticUpdatesEnabled: false,
    });
    expect(
      investmentConnectionsRepository.disconnectConnection,
    ).not.toHaveBeenCalled();
  });

  it("validates and applies a scoped pause action without provider configuration", async () => {
    const investmentConnectionsRepository = repository();
    const pausedStatus = {
      ...readyStatus,
      status: "paused" as const,
      automaticUpdatesEnabled: false,
      latestRunStatus: null,
    };
    investmentConnectionsRepository.getConnectionStatus.mockResolvedValue(
      pausedStatus,
    );
    const app = createApp({
      investmentConnectionsRepository,
      plaidClient: client(),
    });

    const invalid = await app.request(
      `/api/investment-connections/${connectionId}/lifecycle`,
      {
        method: "PATCH",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "stop" }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);

    const response = await app.request(
      `/api/investment-connections/${connectionId}/lifecycle`,
      {
        method: "PATCH",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "pause" }),
      },
      env(),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(pausedStatus);
    expect(
      investmentConnectionsRepository.setConnectionPaused,
    ).toHaveBeenCalledWith("synthetic-access-subject", connectionId, true);
  });

  it("does not retain the Robinhood-only route surface", async () => {
    const app = createApp({
      investmentConnectionsRepository: repository(),
      plaidClient: client(),
    });
    const responses = await Promise.all([
      app.request("/api/public-holdings/robinhood/status", undefined, env()),
      app.request(
        "/api/public-holdings/robinhood/link-token",
        { method: "POST", headers: { Origin: "http://localhost" } },
        env(),
      ),
      app.request(
        "/api/public-holdings/robinhood/exchange",
        { method: "POST", headers: { Origin: "http://localhost" } },
        env(),
      ),
      app.request(
        "/api/public-holdings/robinhood/sync",
        { method: "POST", headers: { Origin: "http://localhost" } },
        env(),
      ),
      app.request(
        "/api/public-holdings/robinhood",
        { method: "DELETE", headers: { Origin: "http://localhost" } },
        env(),
      ),
    ]);

    expect(responses.map((response) => response.status)).toEqual([
      404, 404, 404, 404, 404,
    ]);
  });
});
