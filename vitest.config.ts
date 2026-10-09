import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    // Start costly fixtures early while leaving capacity for browser lanes.
    // Real workerd fixtures spawn native processes beyond these two workers.
    maxWorkers: 2,
    sequence: { sequencer: CiTestSequencer },
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
