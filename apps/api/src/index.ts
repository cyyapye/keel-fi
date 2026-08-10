import { createApp } from "./app";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import type { Env } from "./types";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: handlePortfolioWatchQueue,
} satisfies ExportedHandler<Env, unknown>;
