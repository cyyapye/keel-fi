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
  COST_SUBJECT,
} from "../../../scripts/test-support/cost-fixtures";
import { D1PositionPurchaseRepository } from "./position-purchases";
import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1HoldingsPageRepository } from "./holdings-page";
let db: LegalDocumentTestD1;
beforeEach(async () => {
  db = legalDocumentTestDatabase();
  await seedCostHoldings(db.asD1());
});
afterEach(() => db.sqlite.close());
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
