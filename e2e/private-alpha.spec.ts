import { expect, test } from "@playwright/test";

test("loads the database-backed dashboard and primary views", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Keep optionality. Underwrite the real.",
    }),
  ).toBeVisible();
  await expect(page.getByText("FI-eligible liquid")).toBeVisible();
  await expect(page.getByText("$1.8M")).toBeVisible();

  const mobile = test.info().project.name === "mobile-chromium";
  const navigationName = mobile ? "Mobile navigation" : "Primary navigation";
  const navigation = page.getByRole("navigation", { name: navigationName });

  await navigation.getByRole("button", { name: /Holdings/ }).click();
  await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();
  await expect(page.getByText("Northstar Robotics")).toBeVisible();

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

  await navigation.getByRole("button", { name: /History/ }).click();
  await expect(
    page.getByRole("heading", { name: "Forecast History" }),
  ).toBeVisible();
  await expect(
    page.getByText("Northstar financing mark incorporated"),
  ).toBeVisible();
});
