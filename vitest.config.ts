import { defineConfig } from "vitest/config";
import RequiredVitestReporter from "./scripts/required-vitest-reporter";

export default defineConfig({
  test: {
    allowOnly: process.env.KEEL_REQUIRED_TESTS !== "1" && !process.env.CI,
    passWithNoTests: false,
    reporters:
      process.env.KEEL_REQUIRED_TESTS === "1"
        ? ["default", new RequiredVitestReporter()]
        : ["default"],
    // Real workerd fixtures and GPG probes spawn native processes. Keep their
    // combined CPU/memory bounded on local and shared CI hosts.
    maxWorkers: 4,
    exclude: ["e2e/**", ".tugling/**", "**/node_modules/**", "**/dist/**"],
    include: ["**/*.test.ts", "**/*.test.tsx"],
  },
});
