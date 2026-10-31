import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecordedSeed,
  LINK_DEMO_SUBJECT,
  seedPositionLinks,
  type LinkDemoCase,
} from "./seed-position-links";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { PurchaseLotSchema } from "../packages/domain/src/position-purchases";
import { unknownInvestmentTerms } from "../packages/domain/src/investment-details";
import { type ValuationRecord } from "../packages/domain/src/valuation-record";

const basis = { key: "issuer-original", unitsPerOriginal: 1 };
export const PROXY_DEMO_CASES = [
  {
    name: "Demo Atlas I SPV",
    cash: 1_000_000,
    shares: 84_400_000,
    net: 844_000,
    fees: 156_000,
    refund: null,
    derivation:
      "($10,000 cash paid minus $1,560 recorded fees) divided by $100.",
    note: "Fabricated allocation calculated from recorded net capital; not an administrator-confirmed share allocation.",
  },
  {
    name: "Demo Atlas II SPV",
    cash: 400_000,
    shares: 23_625_000,
    net: null,
    fees: null,
    refund: 80_000,
    derivation: "Provisional: $2,362.50 allocation divided by $100.",
    note: "Fabricated $4,000 payment and $800 received refund. The $3,200 retained cash includes fees; the $837.50 difference from the provisional allocation is unresolved. Carry hurdle is unknown.",
  },
  {
    name: "Demo Atlas III SPV",
    cash: 105_000,
    shares: 7_875_000,
    net: null,
    fees: null,
    refund: null,
    derivation: "Provisional: ($1,050 cash paid times 75%) divided by $100.",
    note: "Fabricated $787.50 deployed-capital assumption after an estimated 25% fee. Fee treatment and final allocation remain unconfirmed.",
  },
] as const;
const sourceName = "Demo Atlas Tokenfolio source";
export async function seedPriceProxies(db: D1Database) {
  const cases: LinkDemoCase[] = [
    ...PROXY_DEMO_CASES.map((c) => ({
      provider: "sydecar" as const,
      name: c.name,
      company: "Demo Atlas AI",
      amount: c.cash,
      value: null,
      date: "2025-03-12",
    })),
    {
      provider: "tokenfolio",
      name: sourceName,
      company: "Demo Atlas AI",
      amount: 1_050_000,
      value: 4_200_000,
      date: "2025-03-12",
    },
  ];
  // Start with an undated imported quote, then accept a separately dated GP
  // correction through the same repositories used by the application.
  await seedPositionLinks(db, 1, true, cases);
  const positions = (
    await new D1InvestmentPositionViewRepository(db).list(LINK_DEMO_SUBJECT)
  ).connections.flatMap((c) => c.containers.flatMap((c) => c.positions));
  const source = positions.find((p) => p.legalVehicleName === sourceName)!;
  const repo = new D1PositionPurchaseRepository(db);
  const sourceInvestment = await repo.accept(LINK_DEMO_SUBJECT, source.id, {
    expectedSnapshotId: source.snapshot.id,
    expectedReceiptId: null,
    details: {
      coversPosition: false,
      cashCoversPosition: true,
      investmentTerms: {
        ...unknownInvestmentTerms(),
        carryPpm: 200_000,
        carryBasis: "net_capital",
      },
      lots: [
        PurchaseLotSchema.parse({
          id: "demo-source-cash",
          purchasedOn: "2025-03-12",
          shareClass: "Common",
          priceMicros: null,
          referencePriceMicros: null,
          grossCashMinor: 1_050_000,
          netCapitalMinor: 945_000,
          upfrontDeductionsMinor: 105_000,
          feePpm: null,
          feeBasis: null,
          feeLabel: null,
          remainingSharesMicros: null,
          sharesAsOf: null,
          sourceLabel: "Synthetic source subscription",
          sourceUrl: null,
          sourceText:
            "Fabricated $250 setup fee and $800 prepaid management fee.",
          mark: null,
        }),
      ],
    },
  });
  const gp: ValuationRecord = {
    id: "gp",
    origin: "gp",
    totalMinor: 4_200_000,
    priceMicros: 200_000_000,
    priceDate: "2026-10-10",
    effectiveDate: "2026-09-20",
    shareClass: "Common",
    shareBasis: basis,
    carryStatus: "before_carry",
    sourceLabel: "Tokenfolio",
    sourceUrl: null,
    sourceEvidenceId: null,
    sourcePositionId: null,
    sourceCapturedAt: null,
    watchEvidenceId: null,
  };
  await repo.acceptValuation(LINK_DEMO_SUBJECT, source.id, {
    expectedSnapshotId: source.snapshot.id,
    expectedReceiptId: sourceInvestment.id,
    record: gp,
    method: "total",
  });
  for (const [index, c] of PROXY_DEMO_CASES.entries()) {
    const position = positions.find((p) => p.legalVehicleName === c.name)!;
    const investment = await repo.accept(LINK_DEMO_SUBJECT, position.id, {
      expectedSnapshotId: position.snapshot.id,
      expectedReceiptId: null,
      details: {
        coversPosition: true,
        cashCoversPosition: true,
        investmentTerms: {
          ...unknownInvestmentTerms(),
          carryPpm: 150_000,
          carryBasis:
            index === 1
              ? "unknown"
              : index === 0
                ? "net_capital"
                : "gross_cash",
        },
        lots: [
          PurchaseLotSchema.parse({
            id: `demo-proxy-allocation-${index + 1}`,
            purchasedOn: "2025-03-12",
            shareClass: "Preferred",
            priceMicros: 100_000_000,
            referencePriceMicros: null,
            grossCashMinor: c.cash,
            netCapitalMinor: c.net,
            upfrontDeductionsMinor: c.fees,
            ...(c.refund === null
              ? {}
              : {
                  capitalReturn: {
                    amountMinor: c.refund,
                    status: "received",
                    effectiveDate: null,
                    reportedDistributions: "excluded",
                  },
                }),
            feePpm: index === 2 ? 250_000 : null,
            feeBasis: index === 2 ? "gross_cash" : null,
            feeLabel: index === 2 ? "Provisional fee assumption" : null,
            feesComplete: index === 0,
            remainingSharesMicros: c.shares,
            sharesAsOf: "2026-10-01",
            sourceLabel: "Synthetic allocation evidence",
            sourceUrl: null,
            sourceText: c.note,
            mark: null,
            quantityDetails: {
              status: "estimated",
              derivation: c.derivation,
              evidence:
                "Fabricated local demonstration; no real portfolio data.",
              shareBasis: basis,
            },
          }),
        ],
      },
    });
    const manual = await repo.acceptValuation(LINK_DEMO_SUBJECT, position.id, {
      expectedSnapshotId: position.snapshot.id,
      expectedReceiptId: investment.id,
      record: {
        ...gp,
        id: "mine",
        origin: "judgment",
        totalMinor: Number((BigInt(c.shares) * 200n) / 10_000n),
        priceMicros: null,
        priceDate: null,
        shareClass: null,
        shareBasis: null,
        effectiveDate: "2026-10-09",
        sourceLabel: "My estimate",
      },
      method: "total",
    });
    const quote = (
      await repo.valuationEvidence(LINK_DEMO_SUBJECT, position.id)
    ).prices.find((p) => p.positionId === source.id)!;
    await repo.acceptValuation(LINK_DEMO_SUBJECT, position.id, {
      expectedSnapshotId: position.snapshot.id,
      expectedReceiptId: manual.id,
      record: {
        ...gp,
        id: `proxy:${source.id}`,
        origin: "proxy",
        totalMinor: null,
        effectiveDate: quote.markDate!,
        priceDate: quote.markDate,
        priceMicros: quote.markMicros,
        followSource: true,
        crossClassProxy: true,
        shareBasis: quote.shareBasis,
        priceSourcePositionId: source.id,
        sourcePositionId: source.id,
        sourceEvidenceId: quote.id,
        sourceCapturedAt: quote.capturedAt,
      },
      method: "shares",
    });
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? "");
  if (root !== resolve(".keel-local/scenarios/price-proxies"))
    throw new Error(
      "Price-proxy seed requires its exact local scenario directory.",
    );
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "price-proxies.sql"),
    await buildRecordedSeed(seedPriceProxies),
  );
}
