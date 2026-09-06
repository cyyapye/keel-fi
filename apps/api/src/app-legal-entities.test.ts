import {
  LegalEntityRepositoryError,
  type InvestmentPositionViewRepository,
  type LegalEntityRepository,
} from "@keel/database";
import type {
  LegalEntityInventory,
  LegalEntityProfileInput,
  LegalEntityRecord,
} from "@keel/domain/legal-entities";
import type { InvestmentPositionView } from "@keel/domain/position-read-model";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "./app";
import type { Env } from "./types";

const positionView = {
  asOf: "2026-09-01T12:00:00.000Z",
  connections: [],
} satisfies InvestmentPositionView;

const profile = {
  legalName: "Synthetic Family Holdings LLC",
  entityType: "llc",
  relationship: "ownership_entity",
  currentOwner: null,
  jurisdiction: "Delaware, US",
  formedOn: null,
  einLastFour: null,
  ownershipInterestPpm: null,
  interestStatus: "current",
  taxClassification: null,
  notes: null,
} satisfies LegalEntityProfileInput;

const entity = {
  id: "entity-synthetic",
  versionId: "entity-version-synthetic",
  version: 1,
  recordedAt: "2026-09-01T12:00:00.000Z",
  ...profile,
  sources: [],
} satisfies LegalEntityRecord;

const inventory = {
  version: 3,
  asOf: positionView.asOf,
  entities: [entity],
  candidates: [],
  excludedCandidates: [],
  exactBatch: {
    revision: "a".repeat(64),
    sourceCount: 0,
    entityCount: 0,
    existingEntityCount: 0,
    newEntityCount: 0,
    llcEntityCount: 0,
    limitedPartnershipEntityCount: 0,
    remainingCandidateCount: 0,
  },
} satisfies LegalEntityInventory;

function env(): Env {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    ENVIRONMENT: "local",
    INGESTION_QUEUE: {} as Queue,
  };
}

function repositories(overrides: Partial<LegalEntityRepository> = {}) {
  const positionList = vi.fn().mockResolvedValue(positionView);
  const investmentPositionViewRepository = {
    list: positionList,
  } satisfies InvestmentPositionViewRepository;
  const legalEntityRepository = {
    getState: vi.fn().mockResolvedValue(inventory),
    create: vi.fn().mockResolvedValue(entity),
    update: vi.fn().mockResolvedValue(entity),
    reviewSource: vi
      .fn()
      .mockResolvedValue({ version: 1, decisionId: "decision-synthetic" }),
    applyExactBatch: vi.fn().mockResolvedValue({
      version: 1,
      reviewedSourceCount: 2,
      entityCount: 1,
      existingEntityCount: 0,
      createdEntityCount: 1,
      remainingCandidateCount: 0,
    }),
    ...overrides,
  } satisfies LegalEntityRepository;
  return {
    investmentPositionViewRepository,
    legalEntityRepository,
    positionList,
  };
}

describe("legal entity API", () => {
  it("validates a source-bound resolution and carries it across both write routes", async () => {
    const options = repositories();
    const app = createApp(options);
    const nameResolution = {
      kind: "document_choice",
      documentId: "11111111-1111-4111-8111-111111111111",
      legalName: profile.legalName,
      page: 1,
      quote: `Issuer: ${profile.legalName}`,
      reason: null,
      expectedEvidenceRevision: "a".repeat(64),
    };
    const source = { kind: "holding_position", id: "position_synthetic" };
    const create = {
      profile,
      source: { reference: source, expectedDecisionId: null, nameResolution },
    };
    const response = await app.request(
      "/api/legal-entities",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(create),
      },
      env(),
    );
    expect(response.status).toBe(201);
    expect(options.legalEntityRepository.create).toHaveBeenCalledWith(
      "synthetic-access-subject",
      create,
      positionView,
    );
    const review = {
      source,
      expectedDecisionId: null,
      decision: { kind: "linked", legalEntityId: entity.id },
      nameResolution,
    };
    const linked = await app.request(
      "/api/legal-entity-sources/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(review),
      },
      env(),
    );
    expect(linked.status).toBe(201);
    expect(options.legalEntityRepository.reviewSource).toHaveBeenCalledWith(
      "synthetic-access-subject",
      review,
      positionView,
    );
    const invalid = await app.request(
      "/api/legal-entities",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...create,
          source: {
            ...create.source,
            nameResolution: { ...nameResolution, quote: "Unrelated text" },
          },
        }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);
    expect(options.legalEntityRepository.create).toHaveBeenCalledTimes(1);
  });
  it("returns a private, projection-backed inventory", async () => {
    const options = repositories();
    const app = createApp(options);

    const response = await app.request("/api/legal-entities", undefined, env());

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(inventory);
    expect(options.positionList).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.any(String),
    );
    expect(options.legalEntityRepository.getState).toHaveBeenCalledWith(
      "synthetic-access-subject",
      positionView,
    );
  });

  it("validates and creates a reviewed entity against the current source view", async () => {
    const options = repositories();
    const app = createApp(options);
    const body = { profile, source: null };

    const response = await app.request(
      "/api/legal-entities",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      env(),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual(entity);
    expect(options.legalEntityRepository.create).toHaveBeenCalledWith(
      "synthetic-access-subject",
      body,
      positionView,
    );

    const invalid = await app.request(
      "/api/legal-entities",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: { legalName: "" }, source: null }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);
  });

  it("maps stale version updates to an actionable conflict", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(
        new LegalEntityRepositoryError("stale", "synthetic stale version"),
      );
    const options = repositories({ update });
    const app = createApp(options);

    const response = await app.request(
      "/api/legal-entities/entity-synthetic",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersionId: "entity-version-synthetic",
          profile,
        }),
      },
      env(),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "This legal entity record changed. Review it and try again.",
    });
  });

  it("records exact source decisions and returns a non-retained CSV", async () => {
    const options = repositories();
    const app = createApp(options);
    const reviewInput = {
      source: {
        kind: "ownership_container" as const,
        id: "container-synthetic",
      },
      expectedDecisionId: null,
      decision: { kind: "not_llc" as const },
    };
    const reviewResponse = await app.request(
      "/api/legal-entity-sources/review",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reviewInput),
      },
      env(),
    );
    expect(reviewResponse.status).toBe(201);
    expect(options.legalEntityRepository.reviewSource).toHaveBeenCalledWith(
      "synthetic-access-subject",
      reviewInput,
      positionView,
    );

    const exactBatchInput = { expectedRevision: "a".repeat(64) };
    const exactBatchResponse = await app.request(
      "/api/legal-entity-sources/exact-batch",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exactBatchInput),
      },
      env(),
    );
    expect(exactBatchResponse.status).toBe(201);
    expect(exactBatchResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(options.legalEntityRepository.applyExactBatch).toHaveBeenCalledWith(
      "synthetic-access-subject",
      exactBatchInput,
      positionView,
    );

    const exportResponse = await app.request(
      "/api/legal-entity-export",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: ["legal_name", "jurisdiction"],
          includeNeedsReview: true,
          includeHistorical: false,
          includeOtherEntityTypes: false,
        }),
      },
      env(),
    );
    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers.get("Cache-Control")).toBe(
      "private, no-store",
    );
    expect(exportResponse.headers.get("Content-Type")).toContain("text/csv");
    expect(exportResponse.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="keel-legal-entities-\d{4}-\d{2}-\d{2}\.csv"$/u,
    );
    await expect(exportResponse.text()).resolves.toContain(
      '"Legal name","Formation jurisdiction"',
    );
  });
});
