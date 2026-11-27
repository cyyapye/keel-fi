import { expect, type Page } from "@playwright/test";

// D1 gives imported USD SPVs a purchases context. Both surfaces must enter
// the investment editor, where carry and its basis are saved on that receipt.
export async function openImportedInvestment(page: Page) {
  const investment = page.getByRole("region", {
    name: "Investment",
    exact: true,
  });
  await investment
    .getByRole("button", { name: "Edit investment", exact: true })
    .click();
  await expect(
    investment.getByRole("textbox", { name: "Carry · %", exact: true }),
  ).toBeVisible();
  await expect(
    investment.getByRole("combobox", {
      name: "Carry gains above",
      exact: true,
    }),
  ).toBeVisible();
}
