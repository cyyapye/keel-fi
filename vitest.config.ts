import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    // Real workerd fixtures and GPG probes spawn native processes. Keep their
    // combined CPU/memory bounded on local and shared CI hosts.
    maxWorkers: 2,
    sequence: { sequencer: CiTestSequencer },
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
