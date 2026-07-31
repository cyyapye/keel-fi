import { expect, test } from "@playwright/test";

test("loads the database-backed dashboard and primary views", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Financial independence",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "FI-eligible liquid: $1.8M. View holdings",
    }),
  ).toBeVisible();
  await expect(page.getByText("Private · Access protected")).toHaveCount(0);

  await page
    .getByRole("button", { name: /2031 liquidity range/ })
    .first()
    .click();
  await expect(page.locator(".chart-tooltip")).toContainText("Middle");

  const mobile = test.info().project.name === "mobile-chromium";
  const navigationName = mobile ? "Mobile navigation" : "Primary navigation";
  const navigation = page.getByRole("navigation", { name: navigationName });

  await page
    .getByRole("button", { name: /FI-eligible liquid.*View holdings/ })
    .click();
  await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();
  await expect(page.getByText("Northstar Robotics")).toBeVisible();

  await navigation.getByRole("button", { name: /Overview/ }).click();
  await page
    .getByRole("button", { name: /Protected runway.*View plan inputs/ })
    .click();
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  await expect(page.getByText("Current planning goal")).toBeVisible();
  await expect(page.getByText("Accepted inputs")).toBeVisible();

  await navigation.getByRole("button", { name: /Goals/ }).click();
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Create a new version" }),
  ).toBeVisible();
  await expect(page.getByText("Live preview")).toBeVisible();
  await expect(page.getByText("Prior decisions stay visible")).toBeVisible();
  await expect(page.getByText("immutable snapshot")).toHaveCount(0);

  await navigation.getByRole("button", { name: /Evidence/ }).click();
  await expect(
    page.getByRole("heading", { name: "Evidence Inbox" }),
  ).toBeVisible();
  await expect(
    page.getByText("New preferred financing terms detected"),
  ).toBeVisible();

  await navigation.getByRole("button", { name: /Scenarios/ }).click();
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "FI Underwriting" }),
  ).toHaveAttribute("aria-selected", "true");

  await navigation.getByRole("button", { name: /Overview/ }).click();
  await page.getByRole("button", { name: "Review goal →" }).click();
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();

  await navigation.getByRole("button", { name: /History/ }).click();
  await expect(
    page.getByRole("heading", { name: "Forecast History" }),
  ).toBeVisible();
  await expect(
    page.getByText("Northstar financing mark incorporated"),
  ).toBeVisible();
});
