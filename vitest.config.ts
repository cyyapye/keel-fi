import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real workerd fixtures and GPG probes spawn native processes. Keep their
    // combined CPU/memory bounded on local and shared CI hosts.
    maxWorkers: 4,
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
