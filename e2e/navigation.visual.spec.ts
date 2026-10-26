import { expect, test } from "@playwright/test";

const navigationLabels = [
  "Overview",
  "Goals",
  "Holdings",
  "Obligations",
  "Portfolio Watch",
  "Evidence Inbox",
  "Scenarios",
  "Forecast History",
] as const;

test("keeps portfolio loading concise", async ({ page }) => {
  let releaseResponse!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/alpha", async (route) => {
    const response = await route.fetch();
    await responseGate;
    await route.fulfill({ response });
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  const loading = page.getByRole("status");
  await expect(
    loading.getByRole("heading", { name: "Loading your portfolio" }),
  ).toBeVisible();
  await expect(loading).not.toContainText("decision record");
  await expect(loading).not.toContainText("database");
  await expect(loading).not.toContainText("synthetic household");
  await expect(page).toHaveScreenshot("loading-shell.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  releaseResponse();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Financial independence",
    }),
  ).toBeVisible();
});

test("paints the Holdings route before the full application loads", async ({
  page,
}) => {
  let releaseApplication!: () => void;
  const applicationGate = new Promise<void>((resolve) => {
    releaseApplication = resolve;
  });
  await page.route("**/src/App.tsx*", async (route) => {
    const response = await route.fetch();
    await applicationGate;
    await route.fulfill({ response });
  });

  await page.goto("/holdings", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { level: 1, name: "Holdings" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").getByText("Loading reviewed exposures…"),
  ).toBeVisible();
  await expect(page).toHaveScreenshot("holdings-route-shell.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth ===
        document.documentElement.clientWidth,
    ),
  ).toBe(true);

  releaseApplication();
  await expect(
    page.getByText("Loading reviewed exposures…", { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByRole("link", { name: "Sources", exact: true }),
  ).toBeVisible();
});

test("keeps primary navigation legible and keyboard accessible", async ({
  page,
}, testInfo) => {
  await page.goto("/");

  const mobile = testInfo.project.name === "mobile-chromium";
  const desktopNavigation = page.getByRole("navigation", {
    name: "Primary navigation",
  });
  const mobileNavigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  const menuButton = page.getByRole("button", {
    name: "Open navigation menu",
  });

  if (mobile) {
    await expect(desktopNavigation).toBeHidden();
    await expect(mobileNavigation).toBeHidden();
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    await menuButton.click();
    await expect(mobileNavigation).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close navigation menu" }),
    ).toHaveAttribute("aria-expanded", "true");

    for (const label of navigationLabels) {
      await expect(
        mobileNavigation.getByRole("button", { name: label }),
      ).toBeVisible();
    }

    const mobileTargets = await mobileNavigation
      .getByRole("button")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getBoundingClientRect().height),
      );
    expect(mobileTargets.every((height) => height >= 44)).toBe(true);
    await expect(
      mobileNavigation.getByRole("button", { name: "Overview" }),
    ).toBeFocused();
    await expect(page).toHaveScreenshot("navigation.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });

    await page.keyboard.press("Escape");
    await expect(mobileNavigation).toBeHidden();
    await expect(menuButton).toBeFocused();

    await menuButton.click();
    const closeMenuButton = page.getByRole("button", {
      name: "Close navigation menu",
    });
    await expect(
      mobileNavigation.getByRole("button", { name: "Overview" }),
    ).toBeFocused();
    await closeMenuButton.focus();
    await expect(closeMenuButton).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      mobileNavigation.getByRole("link", { name: "UI catalogue" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closeMenuButton).toBeFocused();

    await mobileNavigation.getByRole("button", { name: "Goals" }).click();
    await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
    await expect(mobileNavigation).toBeHidden();
    await expect(menuButton).toBeFocused();
  } else {
    await expect(menuButton).toBeHidden();
    await expect(mobileNavigation).toBeHidden();
    await expect(desktopNavigation).toBeVisible();
    await expect(
      desktopNavigation.getByRole("button", { name: "Overview" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".sidebar")).toHaveScreenshot("navigation.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });
  }

  // Use the real Vite/static catalogue entry; do not fulfil it with a fixture.
  if (mobile) await menuButton.click();
  const reference = (
    mobile ? mobileNavigation : page.locator(".sidebar")
  ).getByRole("group", { name: "Reference", exact: true });
  const catalogue = reference.getByRole("link", {
    name: "UI catalogue",
    exact: true,
  });
  await expect(catalogue).toHaveAttribute("href", "/ui/");
  expect(
    await catalogue.evaluate((link) => link.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  const portfolioRequests: string[] = [];
  page.on("request", (request) => {
    // The page we are leaving can still finish its initial requests while
    // Vite builds the separate catalogue. Attribute requests to their document.
    if (
      new URL(request.url()).pathname.startsWith("/api/") &&
      new URL(request.frame().url()).pathname.startsWith("/ui/")
    )
      portfolioRequests.push(request.url());
  });
  await catalogue.click();
  await expect(page).toHaveURL(/\/ui\/$/u);
  await expect(
    page.getByRole("heading", { name: "Foundations", exact: true, level: 1 }),
  ).toBeVisible();
  const indexResponse = await page.request.get("/ui/agent-index.json");
  expect(indexResponse.ok()).toBe(true);
  const index = await indexResponse.json();
  expect(index.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "Records",
        reference: "/ui/reference/Records.json",
      }),
    ]),
  );
  expect(portfolioRequests).toEqual([]);
  if (mobile)
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  const returnLink = (
    mobile
      ? page.getByRole("navigation", { name: "Mobile navigation" })
      : page.locator(".sidebar")
  ).getByRole("link", { name: "Back to Keel" });
  await expect(returnLink).toBeVisible();
  await expect(mobile ? page : page.locator(".sidebar")).toHaveScreenshot(
    "catalogue-navigation.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
  if (mobile) {
    const close = page.getByRole("button", { name: "Close navigation menu" });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(returnLink).toBeFocused();
  }
  await returnLink.click();
  await expect(
    page.getByRole("heading", { name: "Financial independence", level: 1 }),
  ).toBeVisible();

  const viewportWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewportWidths.scroll).toBe(viewportWidths.client);
});
