import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { controlledChromeArguments } from "../scripts/browser-agent-runtime";
import { __providerBrowserReconnectTest } from "../scripts/provider-browser-reconnect";
import { __providerPortfolioMacAgentTest } from "../scripts/provider-portfolio-mac-agent";

const { closeChromeGracefully, stopChild } = __providerBrowserReconnectTest;
const { renewSavedSydecarSession, requireProviderPageReady } =
  __providerPortfolioMacAgentTest;
const origin = "https://app.sydecar.io";
const hour = 3_600_000;
const start = Date.parse("2026-09-01T00:00:00.000Z");
const table =
  '<table data-testid="investments-table"><tr><td>Synthetic portfolio</td></tr></table>';
const login = '<input type="password"><button>Sign in</button>';

function syntheticToken(expires: number) {
  return [
    Buffer.from('{"alg":"none"}').toString("base64url"),
    Buffer.from(JSON.stringify({ exp: expires / 1_000 })).toString("base64url"),
    "synthetic",
  ].join(".");
}

async function fixture(flood = false) {
  const profile = await mkdtemp(
    path.join(os.tmpdir(), "keel-synthetic-renewal-"),
  );
  const processes: Array<{ child: ChildProcess; endpoint: string }> = [];
  const state = { now: start, requests: 0, refreshes: 0 };
  const tokens = () => ({
    access_token: syntheticToken(state.now + hour),
    refresh_token: syntheticToken(state.now + 12 * hour),
  });
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
  const launch = async (seed = false) => {
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
    if (seed)
      await context.addInitScript((value) => {
        localStorage.setItem("auth_token", value.access_token);
        localStorage.setItem("refresh_token", value.refresh_token);
      }, tokens());
    // Every network request is synthetic. Production's admission handler uses
    // fallback, so its cap runs before this fixture rather than bypassing it.
    await context.route("**/*", async (route) => {
      state.requests++;
      const url = new URL(route.request().url());
      if (url.origin !== origin)
        throw new Error("Unexpected synthetic request origin");
      if (url.pathname === "/__fixture__/ping") {
        await route.fulfill({ status: 204 });
        return;
      }
      if (url.pathname === "/__fixture__/refresh") {
        state.refreshes++;
        const allowed = authorized(
          (await route.request().allHeaders()).authorization,
        );
        await route.fulfill({
          status: allowed ? 200 : 401,
          json: allowed ? tokens() : { error: "expired" },
        });
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
            const refresh = await fetch('/__fixture__/refresh', {method: 'POST', headers: {Authorization: 'Bearer ' + localStorage.getItem('refresh_token')}});
            if (!refresh.ok) { localStorage.clear(); document.body.innerHTML = ${JSON.stringify(login)}; return; }
            const tokens = await refresh.json();
            localStorage.setItem('auth_token', tokens.access_token);
            localStorage.setItem('refresh_token', tokens.refresh_token);
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
      close: () => closeChromeGracefully(child, owned.endpoint),
    };
  };
  return {
    state,
    launch,
    cleanup: async () => {
      for (const { child, endpoint } of processes) {
        if (child.exitCode === null && child.signalCode === null) {
          await closeChromeGracefully(child, endpoint).catch(() =>
            stopChild(child),
          );
        }
        await stopChild(child);
      }
      await rm(profile, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

async function ordinaryCapture(context: BrowserContext) {
  const page = await context.newPage();
  await page.goto(`${origin}/investments`);
  await requireProviderPageReady(page, "sydecar", 2_000);
}

for (const maintain of [false, true]) {
  test(`Sydecar ${maintain ? "survives the next daily capture with bounded renewal" : "loses a twelve-hour refresh session despite closing Chrome"}`, async ({
    isMobile,
  }) => {
    test.skip(isMobile, "The provider worker uses desktop Chrome.");
    // Five real cold Chrome starts each retain production's twenty-second
    // startup bound. The twenty-four-hour idle interval itself is virtual.
    test.setTimeout(120_000);
    const runtime = await fixture();
    try {
      const first = await runtime.launch(true);
      await ordinaryCapture(first.context);
      await first.close();
      if (maintain)
        for (const hours of [6, 12, 18]) {
          runtime.state.now = start + hours * hour;
          const next = await runtime.launch();
          await renewSavedSydecarSession(next.context, () => runtime.state.now);
          await next.close();
        }
      runtime.state.now = start + 24 * hour;
      const nextDay = await runtime.launch();
      if (maintain) {
        await ordinaryCapture(nextDay.context);
        expect(runtime.state.refreshes).toBe(4);
      } else {
        await expect(ordinaryCapture(nextDay.context)).rejects.toThrow(
          "provider_sign_in_required",
        );
        expect(runtime.state.refreshes).toBe(1);
      }
    } finally {
      await runtime.cleanup();
    }
  });
}

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
