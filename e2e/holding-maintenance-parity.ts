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

export async function chooseDate(page: Page, label: string, iso: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const calendar = page.getByRole("dialog", {
    name: `${label} calendar`,
    exact: true,
  });
  const heading = await calendar
    .locator(".date-picker__header strong")
    .innerText();
  const match = /^(\w+) (\d{4})$/.exec(heading);
  if (!match) throw new Error(`Unexpected calendar month ${heading}`);
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const parts = iso.split("-").map(Number);
  const delta =
    (parts[0]! - Number(match[2])) * 12 +
    parts[1]! -
    1 -
    months.indexOf(match[1]!);
  for (let index = 0; index < Math.abs(delta); index++)
    await calendar
      .getByRole("button", {
        name: delta < 0 ? "Previous month" : "Next month",
        exact: true,
      })
      .click();
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso}T12:00:00Z`));
  await calendar.getByRole("button", { name: day, exact: true }).click();
  await expect(calendar).toBeHidden();
}
