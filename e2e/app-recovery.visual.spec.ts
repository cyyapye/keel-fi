import { expect, test, type Page } from "@playwright/test";

async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("offers recovery even when the entry script never starts", async ({
  page,
}) => {
  await page.route("**/src/main.tsx*", (route) => route.abort("failed"));
  const path = "/holdings?access=cash";
  await page.goto(path);

  await expect(
    page.getByRole("heading", { name: "Opening Keel" }),
  ).toBeVisible();
  const reload = page.getByRole("link", { name: "Reload Keel" });
  await expect(reload).toBeVisible();
  expect((await reload.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await reload.focus();
  await expect(reload).toBeFocused();
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("entry-recovery.png", {
    animations: "disabled",
  });

  await page.unroute("**/src/main.tsx*");
  await reload.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace("?", "\\?")}$`, "u"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Holdings" }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading reviewed exposures…", { exact: true }),
  ).toBeHidden();
});

test("recovers from a failed main application without retrying on tab resume", async ({
  page,
}) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  let moduleRequests = 0;
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) {
      apiRequests.push(request.url());
    }
  });
  await page.route("**/src/App.tsx*", (route) => {
    moduleRequests += 1;
    return route.abort("failed");
  });
  await page.clock.install();
  const path = "/holdings?access=cash";
  await page.goto(path);

  await expect(
    page.getByRole("heading", { name: "Keel couldn’t open" }),
  ).toBeVisible();
  const reload = page.getByRole("button", { name: "Reload Keel" });
  await expect(reload).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expect(page).toHaveScreenshot("app-recovery.png", {
    animations: "disabled",
  });

  expect(apiRequests).toEqual([new URL("/api/holdings-page", page.url()).href]);
  for (let hour = 0; hour < 24; hour += 1) {
    await page.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.clock.runFor(60 * 60_000);
  }
  expect(moduleRequests).toBe(1);
  expect(apiRequests).toHaveLength(1);
  expect(failures).toEqual([]);
  await expect(reload).toBeVisible();

  // A still-unavailable module leaves the recovery action usable after a click.
  await reload.click();
  await expect.poll(() => moduleRequests).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Keel couldn’t open" }),
  ).toBeVisible();

  // A manual navigation reloads the module graph and retains the current route.
  await page.unroute("**/src/App.tsx*");
  await reload.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace("?", "\\?")}$`, "u"));
  await expect(
    page.getByRole("heading", { level: 1, name: "Holdings" }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading reviewed exposures…", { exact: true }),
  ).toBeHidden();
});

test("keeps the screen and navigation when a delayed portfolio component fails", async ({
  page,
}, testInfo) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  let failModule!: () => void;
  const gate = new Promise<void>((resolve) => {
    failModule = resolve;
  });
  await page.route("**/src/PortfolioSnapshot.tsx*", async (route) => {
    await gate;
    await route.abort("failed");
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("region", { name: "Goal overview" }),
  ).toBeVisible();
  failModule();

  const recovery = page.getByRole("region", { name: "Portfolio snapshot" });
  await expect(
    recovery.getByText("The portfolio summary couldn’t load."),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Goal overview" }),
  ).toBeVisible();
  expect(failures).toEqual([]);
  await expectNoHorizontalOverflow(page);
  await expect(recovery).toHaveScreenshot("portfolio-recovery.png", {
    animations: "disabled",
  });

  // A failed optional component must leave navigation usable.
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile)
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  const navigation = page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Primary navigation",
  });
  await navigation.getByRole("button", { name: "Goals" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Goals" }),
  ).toBeVisible();
  if (mobile)
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  await navigation.getByRole("button", { name: "Overview" }).click();
  await expect(
    recovery.getByRole("button", { name: "Reload Keel" }),
  ).toBeVisible();
  await page.unroute("**/src/PortfolioSnapshot.tsx*");
  const recoveredModule = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/src/PortfolioSnapshot.tsx",
  );
  const [recoveredModuleResponse] = await Promise.all([
    recoveredModule,
    recovery.getByRole("button", { name: "Reload Keel" }).click(),
  ]);
  expect(recoveredModuleResponse.status()).toBeGreaterThanOrEqual(200);
  expect(recoveredModuleResponse.status()).toBeLessThan(400);
  expect(await recoveredModuleResponse.finished()).toBeNull();
  await expect(page.locator(".portfolio-snapshot__metrics")).toBeVisible();
  await expect(
    page.getByText("The portfolio summary couldn’t load."),
  ).toHaveCount(0);
});

for (const failure of ["login HTML", "render exception"] as const) {
  test(`recovers from ${failure} without displaying internal errors`, async ({
    page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.route("**/src/App.tsx*", (route) =>
      route.fulfill(
        failure === "login HTML"
          ? {
              contentType: "text/html",
              body: "<!doctype html><title>Synthetic sign-in page</title>",
            }
          : {
              contentType: "text/javascript",
              body: 'export function App() { throw new Error("Synthetic private error detail"); }',
            },
      ),
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Keel couldn’t open" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Synthetic (sign-in|private error)/u),
    ).toHaveCount(0);
    expect(uncaught).toEqual([]);
    await page.unroute("**/src/App.tsx*");
    await page.getByRole("button", { name: "Reload Keel" }).click();
    await expect(
      page.getByRole("region", { name: "Goal overview" }),
    ).toBeVisible();
  });
}

test("keeps a readable recovery action when scripts and styles are unavailable", async ({
  page,
}) => {
  await page.route("**/*", (route) =>
    ["script", "stylesheet"].includes(route.request().resourceType())
      ? route.abort("failed")
      : route.continue(),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Opening Keel" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Reload Keel" })).toBeVisible();
});
