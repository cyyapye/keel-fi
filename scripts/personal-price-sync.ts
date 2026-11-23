import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DailyPriceSchema } from "../packages/domain/src/market-close";
import { fetchDailyPrices } from "../packages/connectors/src/alpha-vantage-daily";
import {
  personalInstrument,
  recordPersonalDailyCloses,
} from "../packages/database/src/personal-daily-closes";
import { readPersonalListing } from "./seed-personal-prices";

import { dailyWindow } from "./personal-price-window";
const CacheSchema = z.object({
  instrument: z.string(),
  observedAt: z.iso.datetime(),
  prices: DailyPriceSchema.array().min(1).max(100),
});
function storedKey() {
  const supplied = process.env.ALPHA_VANTAGE_API_KEY;
  if (supplied) return supplied;
  if (process.platform === "darwin")
    return execFileSync(
      "/usr/bin/security",
      [
        "find-generic-password",
        "-s",
        "Keel personal Alpha Vantage",
        "-a",
        "personal",
        "-w",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 },
    ).trim();
  throw new Error("Configure the personal Alpha Vantage key.");
}

export async function syncPersonalPrices(
  mode: "scheduled" | "replay",
  root: string,
  replayFirst: boolean,
) {
  const listing = readPersonalListing();
  const instrument = personalInstrument(listing);
  const id = z
    .uuid()
    .parse(readFileSync(join(root, "exposure-id"), "utf8").trim());
  const now = new Date();
  const { day } = dailyWindow(now.getTime());
  const dir = join(root, "daily-feed");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const cachePath = join(dir, day + ".json");
  const replayPath = join(dir, "first-session-replay");
  let fetched = false;
  if (!existsSync(cachePath) && mode === "scheduled") {
    // Even two fresh app processes or repeated restarts share one provider attempt this UTC day.
    try {
      writeFileSync(join(dir, day + ".attempt"), instrument, {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    const prices = await fetchDailyPrices(
      listing.ticker,
      storedKey(),
      now,
      listing.firstSession,
    );
    writeFileSync(
      cachePath + ".tmp",
      JSON.stringify({ instrument, observedAt: now.toISOString(), prices }),
      { mode: 0o600 },
    );
    renameSync(cachePath + ".tmp", cachePath);
    fetched = true;
  }
  if (!existsSync(cachePath)) return false;
  const cache = CacheSchema.parse(JSON.parse(readFileSync(cachePath, "utf8")));
  if (cache.instrument !== instrument)
    throw new Error("The saved prices belong to another listing.");
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    configPath: resolve("apps/api/wrangler.jsonc"),
    environment: "local",
    envFiles: [],
    remoteBindings: false,
    persist: { path: join(root, "v3") },
  });
  try {
    const db = proxy.env.DB;
    const state = await db
      .prepare(
        "SELECT h.session_date,(SELECT max(version) FROM exposure_market_decisions WHERE exposure_id=l.exposure_id) decision FROM exposure_market_listings l LEFT JOIN exposure_market_heads h USING(exposure_id) WHERE l.exposure_id=? AND l.instrument_id=?",
      )
      .bind(id, instrument)
      .first<{ session_date: string | null; decision: number | null }>();
    if (!state)
      throw new Error("Configured listing does not match local Holdings.");
    if (
      !state.session_date &&
      !cache.prices.some((p) => p.date === listing.firstSession)
    )
      throw new Error(
        "The first session is outside the available daily history.",
      );
    if (
      replayFirst &&
      !state.session_date &&
      mode === "scheduled" &&
      !existsSync(replayPath)
    )
      writeFileSync(replayPath, day, { mode: 0o600 });
    const firstOnly = existsSync(replayPath) && state.decision === null;
    if (mode === "replay" && (!state.decision || !existsSync(replayPath)))
      return false;
    const prices = firstOnly
      ? cache.prices.filter((p) => p.date === listing.firstSession)
      : cache.prices;
    if (!prices.length && firstOnly && state.session_date) return false;
    const changed = await recordPersonalDailyCloses(
      db,
      id,
      listing,
      prices,
      cache.observedAt,
    );
    if (existsSync(replayPath) && !firstOnly)
      renameSync(replayPath, replayPath + ".done");
    if (changed || fetched)
      console.log(
        `Personal prices: ${listing.ticker}, latest imported session ${prices.at(-1)?.date}.`,
      );
    return changed;
  } finally {
    await proxy.dispose();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve(
    process.argv[3] ?? ".keel-local/scenarios/personal-prices",
  );
  const mode = z.enum(["scheduled", "replay"]).parse(process.argv[2]);
  try {
    if (
      await syncPersonalPrices(
        mode,
        root,
        process.env.KEEL_PERSONAL_REPLAY_FIRST === "1",
      )
    )
      console.log("DAILY_PRICES_UPDATED");
  } catch {
    console.error(
      "Personal daily-price sync failed. Check the local listing, key, and provider availability. The last accepted price is retained.",
    );
    process.exitCode = 1;
  }
}
