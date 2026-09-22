import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    // Real workerd fixtures and GPG probes spawn native processes. The six-CPU
    // CI host is limited to three workers; local runs retain two.
    maxWorkers: process.env.CI ? 3 : 2,
    sequence: { sequencer: CiTestSequencer },
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
