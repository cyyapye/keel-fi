import { describe, expect, it, vi } from "vitest";
import {
  ManualHoldingError,
  type ManualHoldingRepository,
} from "@keel/database";
import { ManualHoldingInputSchema } from "@keel/domain/manual-holdings";
import { createApp } from "./app";
import type { Env } from "./types";

const submissionId = "57a65095-d112-4309-8bca-bb55acdf5f29";
const receipt = {
  submissionId,
  positionId: "manual_synthetic_position",
  snapshotId: "manual_synthetic_snapshot",
  purchaseReceiptId: "manual_synthetic_purchase",
  identityVersion: 1,
};
const draft = ManualHoldingInputSchema.parse({
  submissionId,
  classification: "private_paper",
  name: "Synthetic API Investment",
  kind: "direct",
  owner: { mode: "new", label: "Synthetic personal" },
  company: { mode: "unassigned" },
  cashPaidMinor: null,
  investmentDate: null,
  valuation: { state: "unknown" },
});
function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}
function repository() {
  return {
    options: vi.fn().mockResolvedValue({
      householdScope: "synthetic_household_scope",
      containers: [],
      legalEntities: [],
      companies: [],
    }),
    create: vi.fn().mockResolvedValue(receipt),
    submission: vi.fn().mockResolvedValue(receipt),
    reviseIdentity: vi
      .fn()
      .mockResolvedValue({ ...receipt, identityVersion: 2 }),
  } satisfies ManualHoldingRepository;
}
describe("manual holdings API", () => {
  it("validates manual input and uses the authenticated household authority", async () => {
    const repo = repository();
    const app = createApp({ manualHoldingRepository: repo });
    const response = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draft),
      },
      env(),
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(receipt);
    expect(repo.create).toHaveBeenCalledWith("synthetic-access-subject", draft);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const invalid = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: JSON.stringify({ ...draft, cashPaidMinor: -1 }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);
    expect(repo.create).toHaveBeenCalledOnce();
    const extra = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: JSON.stringify({ ...draft, householdId: "other-household" }),
      },
      env(),
    );
    expect(extra.status).toBe(400);
    expect(repo.create).toHaveBeenCalledOnce();
  });
  it("keeps check and entry-option GETs projection-only and scoped", async () => {
    const repo = repository();
    const app = createApp({ manualHoldingRepository: repo });
    expect(
      (await app.request("/api/manual-holdings/options", undefined, env()))
        .status,
    ).toBe(200);
    const found = await app.request(
      `/api/manual-holdings/submissions/${submissionId}`,
      undefined,
      env(),
    );
    expect(await found.json()).toEqual({ receipt });
    expect(repo.submission).toHaveBeenCalledWith(
      "synthetic-access-subject",
      submissionId,
    );
    repo.submission.mockResolvedValueOnce(null);
    expect(
      await (
        await app.request(
          `/api/manual-holdings/submissions/${submissionId}`,
          undefined,
          env(),
        )
      ).json(),
    ).toEqual({ receipt: null });
    expect(
      (
        await app.request(
          "/api/manual-holdings/submissions/not-a-uuid",
          undefined,
          env(),
        )
      ).status,
    ).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.reviseIdentity).not.toHaveBeenCalled();
  });
  it("reports known conflicts distinctly from an uncertain server result", async () => {
    const repo = repository();
    const app = createApp({ manualHoldingRepository: repo });
    repo.create.mockRejectedValueOnce(
      new ManualHoldingError("conflict", "Synthetic conflicting submission."),
    );
    const conflict = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: JSON.stringify(draft),
      },
      env(),
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "conflict" });
    repo.create.mockRejectedValueOnce(new Error("Synthetic storage outage"));
    const uncertain = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: JSON.stringify(draft),
      },
      env(),
    );
    expect(uncertain.status).toBe(503);
    expect(await uncertain.text()).toContain(
      "Check Holdings before trying again",
    );
  });
  it("requires explicit identity and mapping revisions for later edits", async () => {
    const repo = repository();
    const app = createApp({ manualHoldingRepository: repo });
    const identity = {
      submissionId,
      expectedVersion: 1,
      expectedMappingIds: ["synthetic_current_mapping"],
      name: "Synthetic Edited Holding",
      kind: "fund_interest",
      owner: {
        mode: "existing",
        containerId: "synthetic_manual_container",
        version: 2,
      },
      company: { mode: "unassigned" },
      investmentDate: null,
    };
    const saved = await app.request(
      "/api/manual-holdings/manual_synthetic_position/identity",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: JSON.stringify(identity),
      },
      env(),
    );
    expect(saved.status).toBe(200);
    expect(repo.reviseIdentity).toHaveBeenCalledWith(
      "synthetic-access-subject",
      "manual_synthetic_position",
      identity,
    );
    const missing = { ...identity, expectedMappingIds: undefined };
    expect(
      (
        await app.request(
          "/api/manual-holdings/manual_synthetic_position/identity",
          {
            method: "POST",
            headers: { Origin: "http://localhost" },
            body: JSON.stringify(missing),
          },
          env(),
        )
      ).status,
    ).toBe(400);
    expect(repo.reviseIdentity).toHaveBeenCalledOnce();
  });
  it("bounds input before parsing and fails closed in production", async () => {
    const repo = repository();
    const app = createApp({ manualHoldingRepository: repo });
    const large = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: " ".repeat(16_385),
      },
      env(),
    );
    expect(large.status).toBe(413);
    expect(repo.create).not.toHaveBeenCalled();
    const production = { ...env(), ENVIRONMENT: "production" };
    const denied = await app.request(
      "/api/manual-holdings",
      {
        method: "POST",
        headers: { Origin: "http://localhost" },
        body: JSON.stringify(draft),
      },
      production,
    );
    expect(denied.status).toBeGreaterThanOrEqual(400);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
