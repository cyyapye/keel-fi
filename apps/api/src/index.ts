import { createApp } from "./app";
import { handleInvestmentSyncScheduled } from "./plaid-investments-schedule";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import type { Env } from "./types";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: handlePortfolioWatchQueue,
  scheduled: handleInvestmentSyncScheduled,
} satisfies ExportedHandler<Env, unknown>;
