import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    // Real workerd fixtures and GPG probes spawn native processes. Leave CPU
    // capacity for the independent browser lanes on the six-CPU CI host.
    maxWorkers: 2,
    sequence: { sequencer: CiTestSequencer },
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
