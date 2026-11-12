import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    ...(process.env.KEEL_TEST_SQLITE_SNAPSHOT_ROOT
      ? {
          globalSetup: ["./scripts/test-support/sqlite-vitest-global.ts"],
          setupFiles: ["./scripts/test-support/sqlite-vitest-worker.ts"],
        }
      : {}),
    // Start costly fixtures early while leaving capacity for browser lanes.
    // Real workerd fixtures spawn native processes beyond these three workers.
    maxWorkers: 3,
    sequence: { sequencer: CiTestSequencer },
    // Private timing experiments can contain copies of tracked test suites.
    exclude: ["e2e/**", ".keel-local/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
