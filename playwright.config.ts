import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { BROWSER_TEST_VITE_READINESS_PATH } from "./scripts/browser-test-readiness";
import {
  BROWSER_TEST_EXECUTION,
  assertBrowserSnapshotRenderer,
  browserTestDirectory,
  resolveBrowserTestLane,
} from "./scripts/browser-test-lanes";
import { resolveDevPorts } from "./scripts/dev-ports";

assertBrowserSnapshotRenderer(process.platform, process.arch);

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
  browserLane.lane === "all"
    ? `${baseURL}/api/alpha`
    : browserLane.frontend === "development"
      ? `${baseURL}${BROWSER_TEST_VITE_READINESS_PATH}`
      : browserLane.server === "stateful"
        ? `${baseURL}/api/holdings-page`
        : baseURL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: browserLane.files,
  fullyParallel: true,
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
      grepInvert: /@mobile-only\b/u,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      grepInvert: /@desktop-only\b/u,
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: {
    command:
      browserLane.lane === "all"
        ? "pnpm dev"
        : "node --import tsx scripts/browser-test-server.ts",
    reuseExistingServer:
      !process.env.CI && process.env.KEEL_E2E_ISOLATED !== "1",
    timeout: 120_000,
    // Development lanes finish Vite's module graph before Playwright starts a
    // browser. Every stateful lane also waits for its synthetic API projection
    // through the same web proxy the browser consumes.
    url: readinessURL,
  },
});
