import { createApp } from "./app";
import { handleInvestmentSyncScheduled } from "./plaid-investments-schedule";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import { handlePortfolioWatchScheduled } from "./portfolio-watch-schedule";
import type { Env } from "./types";

const app = createApp();

async function handleScheduled(
  controller: ScheduledController,
  env: Env,
): Promise<void> {
  await Promise.all([
    handleInvestmentSyncScheduled(controller, env),
    handlePortfolioWatchScheduled(controller, env),
  ]);
}

export default {
  fetch: app.fetch,
  queue: handlePortfolioWatchQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env, unknown>;
