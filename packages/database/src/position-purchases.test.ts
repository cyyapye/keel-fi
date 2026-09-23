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
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
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
