import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "@playwright/test";

import {
  ANGELLIST_ORIGIN,
  filterAngelListStorageState,
  setupKeelUrl,
} from "./angellist-browser-session-lib";

const SIGN_IN_TIMEOUT_MS = 30 * 60 * 1_000;

async function setup(): Promise<void> {
  const keelUrl = setupKeelUrl(process.argv.slice(2));
  const profile = await mkdtemp(
    path.join(os.tmpdir(), "keel-angellist-session-"),
  );
  await chmod(profile, 0o700);
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    viewport: { width: 1_280, height: 900 },
  });
  try {
    const angelListPage = context.pages()[0] ?? (await context.newPage());
    await angelListPage.goto(ANGELLIST_ORIGIN, {
      waitUntil: "domcontentloaded",
    });
    console.info(
      "Sign in to the read-only AngelList account in Chrome. Setup will continue when Export CSV is available.",
    );
    await angelListPage
      .getByRole("button", { exact: true, name: "Export CSV" })
      .waitFor({ state: "visible", timeout: SIGN_IN_TIMEOUT_MS });
    if (new URL(angelListPage.url()).origin !== ANGELLIST_ORIGIN) {
      throw new Error("AngelList sign-in could not be verified.");
    }
    const state = filterAngelListStorageState(await context.storageState());

    const keelPage = await context.newPage();
    await keelPage.goto(keelUrl, { waitUntil: "domcontentloaded" });
    console.info(
      "Sign in to Keel Access in Chrome. Setup will continue when Holdings is available.",
    );
    await keelPage
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("button", { name: /Holdings/u })
      .waitFor({ state: "visible", timeout: SIGN_IN_TIMEOUT_MS });
    if (new URL(keelPage.url()).origin !== keelUrl) {
      throw new Error("Keel Access sign-in could not be verified.");
    }
    const status = await keelPage.evaluate(async (sessionState) => {
      const response = await fetch("/api/automation/angellist/session", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sessionState),
      });
      return response.status;
    }, state);
    if (status !== 204) {
      throw new Error(
        "Keel rejected the session. Confirm the Cloudflare bindings and secrets are configured.",
      );
    }
  } finally {
    await context.close().catch(() => undefined);
    await rm(profile, { force: true, recursive: true });
  }
  console.info(
    "AngelList automation is ready. The temporary Chrome profile has been removed.",
  );
}

setup().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "AngelList session setup could not complete.",
  );
  process.exitCode = 1;
});
