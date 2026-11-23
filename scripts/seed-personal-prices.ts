import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { personalInstrument } from "../packages/database/src/personal-daily-closes";
import { PersonalListingSchema } from "../packages/domain/src/market-close";
import { buildRecordedSeed } from "./seed-position-links";
import { seedSamplePricePositions } from "./seed-closing-price";

export const personalPriceConfig = resolve(".keel-local/personal-market");
export function readPersonalListing() {
  return PersonalListingSchema.parse(
    JSON.parse(readFileSync(join(personalPriceConfig, "listing.json"), "utf8")),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(process.argv[2] ?? "");
  if (root !== resolve(".keel-local/scenarios/personal-prices"))
    throw new Error("Use the personal-prices profile.");
  const listing = readPersonalListing();
  const instrument = personalInstrument(listing);
  let exposureId: string | undefined;
  const sql = await buildRecordedSeed(async (db) => {
    exposureId = await seedSamplePricePositions(
      db,
      listing.company,
      { key: instrument, unitsPerOriginal: 1 },
      listing.shareClass,
    );
    await db
      .prepare("INSERT INTO exposure_market_listings VALUES(?,?,?,?,?,?,?,?,?)")
      .bind(
        exposureId,
        instrument,
        listing.ticker,
        listing.venue,
        listing.shareClass,
        instrument,
        listing.firstSession,
        listing.identitySourceUrl,
        "USD",
      )
      .run();
  });
  if (!exposureId) throw new Error("Personal demo setup failed.");
  writeFileSync(join(root, "personal-prices.sql"), sql, { mode: 0o600 });
  writeFileSync(join(root, "exposure-id"), exposureId, { mode: 0o600 });
}
