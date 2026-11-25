import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRecordedSeed,
  LINK_DEMO_SUBJECT,
  seedPositionLinks,
} from "./seed-position-links";
import { D1InvestmentPositionViewRepository } from "../packages/database/src/position-read-model";
import { D1PositionPurchaseRepository } from "../packages/database/src/position-purchases";
import { PurchaseLotSchema } from "../packages/domain/src/position-purchases";
import { recordOfficialClose } from "../packages/database/src/market-close";

export const firstCedarClose = {
  instrumentId: "demo-cedar-class-a",
  revision: 1,
  ticker: "CDR",
  venue: "Demo Exchange",
  currency: "USD",
  session: "regular_close",
  shareClass: "Class A",
  shareBasis: { key: "cedar-class-a-original", unitsPerOriginal: 1 },
  date: "2026-11-19",
  priceMicros: 50_000_000,
  observedAt: "2026-11-19T21:15:00.000Z",
  sourceUrl: "https://exchange.example/cedar/2026-11-19",
} as const;
export const nextCedarClose = {
  ...firstCedarClose,
  date: "2026-11-20",
  priceMicros: 52_000_000,
  observedAt: "2026-11-20T21:15:00.000Z",
  sourceUrl: "https://exchange.example/cedar/2026-11-20",
};
function closeOn<T extends typeof firstCedarClose | typeof nextCedarClose>(
  quote: T,
  date: string,
) {
  return {
    ...quote,
    date,
    observedAt: date + "T20:15:00.000Z",
    sourceUrl: "https://exchange.example/cedar/" + date,
  };
}
export const firstPrivateProxyClose = closeOn(firstCedarClose, "2026-09-24");
export const nextPrivateProxyClose = closeOn(nextCedarClose, "2026-09-25");

export async function seedSamplePricePositions(
  db: D1Database,
  company: string,
  shareBasis: { key: string; unitsPerOriginal: number },
  shareClass = "Class A",
  preDistribution = false,
) {
  const cases = [
    {
      name: "Grove SPV",
      provider: "sydecar" as const,
      shares: 100,
      value: 400_000,
    },
    {
      name: "Summit SPV",
      provider: "tokenfolio" as const,
      shares: 60,
      value: 270_000,
    },
  ];
  await seedPositionLinks(
    db,
    1,
    false,
    cases.map((c) => ({
      ...c,
      company,
      amount: 100_000,
      date: "2025-03-12",
    })),
  );
  const positions = (
    await new D1InvestmentPositionViewRepository(db).list(LINK_DEMO_SUBJECT)
  ).connections.flatMap((c) => c.containers.flatMap((a) => a.positions));
  const purchases = new D1PositionPurchaseRepository(db);
  for (const c of cases) {
    const p = positions.find((r) => r.legalVehicleName === c.name)!;
    const basis =
      preDistribution && c.name === "Summit SPV"
        ? { key: "legacy-private-units", unitsPerOriginal: 1 }
        : shareBasis;
    const lotClass = preDistribution ? "Preferred" : shareClass;
    const purchase = await purchases.accept(LINK_DEMO_SUBJECT, p.id, {
      expectedSnapshotId: p.snapshot.id,
      expectedReceiptId: null,
      details: {
        coversPosition: true,
        lots: [
          PurchaseLotSchema.parse({
            id: "subscription",
            purchasedOn: "2025-03-12",
            shareClass: lotClass,
            priceMicros: null,
            referencePriceMicros: null,
            grossCashMinor: 100_000,
            netCapitalMinor: null,
            upfrontDeductionsMinor: null,
            feePpm: null,
            feeBasis: null,
            feeLabel: null,
            remainingSharesMicros: c.shares * 1_000_000,
            sharesAsOf: "2026-09-20",
            sourceLabel: "Synthetic subscription",
            sourceUrl: null,
            sourceText: null,
            mark: null,
            quantityDetails: {
              status: preDistribution ? "estimated" : "confirmed",
              derivation: "Economic shares allocated by the vehicle.",
              evidence: "Synthetic subscription schedule",
              shareBasis: basis,
            },
          }),
        ],
      },
    });
    const priceMicros = Number((BigInt(c.value) * 10_000n) / BigInt(c.shares));
    await purchases.acceptValuation(LINK_DEMO_SUBJECT, p.id, {
      expectedSnapshotId: p.snapshot.id,
      expectedReceiptId: purchase.id,
      method: "total",
      record: {
        id: "gp",
        origin: "gp",
        totalMinor: c.value,
        priceMicros,
        priceDate: preDistribution ? "2026-09-23" : "2026-11-17",
        effectiveDate: preDistribution ? "2026-09-23" : "2026-11-17",
        shareClass: lotClass,
        shareBasis: basis,
        carryStatus: "before_carry",
        sourceLabel: c.name + " GP",
        sourceUrl: null,
        sourceEvidenceId: null,
        sourcePositionId: null,
        sourceCapturedAt: null,
        watchEvidenceId: null,
      },
    });
  }
  const exposure = await db
    .prepare(
      "SELECT id FROM canonical_exposures WHERE canonical_name=? AND household_id='hh_demo' AND exposure_kind='private_company'",
    )
    .bind(company)
    .first<{ id: string }>();
  if (!exposure) throw new Error("Synthetic exposure missing.");
  return exposure.id;
}
export async function seedClosingPrice(
  db: D1Database,
  preDistribution = false,
) {
  const quote = preDistribution ? firstPrivateProxyClose : firstCedarClose;
  const id = await seedSamplePricePositions(
    db,
    "Cedar Robotics",
    quote.shareBasis,
    quote.shareClass,
    preDistribution,
  );
  await db
    .prepare("INSERT INTO exposure_market_listings VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(
      id,
      quote.instrumentId,
      "CDR",
      "Demo Exchange",
      "Class A",
      quote.shareBasis.key,
      quote.date,
      "https://exchange.example/cedar/listing",
      "USD",
    )
    .run();
  await recordOfficialClose(db, {
    ...quote,
    exposureId: id,
  });
  return id;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? "");
  if (
    root !== resolve(".keel-local/scenarios/closing-price") &&
    !(
      process.argv[3] === "--next" &&
      root === resolve(".keel-local/scenarios/pre-distribution")
    )
  )
    throw new Error("Use the dedicated closing-price scenario.");
  if (process.argv[3] === "--next") {
    const { getPlatformProxy } = await import("wrangler");
    const proxy = await getPlatformProxy<{ DB: D1Database }>({
      configPath: resolve("apps/api/wrangler.jsonc"),
      environment: "local",
      envFiles: [],
      remoteBindings: false,
      persist: { path: join(root, "v3") },
    });
    try {
      const matched = await proxy.env.DB.prepare(
        "SELECT exposure_id FROM exposure_market_listings WHERE instrument_id=? AND identity_source_url=?",
      )
        .bind(
          nextCedarClose.instrumentId,
          "https://exchange.example/cedar/listing",
        )
        .first<{ exposure_id: string }>();
      if (!matched) throw new Error("Synthetic first close missing.");
      await recordOfficialClose(proxy.env.DB, {
        ...(root === resolve(".keel-local/scenarios/pre-distribution")
          ? nextPrivateProxyClose
          : nextCedarClose),
        exposureId: matched.exposure_id,
      });
      console.log(matched.exposure_id);
    } finally {
      await proxy.dispose();
    }
  } else
    writeFileSync(
      join(root, "closing-price.sql"),
      await buildRecordedSeed(async (db) => {
        await seedClosingPrice(db);
      }),
    );
}
