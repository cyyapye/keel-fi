import { build } from "esbuild";
import type { Page } from "@playwright/test";

const modulePath = "/__keel_browser_test_modules__/collection-search.js";
let moduleSource: Promise<string> | undefined;

export async function routeCollectionSearchModule(page: Page) {
  moduleSource ??= build({
    entryPoints: ["apps/web/src/collection-search.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2023",
    minify: true,
    logLevel: "silent",
  }).then((result) => {
    if (result.outputFiles.length !== 1)
      throw new Error("The browser search fixture requires one bundled module");
    return result.outputFiles[0]!.text;
  });
  const body = await moduleSource;
  await page.route(`**${modulePath}`, (route) =>
    route.fulfill({
      body,
      contentType: "text/javascript",
      headers: { "Cache-Control": "no-store" },
    }),
  );
  return modulePath;
}
