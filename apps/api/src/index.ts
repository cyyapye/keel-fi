import { handleAngelListScheduled } from "./angellist-automation";
import { createApp } from "./app";
import { handlePortfolioWatchQueue } from "./portfolio-watch";
import type { Env } from "./types";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: handlePortfolioWatchQueue,
  scheduled(controller, env, context) {
    context.waitUntil(handleAngelListScheduled(controller, env));
  },
} satisfies ExportedHandler<Env, unknown>;
