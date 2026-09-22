import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import {
  browserTestDirectory,
  resolveBrowserTestLane,
} from "./scripts/browser-test-lanes";
import { resolveDevPorts } from "./scripts/dev-ports";

const { webPort } = resolveDevPorts();
const baseURL = `http://127.0.0.1:${webPort}`;
const readinessURL = `${baseURL}/api/alpha`;
const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));
const browserLane = resolveBrowserTestLane({
  e2eDirectory: browserTestDirectory(repositoryRoot),
  lane: process.env.KEEL_BROWSER_LANE,
});

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
    serviceWorkers: browserLane.lane === "mocked" ? "block" : "allow",
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
