import { defineConfig } from "vitest/config";
import { CiTestSequencer } from "./scripts/ci-test-sequencer";

export default defineConfig({
  test: {
    // CI starts the expensive native fixtures before browser admission. Keep
    // the smaller local pool for the developer's other apps and PDF VM.
    maxWorkers: process.env.CI ? 3 : 2,
    sequence: { sequencer: CiTestSequencer },
    exclude: ["e2e/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
