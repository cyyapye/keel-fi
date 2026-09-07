import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  legalDocumentTestDatabase,
  syntheticAgreementPdf,
  syntheticDocumentScan,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import { extractLegalNameFromPages } from "../../../scripts/legal-document-extraction";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "./holding-imports";
import { D1ProviderPortfolioAgentRepository } from "./provider-portfolio-agent";
import { D1ProviderLegalDocumentRepository } from "./provider-legal-documents";
import { D1InvestmentReviewRepository } from "./investment-review";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1LegalEntityRepository } from "./legal-entities";
import {
  type InvestmentReviewContext,
  type InvestmentOwnershipInput,
} from "@keel/domain/investment-review";
import { legalEntityExportRows } from "../../../apps/api/src/legal-entity-export";

const subject = "synthetic-access-subject";
const now = "2026-09-01T12:00:00.000Z";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let d1: LegalDocumentTestD1;
let repository: D1InvestmentReviewRepository;
let positionId: string;
let input: HoldingImportStageInput;
const base = (context: InvestmentReviewContext) => ({
  requestId: crypto.randomUUID(),
  expectedReviewId: context.review?.id ?? null,
  expectedSnapshotId: context.snapshotId,
  expectedEvidenceRevision: context.evidenceRevision,
  participationStatus:
    context.review?.participationStatus ?? context.defaultParticipationStatus,
});

it("converges concurrent duplicate reviews and rejects reused request IDs", async () => {
  const context = await repository.getContext(subject, positionId);
  const request = { ...base(context), participationStatus: "pending" as const };
  const results = await Promise.all([
    repository.review(subject, positionId, request),
    repository.review(subject, positionId, request),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    d1.sqlite
      .prepare("SELECT COUNT(*) count FROM holding_investment_reviews")
      .get(),
  ).toMatchObject({ count: 1 });
  await expect(
    repository.review(subject, positionId, {
      ...request,
      participationStatus: "cancelled",
    }),
  ).rejects.toMatchObject({ code: "stale" });
});

it("fails closed when a scan changes between validation and commit", async () => {
  const context = await repository.getContext(subject, positionId);
  const doc = context.documents[0]!;
  d1.beforeBatch = () => {
    const scan = {
      ...doc.scan!,
      outcome: "blocked",
      scannedAt: "2026-09-02T12:00:00.000Z",
    };
    d1.sqlite
      .prepare(
        "UPDATE private_document_scans SET outcome = 'blocked', scanned_at = ?, scan_json = ? WHERE document_id = ?",
      )
      .run(scan.scannedAt, JSON.stringify(scan), doc.id);
  };
  await expect(
    repository.review(subject, positionId, base(context)),
  ).rejects.toMatchObject({ code: "stale" });
  expect(
    d1.sqlite
      .prepare("SELECT COUNT(*) count FROM holding_investment_reviews")
      .get(),
  ).toMatchObject({ count: 0 });
});

it("keeps detail reads at seven indexed queries with 128 investment targets", async () => {
  const insert = d1.sqlite
    .prepare(`INSERT INTO holding_positions (id, household_id, provider, position_fingerprint, legal_vehicle_name, owner_label, position_kind, instrument_type, opened_on, currency, created_by, created_at)
    SELECT ?, household_id, provider, ?, ?, owner_label, position_kind, instrument_type, opened_on, currency, created_by, created_at FROM holding_positions WHERE id = ?`);
  for (let index = 0; index < 128; index += 1)
    insert.run(
      `synthetic-scale-${index}`,
      digest(`scale-${index}`),
      `Synthetic Scale ${index}`,
      positionId,
    );
  d1.queries.length = 0;
  const context = await repository.getContext(subject, positionId);
  expect(context.otherPositions.length).toBeGreaterThanOrEqual(128);
  expect(d1.queries).toHaveLength(7);
  const details = d1.queries.flatMap((sql) =>
    d1.sqlite
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...Array.from({ length: sql.split("?").length - 1 }, () => null))
      .map((row) => String(row.detail)),
  );
  expect(
    details.filter((detail) =>
      /SCAN (later|accepted_later|holding_investment_reviews|investment_document_assignments)/u.test(
        detail,
      ),
    ),
  ).toEqual([]);
  expect(
    details.some((detail) =>
      detail.includes("holding_investment_reviews_current_idx"),
    ),
  ).toBe(true);
  expect(
    details.some((detail) =>
      detail.includes("investment_document_assignment_target_idx"),
    ),
  ).toBe(true);
});

it("exports a separate cancelled investment and its company proof without inventing money", async () => {
  const original = await repository.getContext(subject, positionId);
  const created = await repository.createRelated(subject, positionId, {
    ...base(original),
    label: "Synthetic Cancelled Vehicle",
    participationStatus: "cancelled",
    documentIds: [original.documents[2]!.id],
  });
  const context = await repository.getContext(subject, created.positionId);
  await repository.reviewCompany(subject, created.positionId, {
    requestId: crypto.randomUUID(),
    expectedSnapshotId: null,
    expectedEvidenceRevision: context.evidenceRevision,
    expectedMappingIds: [],
    company: { mode: "new", legalName: "Synthetic Robotics Inc." },
    basis: "document_choice",
    citation: context.companyChoices[0]!,
    reason: null,
  });
  const view = await new D1InvestmentPositionViewRepository(d1.asD1()).list(
    subject,
    now,
  );
  const entities = new D1LegalEntityRepository(d1.asD1());
  const inventory = await entities.getState(subject, view);
  const rows = legalEntityExportRows(inventory, {
    fields: ["legal_name"],
    includeNeedsReview: true,
    includeHistorical: true,
    includeOtherEntityTypes: true,
  });
  const cancelled = rows.find(
    (row) => row.source_record === "Synthetic Cancelled Vehicle",
  );
  expect(cancelled).toMatchObject({
    commitment: "Not recorded",
    current_value: "Not recorded",
    funded: "Not recorded",
    underlying_company: "Synthetic Cancelled Vehicle: Synthetic Robotics Inc.",
  });
  expect(cancelled?.company_evidence).toContain(
    "Underlying Company: Synthetic Robotics Inc.",
  );
  expect(
    legalEntityExportRows(inventory, {
      fields: ["legal_name"],
      includeNeedsReview: true,
      includeHistorical: false,
      includeOtherEntityTypes: true,
    }).some((row) => row.source_record === "Synthetic Cancelled Vehicle"),
  ).toBe(false);
  const entity = await entities.create(
    subject,
    {
      profile: {
        legalName: "Synthetic Cancelled Vehicle LLC",
        entityType: "llc",
        relationship: "investment_vehicle",
        currentOwner: null,
        jurisdiction: null,
        formedOn: null,
        einLastFour: null,
        ownershipInterestPpm: null,
        interestStatus: "unknown",
        taxClassification: null,
        notes: null,
      },
      source: {
        reference: { kind: "holding_position", id: created.positionId },
        expectedDecisionId: null,
      },
    },
    view,
  );
  expect(entity.sources[0]?.investmentReview?.participationStatus).toBe(
    "cancelled",
  );
  expect(entity.sources[0]?.companyReview?.companyName).toBe(
    "Synthetic Robotics Inc.",
  );
});
beforeEach(async () => {
  d1 = legalDocumentTestDatabase();
  repository = new D1InvestmentReviewRepository(d1.asD1());
  input = {
    provider: "sydecar",
    formatVersion: 3,
    objectKey: "holding-imports/synthetic-spv.csv",
    sha256: digest("synthetic import"),
    byteSize: 1024,
    effectiveDate: "2026-09-01",
    retrievedAt: now,
    rows: [1, 2].map((index) => ({
      rowNumber: index + 2,
      naturalKeySha256: digest(`row ${index}`),
      providerInvestmentId: `synthetic-investment-${index}`,
      companyOrFund: `Synthetic Growth ${index}`,
      fundName: `Synthetic Growth ${index} SPV`,
      investmentEntity: "Synthetic Family LLC",
      status: "Live",
      investDate: "2026-08-01",
      investedMinor: index * 1_000_000,
      unrealizedValueMinor: null,
      unrealizedValueState: "not_reported",
      realizedValueMinor: 0,
      netValueMinor: null,
      netValueState: "not_reported",
      positionKind: "spv_interest",
      dealMetadata: {
        allocationMinor: index * 1_000_000,
        instrument: "SPV interest",
        managementFeePpm: 10_000,
        carryPpm: 200_000,
      },
    })),
    canonicalScope: {
      connection: {
        mode: "ensure",
        adapterType: "manual",
        protectedSourceKey: digest("source"),
        institutionKey: "sydecar",
        institutionLabel: "Sydecar",
        lifecycleState: "pending",
        credentialReference: null,
      },
      containers: [
        {
          protectedAccountKey: digest("holder"),
          displayLabel: "Synthetic Family LLC",
          containerKind: "entity",
          taxTreatment: "unknown",
          completeness: "partial",
        },
      ],
      rows: [1, 2].map((index) => ({
        sourceRowNumber: index + 2,
        protectedAccountKey: digest("holder"),
        protectedPositionKey: digest(`position ${index}`),
      })),
    },
  };
  const imports = new D1HoldingImportRepository(d1.asD1());
  const staged = await imports.stageHoldingImport(subject, input);
  await imports.applyHoldingImport(subject, staged.preview.id, {
    currency: "USD",
    decisions: staged.preview.rows.map((row) => ({
      rowId: row.id,
      decision: "accepted",
      rationale: "Reviewed synthetic investment.",
    })),
  });
  positionId = (
    d1.sqlite
      .prepare(
        "SELECT id FROM holding_positions WHERE position_fingerprint = ?",
      )
      .get(digest("position 1")) as { id: string }
  ).id;
  const agents = new D1ProviderPortfolioAgentRepository(
    d1.asD1(),
    () => new Date(now),
  );
  await agents.register(subject, "sydecar");
  await agents.requestRun(subject, "sydecar");
  const run = (await agents.lease(subject, "sydecar")).run!;
  const documents = new D1ProviderLegalDocumentRepository(
    d1.asD1(),
    () => new Date(now),
  );
  const lease = await documents.lease(
    subject,
    "sydecar",
    run.id,
    run.leaseToken,
  );
  const captured = [
    "Synthetic Active Vehicle LLC",
    "Synthetic Active Vehicle LLC",
    "Synthetic Cancelled Vehicle LLC",
  ].map((name, index) => {
    const lines = [
      `Fund: ${name}`,
      "Underlying Company: Synthetic Robotics Inc.",
      `Agreement version ${index}`,
    ];
    const bytes = syntheticAgreementPdf(lines);
    return {
      documentKey: digest(`document ${index}`),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fileName: `synthetic-agreement-${index}.pdf`,
      byteSize: bytes.length,
      checkedAt: now,
      scan: syntheticDocumentScan(bytes),
      extraction: extractLegalNameFromPages([lines.join("\n")]),
    };
  });
  await documents.record(
    lease,
    digest("position 1"),
    {
      version: 1,
      naturalKeySha256: digest("row 1"),
      ownershipLabel: "Synthetic Family LLC",
      sourceInvestment: {
        id: "synthetic-investment-1",
        association: "investment_page",
      },
      problem: null,
      documents: captured,
    },
    captured.map((doc) => ({
      sha256: doc.sha256,
      objectKey: `legal-entity-documents/hh_demo/${doc.sha256}.pdf`,
    })),
  );
});
afterEach(() => d1.sqlite.close());

describe("connected investment review", () => {
  it("loads existing amounts with bounded projection-only queries and needs no K-1", async () => {
    d1.queries.length = 0;
    const context = await repository.getContext(subject, positionId);
    expect(context).toMatchObject({
      committedMinor: 1_000_000,
      fundedMinor: 1_000_000,
      defaultParticipationStatus: "current",
      review: null,
    });
    expect(context.companyChoices).toHaveLength(3);
    expect(d1.queries).toHaveLength(7);
    expect(d1.queries.every((sql) => /^SELECT/u.test(sql))).toBe(true);
    const reviewed = await repository.review(
      subject,
      positionId,
      base(context),
    );
    expect(reviewed.ownershipObservations).toEqual([]);
    expect(reviewed.participationStatus).toBe("current");
  });
  it("splits a cancelled agreement into a separate investment without copying money or dissolving the entity", async () => {
    const context = await repository.getContext(subject, positionId);
    const cancelled = context.documents.find(
      (doc) =>
        doc.citations?.[0]?.legalName === "Synthetic Cancelled Vehicle LLC",
    )!;
    const request = {
      ...base(context),
      documentIds: [cancelled.id],
      label: "Synthetic Cancelled Vehicle LLC",
      participationStatus: "cancelled" as const,
    };
    const created = await repository.createRelated(
      subject,
      positionId,
      request,
    );
    expect(
      await repository.createRelated(subject, positionId, request),
    ).toEqual(created);
    expect(
      await repository.getContext(subject, created.positionId),
    ).toMatchObject({
      committedMinor: null,
      fundedMinor: null,
      snapshotId: null,
      economics: null,
      review: { participationStatus: "cancelled" },
    });
    const view = await new D1InvestmentPositionViewRepository(d1.asD1()).list(
      subject,
      "2026-09-02T12:00:00.000Z",
    );
    const positions = view.connections.flatMap((connection) =>
      connection.containers.flatMap((container) => container.positions),
    );
    expect(positions).toHaveLength(2);
    expect(
      positions.reduce((sum, p) => sum + p.snapshot.investedMinor, 0),
    ).toBe(3_000_000);
    expect(
      positions.find((p) => p.id === positionId)?.legalEntityNameEvidence,
    ).toMatchObject({
      legalName: "Synthetic Active Vehicle LLC",
      documents: [{}, {}],
    });
    const inventory = await new D1LegalEntityRepository(d1.asD1()).getState(
      subject,
      view,
    );
    expect(
      inventory.candidates.find(
        (candidate) => candidate.source.id === created.positionId,
      ),
    ).toMatchObject({
      investmentReview: { participationStatus: "cancelled" },
      financials: null,
    });
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM holding_position_snapshots WHERE position_id = ?",
        )
        .get(created.positionId),
    ).toEqual({ count: 0 });
  });
  it("reviews two vehicles into one company then corrects only one, preserving versioned mappings", async () => {
    // Clock precision must not decide which accepted correction is current.
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue(now);
    const context = await repository.getContext(subject, positionId);
    const request = {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      expectedMappingIds: context.mappings.map((m) => m.id),
      company: { mode: "new" as const, legalName: "Synthetic Robotics Inc." },
      basis: "document_choice" as const,
      citation: context.companyChoices[0]!,
      reason: null,
    };
    const receipt = await repository.reviewCompany(
      subject,
      positionId,
      request,
    );
    expect(
      await repository.reviewCompany(subject, positionId, request),
    ).toEqual(receipt);
    const secondId = context.otherPositions[0]!.id;
    const second = await repository.getContext(subject, secondId);
    await repository.reviewCompany(subject, secondId, {
      ...request,
      requestId: crypto.randomUUID(),
      expectedSnapshotId: second.snapshotId,
      expectedEvidenceRevision: second.evidenceRevision,
      expectedMappingIds: second.mappings.map((m) => m.id),
      company: { mode: "existing", companyId: receipt.companyId },
      basis: "user_confirmed",
      citation: null,
    });
    expect(
      (await repository.getContext(subject, secondId)).mappings.filter(
        (m) => m.status === "active",
      ),
    ).toMatchObject([{ companyId: receipt.companyId }]);
    const current = await repository.getContext(subject, positionId);
    await repository.reviewCompany(subject, positionId, {
      ...request,
      requestId: crypto.randomUUID(),
      expectedMappingIds: current.mappings.map((m) => m.id),
      company: { mode: "new", legalName: "Synthetic Different Company" },
      basis: "user_confirmed",
      citation: null,
    });
    const corrected = await repository.getContext(subject, positionId);
    expect(corrected.companyReceipt?.companyName).toBe(
      "Synthetic Different Company",
    );
    expect(
      d1.sqlite
        .prepare(
          "SELECT version, recorded_at FROM investment_company_reviews WHERE position_id = ? ORDER BY version",
        )
        .all(positionId),
    ).toEqual([
      { version: 1, recorded_at: now },
      { version: 2, recorded_at: now },
    ]);
    vi.restoreAllMocks();
    expect(
      corrected.mappings.filter((m) => m.status === "active"),
    ).toMatchObject([{ companyName: "Synthetic Different Company" }]);
    expect(
      (await repository.getContext(subject, secondId)).mappings.filter(
        (m) => m.status === "active",
      ),
    ).toMatchObject([{ companyId: receipt.companyId }]);
    expect(
      d1.sqlite
        .prepare(
          "SELECT COUNT(*) count FROM holding_position_exposure_mappings WHERE position_id = ? AND decision_source = 'review'",
        )
        .get(positionId),
    ).toEqual({ count: 3 });
    await expect(
      repository.reviewCompany(subject, positionId, {
        ...request,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });
  it("preserves K-1 profit, loss and capital shares and amendments without filling missing shares", async () => {
    const context = await repository.getContext(subject, positionId);
    const observation: InvestmentOwnershipInput = {
      sourceKind: "k1",
      sourceLabel: "Synthetic K-1",
      effectiveDate: null,
      taxYear: 2025,
      ownershipPpm: null,
      profitBeginningPpm: null,
      profitEndingPpm: 12_000,
      lossBeginningPpm: null,
      lossEndingPpm: null,
      capitalBeginningPpm: 0,
      capitalEndingPpm: 8_000,
      documentId: null,
      page: null,
      quote: null,
      supersedesObservationId: null,
    };
    const request = { ...base(context), ownershipObservation: observation };
    const first = await repository.review(subject, positionId, request);
    expect(await repository.review(subject, positionId, request)).toEqual(
      first,
    );
    const current = await repository.getContext(subject, positionId);
    const amended = await repository.review(subject, positionId, {
      ...base(current),
      ownershipObservation: {
        ...observation,
        profitEndingPpm: 13_000,
        supersedesObservationId: first.ownershipObservations[0]!.id,
      },
    });
    expect(
      amended.ownershipObservations.map((item) => item.profitEndingPpm),
    ).toEqual([12_000, 13_000]);
    expect(
      amended.ownershipObservations.every(
        (item) => item.lossEndingPpm === null && item.ownershipPpm === null,
      ),
    ).toBe(true);
    expect(amended.ownershipObservations[0]?.evidenceBasis).toBe(
      "user_reported",
    );
    await expect(
      repository.review(subject, positionId, {
        ...request,
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });
  it("rejects forged company citations, cross-household access and security-blocked documents", async () => {
    const context = await repository.getContext(subject, positionId);
    const request = {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: context.snapshotId,
      expectedEvidenceRevision: context.evidenceRevision,
      expectedMappingIds: context.mappings.map((m) => m.id),
      company: { mode: "new" as const, legalName: "Synthetic Fake Company" },
      basis: "document_choice" as const,
      citation: {
        ...context.companyChoices[0]!,
        companyName: "Synthetic Fake Company",
        quote: "Underlying Company: Synthetic Fake Company",
      },
      reason: null,
    };
    await expect(
      repository.reviewCompany(subject, positionId, request),
    ).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(
      repository.getContext("wrong-subject", positionId),
    ).rejects.toMatchObject({ code: "not_found" });
    const document = context.documents[0]!;
    d1.sqlite
      .prepare(
        "UPDATE private_document_scans SET outcome = 'blocked', scan_json = json_set(scan_json, '$.outcome', 'blocked') WHERE document_id = ?",
      )
      .run(document.id);
    await expect(
      repository.createRelated(subject, positionId, {
        ...base(context),
        label: "Synthetic Other",
        documentIds: [document.id],
        participationStatus: "cancelled",
      }),
    ).rejects.toMatchObject({ code: "stale" });
    expect(
      (await repository.getContext(subject, positionId)).companyChoices.some(
        (choice) => choice.documentId === document.id,
      ),
    ).toBe(false);
  });
  it("keeps reviewed decisions through a newer provider snapshot", async () => {
    const context = await repository.getContext(subject, positionId);
    const saved = await repository.review(subject, positionId, {
      ...base(context),
      participationStatus: "historical",
    });
    const imports = new D1HoldingImportRepository(d1.asD1());
    const staged = await imports.stageHoldingImport(subject, {
      ...input,
      sha256: digest("next synthetic import"),
      effectiveDate: "2026-09-02",
      retrievedAt: "2026-09-02T12:00:00.000Z",
      rows: input.rows.map((row) => ({
        ...row,
        investedMinor: row.investedMinor + 10_000,
      })),
    });
    await imports.applyHoldingImport(subject, staged.preview.id, {
      currency: "USD",
      decisions: staged.preview.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
        rationale: "Reviewed new synthetic snapshot.",
      })),
    });
    const after = await repository.getContext(subject, positionId);
    expect(after.snapshotId).not.toBe(context.snapshotId);
    expect(after.review).toEqual(saved);
    expect(after.fundedMinor).toBe(1_010_000);
    await expect(
      repository.review(subject, positionId, {
        ...base(context),
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "stale" });
  });
});
