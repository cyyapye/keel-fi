import { personalPriceServer } from "../../scripts/personal-price-server";
import { localClosingPriceFeed } from "../../scripts/local-closing-price-feed";
import { uiCataloguePlugin } from "../../scripts/ui-catalogue-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { browserTestReadinessPlugin } from "../../scripts/browser-test-readiness";
import { resolveDevPorts } from "../../scripts/dev-ports";

const { apiPort } = resolveDevPorts();
const browserCacheDir = process.env.KEEL_BROWSER_VITE_CACHE_DIR;
const browserReadinessEnabled = process.env.KEEL_BROWSER_VITE_READINESS === "1";

export default defineConfig({
  ...(browserCacheDir === undefined ? {} : { cacheDir: browserCacheDir }),
  plugins: [
    react(),
    ...(process.env.KEEL_LOCAL_SCENARIO === "closing-price"
      ? [localClosingPriceFeed()]
      : []),
    ...(process.env.KEEL_LOCAL_SCENARIO === "personal-prices"
      ? [personalPriceServer()]
      : []),
    uiCataloguePlugin(),
    ...(browserReadinessEnabled ? [browserTestReadinessPlugin()] : []),
  ],
  server: {
    // Keep Vite's WebSocket pings outside the browser tests' simulated day.
    // Application timers still run for every virtual hour.
    ...(browserReadinessEnabled ? { hmr: { timeout: 48 * 60 * 60_000 } } : {}),
    proxy: {
      "/mcp": {
        target: process.env.KEEL_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      "/.well-known": {
        target: process.env.KEEL_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      "/oauth/token": {
        target: process.env.KEEL_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      "/oauth/register": {
        target: process.env.KEEL_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
      "/api": {
        target: process.env.KEEL_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    manifest: true,
    sourcemap: true,
    target: "es2023",
  },
});
