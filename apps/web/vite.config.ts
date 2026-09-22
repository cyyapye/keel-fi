import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolveDevPorts } from "../../scripts/dev-ports";

const { apiPort } = resolveDevPorts();
const browserCacheDir = process.env.KEEL_BROWSER_VITE_CACHE_DIR;

export default defineConfig({
  ...(browserCacheDir === undefined ? {} : { cacheDir: browserCacheDir }),
  plugins: [react()],
  server: {
    proxy: {
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
