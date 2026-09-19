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
import { D1PositionEconomicsRepository } from "./position-economics";
import { D1HoldingsPageRepository } from "./holdings-page";
import { calculatePositionEconomics } from "@keel/domain/position-economics";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1AlphaRepository } from "./index";
import { D1PortfolioBaselineRepository } from "./portfolio-baseline";
import { createPortfolioDashboardSnapshot } from "@keel/domain/portfolio-dashboard";
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

it("reads reviewed net capital through detail and holdings without rewriting the import", async () => {
  const original = await repository.getContext(subject, positionId);
  const economics = new D1PositionEconomicsRepository(d1.asD1());
  const request = {
    expectedSnapshotId: original.snapshotId!,
    expectedTermsId: null,
    capitalBasis: "net_invested" as const,
    grossCommitmentMinor: 1_250_000,
    annualAdminFeePpm: 150_000,
    adminFeeYears: 1,
    setupFeePpm: 50_000,
    carryPpm: 150_000,
    note: "Synthetic net capital reconciled to the subscription.",
  };
  await expect(
    economics.accept(subject, positionId, {
      ...request,
      grossCommitmentMinor: 1_250_001,
    }),
  ).rejects.toMatchObject({ code: "capital_mismatch" });
  const first = await economics.accept(subject, positionId, request);
  const second = await economics.accept(subject, positionId, {
    ...request,
    expectedTermsId: first.id,
    carryPpm: 180_000,
  });
  await expect(
    economics.accept(subject, positionId, {
      ...request,
      expectedTermsId: first.id,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const detail = await repository.getContext(subject, positionId);
  expect(detail).toMatchObject({
    snapshotId: original.snapshotId,
    committedMinor: 1_000_000,
    fundedMinor: 1_000_000,
  });
  expect(detail.economics?.acceptedTerms).toEqual(second);
  expect(calculatePositionEconomics(detail.economics!)).toMatchObject({
    committedMinor: 1_250_000,
    upfrontAdminFeeMinor: 187_500,
    setupFeeMinor: 62_500,
    positionCostBasisMinor: 1_000_000,
  });
  const page = await new D1HoldingsPageRepository(d1.asD1()).getPage(
    subject,
    "configuration_required",
  );
  expect(
    page.holdings.find((holding) => holding.id === positionId)
      ?.positionEconomicsContext?.acceptedTerms,
  ).toEqual(second);
  const view = await new D1InvestmentPositionViewRepository(d1.asD1()).list(
    subject,
    now,
  );
  const inventory = await new D1LegalEntityRepository(d1.asD1()).getState(
    subject,
    view,
  );
  const rows = legalEntityExportRows(inventory, {
    fields: ["legal_name", "fee_and_carry"],
    includeNeedsReview: true,
    includeHistorical: true,
    includeOtherEntityTypes: true,
  });
  const exported = rows.find((row) =>
    row.source_record.includes("Synthetic Growth 1"),
  );
  expect(exported?.commitment).toContain(
    "USD 12500.00 (reviewed gross; imported net USD 10000.00)",
  );
  expect(exported?.funded).toContain("USD 10000.00 (imported net of fees)");
  expect(exported?.fee_and_carry).toContain("setup fee 5%");
  expect(
    d1.sqlite
      .prepare(
        "SELECT COUNT(*) count FROM holding_position_economics_proposals WHERE position_id = ?",
      )
      .get(positionId),
  ).toEqual({ count: 2 });
  expect(() =>
    d1.sqlite
      .prepare(
        "UPDATE holding_position_economics_proposals SET gross_commitment_minor = 1 WHERE id = ?",
      )
      .run(first.id),
  ).toThrow(/immutable/u);
  expect(() =>
    d1.sqlite
      .prepare(
        `INSERT INTO holding_position_economics_proposals (
    id, household_id, position_id, snapshot_id, supersedes_proposal_id, commitment_minor, funded_minor,
    capital_basis, gross_commitment_minor, setup_fee_ppm, annual_admin_fee_ppm, admin_fee_years, carry_ppm, note, created_by, created_at, immutable
  ) SELECT 'synthetic-invalid-capital', household_id, position_id, snapshot_id, id, commitment_minor, funded_minor,
    capital_basis, gross_commitment_minor + 1, setup_fee_ppm, annual_admin_fee_ppm, admin_fee_years, carry_ppm, note, created_by, created_at, immutable
    FROM holding_position_economics_proposals WHERE id = ?`,
      )
      .run(second.id),
  ).toThrow(/net capital does not reconcile/u);
});

it("reads back successive document assignments without dropping the first decision", async () => {
  let context = await repository.getContext(subject, positionId);
  const first = context.documents[0]!;
  const second = context.documents[1]!;
  await repository.review(subject, positionId, {
    ...base(context),
    documentAssignments: [
      {
        documentId: first.id,
        sha256: first.sha256,
        relationship: "supports",
        targetPositionId: null,
      },
    ],
  });
  context = await repository.getContext(subject, positionId);
  expect(context.review?.documentAssignments).toEqual([
    {
      documentId: first.id,
      sha256: first.sha256,
      relationship: "supports",
      targetPositionId: null,
    },
  ]);
  await repository.review(subject, positionId, {
    ...base(context),
    documentAssignments: [
      {
        documentId: second.id,
        sha256: second.sha256,
        relationship: "general",
        targetPositionId: null,
      },
    ],
  });
  const reloaded = await repository.getContext(subject, positionId);
  expect(reloaded.review?.documentAssignments).toHaveLength(2);
  expect(reloaded.review?.documentAssignments).toEqual(
    expect.arrayContaining([
      {
        documentId: first.id,
        sha256: first.sha256,
        relationship: "supports",
        targetPositionId: null,
      },
      {
        documentId: second.id,
        sha256: second.sha256,
        relationship: "general",
        targetPositionId: null,
      },
    ]),
  );
  expect(reloaded.committedMinor).toBe(context.committedMinor);
  expect(reloaded.fundedMinor).toBe(context.fundedMinor);
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
  it("links an exact agreement citation to an existing portfolio company without creating a duplicate", async () => {
    const context = await repository.getContext(subject, positionId);
    const siblingId = context.otherPositions[0]!.id;
    const sibling = await repository.getContext(subject, siblingId);
    const canonical = await repository.reviewCompany(subject, siblingId, {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: sibling.snapshotId,
      expectedEvidenceRevision: sibling.evidenceRevision,
      expectedMappingIds: sibling.mappings.map((mapping) => mapping.id),
      company: { mode: "new", legalName: "Synthetic Robotics" },
      basis: "user_confirmed",
      citation: null,
      reason: null,
    });
    const before = await repository.getContext(subject, positionId);
    const request = {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: before.snapshotId,
      expectedEvidenceRevision: before.evidenceRevision,
      expectedMappingIds: before.mappings.map((mapping) => mapping.id),
      company: { mode: "existing" as const, companyId: canonical.companyId },
      basis: "document_link" as const,
      citation: before.companyChoices[0]!,
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
    const after = await repository.getContext(subject, positionId);
    expect(after.companyReceipt).toMatchObject({
      basis: "document_link",
      companyId: canonical.companyId,
      companyName: "Synthetic Robotics",
      citation: { ...request.citation, companyName: "Synthetic Robotics Inc." },
      sourceDocument: {
        id: request.citation.documentId,
        sha256: request.citation.sha256,
      },
    });
    expect(after.companies).toHaveLength(before.companies.length);
    expect(after.snapshotId).toBe(before.snapshotId);
    expect(after.committedMinor).toBe(before.committedMinor);
    expect(after.fundedMinor).toBe(before.fundedMinor);
    expect(
      after.mappings.filter((mapping) => mapping.status === "active"),
    ).toMatchObject([{ companyId: canonical.companyId }]);
    expect(
      (await repository.getContext(subject, siblingId)).companyReceipt,
    ).toEqual(canonical);
    const positionView = await new D1InvestmentPositionViewRepository(
      d1.asD1(),
    ).list(subject, now);
    const inventory = await new D1LegalEntityRepository(d1.asD1()).getState(
      subject,
      positionView,
    );
    const exported = legalEntityExportRows(inventory, {
      fields: ["legal_name"],
      includeNeedsReview: true,
      includeHistorical: true,
      includeOtherEntityTypes: true,
    });
    expect(
      exported.some((row) =>
        row.company_evidence.includes(
          "User-confirmed company link to Synthetic Robotics; agreement names Synthetic Robotics Inc.",
        ),
      ),
    ).toBe(true);
    const current = {
      ...request,
      requestId: crypto.randomUUID(),
      expectedMappingIds: after.mappings.map((mapping) => mapping.id),
    };
    await expect(
      repository.reviewCompany(subject, positionId, {
        ...current,
        citation: {
          ...request.citation,
          quote: "Forged Synthetic Robotics Inc. quote",
        },
      }),
    ).rejects.toMatchObject({ code: "invalid_evidence" });
    await expect(
      repository.reviewCompany(subject, positionId, {
        ...current,
        company: { mode: "existing", companyId: "company_other_household" },
      }),
    ).rejects.toMatchObject({ code: "invalid_evidence" });
  });
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
      closure: {
        endedOn: "2026-08-25",
        reason: "unwound",
        note: "Synthetic closure survives a newer source",
        replacementPositionId: context.otherPositions[0]!.id,
      },
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

it("reads historical closure back, excludes its value once, and preserves documents, distributions, snapshots and its replacement", async () => {
  const imports = new D1HoldingImportRepository(d1.asD1());
  const staged = await imports.stageHoldingImport(subject, {
    ...input,
    sha256: digest("synthetic distribution import"),
    effectiveDate: "2026-09-02",
    retrievedAt: "2026-09-02T12:00:00.000Z",
    rows: input.rows.map((row) => ({ ...row, realizedValueMinor: 125_000 })),
  });
  await imports.applyHoldingImport(subject, staged.preview.id, {
    currency: "USD",
    decisions: staged.preview.rows.map((row) => ({
      rowId: row.id,
      decision: "accepted",
      rationale: "Reviewed synthetic distribution.",
    })),
  });
  const holdings = new D1HoldingsPageRepository(d1.asD1());
  const baselines = new D1PortfolioBaselineRepository(d1.asD1());
  const before = await holdings.getPage(subject, "available");
  const beforeDashboard = createPortfolioDashboardSnapshot(
    before.investmentHoldings,
    await baselines.getState(subject),
  );
  const context = await repository.getContext(subject, positionId);
  const replacement = context.otherPositions[0]!;
  const original = d1.sqlite
    .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
    .all();
  const forecasts = d1.sqlite
    .prepare("SELECT * FROM forecast_snapshots ORDER BY id")
    .all();
  const request = {
    ...base(context),
    participationStatus: "historical" as const,
    closure: {
      endedOn: "2026-08-25",
      reason: "unwound" as const,
      note: "Fully refunded (synthetic note)",
      replacementPositionId: replacement.id,
    },
  };
  const saved = await repository.review(subject, positionId, request);
  expect(await repository.review(subject, positionId, request)).toEqual(saved);
  const reloaded = await repository.getContext(subject, positionId);
  expect(reloaded.review?.closure).toEqual({
    ...request.closure,
    replacementPositionLabel: replacement.label,
  });
  expect(reloaded.documents).toEqual(context.documents);
  expect(reloaded.fundedMinor).toBe(context.fundedMinor);
  const after = await holdings.getPage(subject, "available");
  expect(after.holdings.some((item) => item.id === positionId)).toBe(false);
  const legacy = await new D1AlphaRepository(d1.asD1()).getAlphaData(subject);
  expect(legacy.holdings.some((item) => item.id === positionId)).toBe(false);
  expect(legacy.holdings.some((item) => item.id === replacement.id)).toBe(true);
  expect(after.holdings.some((item) => item.id === replacement.id)).toBe(true);
  expect(
    after.investmentHoldings.exposureView.positions.map((item) => item.id),
  ).toEqual([replacement.id]);
  const oldValue = before.investmentHoldings.exposureView.positions.find(
    (item) => item.id === positionId,
  )!.valueMinor!;
  const afterDashboard = createPortfolioDashboardSnapshot(
    after.investmentHoldings,
    await baselines.getState(subject),
  );
  expect(
    BigInt(beforeDashboard.knownPortfolioValueMinor) -
      BigInt(afterDashboard.knownPortfolioValueMinor),
  ).toBe(BigInt(oldValue));
  const historical = after.investmentHoldings.positionView.connections
    .flatMap((c) => c.containers.flatMap((item) => item.positions))
    .find((item) => item.id === positionId)!;
  expect(historical.investmentReview).toEqual(saved);
  expect(historical.snapshot.realizedValueMinor).toBe(125_000);
  expect(
    d1.sqlite
      .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
      .all(),
  ).toEqual(original);
  expect(
    d1.sqlite.prepare("SELECT * FROM forecast_snapshots ORDER BY id").all(),
  ).toEqual(forecasts);
  const inventory = await new D1LegalEntityRepository(d1.asD1()).getState(
    subject,
    after.investmentHoldings.positionView,
  );
  const options = {
    fields: ["legal_name", "closure_details", "current_value"] as const,
    includeNeedsReview: true,
    includeHistorical: true,
    includeOtherEntityTypes: true,
  };
  const exported = legalEntityExportRows(inventory, {
    ...options,
    fields: [...options.fields],
  });
  const row = exported.find((item) =>
    item.source_record.includes("Synthetic Growth 1"),
  )!;
  expect(row.closure_details).toContain(replacement.label);
  expect(row.closure_details).toContain(request.closure.note);
  expect(row.current_value).toContain("Excluded from current holdings");
  expect(
    legalEntityExportRows(inventory, {
      ...options,
      fields: [...options.fields],
      includeHistorical: false,
    }).some((item) => item.source_record.includes("Synthetic Growth 1")),
  ).toBe(false);
  // Independent ownership/document saves must retain the participation metadata.
  const retained = await repository.review(subject, positionId, base(reloaded));
  expect(retained.closure).toEqual(saved.closure);
  const latest = await repository.getContext(subject, positionId);
  await repository.review(subject, positionId, {
    ...base(latest),
    participationStatus: "current",
  });
  expect(
    (await holdings.getPage(subject, "available")).investmentHoldings
      .exposureView.positions,
  ).toHaveLength(2);
  expect(
    (await repository.getContext(subject, positionId)).review?.closure,
  ).toBeNull();
  expect(
    JSON.parse(
      d1.sqlite
        .prepare(
          "SELECT state_json FROM holding_investment_reviews WHERE id = ?",
        )
        .get(saved.id)!.state_json as string,
    ).closure,
  ).toEqual(saved.closure);
});

it("rejects future or pre-opening closure dates and invalid replacement scope without saving", async () => {
  const context = await repository.getContext(subject, positionId);
  const closure = {
    endedOn: null,
    reason: null,
    note: null,
    replacementPositionId: null,
  };
  for (const patch of [
    { endedOn: "2999-01-01" },
    { endedOn: "2026-07-01" },
    { replacementPositionId: positionId },
    { replacementPositionId: "other-household-position" },
  ]) {
    await expect(
      repository.review(subject, positionId, {
        ...base(context),
        participationStatus: "historical",
        closure: { ...closure, ...patch },
      }),
    ).rejects.toMatchObject({ code: "invalid_evidence" });
  }
  expect((await repository.getContext(subject, positionId)).review).toBeNull();
});

it("enforces replacement household scope at commit and keeps an all-historical portfolio out of current totals", async () => {
  d1.sqlite.exec(
    "INSERT INTO users VALUES ('closure-other-user','closure-other-subject','other@example.invalid','Synthetic Other','2026-09-01'); INSERT INTO households VALUES ('closure-other-household','closure-other-user','Synthetic Other','USD','2026-09-01')",
  );
  d1.sqlite
    .prepare(
      `INSERT INTO holding_positions (id,household_id,provider,position_fingerprint,legal_vehicle_name,owner_label,position_kind,instrument_type,opened_on,currency,created_by,created_at)
    SELECT 'closure-other-position','closure-other-household',provider,position_fingerprint,legal_vehicle_name,owner_label,position_kind,instrument_type,opened_on,currency,'closure-other-user',created_at FROM holding_positions WHERE id = ?`,
    )
    .run(positionId);
  const context = await repository.getContext(subject, positionId);
  const replacement = context.otherPositions[0]!.id;
  const saved = await repository.review(subject, positionId, {
    ...base(context),
    participationStatus: "historical",
    closure: {
      endedOn: null,
      reason: null,
      note: null,
      replacementPositionId: replacement,
    },
  });
  const stored = d1.sqlite
    .prepare("SELECT * FROM holding_investment_reviews WHERE id = ?")
    .get(saved.id)!;
  for (const id of [positionId, "closure-other-position"]) {
    const reviewId = crypto.randomUUID();
    const record = {
      ...stored,
      id: reviewId,
      request_id: crypto.randomUUID(),
      request_sha256: digest(id),
      supersedes_review_id: saved.id,
      version: 2,
      state_json: JSON.stringify({
        ...saved,
        id: reviewId,
        version: 2,
        closure: { ...saved.closure, replacementPositionId: id },
      }),
      evidence_guard_json: JSON.stringify({
        ...JSON.parse(stored.evidence_guard_json as string),
        reviewId: saved.id,
      }),
    };
    expect(() =>
      d1.sqlite
        .prepare(
          `INSERT INTO holding_investment_reviews (${Object.keys(record).join(",")}) VALUES (${Object.keys(
            record,
          )
            .map(() => "?")
            .join(",")})`,
        )
        .run(...Object.values(record)),
    ).toThrow(/replacement scope mismatch/u);
  }
  const other = await repository.getContext(subject, replacement);
  await repository.review(subject, replacement, {
    ...base(other),
    participationStatus: "historical",
  });
  const holdings = await new D1HoldingsPageRepository(d1.asD1()).getPage(
    subject,
    "available",
  );
  expect(holdings.investmentHoldings.exposureView.positions).toEqual([]);
  expect(holdings.investmentHoldings.exposureView.exposures).toEqual([]);
  const baseline = await new D1PortfolioBaselineRepository(d1.asD1()).getState(
    subject,
  );
  expect(baseline.positions).toEqual([]);
  expect(
    createPortfolioDashboardSnapshot(holdings.investmentHoldings, baseline)
      .knownExposureValueMinor,
  ).toBe(0);
  expect(
    (await repository.getContext(subject, positionId)).documents.length,
  ).toBeGreaterThan(0);
});
