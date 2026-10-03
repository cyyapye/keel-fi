import { automaticEconomics } from "@keel/domain/automatic-investment-review";
import { D1PositionEconomicsRepository } from "./position-economics";
import { calculatePositionEconomics } from "@keel/domain/position-economics";
import { purchaseEconomicsEvidence } from "@keel/domain/purchase-economics";
import { D1InvestmentReviewRepository } from "./investment-review";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  legalDocumentTestDatabase,
  type LegalDocumentTestD1,
} from "../../../scripts/test-support/legal-documents";
import {
  seedCostHoldings,
  seedCostWatchTargets,
  COST_SUBJECT,
} from "../../../scripts/test-support/cost-fixtures";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1HoldingsPageRepository } from "./holdings-page";
import {
  PurchaseLotSchema,
  reviewedInvestmentFromReceipt,
  estimatePurchaseCapital,
} from "@keel/domain/position-purchases";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";
import { automaticEconomics as proposeEconomics } from "@keel/domain/automatic-investment-review";
let db: LegalDocumentTestD1;
beforeEach(async () => {
  db = legalDocumentTestDatabase();
  await seedCostHoldings(db.asD1());
});
afterEach(() => db.sqlite.close());
it("persists allocation refunds and rate estimates without converting them into accepted net capital", async () => {
  const reader = new D1InvestmentPositionViewRepository(db.asD1());
  const position = (await reader.list(COST_SUBJECT)).connections.flatMap((c) =>
    c.containers.flatMap((c) => c.positions),
  )[0]!;
  const repo = new D1PositionPurchaseRepository(db.asD1());
  const lot = PurchaseLotSchema.parse({
    id: "synthetic-allocation",
    purchasedOn: null,
    shareClass: "Preferred",
    priceMicros: 17500000,
    referencePriceMicros: null,
    grossCashMinor: 640000,
    netCapitalMinor: null,
    upfrontDeductionsMinor: null,
    feePpm: 90000,
    feeBasis: "gross_cash",
    feeLabel: "Synthetic prepaid fee",
    remainingSharesMicros: null,
    sharesAsOf: null,
    sourceLabel: "Synthetic allocation notice",
    sourceUrl: null,
    mark: null,
    capitalReturn: {
      amountMinor: 154321,
      status: "expected",
      effectiveDate: "2026-03-05",
      reportedDistributions: "unknown",
    },
  });
  const input = {
    expectedSnapshotId: position.snapshot.id,
    expectedReceiptId: null,
    details: {
      investmentTerms: unknownInvestmentTerms(),
      cashCoversPosition: true,
      coversPosition: false,
      lots: [lot],
    },
  };
  const expected = await repo.accept(COST_SUBJECT, position.id, input);
  const read = async () =>
    (
      await new D1HoldingsPageRepository(db.asD1()).getPage(
        COST_SUBJECT,
        "configuration_required",
      )
    ).holdings.find((row) => row.id === position.id)!;
  const first = await read();
  expect(first.purchaseContext?.receipt).toEqual(expected);
  expect(
    estimatePurchaseCapital(first.purchaseContext!.receipt!.details.lots[0]!),
  ).toMatchObject({
    netCapitalMinor: 441968,
    upfrontDeductionsMinor: 43711,
    expectedRefund: true,
  });
  expect(first.positionEconomicsContext?.reviewedInvestment).toMatchObject({
    cashPaidMinor: 640000,
    netCapitalMinor: null,
    returnedCapitalMinor: 0,
  });
  const received = await repo.accept(COST_SUBJECT, position.id, {
    ...input,
    expectedReceiptId: expected.id,
    details: {
      ...input.details,
      lots: [
        {
          ...lot,
          capitalReturn: {
            ...lot.capitalReturn!,
            status: "received",
            effectiveDate: null,
            reportedDistributions: "excluded",
          },
          netCapitalMinor: 441968,
          upfrontDeductionsMinor: 43711,
        },
      ],
    },
  });
  expect(
    (await read()).positionEconomicsContext?.reviewedInvestment,
  ).toMatchObject({
    cashPaidMinor: 640000,
    returnedCapitalMinor: 154321,
    additionalReturnedCapitalMinor: 154321,
    netCapitalMinor: 441968,
    upfrontDeductionsMinor: 43711,
  });
  expect(
    (await read()).purchaseContext?.receipt?.details.lots[0]?.capitalReturn,
  ).toMatchObject({ status: "received", effectiveDate: null });
  expect(
    db.sqlite
      .prepare("SELECT receipt_json FROM holding_purchase_reviews WHERE id=?")
      .get(expected.id)?.receipt_json,
  ).toBe(JSON.stringify(expected));
  const rawInsert = (details: unknown) =>
    db.sqlite
      .prepare(
        "INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) SELECT ?,household_id,position_id,snapshot_id,?,?,reviewer_user_id,accepted_at FROM holding_purchase_reviews WHERE id=?",
      )
      .run(
        "invalid-refund",
        received.id,
        JSON.stringify({ ...received, id: "invalid-refund", details }),
        received.id,
      );
  expect(() =>
    rawInsert({
      ...received.details,
      lots: [
        {
          ...received.details.lots[0]!,
          capitalReturn: {
            ...lot.capitalReturn!,
            status: "received",
            effectiveDate: "unknown",
          },
        },
      ],
    }),
  ).toThrow(/capital refund invalid/u);
  expect(() =>
    rawInsert({
      ...received.details,
      lots: [{ ...received.details.lots[0]!, upfrontDeductionsMinor: 43710 }],
    }),
  ).toThrow(/capital does not reconcile/u);
});
it("binds carry classification to the current reported mark while preserving unknown dates and annual fees", async () => {
  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2);
  const reader = new D1InvestmentPositionViewRepository(db.asD1());
  const positions = (await reader.list(COST_SUBJECT)).connections.flatMap((c) =>
    c.containers.flatMap((c) => c.positions),
  );
  const position = positions[0]!;
  const repo = new D1PositionPurchaseRepository(db.asD1());
  const valueReview = {
    sourceSnapshotId: position.snapshot.id,
    valueMinor: 100002,
    sourceLabel: "Synthetic provider statement",
    effectiveDate: null,
    carryStatus: "unknown" as const,
  };
  const input = {
    expectedSnapshotId: position.snapshot.id,
    expectedReceiptId: null,
    details: {
      investmentTerms: {
        ...unknownInvestmentTerms(),
        reportedValueReview: valueReview,
      },
      cashCoversPosition: true,
      coversPosition: false,
      lots: [
        PurchaseLotSchema.parse({
          id: "synthetic-current-mark",
          purchasedOn: null,
          shareClass: null,
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: 240000,
          netCapitalMinor: null,
          upfrontDeductionsMinor: 28766,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          sourceLabel: "Synthetic executed receipt",
          sourceUrl: null,
          mark: null,
        }),
      ],
    },
  };
  for (const badReview of [
    { ...valueReview, valueMinor: 100003 },
    { ...valueReview, sourceSnapshotId: positions[1]!.snapshot.id },
  ]) {
    await expect(
      repo.accept(COST_SUBJECT, position.id, {
        ...input,
        details: {
          ...input.details,
          investmentTerms: {
            ...input.details.investmentTerms,
            reportedValueReview: badReview,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "stale" });
  }
  const saved = await repo.accept(COST_SUBJECT, position.id, input);
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  const holding = page.holdings.find((row) => row.id === position.id)!;
  expect(
    holding.positionEconomicsContext?.reviewedInvestment?.cashPaidMinor,
  ).toBe(240000);
  expect(holding.purchaseContext?.reportedValueSnapshotId).toBe(
    position.snapshot.id,
  );
  const review = await new D1InvestmentReviewRepository(db.asD1()).getContext(
    COST_SUBJECT,
    position.id,
  );
  expect(review.economics?.reviewedInvestment).toEqual(
    reviewedInvestmentFromReceipt(saved),
  );
  expect(review.purchaseContext?.reportedValueMinor).toBe(100002);
});
it("upgrades legacy receipts atomically, uses exact cash across projections and blocks parallel fee writers", async () => {
  const reader = new D1InvestmentPositionViewRepository(db.asD1());
  const position = (await reader.list(COST_SUBJECT)).connections.flatMap((c) =>
    c.containers.flatMap((c) => c.positions),
  )[0]!;
  const repo = new D1PositionPurchaseRepository(db.asD1());
  const baseLot = PurchaseLotSchema.parse({
    id: "synthetic-tranche",
    purchasedOn: null,
    shareClass: null,
    priceMicros: null,
    referencePriceMicros: null,
    grossCashMinor: null,
    netCapitalMinor: null,
    feePpm: null,
    feeBasis: null,
    feeLabel: null,
    remainingSharesMicros: null,
    sharesAsOf: null,
    sourceLabel: "Synthetic executed receipt",
    sourceUrl: null,
    mark: null,
  });
  const legacy = await repo.accept(COST_SUBJECT, position.id, {
    expectedSnapshotId: position.snapshot.id,
    expectedReceiptId: null,
    details: { coversPosition: false, lots: [baseLot] },
  });
  const context = (
    await new D1InvestmentReviewRepository(db.asD1()).getContext(
      COST_SUBJECT,
      position.id,
    )
  ).economics!;
  const economics = new D1PositionEconomicsRepository(db.asD1());
  const legacyTermsInput = {
    expectedSnapshotId: position.snapshot.id,
    expectedCommitmentMinor: context.committedMinor,
    expectedTermsId: null,
    annualAdminFeePpm: 0,
    adminFeeYears: 1,
    carryPpm: 100000,
    note: "Synthetic prior agreement",
  };
  const legacyTerms = await economics.accept(
    COST_SUBJECT,
    position.id,
    legacyTermsInput,
  );
  const request = {
    expectedSnapshotId: position.snapshot.id,
    expectedReceiptId: legacy.id,
    expectedTermsId: legacyTerms.id,
    details: {
      investmentTerms: {
        ...unknownInvestmentTerms(),
        importedAmountBasis: "net_capital" as const,
        carryPpm: 200000,
        carryBasis: "net_capital" as const,
        note: "Executed receipt differs from historical deal snapshot.",
      },
      cashCoversPosition: true,
      coversPosition: false,
      lots: [
        {
          ...baseLot,
          grossCashMinor: 240000,
          netCapitalMinor: 211234,
          upfrontDeductionsMinor: null,
          feePpm: 60000,
          feeBasis: "net_capital" as const,
          nominalSpvUnitsMicros: 500000000,
        },
      ],
    },
  };
  await expect(
    repo.accept(COST_SUBJECT, position.id, {
      ...request,
      expectedTermsId: null,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const accepted = await repo.accept(COST_SUBJECT, position.id, request);
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  const holding = page.holdings.find((row) => row.id === position.id)!;
  expect(holding.purchaseContext?.receipt).toEqual(accepted);
  expect(holding.positionEconomicsContext?.reviewedInvestment).toMatchObject({
    cashPaidMinor: 240000,
    netCapitalMinor: 211234,
    upfrontDeductionsMinor: 28766,
    terms: { annualManagementFeePpm: null, carryPpm: 200000 },
  });
  const readback = await new D1InvestmentReviewRepository(db.asD1()).getContext(
    COST_SUBJECT,
    position.id,
  );
  expect(readback.economics?.reviewedInvestment).toEqual(
    reviewedInvestmentFromReceipt(accepted),
  );
  expect(proposeEconomics(readback.economics!, [], accepted).input).toBeNull();
  await expect(
    economics.accept(COST_SUBJECT, position.id, {
      ...legacyTermsInput,
      expectedTermsId: legacyTerms.id,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  await expect(
    repo.accept(COST_SUBJECT, position.id, {
      expectedSnapshotId: position.snapshot.id,
      expectedReceiptId: accepted.id,
      details: legacy.details,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  expect(
    db.sqlite
      .prepare("SELECT receipt_json FROM holding_purchase_reviews WHERE id=?")
      .get(legacy.id)?.receipt_json,
  ).toBe(JSON.stringify(legacy));
  await expect(
    repo.accept(COST_SUBJECT, position.id, request),
  ).rejects.toMatchObject({ code: "stale" });
  await expect(
    repo.accept(COST_SUBJECT, position.id, {
      ...request,
      expectedReceiptId: accepted.id,
      details: {
        ...request.details,
        lots: [{ ...request.details.lots[0]!, upfrontDeductionsMinor: 1 }],
      },
    }),
  ).rejects.toThrow(/reconcile/u);
});
it("persists optional details, reads them through holdings, versions edits and rejects stale or foreign writes", async () => {
  // Local SQLite accepts this construct, but remote D1's statement parser
  // does not: https://github.com/cloudflare/workers-sdk/issues/4727.
  // Keep the deployment compatibility guard alongside the behavioral checks.
  expect(
    readFileSync(
      "packages/database/migrations/0070_private_purchase_details.sql",
      "utf8",
    ),
  ).not.toMatch(/\bSELECT\s+CASE\b/iu);
  const reader = new D1InvestmentPositionViewRepository(db.asD1());
  const view = await reader.list(COST_SUBJECT);
  const p = view.connections.flatMap((c) =>
    c.containers.flatMap((c) => c.positions),
  )[0]!;
  const repo = new D1PositionPurchaseRepository(db.asD1());
  const request = {
    expectedSnapshotId: p.snapshot.id,
    expectedReceiptId: null,
    details: {
      coversPosition: true,
      lots: [
        {
          id: "partial",
          transactionType: "secondary" as const,
          referenceRound: "Series B",
          reportedPremiumPpm: 240_000,
          reportedManagementFeePpm: 0,
          reportedCarryPpm: 120_000,
          sourceText: "Synthetic GP notice: secondary preferred shares",
          purchasedOn: "2025-04-12",
          shareClass: "Series B",
          priceMicros: 12_500_000,
          referencePriceMicros: null,
          grossCashMinor: null,
          netCapitalMinor: null,
          feePpm: 60_000,
          feeBasis: "net_capital" as const,
          feeLabel: "Underlying fee",
          originalSharesUnchanged: false,
          remainingSharesMicros: null,
          sharesAsOf: null,
          sourceLabel: "Synthetic purchase statement",
          sourceUrl: null,
          mark: null,
        },
      ],
    },
  };
  const first = await repo.accept(COST_SUBJECT, p.id, request);
  await expect(repo.accept(COST_SUBJECT, p.id, request)).rejects.toMatchObject({
    code: "stale",
  });
  await expect(
    repo.accept("another-subject", p.id, request),
  ).rejects.toMatchObject({ code: "not_found" });
  await expect(
    repo.accept(COST_SUBJECT, p.id, {
      ...request,
      expectedReceiptId: first.id,
      expectedSnapshotId: "missing",
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const second = await repo.accept(COST_SUBJECT, p.id, {
    ...request,
    expectedReceiptId: first.id,
  });
  const reloaded = await reader.list(COST_SUBJECT);
  expect(
    reloaded.connections
      .flatMap((c) => c.containers.flatMap((c) => c.positions))
      .find((row) => row.id === p.id)?.purchaseReceipt,
  ).toEqual(second);
  const page = await new D1HoldingsPageRepository(db.asD1()).getPage(
    COST_SUBJECT,
    "configuration_required",
  );
  expect(
    page.holdings.find((row) => row.id === p.id)?.purchaseContext?.receipt,
  ).toEqual(second);
  const reviewContext = await new D1InvestmentReviewRepository(
    db.asD1(),
  ).getContext(COST_SUBJECT, p.id);
  expect(reviewContext.purchaseContext?.receipt).toEqual(second);
  const economicsContext = reviewContext.economics!;
  const evidence = purchaseEconomicsEvidence(economicsContext, second);
  expect(evidence.purchaseFee).toMatchObject({
    receiptId: second.id,
    basis: "net_capital",
    ratePpm: 60_000,
  });
  expect(
    purchaseEconomicsEvidence(
      {
        ...economicsContext,
        reportedTerms: {
          managementFeePpm: 0,
          carryPpm: 150_000,
          sourceLabel: "Synthetic provider",
          observedAt: second.acceptedAt,
        },
      },
      second,
    ),
  ).toMatchObject({
    managementFeePpm: 0,
    carryPpm: null,
    conflicts: ["carry"],
  });
  expect(
    purchaseEconomicsEvidence(
      { ...economicsContext, snapshotId: "new-snapshot" },
      second,
    ).purchaseFee,
  ).toBeNull();
  const economicsRepo = new D1PositionEconomicsRepository(db.asD1());
  const feeInput = {
    expectedSnapshotId: p.snapshot.id,
    expectedTermsId: null,
    expectedCommitmentMinor: economicsContext.committedMinor,
    capitalBasis: "gross_commitment" as const,
    annualAdminFeePpm: 0,
    adminFeeYears: 1,
    setupFeePpm: 0,
    carryPpm: 120_000,
    purchaseFee: evidence.purchaseFee,
    note: "Synthetic source-backed purchase economics",
  };
  await expect(
    economicsRepo.accept(COST_SUBJECT, p.id, {
      ...feeInput,
      purchaseFee: { ...evidence.purchaseFee!, receiptId: first.id },
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const accepted = await economicsRepo.accept(COST_SUBJECT, p.id, feeInput);
  expect(accepted.purchaseFee).toEqual(evidence.purchaseFee);
  const automatic = automaticEconomics(
    { ...economicsContext, reportedTerms: null },
    [],
    second,
  );
  expect(automatic.reported).toMatchObject({
    managementFeePpm: 0,
    carryPpm: 120_000,
  });
  expect(automatic.issue?.code).toBe("missing");
  expect(automatic.input).toBeNull();
  expect(
    automaticEconomics(
      {
        ...economicsContext,
        reportedTerms: {
          managementFeePpm: 0,
          carryPpm: 150_000,
          sourceLabel: "Synthetic provider",
          observedAt: second.acceptedAt,
        },
      },
      [],
      second,
    ).issue?.code,
  ).toBe("conflicting");

  const grossForNet = Number(
    (BigInt(economicsContext.committedMinor) * 1_060_000n + 500_000n) /
      1_000_000n,
  );
  await expect(
    economicsRepo.accept(COST_SUBJECT, p.id, {
      ...feeInput,
      expectedTermsId: accepted.id,
      capitalBasis: "net_invested",
      grossCommitmentMinor: grossForNet + 100,
    }),
  ).rejects.toMatchObject({ code: "capital_mismatch" });

  const afterFee = await new D1InvestmentReviewRepository(db.asD1()).getContext(
    COST_SUBJECT,
    p.id,
  );
  expect(afterFee.economics?.acceptedTerms?.purchaseFee).toEqual(
    evidence.purchaseFee,
  );
  const calculated = calculatePositionEconomics(afterFee.economics!);
  const net = Number(
    (BigInt(economicsContext.committedMinor) * 1_000_000n + 530_000n) /
      1_060_000n,
  );
  expect(calculated).toMatchObject({
    positionCostBasisMinor: net,
    purchaseFeeMinor: economicsContext.committedMinor - net,
  });
  expect(
    readFileSync(
      "packages/database/migrations/0074_purchase_fee_economics.sql",
      "utf8",
    ),
  ).not.toMatch(/\bSELECT\s+CASE\b/iu);

  const netAccepted = await economicsRepo.accept(COST_SUBJECT, p.id, {
    ...feeInput,
    expectedTermsId: accepted.id,
    capitalBasis: "net_invested",
    grossCommitmentMinor: grossForNet,
  });
  expect(netAccepted.grossCommitmentMinor).toBe(grossForNet);
  const netReadback = await new D1InvestmentReviewRepository(
    db.asD1(),
  ).getContext(COST_SUBJECT, p.id);
  expect(calculatePositionEconomics(netReadback.economics!)).toMatchObject({
    committedMinor: grossForNet,
    positionCostBasisMinor: economicsContext.committedMinor,
  });
  expect(reviewContext.purchaseContext?.snapshotId).toEqual(p.snapshot.id);
  await expect(
    new D1InvestmentReviewRepository(db.asD1()).getContext(
      "another-subject",
      p.id,
    ),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(
    db.sqlite.prepare("SELECT COUNT(*) n FROM holding_purchase_reviews").get(),
  ).toMatchObject({ n: 2 });
  expect(() =>
    db.sqlite.exec("UPDATE holding_purchase_reviews SET accepted_at='changed'"),
  ).toThrow(/immutable/u);
  expect(() => db.sqlite.exec("DELETE FROM holding_purchase_reviews")).toThrow(
    /immutable/u,
  );
});

it("projects only owned source prices with one bounded query across 120 positions", async () => {
  const positions = db.sqlite
    .prepare(
      `SELECT id,household_id FROM holding_positions WHERE household_id='hh_demo' ORDER BY id`,
    )
    .all() as { id: string; household_id: string }[];
  expect(positions.length).toBeGreaterThanOrEqual(120);
  await seedCostWatchTargets(db.asD1());
  const p = positions[0]!;
  const row = db.sqlite
    .prepare(
      `SELECT import_row_id FROM holding_import_applications WHERE position_id=? ORDER BY applied_at DESC,id DESC LIMIT 1`,
    )
    .get(p.id) as { import_row_id: string };
  db.sqlite
    .prepare(`INSERT INTO holding_import_share_prices VALUES(?,?,?)`)
    .run(
      row.import_row_id,
      p.household_id,
      JSON.stringify({
        costMicros: 20000000,
        markMicros: 35000000,
        markDate: null,
        shareClass: "Series B",
      }),
    );
  const before = db.statements.length;
  const repo = new D1PositionPurchaseRepository(db.asD1());
  const prices = await repo.evidence(COST_SUBJECT, p.id);
  expect(db.statements.length - before).toBe(1);
  const query = db.statements[before]!;
  const plan = db.sqlite
    .prepare(`EXPLAIN QUERY PLAN ${query.sql}`)
    .all(COST_SUBJECT, p.id) as { detail: string }[];
  expect(plan.some((row) => /SCAN candidate/u.test(row.detail))).toBe(false);
  expect(
    plan.some((row) => /SEARCH candidate USING INDEX/u.test(row.detail)),
  ).toBe(true);
  expect(prices).toHaveLength(1);
  expect(prices[0]).toMatchObject({
    id: row.import_row_id,
    markMicros: 35000000,
    costMicros: 20000000,
    shareClass: "Series B",
  });
  const related = positions[1]!;
  // Source prices cannot cross legal positions until the economic link is reviewed.
  expect(await repo.evidence(COST_SUBJECT, related.id)).toEqual([]);
  const exposure = db.sqlite
    .prepare(
      "SELECT exposure_id FROM holding_position_exposure_heads WHERE position_id=? AND status='active'",
    )
    .get(p.id) as { exposure_id: string };
  db.sqlite
    .prepare(
      `INSERT INTO holding_position_exposure_mappings
    (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
    SELECT id || '-withdrawn',household_id,position_id,exposure_id,relationship_kind,NULL,'withdrawn','review','Synthetic regrouping',evidence_sha256,effective_at,version+1,id,'usr_demo',accepted_at,1
    FROM holding_position_exposure_mappings m WHERE position_id=? AND status='active' AND NOT EXISTS (SELECT 1 FROM holding_position_exposure_mappings later WHERE later.supersedes_mapping_id=m.id)`,
    )
    .run(related.id);
  db.sqlite
    .prepare(
      `INSERT INTO holding_position_exposure_mappings
    (id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
    VALUES('shared-price-link','hh_demo',?,?,'look_through',1000000,'active','review','Synthetic comparable issuer',?,'2026-09-02',1,NULL,'usr_demo','2026-09-02',1)`,
    )
    .run(related.id, exposure.exposure_id, "a".repeat(64));
  expect(await repo.evidence(COST_SUBJECT, related.id)).toEqual(prices);
  const snapshot = db.sqlite
    .prepare(
      "SELECT snapshot_id FROM holding_import_applications WHERE position_id=? ORDER BY applied_at DESC,id DESC LIMIT 1",
    )
    .get(related.id) as { snapshot_id: string };
  const details = {
    coversPosition: true,
    lots: [
      {
        id: "estimated",
        purchasedOn: null,
        shareClass: "Series B",
        priceMicros: 20000000,
        referencePriceMicros: null,
        grossCashMinor: null,
        netCapitalMinor: 200000,
        feePpm: 0,
        feeBasis: "net_capital" as const,
        feeLabel: null,
        originalSharesUnchanged: true,
        remainingSharesMicros: null,
        sharesAsOf: null,
        sourceLabel: "Synthetic purchase",
        sourceUrl: null,
        mark: {
          priceMicros: 35000000,
          effectiveDate: "2026-09-01",
          shareClass: "Series B",
          sourceLabel: "Synthetic provider",
          sourceUrl: null,
          sourceEvidenceId: row.import_row_id,
          comparableConfirmed: true as const,
        },
      },
    ],
  };
  let saved = await repo.accept(COST_SUBJECT, related.id, {
    expectedSnapshotId: snapshot.snapshot_id,
    expectedReceiptId: null,
    details,
  });
  expect(saved.details.lots[0]?.mark?.sourceEvidenceId).toBe(row.import_row_id);
  const proxyDetails = {
    ...details,
    lots: [
      {
        ...details.lots[0]!,
        shareClass: "Preferred",
        mark: {
          ...details.lots[0]!.mark,
          comparableConfirmed: undefined,
          effectiveDate: null,
          proxy: {
            confirmed: true as const,
            reason: "Closest available source price.",
            capturedAt: prices[0]!.capturedAt,
          },
        },
      },
    ],
  };
  await expect(
    repo.accept(COST_SUBJECT, related.id, {
      expectedSnapshotId: snapshot.snapshot_id,
      expectedReceiptId: saved.id,
      details: {
        ...proxyDetails,
        lots: [
          {
            ...proxyDetails.lots[0]!,
            mark: { ...proxyDetails.lots[0]!.mark, priceMicros: 99000000 },
          },
        ],
      },
    }),
  ).rejects.toMatchObject({ code: "stale" });
  saved = await repo.accept(COST_SUBJECT, related.id, {
    expectedSnapshotId: snapshot.snapshot_id,
    expectedReceiptId: saved.id,
    details: proxyDetails,
  });
  const storedProxy = db.sqlite
    .prepare("SELECT receipt_json FROM holding_purchase_reviews WHERE id=?")
    .get(saved.id) as { receipt_json: string };
  expect(
    JSON.parse(storedProxy.receipt_json).details.lots[0].mark.proxy,
  ).toEqual(proxyDetails.lots[0]!.mark.proxy);

  const forged = structuredClone(saved);
  forged.id = "forged-proxy-capture";
  forged.details.lots[0]!.mark!.proxy!.capturedAt = "2020-01-01T00:00:00.000Z";
  expect(() =>
    db.sqlite
      .prepare(
        "INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,'hh_demo',?,?,?,?,'usr_demo',?)",
      )
      .run(
        forged.id,
        related.id,
        snapshot.snapshot_id,
        saved.id,
        JSON.stringify(forged),
        forged.acceptedAt,
      ),
  ).toThrow(/purchase price evidence stale/u);

  await seedCostHoldings(db.asD1(), COST_SUBJECT, 2);
  await expect(
    repo.accept(COST_SUBJECT, related.id, {
      expectedSnapshotId: snapshot.snapshot_id,
      expectedReceiptId: saved.id,
      details,
    }),
  ).rejects.toMatchObject({ code: "stale" });
  const latest = db.sqlite
    .prepare(
      "SELECT snapshot_id FROM holding_import_applications WHERE position_id=? ORDER BY applied_at DESC,id DESC LIMIT 1",
    )
    .get(related.id) as { snapshot_id: string };
  expect(() =>
    db.sqlite
      .prepare(
        `INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES('raced-price','hh_demo',?,?,?,?,'usr_demo','2026-09-03')`,
      )
      .run(
        related.id,
        latest.snapshot_id,
        saved.id,
        JSON.stringify({
          ...saved,
          id: "raced-price",
          snapshotId: latest.snapshot_id,
        }),
      ),
  ).toThrow(/purchase price evidence stale/u);

  expect(await repo.evidence("unrelated-subject", p.id)).toEqual([]);
  expect(await repo.evidence(COST_SUBJECT, "missing")).toEqual([]);
});
