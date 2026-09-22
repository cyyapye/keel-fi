import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  BROWSER_TEST_EXECUTION,
  browserTestDirectory,
  resolveBrowserTestLane,
} from "./scripts/browser-test-lanes";
import { resolveDevPorts } from "./scripts/dev-ports";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const browserLane = resolveBrowserTestLane({
  e2eDirectory: browserTestDirectory(repositoryRoot),
  lane: process.env.KEEL_BROWSER_LANE,
});
const localPorts = resolveDevPorts();
const webPort =
  browserLane.lane === "all"
    ? localPorts.webPort
    : BROWSER_TEST_EXECUTION[browserLane.lane].webPort;
const baseURL = `http://127.0.0.1:${webPort}`;
const readinessURL =
  browserLane.server === "mocked"
    ? baseURL
    : `${baseURL}${browserLane.lane === "all" ? "/api/alpha" : "/api/holdings-page"}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: browserLane.files,
  fullyParallel: true,
  // The mocked lane rejects unhandled application API requests. All flows that
  // can reach shared D1 or own provider/browser processes remain serialized.
  workers: browserLane.workers,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  snapshotPathTemplate:
    "{testDir}/{testFilePath}-snapshots/{arg}-{projectName}-{platform}{ext}",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    serviceWorkers: browserLane.server === "mocked" ? "block" : "allow",
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
    command:
      browserLane.lane === "all"
        ? "pnpm dev"
        : "pnpm exec tsx scripts/browser-test-server.ts",
    reuseExistingServer:
      !process.env.CI && process.env.KEEL_E2E_ISOLATED !== "1",
    timeout: 120_000,
    // Waiting through Vite's API proxy proves both local services are ready.
    url: readinessURL,
  },
});
