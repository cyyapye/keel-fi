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

/** A real revision conflict requires reading and reviewing the new source. */
export async function reviewUpdatedCash(page: Page) {
  await page.reload();
  await page
    .getByRole("button", { name: "Review Synthetic reserve cash" })
    .click();
  const amount = page.getByLabel("Cash held elsewhere", { exact: true });
  await expect(amount).toHaveValue("25,000.00");
  await amount.fill("20,000.00");
  await expect(
    page.getByText("$264,000.00 → $264,000.00", { exact: true }),
  ).toBeVisible();
}
