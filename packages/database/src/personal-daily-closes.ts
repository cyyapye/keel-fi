import { z } from "zod";
import {
  alphaVantageDailyUrl,
  DailyPriceSchema,
  easternTradingDate,
  type PersonalListing,
  type DailyPrice,
} from "@keel/domain/market-close";

// The immutable listing binds the reviewed instrument to this daily-price source.
// Official-close enrollment and personal daily-close enrollment never share a listing.
export const personalDailyInstrumentPrefix = "personal-daily:alpha-vantage:";
export function personalInstrument(listing: PersonalListing) {
  return (
    personalDailyInstrumentPrefix +
    [listing.issuerId, listing.venue, listing.ticker, listing.shareClass].join(
      "/",
    )
  );
}

export async function recordPersonalDailyCloses(
  db: D1Database,
  exposureId: string,
  listing: PersonalListing,
  prices: readonly DailyPrice[],
  observedAt: string,
  basisKey = personalInstrument(listing),
) {
  const rows = DailyPriceSchema.array().min(1).max(100).parse(prices);
  const source = alphaVantageDailyUrl(listing.ticker);
  const instrument = personalInstrument(listing);
  const timestamp = new Date(z.iso.datetime().parse(observedAt)).toISOString();
  const easternToday = easternTradingDate(new Date(timestamp));
  if (
    Date.parse(timestamp) > Date.now() ||
    rows.some((r) => r.date >= easternToday) ||
    new Set(rows.map((r) => r.date)).size !== rows.length
  )
    throw new Error("Expected unique completed daily prices.");
  const match = await db
    .prepare(
      "SELECT first_session FROM exposure_market_listings WHERE exposure_id=? AND instrument_id=? AND ticker=? AND venue=? AND currency='USD' AND share_class=? AND basis_key=? AND first_session=? AND identity_source_url=?",
    )
    .bind(
      exposureId,
      instrument,
      listing.ticker,
      listing.venue,
      listing.shareClass,
      basisKey,
      listing.firstSession,
      listing.identitySourceUrl,
    )
    .first();
  if (!match)
    throw new Error("Daily prices require the matching confirmed listing.");
  // Materialize the last revision per supplied session before appending any corrections.
  const result = await db
    .prepare(
      `WITH history AS MATERIALIZED (
    SELECT json_extract(value,'$.date') AS day,json_extract(value,'$.priceMicros') AS price
    FROM json_each(?) WHERE json_extract(value,'$.date')>=?
  ), compared AS MATERIALIZED (
    SELECT h.*,q.price_micros previous,q.observed_at last_seen,coalesce(q.revision,0)+1 revision FROM history h
    LEFT JOIN exposure_market_closes q ON q.exposure_id=? AND q.session_date=h.day AND q.revision=(
      SELECT max(p.revision) FROM exposure_market_closes p WHERE p.exposure_id=? AND p.session_date=h.day)
  )
  INSERT INTO exposure_market_closes(id,exposure_id,session_date,revision,price_micros,units_per_original,source_url,observed_at)
  SELECT json_array(?,day,revision),?,day,revision,price,1,?,? FROM compared WHERE previous IS NULL OR (previous<>price AND last_seen<?) ORDER BY day`,
    )
    .bind(
      JSON.stringify(rows),
      listing.firstSession,
      exposureId,
      exposureId,
      exposureId,
      exposureId,
      source,
      timestamp,
      timestamp,
    )
    .run();
  return result.meta.changes > 0;
}
