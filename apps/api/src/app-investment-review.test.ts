import { describe, expect, it, vi } from "vitest";
import {
  InvestmentReviewError,
  type InvestmentReviewRepository,
} from "@keel/database";
import type { InvestmentReviewContext } from "@keel/domain/investment-review";
import { createApp } from "./app";
import type { Env } from "./types";

const details: InvestmentReviewContext = {
  positionId: "synthetic-position",
  positionLabel: "Synthetic Growth IV",
  holderLabel: "Synthetic Family LLC",
  snapshotId: null,
  committedMinor: null,
  fundedMinor: null,
  currency: "USD",
  economics: null,
  review: null,
  defaultParticipationStatus: "unknown",
  documents: [],
  evidenceRevision: "a".repeat(64),
  companyChoices: [],
  companies: [],
  mappings: [],
  companyReceipt: null,
  otherPositions: [],
};
const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  expectedReviewId: null,
  expectedSnapshotId: null,
  expectedEvidenceRevision: "a".repeat(64),
  participationStatus: "pending",
};
const review = {
  id: "22222222-2222-4222-8222-222222222222",
  positionId: details.positionId,
  version: 1,
  participationStatus: "pending",
  ownershipObservations: [],
  documentAssignments: [],
  recordedAt: "2026-09-01T12:00:00.000Z",
};
const environment = {
  DB: {} as D1Database,
  DOCUMENTS: {} as R2Bucket,
  ENVIRONMENT: "local",
  INGESTION_QUEUE: {} as Queue,
} satisfies Env;
function setup() {
  const repository = {
    getContext: vi.fn().mockResolvedValue(details),
    review: vi.fn().mockResolvedValue(review),
    reviewCompany: vi.fn(),
    createRelated: vi.fn().mockResolvedValue({ positionId: "synthetic-child" }),
  } satisfies InvestmentReviewRepository;
  return {
    repository,
    app: createApp({ investmentReviewRepository: repository }),
  };
}
describe("connected investment review API", () => {
  it("returns only authenticated household projection data, without storage reads", async () => {
    const { app, repository } = setup();
    const response = await app.request(
      `/api/investment-positions/${details.positionId}/review`,
      {},
      environment,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(details);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(repository.getContext).toHaveBeenCalledWith(
      "synthetic-access-subject",
      details.positionId,
    );
    const unauthorized = await app.request(
      `/api/investment-positions/${details.positionId}/review`,
      {},
      { ...environment, ENVIRONMENT: "production" },
    );
    expect(unauthorized.status).not.toBe(200);
    expect(repository.getContext).toHaveBeenCalledTimes(1);
  });
  it("validates all write boundaries before calling the repository", async () => {
    const { app, repository } = setup();
    for (const suffix of ["review", "company-review", "related-investments"]) {
      const response = await app.request(
        `/api/investment-positions/${details.positionId}/${suffix}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...request,
            ownershipObservation: { ownershipPpm: 1.2 },
          }),
        },
        environment,
      );
      expect(response.status).toBe(400);
    }
    expect(repository.review).not.toHaveBeenCalled();
    expect(repository.reviewCompany).not.toHaveBeenCalled();
    expect(repository.createRelated).not.toHaveBeenCalled();
    const accepted = await app.request(
      `/api/investment-positions/${details.positionId}/review`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
      environment,
    );
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toEqual(review);
  });
  it.each([
    ["stale", 409],
    ["not_found", 404],
    ["invalid_evidence", 400],
  ] as const)(
    "reports %s without losing the client's draft",
    async (code, status) => {
      const { app, repository } = setup();
      repository.review.mockRejectedValue(
        new InvestmentReviewError(code, "Synthetic review problem."),
      );
      const response = await app.request(
        `/api/investment-positions/${details.positionId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
        environment,
      );
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({
        error: "Synthetic review problem.",
      });
      expect(response.headers.get("Cache-Control")).toContain("no-store");
    },
  );
});
