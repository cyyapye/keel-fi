import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolveDevPorts } from "../../scripts/dev-ports";

const { apiPort } = resolveDevPorts();

export default defineConfig({
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
    sourcemap: true,
    target: "es2023",
  },
});
