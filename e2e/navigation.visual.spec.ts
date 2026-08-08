import { expect, test } from "@playwright/test";

const navigationLabels = [
  "Overview",
  "Goals",
  "Holdings",
  "Portfolio Watch",
  "Evidence Inbox",
  "Scenarios",
  "Forecast History",
] as const;

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
      mobileNavigation.getByRole("button", { name: "Forecast History" }),
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

  const viewportWidths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewportWidths.scroll).toBe(viewportWidths.client);
});
