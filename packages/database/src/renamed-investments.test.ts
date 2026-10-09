import { D1PositionPurchaseRepository } from "./position-purchases";
import { reviewedInvestmentFromReceipt } from "@keel/domain/position-purchases";
import {
  renamedInvestmentImport as importInput,
  renamedInvestmentDetails,
} from "../../../scripts/test-support/renamed-investments";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  D1HoldingImportRepository,
  type HoldingImportStageInput,
} from "./holding-imports";
import { D1PositionLinkRepository } from "./position-links";
import { D1InvestmentReviewRepository } from "./investment-review";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1HoldingsPageRepository } from "./holdings-page";
import { effectiveParticipation } from "@keel/domain/investment-review";
const subject = "synthetic-access-subject";
let db: LegalDocumentTestD1;
let links: D1PositionLinkRepository;
async function stage(input: HoldingImportStageInput, accept = true) {
  const repo = new D1HoldingImportRepository(db.asD1());
  const staged = await repo.stageHoldingImport(subject, input);
  const result = {
    ...staged,
    preview: await repo.autoAdjudicatePrivateHoldingImport(
      subject,
      staged.preview.id,
    ),
  };
  if (accept && result.preview.status !== "applied")
    await repo.applyHoldingImport(subject, result.preview.id, {
      currency: "USD",
      decisions: result.preview.rows.map((row) => ({
        rowId: row.id,
        decision: "accepted",
        rationale: "Synthetic identity confirmed.",
      })),
    });
  return result;
}
async function proposal() {
  const w = await links.workspace(subject);
  const source = w.positions.find(
    (p) => p.reportedExposureName === "Synthetic Circuit Works",
  )!;
  const target = w.positions.find(
    (p) => p.reportedExposureName === "Synthetic Circuit Labs",
  )!;
  return {
    sourcePositionId: source.id,
    targetPositionId: target.id,
    expectedSourceSnapshotId: source.snapshot.id,
    expectedTargetSnapshotId: target.snapshot.id,
    expectedSourceParticipationReviewId: source.investmentReview?.id ?? null,
    expectedTargetParticipationReviewId: target.investmentReview?.id ?? null,
    expectedReviewId:
      w.links.find((l) => l.sourcePositionId === source.id)?.id ?? null,
    relationship: "same_investment" as const,
    state: "linked" as const,
    useSourceValue: false,
    companyRenamed: true,
    note: "",
  };
}
beforeEach(async () => {
  db = legalDocumentTestDatabase();
  links = new D1PositionLinkRepository(db.asD1());
  await stage(importInput("Synthetic Circuit Labs", 1));
  await stage(importInput("Synthetic Circuit Works", 2));
  const reviews = new D1InvestmentReviewRepository(db.asD1());
  let companyId: string | undefined;
  for (const p of (await links.workspace(subject)).positions.filter(
    (p) => p.legalVehicleName === "Synthetic Circuit SPV, LP",
  )) {
    const c = await reviews.getContext(subject, p.id);
    const receipt = await reviews.reviewCompany(subject, p.id, {
      requestId: crypto.randomUUID(),
      expectedSnapshotId: c.snapshotId,
      expectedEvidenceRevision: c.evidenceRevision,
      expectedMappingIds: c.mappings.map((m) => m.id),
      company: companyId
        ? { mode: "existing", companyId }
        : { mode: "new", legalName: "Synthetic Circuit Labs" },
      basis: "user_confirmed",
      citation: null,
      reason: null,
    });
    companyId = receipt.companyId;
  }
});
afterEach(() => db.sqlite.close());
it("links a historical renamed investment once with dated terms, no distribution or resurrection, and reversible display", async () => {
  const before = await proposal();
  const purchase = await new D1PositionPurchaseRepository(db.asD1()).accept(
    subject,
    before.targetPositionId,
    {
      expectedSnapshotId: before.expectedTargetSnapshotId,
      expectedReceiptId: null,
      expectedTermsId: null,
      details: renamedInvestmentDetails(),
    },
  );
  const snapshots = db.sqlite
    .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
    .all();
  const receipt = await links.accept(subject, before);
  expect(receipt).toMatchObject({
    companyName: "Synthetic Circuit Works",
    formerCompanyName: "Synthetic Circuit Labs",
    companyRenamed: true,
  });
  const view = await new D1InvestmentPositionViewRepository(db.asD1()).list(
    subject,
  );
  const positions = view.connections
    .flatMap((c) => c.containers.flatMap((c) => c.positions))
    .filter((p) => p.legalVehicleName === "Synthetic Circuit SPV, LP");
  expect(positions).toHaveLength(1);
  expect(effectiveParticipation(positions[0]!)).toBe("historical");
  expect(positions[0]?.snapshot.investedMinor).toBe(310_000);
  expect(positions[0]?.snapshot.realizedValueMinor).toBe(0);
  expect(positions[0]?.purchaseReceipt).toEqual(purchase);
  expect(
    reviewedInvestmentFromReceipt(positions[0]?.purchaseReceipt)?.cashPaidMinor,
  ).toBe(335000);
  expect(positions[0]?.renamedCompany?.name).toBe("Synthetic Circuit Works");
  const w = await links.workspace(subject);
  expect(
    w.positions.find((p) => p.id === before.sourcePositionId)
      ?.reportedEconomicsTerms,
  ).toMatchObject({ carryPpm: 175_000 });
  expect(
    w.positions.find((p) => p.id === before.targetPositionId)
      ?.acceptedEconomicsTerms,
  ).toBeNull();
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    subject,
    "available",
  );
  expect(
    page.holdings.some((p) =>
      [before.sourcePositionId, before.targetPositionId].includes(p.id),
    ),
  ).toBe(false);
  await links.accept(subject, {
    ...before,
    state: "unlinked",
    expectedReviewId: receipt.id,
  });
  const unlinked = (
    await new D1InvestmentPositionViewRepository(db.asD1()).list(subject)
  ).connections
    .flatMap((c) => c.containers.flatMap((c) => c.positions))
    .filter((p) => p.legalVehicleName === "Synthetic Circuit SPV, LP");
  expect(unlinked).toHaveLength(2);
  const history = (
    await new D1PositionPurchaseRepository(db.asD1()).history(
      subject,
      before.targetPositionId,
    )
  ).entries.filter((entry) => entry.kind === "link");
  expect(history).toHaveLength(2);
  expect(
    unlinked.find((p) => p.id === before.targetPositionId)?.purchaseReceipt,
  ).toEqual(purchase);
  expect(
    history.every(
      (entry) => entry.receipt.formerCompanyName === "Synthetic Circuit Labs",
    ),
  ).toBe(true);
  expect(
    unlinked.every(
      (p) =>
        effectiveParticipation(p) === "historical" && p.renamedCompany == null,
    ),
  ).toBe(true);
  expect(
    db.sqlite
      .prepare("SELECT * FROM holding_position_snapshots ORDER BY id")
      .all(),
  ).toEqual(snapshots);
  expect(
    db.sqlite
      .prepare("SELECT count(*) n FROM holding_position_link_reviews")
      .get()?.n,
  ).toBe(2);
});
it("rejects historical valuation, replacement, status conflicts, and unreviewed company mismatches", async () => {
  const p = await proposal();
  await expect(
    links.accept(subject, { ...p, useSourceValue: true }),
  ).rejects.toThrow(/historical/);
  await expect(
    links.accept(subject, {
      ...p,
      companyRenamed: false,
      relationship: "replaced",
    }),
  ).rejects.toThrow(/current SPV/);
  const reviews = new D1InvestmentReviewRepository(db.asD1());
  const c = await reviews.getContext(subject, p.sourcePositionId);
  await reviews.review(subject, p.sourcePositionId, {
    requestId: crypto.randomUUID(),
    expectedReviewId: c.review?.id ?? null,
    expectedSnapshotId: c.snapshotId,
    expectedEvidenceRevision: c.evidenceRevision,
    participationStatus: "current",
  });
  await expect(links.accept(subject, await proposal())).rejects.toThrow(
    /Participation differs/,
  );
});
it("reuses a reviewed provider/account/SPV/date identity for a known alias, and quarantines unknown aliases after reversal", async () => {
  const p = await proposal();
  const receipt = await links.accept(subject, p);
  const incoming = importInput(
    "Synthetic Circuit Works",
    3,
    "rotated-synthetic-key",
  );
  const resolved = await stage(incoming);
  expect(
    db.sqlite
      .prepare(
        "SELECT target_position_id FROM holding_import_rename_aliases WHERE import_row_id=?",
      )
      .get(resolved.preview.rows[0]!.id)?.target_position_id,
  ).toBe(p.targetPositionId);
  expect(
    (await links.workspace(subject)).positions.filter(
      (p) => p.legalVehicleName === "Synthetic Circuit SPV, LP",
    ),
  ).toHaveLength(2);
  const old = (await links.workspace(subject)).positions.find(
    (v) => v.id === p.targetPositionId,
  )!;
  await links.accept(subject, {
    ...p,
    state: "unlinked",
    expectedReviewId: receipt.id,
    expectedTargetSnapshotId: old.snapshot.id,
  });
  const unknown = await stage(
    importInput("Synthetic Circuit Works", 4, "another-rotated-key"),
    false,
  );
  expect(unknown.preview.rows[0]?.adjudicationStatus).toBe("quarantined");
});

it("keeps one reviewed historical legal entity while both dated sources remain reviewable", async () => {
  const { D1LegalEntityRepository } = await import("./legal-entities");
  const legal = new D1LegalEntityRepository(db.asD1());
  const reader = new D1InvestmentPositionViewRepository(db.asD1());
  const p = await proposal();
  const identity = await legal.create(
    subject,
    {
      profile: {
        legalName: "Synthetic Circuit SPV, LP",
        entityType: "limited_partnership",
        relationship: "investment_vehicle",
        currentOwner: "Synthetic Family LLC",
        jurisdiction: null,
        formedOn: null,
        einLastFour: null,
        ownershipInterestPpm: null,
        interestStatus: "historical",
        taxClassification: null,
        notes: null,
      },
      source: {
        reference: { kind: "holding_position", id: p.targetPositionId },
        expectedDecisionId: null,
      },
    },
    await reader.list(subject),
  );
  await links.accept(subject, p);
  const fullView = await reader.list(subject, undefined, true);
  const state = await legal.getState(subject, fullView);
  const candidate = state.candidates.find(
    (c) => c.source.id === p.sourcePositionId,
  )!;
  await legal.reviewSource(
    subject,
    {
      source: candidate.source,
      expectedDecisionId: candidate.currentDecisionId,
      decision: { kind: "linked", legalEntityId: identity.id },
    },
    fullView,
  );
  const after = await legal.getState(
    subject,
    await reader.list(subject, undefined, true),
  );
  const entities = after.entities.filter(
    (e) => e.legalName === "Synthetic Circuit SPV, LP",
  );
  expect(entities).toHaveLength(1);
  expect(entities[0]?.id).toBe(identity.id);
  expect(entities[0]?.interestStatus).toBe("historical");
  expect(entities[0]?.sources).toHaveLength(2);
  expect(
    entities[0]?.sources.find((s) => s.source.id === p.targetPositionId)
      ?.sourceDisplayName,
  ).toBe("Synthetic Circuit Works (formerly Synthetic Circuit Labs)");
});

it("quarantines a later live report for a historical survivor instead of restoring current exposure", async () => {
  const p = await proposal();
  await links.accept(subject, p);
  const incoming = importInput("Synthetic Circuit Labs", 5);
  incoming.rows[0]!.status = "Live";
  const staged = await stage(incoming, false);
  expect(staged.preview.rows[0]?.adjudicationStatus).toBe("quarantined");
  const survivor = (await links.workspace(subject)).positions.find(
    (v) => v.id === p.targetPositionId,
  )!;
  expect(effectiveParticipation(survivor)).toBe("historical");
});

it("fails closed when the reviewed alias is reversed before the import transaction applies", async () => {
  await links.accept(subject, await proposal());
  db.beforeBatch = () => {
    db.sqlite
      .exec(`INSERT INTO holding_position_link_reviews(id,household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,prior_id,relationship,state,use_source_value,note,reviewer_user_id,accepted_at,company_renamed,company_name,former_company_name)
      SELECT 'synthetic-concurrent-undo',household_id,source_position_id,target_position_id,source_snapshot_id,target_snapshot_id,source_participation_review_id,target_participation_review_id,id,relationship,'unlinked',0,'Synthetic concurrent reversal',reviewer_user_id,'2026-09-21T00:00:00.000Z',company_renamed,company_name,former_company_name FROM holding_position_link_reviews WHERE company_renamed=1 AND state='linked'`);
  };
  await expect(
    stage(importInput("Synthetic Circuit Works", 6, "synthetic-race-key")),
  ).rejects.toThrow(/alias stale/);
  expect(
    db.sqlite
      .prepare("SELECT count(*) n FROM holding_import_rename_aliases")
      .get()?.n,
  ).toBe(0);
});

it("keeps conflicting cash contributions behind review instead of substituting a source amount", async () => {
  const p = await proposal();
  await links.accept(subject, p);
  const incoming = importInput(
    "Synthetic Circuit Works",
    7,
    "synthetic-conflicting-cash-key",
  );
  incoming.rows[0]!.investedMinor = 320_000;
  const staged = await stage(incoming, false);
  expect(staged.preview.rows[0]?.adjudicationStatus).toBe("quarantined");
  const survivor = (await links.workspace(subject)).positions.find(
    (v) => v.id === p.targetPositionId,
  )!;
  expect(survivor.snapshot.investedMinor).toBe(310_000);
});

it("rejects a rename when the source maps to a different reviewed company", async () => {
  const p = await proposal();
  const reviews = new D1InvestmentReviewRepository(db.asD1());
  const c = await reviews.getContext(subject, p.sourcePositionId);
  await reviews.reviewCompany(subject, p.sourcePositionId, {
    requestId: crypto.randomUUID(),
    expectedSnapshotId: c.snapshotId,
    expectedEvidenceRevision: c.evidenceRevision,
    expectedMappingIds: c.mappings.map((m) => m.id),
    company: { mode: "new", legalName: "Synthetic Other Circuit" },
    basis: "user_confirmed",
    citation: null,
    reason: null,
  });
  await expect(links.accept(subject, p)).rejects.toThrow(/same legal vehicle/);
});
