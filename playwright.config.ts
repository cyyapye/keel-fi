import { defineConfig, devices } from "@playwright/test";
import { resolveDevPorts } from "./scripts/dev-ports";

const { webPort } = resolveDevPorts();
const baseURL = `http://127.0.0.1:${webPort}`;
const readinessURL = `${baseURL}/api/alpha`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  // Functional flows share the seeded local D1 database and must not mutate it concurrently.
  workers: 1,
  forbidOnly:
    Boolean(process.env.CI) || process.env.KEEL_REQUIRED_TESTS === "1",
  retries: process.env.CI ? 2 : 0,
  reporter: [
    [process.env.CI ? "github" : "list"],
    ...(process.env.KEEL_REQUIRED_TESTS === "1"
      ? ([["./scripts/required-playwright-reporter.ts"]] as const)
      : []),
  ],
  snapshotPathTemplate:
    "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    reuseExistingServer:
      !process.env.CI && process.env.KEEL_E2E_ISOLATED !== "1",
    timeout: 120_000,
    // Waiting through Vite's API proxy proves both local services are ready.
    url: readinessURL,
  },
});
