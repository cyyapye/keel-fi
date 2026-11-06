import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type BrowserContext } from "@playwright/test";

import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const { withProviderBrowser } = __providerPortfolioMacAgentTest;
const origin = new URL("https://keel.example.com");
const providerUrl = "https://synthetic-provider.example/portfolio";
const idleMs = 12 * 60 * 60_000;
const fixture = `<!doctype html><title>Synthetic provider</title>
  <main>Synthetic portfolio</main><script>
    setTimeout(() => localStorage.removeItem("synthetic-sign-in"), ${idleMs});
  </script>`;

test(
  "Sydecar closes between captures and preserves its saved profile across browser restarts",
  { tag: "@desktop-only" },
  async ({ playwright }, testInfo) => {
    const profile = testInfo.outputPath("synthetic-provider-profile");
    let ownedBrowser: BrowserContext | null = null;
    let closed = false;
    const runtime = {
      connectContext: async () => {
        closed = false;
        ownedBrowser = await playwright.chromium.launchPersistentContext(
          profile,
          {
            headless: true,
            args: ["--remote-debugging-port=0"],
          },
        );
        ownedBrowser.once("close", () => {
          closed = true;
        });
        const port = (
          await readFile(path.join(profile, "DevToolsActivePort"), "utf8")
        ).split("\n")[0];
        // Match the worker: disconnecting this CDP client alone leaves Chrome open.
        const browser = await playwright.chromium.connectOverCDP(
          `http://127.0.0.1:${port}`,
          { noDefaults: true },
        );
        const context = browser.contexts()[0]!;
        await context.route(`${new URL(providerUrl).origin}/**`, (route) =>
          route.fulfill({ body: fixture, contentType: "text/html" }),
        );
        return context;
      },
      closeControlledChrome: async () => {
        await ownedBrowser?.close();
      },
    };
    try {
      // Reproduce the failure with an open, idle page using only fabricated state.
      const idleContext = await runtime.connectContext();
      const idlePage = await idleContext.newPage();
      await idlePage.clock.install();
      await idlePage.goto(providerUrl);
      await idlePage.evaluate(() =>
        localStorage.setItem("synthetic-sign-in", "synthetic-saved-session"),
      );
      await idlePage.clock.fastForward(idleMs);
      expect(
        await idlePage.evaluate(() =>
          localStorage.getItem("synthetic-sign-in"),
        ),
      ).toBeNull();
      await runtime.closeControlledChrome();
      await idleContext.browser()?.close();

      await withProviderBrowser(
        "sydecar",
        origin,
        async (context) => {
          const page = await context.newPage();
          await page.clock.install();
          await page.goto(providerUrl);
          await page.evaluate(() =>
            localStorage.setItem(
              "synthetic-sign-in",
              "synthetic-saved-session",
            ),
          );
        },
        runtime,
      );
      expect(closed).toBe(true);

      // Reopening the exact profile must preserve the saved sign-in. Also exercise
      // cleanup after a failed capture rather than leaving its idle page running.
      const captureFailure = new Error("synthetic capture failure");
      await expect(
        withProviderBrowser(
          "sydecar",
          origin,
          async (context) => {
            const page = await context.newPage();
            await page.clock.install();
            await page.goto(providerUrl);
            expect(
              await page.evaluate(() =>
                localStorage.getItem("synthetic-sign-in"),
              ),
            ).toBe("synthetic-saved-session");
            throw captureFailure;
          },
          runtime,
        ),
      ).rejects.toBe(captureFailure);
      expect(closed).toBe(true);
    } finally {
      await runtime.closeControlledChrome();
    }
  },
);
