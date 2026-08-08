import { createApp } from "./app";
import { handlePortfolioWatchQueue } from "./portfolio-watch";

const app = createApp();

export default {
  fetch: app.fetch,
  queue: handlePortfolioWatchQueue,
};
