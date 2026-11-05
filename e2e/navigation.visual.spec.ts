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

test(
  "paints the Holdings route before the full application loads",
  { tag: "@mobile-only" },
  async ({ page }) => {
    let heldApplicationRequests = 0;
    let releaseApplication!: () => void;
    const applicationGate = new Promise<void>((resolve) => {
      releaseApplication = resolve;
    });
    await page.route("**/src/App.tsx*", async (route) => {
      heldApplicationRequests += 1;
      const response = await route.fetch();
      await applicationGate;
      await route.fulfill({ response });
    });

    await page.goto("/holdings", { waitUntil: "domcontentloaded" });
    await expect.poll(() => heldApplicationRequests).toBe(1);
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
  },
);

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
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
    await expect(desktopNavigation).toBeHidden();
    await expect(mobileNavigation).toBeHidden();

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

  if (!mobile) {
    await desktopNavigation.getByRole("button", { name: "Goals" }).click();
    await expect(
      page.getByRole("heading", { name: "Goals", exact: true }),
    ).toBeVisible();
  }

  const viewportWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewportWidths.scroll).toBe(viewportWidths.client);
});
