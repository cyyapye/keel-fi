import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { __providerPortfolioMacAgentTest } from "../provider-portfolio-mac-agent";

// The service uses tsx, whose browser-callback serialization differs from
// Playwright's test transpiler. Run the real renewal in a separate tsx process.
const start = Date.parse("2026-09-01T00:00:00.000Z");
const timestamp = start / 1_000;
const hour = 3_600;
function syntheticToken(exp: unknown) {
  return `synthetic.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.synthetic`;
}

const freshAccess = syntheticToken(timestamp + hour);
const freshRefresh = syntheticToken(timestamp + 12 * hour);
const cases = [
  {
    name: "renewed",
    access: freshAccess,
    refresh: freshRefresh,
    outcome: "verified",
  },

  {
    name: "missing refresh",
    access: freshAccess,
    refresh: null,
    outcome: "unexpected_failure",
  },
  {
    name: "malformed refresh",
    access: freshAccess,
    refresh: "synthetic.invalid.synthetic",
    outcome: "unexpected_failure",
  },
];

const browser = await chromium.launch();
const results: Array<{ name: string; outcome: string; requests: number }> = [];
try {
  for (const fixture of cases) {
    const context = await browser.newContext();
    let requests = 0;
    try {
      await context.addInitScript(({ access, refresh }) => {
        if (access !== null) localStorage.setItem("auth_token", access);
        if (refresh !== null) localStorage.setItem("refresh_token", refresh);
      }, fixture);
      await context.route("**/*", (route) => {
        requests++;
        assert.equal(
          route.request().url(),
          "https://app.sydecar.io/investments",
        );
        return route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><table data-testid="investments-table"><tr><td>Synthetic portfolio</td></tr></table>',
        });
      });
      let outcome = "verified";
      try {
        await __providerPortfolioMacAgentTest.renewSavedSydecarSession(
          context,
          () => start,
        );
      } catch (error) {
        if (!(error instanceof Error)) throw error;
        outcome = error.message;
      }
      assert.equal(outcome, fixture.outcome, fixture.name);
      assert.equal(requests, 1);
      results.push({ name: fixture.name, outcome, requests });
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ cases: results }));
} finally {
  await browser.close();
}
