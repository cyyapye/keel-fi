import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    // Start costly fixtures early while leaving capacity for browser lanes.
    // Real workerd fixtures spawn native processes beyond these three workers.
    maxWorkers: 3,
    sequence: { sequencer: CiTestSequencer },
    exclude: [".keel-local/**", "e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
