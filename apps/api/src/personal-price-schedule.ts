import { PLAID_INVESTMENTS_DAILY_SYNC_CRON } from "@keel/connectors";
import { fetchDailyPrices } from "@keel/connectors/alpha-vantage-daily";
import { PreviewPersonalFeedSchema } from "@keel/domain/market-close";
import {
  personalInstrument,
  recordPersonalDailyCloses,
} from "@keel/database/personal-daily-closes";
import type { Env } from "./types";

const windowKey = "personal-market/daily-window";
export async function refreshPreviewDailyPrices(
  controller: Pick<ScheduledController, "cron" | "scheduledTime">,
  env: Env,
) {
  if (
    env.ENVIRONMENT !== "preview" ||
    env.PERSONAL_DAILY_PRICES_ENABLED !== "true" ||
    controller.cron !== PLAID_INVESTMENTS_DAILY_SYNC_CRON ||
    !env.ALPHA_VANTAGE_PERSONAL_FEED
  )
    return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (new Date(controller.scheduledTime).toISOString().slice(0, 10) !== day)
    return;
  try {
    const { listing, apiKey, householdId, exposureId, basisKey } =
      PreviewPersonalFeedSchema.parse(
        JSON.parse(env.ALPHA_VANTAGE_PERSONAL_FEED),
      );
    // One rolling, strongly consistent slot for the single configured personal exposure.
    // A lost response spends the slot. Concurrent or redelivered ticks cannot retry the feed.
    const prior = await env.DOCUMENTS.head(windowKey);
    if (
      prior &&
      (!prior.customMetadata?.day || prior.customMetadata.day >= day)
    )
      return;
    const admitted = await env.DOCUMENTS.put(windowKey, day, {
      onlyIf: prior ? { etagMatches: prior.etag } : { etagDoesNotMatch: "*" },
      customMetadata: { day },
    });
    if (!admitted) return;
    const instrument = personalInstrument(listing);
    const current = await env.DB.prepare(
      `SELECT l.exposure_id AS registered,h.session_date AS latest
       FROM canonical_exposures e LEFT JOIN exposure_market_listings l ON l.exposure_id=e.id
       LEFT JOIN exposure_market_heads h ON h.exposure_id=e.id
       WHERE e.id=? AND e.household_id=? AND e.canonical_name=? AND e.exposure_kind='private_company'
       AND (l.exposure_id IS NULL OR (l.instrument_id=? AND l.basis_key=? AND l.first_session=?
         AND l.ticker=? AND l.venue=? AND l.share_class=? AND l.identity_source_url=? AND l.currency='USD'))`,
    )
      .bind(
        exposureId,
        householdId,
        listing.company,
        instrument,
        basisKey,
        listing.firstSession,
        listing.ticker,
        listing.venue,
        listing.shareClass,
        listing.identitySourceUrl,
      )
      .first<{ registered: string | null; latest: string | null }>();
    if (!current) throw new Error("Unconfirmed exposure");
    const prices = await fetchDailyPrices(
      listing.ticker,
      apiKey,
      now,
      listing.firstSession,
      "preview",
    );
    if (
      !current.latest &&
      !prices.some((price) => price.date === listing.firstSession)
    )
      throw new Error("First session unavailable");
    if (!current.registered) {
      await env.DB.prepare(
        `INSERT INTO exposure_market_listings SELECT id,?,?,?,?,?,?,?,'USD' FROM canonical_exposures WHERE id=? AND household_id=? AND canonical_name=? AND exposure_kind='private_company' ON CONFLICT(exposure_id) DO NOTHING`,
      )
        .bind(
          instrument,
          listing.ticker,
          listing.venue,
          listing.shareClass,
          basisKey,
          listing.firstSession,
          listing.identitySourceUrl,
          exposureId,
          householdId,
          listing.company,
        )
        .run();
    }
    const changed = await recordPersonalDailyCloses(
      env.DB,
      exposureId,
      listing,
      prices,
      now.toISOString(),
      basisKey,
    );
    console.info(
      JSON.stringify({
        event: "personal_daily_prices",
        status: changed ? "updated" : "current",
      }),
    );
  } catch {
    // Keep secrets, request URLs and personal portfolio identities out of worker logs.
    console.error(
      JSON.stringify({ event: "personal_daily_prices", status: "unavailable" }),
    );
  }
}
