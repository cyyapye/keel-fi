import { expect, test } from "@playwright/test";

const openPath =
  "/api/automation/provider-browser/sessions/11111111-1111-4111-8111-111111111111/open";

test("opens the reconnect interstitial through one explicit same-origin POST", async ({
  page,
}) => {
  const methods: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === openPath) {
      methods.push(request.method());
      if (request.method() === "POST")
        expect(request.headers()["x-keel-reconnect-open"]).toBe("1");
    }
  });
  await page.goto(openPath);
  await expect(page.getByRole("status")).toHaveText(
    "The secure browser is not ready or was already opened. Return to Keel to check the reconnect.",
  );
  expect(methods).toEqual(["GET", "POST"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const viewerUrl = `https://keel-tokenfolio-reconnect.example.com/${"c".repeat(43)}.html`;
  await page.route(`**${openPath}`, async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({ json: { liveUrl: viewerUrl } });
    else await route.continue();
  });
  await page.route(viewerUrl, async (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<p>Synthetic authenticated viewer</p>",
    }),
  );
  await page.reload();
  await expect(page).toHaveURL(viewerUrl);
  await expect(page.getByText("Synthetic authenticated viewer")).toBeVisible();
  expect(methods).toEqual(["GET", "POST", "GET", "POST"]);
});

test("a passive reconnect GET does not consume a link when scripts are disabled", async ({
  browser,
  baseURL,
  isMobile,
}) => {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    ...(baseURL === undefined ? {} : { baseURL }),
    viewport: isMobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const methods: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === openPath)
      methods.push(request.method());
  });
  try {
    await page.goto(openPath);
    await expect(page.getByRole("status")).toHaveText(
      "Opening your secure browser…",
    );
    expect(methods).toEqual(["GET"]);
  } finally {
    await context.close();
  }
});
