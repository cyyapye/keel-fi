import {
  LegalEntityRepositoryError,
  type InvestmentPositionViewRepository,
  type LegalEntityRepository,
} from "@keel/database";
import {
  LegalEntityExportTableSchema,
  type LegalEntityInventory,
  type LegalEntityProfileInput,
  type LegalEntityRecord,
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
    getState: vi.fn(
      async (
        _subject: string,
        view: InvestmentPositionView | Promise<InvestmentPositionView>,
      ) => {
        await view;
        return inventory;
      },
    ),
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
  it("runs one authenticated automatic batch only on POST and validates its cursor", async () => {
    const options = repositories();
    const resolve = vi.fn().mockResolvedValue({
      processedCount: 120,
      changedCount: 118,
      resolvedCount: 118,
      exceptionCount: 2,
      nextPositionId: "position-next",
    });
    const app = createApp({
      ...options,
      automaticInvestmentReviewRepository: { resolve },
    });
    const read = await app.request("/api/legal-entities", {}, env());
    expect(read.status).toBe(200);
    expect(resolve).not.toHaveBeenCalled();
    const response = await app.request(
      "/api/legal-entities/resolve",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ afterPositionId: null }),
      },
      env(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(resolve).toHaveBeenCalledWith("synthetic-access-subject", null);
    await expect(response.json()).resolves.toMatchObject({ exceptionCount: 2 });
    const invalid = await app.request(
      "/api/legal-entities/resolve",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ afterPositionId: "", householdId: "other" }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);
    expect(resolve).toHaveBeenCalledTimes(1);
    const anonymous = await app.request(
      "/api/legal-entities/resolve",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
        body: "{}",
      },
      { ...env(), ENVIRONMENT: "preview" },
    );
    expect(anonymous.status).toBe(401);
    expect(resolve).toHaveBeenCalledTimes(1);
  });
  it.each([
    undefined,
    "invalid-client",
    "synthetic-client.apps.googleusercontent.com",
  ])(
    "exposes only valid Google export configuration without reading holdings (%s)",
    async (clientId) => {
      const options = repositories();
      const response = await createApp(options).request(
        "/api/legal-entity-export/options",
        {},
        {
          ...env(),
          ...(clientId === undefined
            ? {}
            : { GOOGLE_SHEETS_CLIENT_ID: clientId }),
        },
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      await expect(response.json()).resolves.toEqual({
        googleSheetsClientId: clientId?.endsWith(".apps.googleusercontent.com")
          ? clientId
          : null,
      });
      expect(options.positionList).not.toHaveBeenCalled();
      expect(options.legalEntityRepository.getState).not.toHaveBeenCalled();
    },
  );

  it("exports every selected row from the authenticated projection as a table", async () => {
    const largeInventory = {
      ...inventory,
      entities: Array.from({ length: 120 }, (_, index) => ({
        ...entity,
        id: `synthetic-${index}`,
        legalName: `Synthetic ${String(index).padStart(3, "0")} LLC`,
      })),
    };
    const options = repositories({
      getState: vi.fn().mockResolvedValue(largeInventory),
    });
    const response = await createApp(options).request(
      "/api/legal-entity-export",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fields: ["legal_name", "jurisdiction", "current_owner"],
          includeNeedsReview: true,
          includeHistorical: false,
          includeOtherEntityTypes: true,
        }),
      },
      env(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = LegalEntityExportTableSchema.parse(await response.json());
    expect(body.columns).toEqual([
      "Legal name",
      "Formation jurisdiction",
      "Current titled owner",
    ]);
    expect(body.rows).toHaveLength(120);
    expect(body.rows[119]).toEqual([
      "Synthetic 119 LLC",
      "Delaware, US",
      "Not recorded",
    ]);
    expect(options.positionList).toHaveBeenCalledTimes(1);
    expect(options.legalEntityRepository.getState).toHaveBeenCalledTimes(1);
    expect(options.legalEntityRepository.getState).toHaveBeenCalledWith(
      "synthetic-access-subject",
      positionView,
    );
    expect(options.legalEntityRepository.create).not.toHaveBeenCalled();
  });

  it.each(["/api/legal-entity-export/options", "/api/legal-entity-export"])(
    "keeps %s behind production authentication",
    async (path) => {
      const options = repositories();
      const response = await createApp(options).request(
        path,
        path.endsWith("/options")
          ? {}
          : {
              method: "POST",
              headers: {
                Origin: "http://localhost",
                "Content-Type": "application/json",
              },
              body: "{}",
            },
        { ...env(), ENVIRONMENT: "production" },
      );
      expect(response.status).toBe(401);
      expect(options.positionList).not.toHaveBeenCalled();
      expect(options.legalEntityRepository.getState).not.toHaveBeenCalled();
    },
  );

  it.each(["document_choice", "document_entry", "document_structure"] as const)(
    "validates a source-bound %s and carries it across both write routes",
    async (kind) => {
      const options = repositories();
      const app = createApp(options);
      const nameResolution = {
        kind,
        documentId: "11111111-1111-4111-8111-111111111111",
        legalName: profile.legalName,
        page: 1,
        quote:
          kind === "document_entry" ? null : `Issuer: ${profile.legalName}`,
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
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
          },
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
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
          },
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
          headers: {
            Origin: "http://localhost",
            "Content-Type": "application/json",
          },
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
    },
  );
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
      true,
    );
    expect(options.legalEntityRepository.getState).toHaveBeenCalledWith(
      "synthetic-access-subject",
      expect.any(Promise),
    );
    await expect(
      vi.mocked(options.legalEntityRepository.getState).mock.calls[0]?.[1],
    ).resolves.toEqual(positionView);
  });

  it("validates and creates a reviewed entity against the current source view", async () => {
    const options = repositories();
    const app = createApp(options);
    const body = { profile, source: null };

    const response = await app.request(
      "/api/legal-entities",
      {
        method: "POST",
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
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
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
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
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
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
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
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
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
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
        headers: {
          Origin: "http://localhost",
          "Content-Type": "application/json",
        },
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
