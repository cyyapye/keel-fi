import { expect, type Page } from "@playwright/test";

/** Use the same overlap adjustment in the shipped Holdings UI and its capture. */
export async function adjustOverlappingCash(page: Page) {
  await page
    .getByRole("button", { name: "Review Synthetic reserve cash" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Synthetic reserve cash" }),
  ).toBeFocused();
  await page
    .getByLabel("Cash held elsewhere", { exact: true })
    .fill("20,000.00");
  await expect(
    page.getByText("$263,000.00 → $263,000.00", { exact: true }),
  ).toBeVisible();
}
