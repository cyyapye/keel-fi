import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";

import { controlledChromeArguments } from "../scripts/browser-agent-runtime";
import {
  __providerBrowserReconnectTest,
  type ProviderBrowserRuntimeOptions,
} from "../scripts/provider-browser-reconnect";
import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const { closeChromeGracefully, completeBrowserSession, stopChild } =
  __providerBrowserReconnectTest;

for (const [provider, persisted] of [
  ["tokenfolio", true],
  ["sydecar", false],
] as const) {
  test(
    `${provider} ${persisted ? "accepts a saved" : "rejects a lost"} sign-in after a real Chrome restart`,
    { tag: "@desktop-only" },
    async () => {
      const profile = await mkdtemp(
        path.join(os.tmpdir(), "keel-synthetic-reconnect-"),
      );
      const origin =
        provider === "tokenfolio"
          ? "https://app.tokenfolio.co"
          : "https://app.sydecar.io";
      const portfolio =
        provider === "tokenfolio"
          ? '<button id="portfolio-tab-active" role="tab">Active Holdings0</button>'
          : '<table data-testid="investments-table"><thead><tr><th>Investment</th></tr></thead><tbody></tbody></table>';
      const processes: ChildProcess[] = [];
      const browsers: Array<{ child: ChildProcess; endpoint: string }> = [];
      const start = async (interactive = false) => {
        await rm(path.join(profile, "DevToolsActivePort"), { force: true });
        const headed =
          interactive &&
          process.platform === "linux" &&
          Boolean(process.env.DISPLAY);
        const environment = { ...process.env };
        if (!headed) {
          delete environment.DISPLAY;
          delete environment.XAUTHORITY;
        }
        const child = spawn(
          chromium.executablePath(),
          [
            ...controlledChromeArguments(profile, "linux").filter(
              (argument) => !headed || argument !== "--headless=new",
            ),
            // Only the synthetic test browser uses Playwright's sandbox setting.
            "--no-sandbox",
          ],
          { env: environment, stdio: "ignore" },
        );
        processes.push(child);
        let port = "";
        await expect
          .poll(
            async () => {
              if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(
                  "Synthetic Chrome exited before DevTools was ready.",
                );
              }
              port = await readFile(
                path.join(profile, "DevToolsActivePort"),
                "utf8",
              )
                .then((text) => text.split("\n")[0] ?? "")
                .catch(() => "");
              return /^\d+$/u.test(port);
            },
            {
              // Match ensureChrome's startup budget, including a cold profile.
              timeout: 20_000,
            },
          )
          .toBe(true);
        const endpoint = `http://127.0.0.1:${port}`;
        const browser = await chromium.connectOverCDP(endpoint, {
          noDefaults: true,
        });
        browsers.push({ child, endpoint });
        return { child, endpoint, context: browser.contexts()[0]! };
      };
      const routePortfolio = async (
        context: BrowserContext,
        interactive = false,
      ) => {
        await context.route(`${origin}/**`, async (route) => {
          // headers() can omit cookie headers; this assertion must inspect the
          // complete request sent by the reopened browser.
          const headers = await route.request().allHeaders();
          const authenticated =
            interactive ||
            (headers.cookie ?? "").includes("synthetic_session=saved");
          if (!interactive) expect(authenticated).toBe(persisted);
          await route.fulfill({
            contentType: "text/html",
            body: authenticated
              ? portfolio
              : '<input type="password"><button>Sign in</button>',
          });
        });
        const page = await context.newPage();
        await page.goto(`${origin}/portfolio`);
        return page;
      };
      try {
        // xvfb-run exercises the production visible -> headless handoff on
        // Linux. Without a display this still proves cold-profile persistence.
        const interactive = await start(true);
        const page = await routePortfolio(interactive.context, true);
        if (persisted) {
          await interactive.context.addCookies([
            {
              name: "synthetic_session",
              value: "saved",
              url: origin,
              expires: Math.floor(Date.now() / 1_000) + 3_600,
            },
          ]);
        }
        await expect(
          __providerPortfolioMacAgentTest.providerPageReady(page, provider),
        ).resolves.toBe(true);
        let completed = false;
        const options: ProviderBrowserRuntimeOptions = {
          appDirectory: profile,
          profileDirectory: profile,
          chromePath: chromium.executablePath(),
          provider,
          label: "Synthetic provider",
          startUrl: `${origin}/portfolio`,
          isProviderReady: () => Promise.resolve(true),
          authorization: {
            version: 1,
            target: provider,
            apiOrigin: "https://keel.example.com",
            token: "a".repeat(43),
          },
          lease: {
            id: "11111111-1111-4111-8111-111111111111",
            leaseToken: "b".repeat(43),
            viewerSubject: "synthetic-access-subject",
            expiresAt: "2026-09-04T12:15:00.000Z",
          },
          verifySavedSession: async () => {
            const reopened = await start();
            expect(
              (await reopened.context.cookies(origin)).some(
                (cookie) =>
                  cookie.name === "synthetic_session" &&
                  cookie.value === "saved",
              ),
            ).toBe(persisted);
            await __providerPortfolioMacAgentTest.requireProviderPageReady(
              await routePortfolio(reopened.context),
              provider,
              // Cold Linux rendering can exceed 250 ms; authentication is
              // asserted separately above, before the page-readiness check.
              2_000,
            );
          },
        };
        const completion = completeBrowserSession(
          options,
          () => closeChromeGracefully(interactive.child, interactive.endpoint),
          () => {
            completed = true;
            return Promise.resolve("connected");
          },
        );
        if (persisted) {
          await expect(completion).resolves.toBe("connected");
        } else {
          await expect(completion).rejects.toThrow("provider_sign_in_required");
        }
        expect(completed).toBe(persisted);
        expect(interactive.child.exitCode).toBe(0);
      } finally {
        for (const { child, endpoint } of browsers) {
          if (child.exitCode === null && child.signalCode === null) {
            await closeChromeGracefully(child, endpoint).catch(() =>
              stopChild(child),
            );
          }
        }
        for (const child of processes) await stopChild(child);
        // Chrome helpers can finish filesystem teardown just after the parent
        // exits. Retry only cleanup of this exact disposable test directory.
        await rm(profile, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        });
      }
    },
  );
}
