import { D1InvestmentPositionViewRepository } from "./position-read-model";
import { D1InvestmentExposureViewRepository } from "./exposure-read-model";
import { z } from "zod";
import {
  MarketQuoteSchema,
  MarketReviewSchema,
  type MarketReview,
  type MarketDecisionInput,
} from "@keel/domain/market-close";
import {
  PurchaseReceiptSchema,
  effectivePositionValuation,
  publicClosingValuation,
} from "@keel/domain/position-purchases";

interface ReviewRow {
  exposure_id: string;
  canonical_name: string;
  first_session: string;
  quote_json: string;
  first_price: number;
  is_read: number;
  read_version: number;
  version: number;
  choice: "keep" | "follow" | null;
  position_id: string;
  mapping_id: string;
  legal_vehicle_name: string;
  receipt_json: string;
  receipt_id: string;
  snapshot_id: string;
  unrealized_value_minor: number | null;
  enrolled: number;
}
const candidates = ` FROM users u JOIN households hh ON hh.owner_user_id=u.id
 JOIN canonical_exposures e ON e.household_id=hh.id
 JOIN exposure_market_prices price ON price.exposure_id=e.id
 JOIN exposure_market_closes first ON first.exposure_id=e.id AND first.session_date=price.first_session AND first.revision=(SELECT max(f.revision) FROM exposure_market_closes f WHERE f.exposure_id=e.id AND f.session_date=price.first_session)
 LEFT JOIN exposure_market_news_reads news ON news.exposure_id=e.id AND news.user_id=u.id
 JOIN exposure_market_candidates c ON c.household_id=hh.id AND c.exposure_id=e.id
 LEFT JOIN exposure_market_members m ON m.position_id=c.position_id AND m.mapping_id=c.mapping_id
 LEFT JOIN exposure_market_decisions d ON d.id=(SELECT id FROM exposure_market_decisions WHERE exposure_id=e.id ORDER BY version DESC LIMIT 1)
 WHERE u.access_subject=?`;
type Scope = {
  id: string;
  mappingId: string;
  receiptId: string;
  snapshotId: string;
}[];
async function reviews(db: D1Database, subject: string, exposure?: string) {
  const selectCandidates = `SELECT e.id exposure_id,e.canonical_name,price.first_session,price.quote_json,
    first.price_micros first_price,coalesce(news.is_read,0) is_read,coalesce(news.version,0) read_version,coalesce(d.version,0) version,d.choice,c.position_id,c.mapping_id,c.legal_vehicle_name,c.receipt_json,c.receipt_id,c.snapshot_id,c.unrealized_value_minor,
    (m.position_id IS NOT NULL) enrolled ${candidates}`;
  const order = " ORDER BY e.id,c.position_id";
  const statement = exposure
    ? db
        .prepare(selectCandidates + " AND e.id=?" + order)
        .bind(subject, exposure)
    : db.prepare(selectCandidates + order).bind(subject);
  const { results } = await statement.all<ReviewRow>();
  const groups = new Map<string, { review: MarketReview; scope: Scope }>();
  for (const row of results) {
    const quote = MarketQuoteSchema.parse(JSON.parse(row.quote_json));
    const receipt = PurchaseReceiptSchema.parse(JSON.parse(row.receipt_json));
    const mark = publicClosingValuation(receipt, quote);
    if (!mark) continue;
    let group = groups.get(row.exposure_id);
    if (!group) {
      group = {
        review: {
          exposureId: row.exposure_id,
          name: row.canonical_name,
          quote,
          firstDate: row.first_session,
          firstPriceMicros: row.first_price,
          read: Boolean(row.is_read),
          readVersion: row.read_version,
          version: row.version,
          choice: row.choice,
          positions: [],
          token: "",
        },
        scope: [],
      };
      groups.set(row.exposure_id, group);
    }
    group.review.positions.push({
      id: row.position_id,
      name: row.legal_vehicle_name,
      valueMinor: mark.valueMinor,
      quantityMicros: mark.quantityMicros,
      previousMinor:
        effectivePositionValuation(receipt, row.snapshot_id)?.valueMinor ??
        row.unrealized_value_minor,
      enrolled: Boolean(row.enrolled),
    });
    group.scope.push({
      id: row.position_id,
      mappingId: row.mapping_id,
      receiptId: row.receipt_id,
      snapshotId: row.snapshot_id,
    });
  }
  await Promise.all(
    [...groups.values()].map(async ({ review, scope }) => {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify([
            review.exposureId,
            review.version,
            review.quote.id,
            scope,
          ]),
        ),
      );
      review.token = Array.from(new Uint8Array(digest), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
    }),
  );
  return groups;
}
export async function listMarketReviews(db: D1Database, subject: string) {
  return Array.from((await reviews(db, subject)).values(), ({ review }) =>
    MarketReviewSchema.parse(review),
  );
}
// The review compares against the same accepted GP, proxy and adjustment precedence as Holdings.
export async function marketReviewDetail(
  db: D1Database,
  subject: string,
  exposure: string,
) {
  const current = (await reviews(db, subject, exposure)).get(exposure)?.review;
  if (!current) return null;
  const previous = await new D1InvestmentPositionViewRepository(db).list(
    subject,
  );
  for (const connection of previous.connections)
    for (const account of connection.containers)
      for (const p of account.positions) {
        if (p.purchaseReceipt?.publicClose)
          delete p.purchaseReceipt.publicClose;
      }
  const projection = await new D1InvestmentExposureViewRepository(db).list(
    subject,
    previous.asOf,
    previous,
  );
  const byId = new Map(projection.positions.map((p) => [p.id, p]));
  current.positions = current.positions
    .filter(
      (p) => byId.has(p.id) && (current.choice !== "follow" || p.enrolled),
    )
    .map((p) => {
      const prior = byId.get(p.id)!;
      return {
        ...p,
        previousMinor: prior.valueMinor,
        previousSource: prior.valueSourceLabel ?? prior.sourceLabel,
      };
    });
  return current.positions.length ? MarketReviewSchema.parse(current) : null;
}
export async function decideMarketSource(
  db: D1Database,
  subject: string,
  exposure: string,
  input: z.infer<typeof MarketDecisionInput>,
) {
  const prior = await db
    .prepare(
      `SELECT d.choice,d.input_token FROM exposure_market_decisions d JOIN users u ON u.id=d.user_id
    WHERE d.id=? AND d.exposure_id=? AND u.access_subject=?`,
    )
    .bind(input.requestId, exposure, subject)
    .first<{ choice: string; input_token: string }>();
  if (prior)
    return prior.choice === input.choice && prior.input_token === input.token;
  const group = (await reviews(db, subject, exposure)).get(exposure);
  if (!group || group.review.token !== input.token) return false;
  const { review, scope } = group;
  const result = await db
    .prepare(
      `INSERT INTO exposure_market_decisions(id,exposure_id,version,quote_id,user_id,choice,scope_json,input_token,decided_at)
    SELECT ?,e.id,?,?,u.id,?,?,?,? FROM users u JOIN households hh ON hh.owner_user_id=u.id
    JOIN canonical_exposures e ON e.household_id=hh.id JOIN exposure_market_heads h ON h.exposure_id=e.id
    WHERE u.access_subject=? AND e.id=? AND h.quote_id=? AND
    coalesce((SELECT max(version) FROM exposure_market_decisions WHERE exposure_id=e.id),0)=?
    AND NOT EXISTS(SELECT 1 FROM json_each(?) item WHERE NOT EXISTS(
       SELECT 1 FROM exposure_market_candidates c WHERE c.position_id=json_extract(item.value,'$.id') AND c.exposure_id=e.id
       AND c.mapping_id=json_extract(item.value,'$.mappingId') AND c.receipt_id=json_extract(item.value,'$.receiptId') AND c.snapshot_id=json_extract(item.value,'$.snapshotId')))
    ON CONFLICT DO NOTHING`,
    )
    .bind(
      input.requestId,
      review.version + 1,
      review.quote.id,
      input.choice,
      JSON.stringify(scope),
      input.token,
      new Date().toISOString(),
      subject,
      exposure,
      review.quote.id,
      review.version,
      JSON.stringify(scope),
    )
    .run();
  return result.meta.changes > 0;
}

// Called only by a trusted price-feed importer after the listing identity is confirmed.
export const OfficialCloseSchema = z
  .object({
    instrumentId: z.string().min(1).max(160),
    revision: z.number().int().positive().safe(),
    exposureId: z.string().min(1),
    ticker: z.string().min(1),
    venue: z.string().min(1),
    currency: z.literal("USD"),
    session: z.literal("regular_close"),
    date: z.iso.date(),
    priceMicros: MarketQuoteSchema.shape.priceMicros,
    shareClass: z.string().min(1),
    shareBasis: MarketQuoteSchema.shape.shareBasis,
    sourceUrl: MarketQuoteSchema.shape.sourceUrl,
    observedAt: z.iso.datetime(),
  })
  .strict();
export async function recordOfficialClose(db: D1Database, raw: unknown) {
  const q = OfficialCloseSchema.parse(raw);
  if (q.observedAt.slice(0, 10) < q.date)
    throw new Error("The observation predates the closing session.");
  const id = JSON.stringify([q.exposureId, q.date, q.revision]);
  await db
    .prepare(
      `INSERT INTO exposure_market_closes
    SELECT ?,exposure_id,?,?,?,?,?,? FROM exposure_market_listings WHERE exposure_id=? AND ticker=? AND venue=?
    AND instrument_id=? AND first_session<=? AND share_class=? AND basis_key=? AND currency=?
    ON CONFLICT(exposure_id,session_date,revision) DO NOTHING`,
    )
    .bind(
      id,
      q.date,
      q.revision,
      q.priceMicros,
      q.shareBasis.unitsPerOriginal,
      q.sourceUrl,
      q.observedAt,
      q.exposureId,
      q.ticker,
      q.venue,
      q.instrumentId,
      q.date,
      q.shareClass,
      q.shareBasis.key,
      q.currency,
    )
    .run();
  const saved = await db
    .prepare(
      `SELECT price_micros,units_per_original,source_url FROM exposure_market_closes q JOIN exposure_market_listings l USING(exposure_id) WHERE q.id=? AND l.instrument_id=? AND l.venue=? AND l.ticker=? AND l.share_class=? AND l.basis_key=?`,
    )
    .bind(id, q.instrumentId, q.venue, q.ticker, q.shareClass, q.shareBasis.key)
    .first<{
      price_micros: number;
      units_per_original: number;
      source_url: string;
    }>();
  if (
    !saved ||
    saved.price_micros !== q.priceMicros ||
    saved.units_per_original !== q.shareBasis.unitsPerOriginal ||
    saved.source_url !== q.sourceUrl
  )
    throw new Error(
      "The close conflicts with the confirmed listing or a recorded session.",
    );
}

export async function setMarketNewsRead(
  db: D1Database,
  subject: string,
  exposure: string,
  read: boolean,
  expectedVersion: number,
) {
  const saved = await db
    .prepare(
      `INSERT INTO exposure_market_news_reads(exposure_id,user_id,is_read,version)
    SELECT l.exposure_id,u.id,?,?+1 FROM users u JOIN households hh ON hh.owner_user_id=u.id
    JOIN canonical_exposures e ON e.household_id=hh.id JOIN exposure_market_prices l ON l.exposure_id=e.id
    WHERE u.access_subject=? AND e.id=? AND coalesce((SELECT version FROM exposure_market_news_reads WHERE exposure_id=e.id AND user_id=u.id),0)=?
    ON CONFLICT(exposure_id,user_id) DO UPDATE SET is_read=excluded.is_read,version=excluded.version`,
    )
    .bind(Number(read), expectedVersion, subject, exposure, expectedVersion)
    .run();
  return saved.meta.changes === 1;
}
