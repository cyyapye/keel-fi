import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D1ExposureRepository } from "../packages/database/src/exposures";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import { PurchaseLotSchema } from "../packages/domain/src/position-purchases";
import {
  buildRecordedSeed,
  LINK_DEMO_SUBJECT,
  seedPositionLinks,
  type LinkDemoCase,
} from "./seed-position-links";

export async function seedHoldingsTotal(db: D1Database) {
  const subject = LINK_DEMO_SUBJECT;
  const cases: LinkDemoCase[] = [
    {
      provider: "sydecar",
      company: "Orchard Computing",
      name: "Orchard I SPV",
      value: 18_500_000,
      amount: 12_000_000,
      date: "2025-01-01",
    },
    {
      provider: "tokenfolio",
      company: "Orchard Computing",
      name: "Orchard II SPV",
      value: 24_000_000,
      amount: 16_000_000,
      date: "2025-03-01",
    },
    {
      provider: "sydecar",
      company: "Orchard Computing",
      name: "Orchard III SPV",
      value: 31_500_000,
      amount: 18_000_000,
      date: "2025-06-01",
    },
    {
      provider: "sydecar",
      company: "Beacon Robotics",
      name: "Beacon Direct SPV",
      value: 6_000_000,
      amount: 4_000_000,
      date: "2025-05-01",
    },
    {
      provider: "tokenfolio",
      company: "Beacon Robotics",
      name: "Beacon Opportunity SPV",
      value: 6_000_000,
      amount: 5_000_000,
      date: "2025-07-01",
    },
    {
      provider: "angellist",
      company: "Harbor Health Systems",
      name: "Horizon SPV",
      value: null,
      locked: true,
      amount: 2_000_000,
      date: "2025-08-01",
    },
    {
      provider: "tokenfolio",
      company: "Synthetic Growth Fund",
      name: "Synthetic Growth Fund",
      kind: "fund_interest",
      value: 9_000_000,
      amount: 8_000_000,
      date: "2025-09-01",
    },
  ];
  await seedPositionLinks(db, 1, false, cases);
  const positions = (
    await new D1InvestmentPositionViewRepository(db).list(subject)
  ).connections.flatMap((c) => c.containers.flatMap((a) => a.positions));
  const harbor = positions.find((p) => p.legalVehicleName === "Horizon SPV")!;
  await new D1PositionPurchaseRepository(db).accept(subject, harbor.id, {
    expectedSnapshotId: harbor.snapshot.id,
    expectedReceiptId: harbor.purchaseReceipt?.id ?? null,
    details: {
      coversPosition: false,
      cashCoversPosition: true,
      investmentTerms: unknownInvestmentTerms(),
      lots: [
        PurchaseLotSchema.parse({
          id: "harbor-subscription",
          purchasedOn: "2025-08-01",
          sourceLabel: "Reconciled capital statement",
          sourceUrl: null,
          shareClass: null,
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: 2_000_000,
          upfrontDeductionsMinor: 50_000,
          netCapitalMinor: 1_800_000,
          capitalReturn: {
            status: "received",
            amountMinor: 150_000,
            effectiveDate: "2026-08-01",
            reportedDistributions: "excluded",
          },
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          mark: null,
        }),
      ],
    },
  });
  const fund = positions.find(
    (p) => p.legalVehicleName === "Synthetic Growth Fund",
  )!;
  const exposures = new D1ExposureRepository(db);
  const evidenceSha256 = createHash("sha256")
    .update("Synthetic fund statement, Cloud Basket 40 percent")
    .digest("hex");
  const cloud = await exposures.resolveExposure(subject, {
    exposureKind: "fund",
    canonicalName: "Cloud Basket",
    protectedIdentityKey: evidenceSha256,
    evidenceSha256,
  });
  await exposures.recordMapping(subject, {
    positionId: fund.id,
    exposureId: cloud.id,
    relationshipKind: "look_through",
    allocationPpm: 400_000,
    status: "active",
    decisionSource: "review",
    decisionReference: "Synthetic fund statement",
    evidenceSha256,
    effectiveAt: "2026-10-01T00:00:00.000Z",
  });
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? "");
  if (root !== resolve(".keel-local/scenarios/holdings-total"))
    throw new Error("Select the holdings-total local scenario.");
  writeFileSync(
    join(root, "holdings-total.sql"),
    await buildRecordedSeed(seedHoldingsTotal),
  );
}
