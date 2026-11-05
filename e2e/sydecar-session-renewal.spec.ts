import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { controlledChromeArguments } from "../scripts/browser-agent-runtime";
import { __providerBrowserReconnectTest } from "../scripts/provider-browser-reconnect";
import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const { closeChromeGracefully, stopChild } = __providerBrowserReconnectTest;
const {
  closeControlledChrome,
  portfolioPage,
  providerPaths,
  renewSavedSydecarSession,
  requireProviderPageReady,
} = __providerPortfolioMacAgentTest;
const origin = "https://app.sydecar.io";
const hour = 3_600_000;
const start = Date.parse("2026-09-01T00:00:00.000Z");
const table =
  '<table data-testid="investments-table"><tr><td>Synthetic portfolio</td></tr></table>';
const login = '<input type="password"><button>Sign in</button>';

test(
  "Sydecar renewal verifies expiry through the production tsx runner",
  { tag: "@desktop-only" },
  async () => {
    test.setTimeout(60_000);
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        path.resolve("node_modules/tsx/dist/cli.mjs"),
        path.resolve("scripts/test-support/sydecar-renewal-runtime-smoke.ts"),
      ],
      { timeout: 50_000, maxBuffer: 128 * 1024 },
    );
    const records: unknown[] = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    expect(records).toEqual([
      {
        event: "provider_session_renewal_verified",
        provider: "sydecar",
        admittedRequests: 1,
        refreshRemainingSeconds: 43_200,
      },
      {
        cases: [
          { name: "renewed", outcome: "verified", requests: 1 },
          {
            name: "missing refresh",
            outcome: "unexpected_failure",
            requests: 1,
          },
          {
            name: "malformed refresh",
            outcome: "unexpected_failure",
            requests: 1,
          },
        ],
      },
    ]);
  },
);

function syntheticToken(expires: number, generation = 0) {
  return [
    Buffer.from('{"alg":"none"}').toString("base64url"),
    Buffer.from(JSON.stringify({ exp: expires / 1_000, generation })).toString(
      "base64url",
    ),
    "synthetic",
  ].join(".");
}

async function fixture(
  flood = false,
  failTransport = false,
  productionShutdown = false,
) {
  const profileRoot = await mkdtemp(
    path.join(os.tmpdir(), "keel-synthetic-renewal-"),
  );
  const originalStateRoot = process.env.XDG_STATE_HOME;
  const originalChromePath = process.env.KEEL_CHROME_PATH;
  const syntheticKeelOrigin = new URL("https://keel.example.com");
  if (productionShutdown) {
    process.env.XDG_STATE_HOME = profileRoot;
    process.env.KEEL_CHROME_PATH = chromium.executablePath();
  }
  const profile = productionShutdown
    ? providerPaths("sydecar", syntheticKeelOrigin).profileDirectory
    : profileRoot;
  const processes: Array<{ child: ChildProcess; endpoint: string }> = [];
  const state = { now: start, requests: 0, refreshes: 0, documents: 0 };
  let currentRefreshToken = "";
  let generation = 0;
  const tokens = () => {
    generation++;
    const pair = {
      access_token: syntheticToken(state.now + hour, generation),
      refresh_token: syntheticToken(state.now + 12 * hour, generation),
    };
    currentRefreshToken = pair.refresh_token;
    return pair;
  };
  const authorized = (header: string | undefined) => {
    try {
      const encoded = header?.replace(/^Bearer /u, "").split(".")[1];
      if (!encoded) return false;
      const payload = JSON.parse(
        Buffer.from(encoded, "base64url").toString(),
      ) as { exp: number };
      return payload.exp * 1_000 > state.now;
    } catch {
      return false;
    }
  };
  const launch = async (
    seed = false,
    { rejectedPage = failTransport ? table + login : login } = {},
  ) => {
    await rm(path.join(profile, "DevToolsActivePort"), { force: true });
    const child = spawn(
      chromium.executablePath(),
      [...controlledChromeArguments(profile, "linux"), "--no-sandbox"],
      { stdio: "ignore" },
    );
    const owned = { child, endpoint: "" };
    processes.push(owned);
    let port = "";
    await expect
      .poll(
        async () => {
          if (child.exitCode !== null || child.signalCode !== null)
            throw new Error("Synthetic Chrome exited before startup");
          port = await readFile(
            path.join(profile, "DevToolsActivePort"),
            "utf8",
          )
            .then((text) => text.split("\n")[0] ?? "")
            .catch(() => "");
          return /^\d+$/u.test(port);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    owned.endpoint = `http://127.0.0.1:${port}`;
    const browser = await chromium.connectOverCDP(owned.endpoint, {
      noDefaults: true,
    });
    const context = browser.contexts()[0]!;
    // Restored tabs can load the actual provider before routing is installed.
    // Assert the cold-start boundary, including after a saved portfolio visit.
    expect(context.pages()).toHaveLength(0);
    const seedScript = seed
      ? await context.addInitScript((value) => {
          localStorage.setItem("auth_token", value.access_token);
          localStorage.setItem("refresh_token", value.refresh_token);
        }, tokens())
      : undefined;
    // Every network request is synthetic. Production's admission handler uses
    // fallback, so its cap runs before this fixture rather than bypassing it.
    await context.route("**/*", async (route) => {
      state.requests++;
      const url = new URL(route.request().url());
      if (route.request().resourceType() === "document") state.documents++;
      if (url.origin === "https://keel.example.com") {
        await route.fulfill({
          contentType: "text/html",
          body: "Synthetic Keel setup",
        });
        return;
      }
      if (
        url.origin === "https://api-backend.sydecar.io" &&
        url.pathname === "/authenticate/refresh_tokens"
      ) {
        const headers = {
          "access-control-allow-origin": origin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "Authorization",
        };
        if (route.request().method() === "OPTIONS") {
          await route.fulfill({ status: 204, headers });
          return;
        }
        state.refreshes++;
        if (failTransport) {
          await route.abort("namenotresolved");
          return;
        }
        const authorization = (await route.request().allHeaders())
          .authorization;
        const allowed =
          authorized(authorization) &&
          authorization === `Bearer ${currentRefreshToken}`;
        await route.fulfill({
          status: allowed ? 200 : 403,
          headers,
          json: allowed
            ? tokens()
            : {
                error_key: authorized(authorization)
                  ? "INVALID_REFRESH_TOKEN"
                  : "EXPIRED_REFRESH_TOKEN",
                message: "SYNTHETIC_REFRESH_SECRET",
              },
        });
        return;
      }
      if (url.origin !== origin)
        throw new Error(
          `Unexpected synthetic request origin: ${url.origin}${url.pathname}`,
        );
      if (url.pathname === "/__fixture__/ping") {
        await route.fulfill({ status: 204 });
        return;
      }
      if (url.pathname === "/__fixture__/portfolio") {
        await route.fulfill({
          status: authorized((await route.request().allHeaders()).authorization)
            ? 200
            : 401,
          json: {},
        });
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<html><body><script>
        (async () => {
          const portfolio = () => fetch('/__fixture__/portfolio', {headers: {Authorization: 'Bearer ' + localStorage.getItem('auth_token')}});
          let response = await portfolio();
          if (response.status === 401) {
            try {
              const refresh = await fetch('https://api-backend.sydecar.io/authenticate/refresh_tokens', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('refresh_token')}});
              if (!refresh.ok) throw new Error('Synthetic refresh failure');
              const tokens = await refresh.json();
              localStorage.setItem('auth_token', tokens.access_token);
              localStorage.setItem('refresh_token', tokens.refresh_token);
            } catch {
              localStorage.clear();
              document.body.innerHTML = ${JSON.stringify(rejectedPage)};
              return;
            }
            response = await portfolio();
          }
          ${flood ? "await Promise.allSettled(Array.from({length: 180}, () => fetch('/__fixture__/ping')));" : ""}
          document.body.innerHTML = response.ok ? ${JSON.stringify(table)} : ${JSON.stringify(login)};
        })();
      </script></body></html>`,
      });
    });
    return {
      context,
      seedScript,
      close: () =>
        productionShutdown
          ? closeControlledChrome("sydecar", syntheticKeelOrigin)
          : closeChromeGracefully(child, owned.endpoint),
    };
  };
  return {
    state,
    launch,
    signInElsewhere: () => {
      tokens();
    },
    cleanup: async () => {
      for (const { child, endpoint } of processes) {
        if (child.exitCode === null && child.signalCode === null) {
          await closeChromeGracefully(child, endpoint).catch(() =>
            stopChild(child),
          );
        }
        await stopChild(child);
      }
      await rm(profileRoot, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      if (productionShutdown) {
        if (originalStateRoot === undefined) delete process.env.XDG_STATE_HOME;
        else process.env.XDG_STATE_HOME = originalStateRoot;
        if (originalChromePath === undefined)
          delete process.env.KEEL_CHROME_PATH;
        else process.env.KEEL_CHROME_PATH = originalChromePath;
      }
    },
  };
}

test(
  "Sydecar survives the next daily capture with bounded renewal",
  { tag: "@desktop-only" },
  async () => {
    // Five cold starts exercise the deployed shutdown on Linux and graceful
    // Chrome shutdown on macOS. The provider's idle interval is virtual.
    const productionShutdown = process.platform === "linux";
    test.setTimeout(productionShutdown ? 180_000 : 120_000);
    const runtime = await fixture(false, false, productionShutdown);
    try {
      const first = await runtime.launch(true);
      await ordinaryCapture(first.context);
      await first.close();
      for (const hours of [6, 12, 18]) {
        runtime.state.now = start + hours * hour;
        const next = await runtime.launch();
        await renewSavedSydecarSession(next.context, () => runtime.state.now);
        expect(runtime.state.refreshes).toBe(hours / 6);
        expect(runtime.state.documents).toBe(hours / 6 + 1);
        await expect.poll(() => next.context.pages().length).toBe(1);
        await next.close();
      }
      runtime.state.now = start + 24 * hour;
      const nextDay = await runtime.launch();
      await ordinaryCapture(nextDay.context);
      expect(runtime.state.refreshes).toBe(4);
      expect(runtime.state.documents).toBe(5);
      await nextDay.close();
    } finally {
      await runtime.cleanup();
    }
  },
);

async function ordinaryCapture(context: BrowserContext) {
  const page = await portfolioPage(context, "sydecar");
  await requireProviderPageReady(page, "sydecar", 2_000);
  return page;
}

test("a working Sydecar access token does not prove a refresh token survived another login", async ({
  isMobile,
}) => {
  test.skip(isMobile, "The provider worker uses desktop Chrome.");
  test.setTimeout(90_000);
  const runtime = await fixture();
  const messages: string[] = [];
  const original = console.error;
  try {
    const first = await runtime.launch(true);
    await ordinaryCapture(first.context);
    await first.close();
    runtime.signInElsewhere();
    runtime.state.now = start + hour / 2;
    const immediate = await runtime.launch();
    await ordinaryCapture(immediate.context);
    await immediate.close();
    expect(runtime.state.refreshes).toBe(0);
    runtime.state.now = start + 6 * hour;
    const later = await runtime.launch(false, { rejectedPage: table + login });
    console.error = (message: unknown) => {
      messages.push(String(message));
    };
    await expect(
      renewSavedSydecarSession(later.context, () => runtime.state.now),
    ).rejects.toThrow("provider_sign_in_required");
    expect(messages.map((message) => JSON.parse(message) as unknown)).toEqual([
      expect.objectContaining({
        refreshStatus: 403,
        refreshErrorCode: "INVALID_REFRESH_TOKEN",
        reason: "authorization",
      }),
    ]);
    expect(runtime.state.refreshes).toBe(1);
  } finally {
    console.error = original;
    await runtime.cleanup();
  }
});

// The refresh-observation unit covers HTTP response categories. Chromium owns
// the requestfailed event and the redacted transport diagnostic here.
test(
  "Sydecar identifies dns refresh failures without logging credentials",
  { tag: "@desktop-only" },
  async () => {
    test.setTimeout(60_000);
    const runtime = await fixture(false, true);
    const messages: string[] = [];
    const original = console.error;
    try {
      const { context, seedScript } = await runtime.launch(true);
      const captured = await ordinaryCapture(context);
      await seedScript?.dispose();
      // Leave only the renewal page on the provider origin when it reports expiry.
      await captured.goto("about:blank");
      runtime.state.now += 6 * hour;
      console.error = (message: unknown) => {
        messages.push(String(message));
      };
      await expect(
        renewSavedSydecarSession(context, () => runtime.state.now),
      ).rejects.toMatchObject({
        code: "unexpected_failure",
        failure: {
          refreshExpiresAt: new Date(start + 12 * hour).toISOString(),
        },
      });
      expect(messages.map((message) => JSON.parse(message) as unknown)).toEqual(
        [
          {
            event: "provider_session_renewal_failed",
            provider: "sydecar",
            code: "unexpected_failure",
            refreshRequests: 1,
            refreshStatus: null,
            refreshTransport: "dns",
            refreshErrorCode: null,
            refreshResponseKind: null,
            reason: "transport",
          },
        ],
      );
      expect(messages.join("\n")).not.toContain("SYNTHETIC_REFRESH_SECRET");
      expect(messages.join("\n")).not.toContain("api-backend.sydecar.io");
      expect(runtime.state.refreshes).toBe(1);
    } finally {
      console.error = original;
      await runtime.cleanup();
    }
  },
);

test("Sydecar renewal fails closed at its provider-request admission bound", async ({
  isMobile,
}) => {
  test.skip(isMobile, "The provider worker uses desktop Chrome.");
  const runtime = await fixture(true);
  try {
    const browser = await runtime.launch(true);
    await expect(
      renewSavedSydecarSession(browser.context, () => runtime.state.now),
    ).rejects.toThrow("unexpected_failure");
    expect(runtime.state.requests).toBeLessThanOrEqual(150);
  } finally {
    await runtime.cleanup();
  }
});
