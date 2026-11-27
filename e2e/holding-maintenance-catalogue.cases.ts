import type { Page, TestInfo } from "@playwright/test";
import {
  chooseDate,
  openImportedInvestment,
} from "./holding-maintenance-parity";
import { expect } from "./api-mocked-test";

export async function isolateMaintenanceExample({ page }: { page: Page }) {
  // Every action in the synthetic catalogue must stay within the example.
  await page.route("**/api/**", async (route) => {
    await route.abort();
    throw new Error(
      "The catalogue attempted an application request: " +
        new URL(route.request().url()).pathname,
    );
  });
}

const entry = (step: string) => "/ui/#journeys/maintenance-" + step;
const savedPurchaseReceipt = (page: Page) =>
  page.evaluate(() =>
    sessionStorage.getItem("keel-ui:holding-maintenance:purchases:v2"),
  );
async function select(page: Page, label: string, option: string | RegExp) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("option", { name: option, exact: typeof option === "string" })
    .click();
}
async function capture(page: Page, info: TestInfo, state: string) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  if (process.env.KEEL_HOLDING_MAINTENANCE_CAPTURE) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      path: info.outputPath(state + ".png"),
      fullPage: true,
      scale: "css",
      animations: "disabled",
      caret: "hide",
    });
  }
}

export async function manualHoldingRecovery(
  { page }: { page: Page },
  info: TestInfo,
) {
  await page.goto(entry("manual"));
  await page
    .getByRole("button", { name: "Capture controls and source" })
    .click();
  for (const [mode, name] of [
    ["Saved, response lost", "Demo Orchard Direct"],
    ["Save did not reach Keel", "Demo Orchard Fund"],
  ] as const) {
    await select(page, "Save example", mode);
    await page
      .getByRole("button", { name: "Add holding", exact: true })
      .click();
    await page.getByLabel("Investment name", { exact: true }).fill(name);
    await page
      .getByRole("radio", {
        name: mode === "Saved, response lost" ? "Direct" : "Fund",
        exact: true,
      })
      .check();
    await select(page, "Held by", "Demo Family LLC");
    if (mode === "Saved, response lost") {
      await page
        .getByRole("button", { name: "Add investment or valuation details" })
        .click();
      await page.getByLabel("Cash paid · USD", { exact: true }).fill("6250");
    }
    await page
      .getByRole("button", { name: "Save holding", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Check holdings" }),
    ).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#journeys\/maintenance-manual\/new$/);
    await expect(
      page.getByRole("button", { name: "Check holdings" }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("textbox", {
        name: mode === "Saved, response lost" ? "Investment name" : "Fund name",
        exact: true,
      }),
    ).toHaveValue(name);
    await expect(
      page.getByRole("button", { name: "Save holding", exact: true }),
    ).toBeDisabled();
    if (mode === "Saved, response lost")
      await capture(page, info, "manual-unconfirmed");
    await page.getByRole("button", { name: "Check holdings" }).click();
    if (mode === "Save did not reach Keel") {
      await expect(page.getByLabel("Fund name", { exact: true })).toHaveValue(
        name,
      );
      await expect(
        page.getByText(
          "No matching holding was found. Review this entry before trying again.",
        ),
      ).toBeVisible();
      await capture(page, info, "manual-no-match");
      await page.getByRole("button", { name: "Try again" }).click();
    }
    const selected = page.getByRole("region", { name: "Selected holding" });
    await expect(
      selected.getByRole("heading", { name, exact: true }),
    ).toBeFocused();
    const url = page.url();
    await page.reload();
    await expect(
      selected.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(url);
    if (mode === "Saved, response lost") {
      await expect(selected).toContainText("Direct · Demo Family LLC");
      await expect(selected).toContainText("Entered by you");
      await expect(selected).toContainText("$6,250.00");
      await capture(page, info, "manual-recovered");
    }
    await selected.getByRole("link", { name: "Back to holdings" }).click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);
    await expect(page.locator(`a[href="${new URL(url).hash}"]`)).toBeFocused();
    if (mode === "Saved, response lost")
      await page
        .getByRole("button", { name: "Capture controls and source" })
        .click();
  }
  const add = page.getByRole("button", { name: "Add holding", exact: true });
  await add.click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(add).toBeFocused();
}

export async function linkAndReplacePosition(
  { page }: { page: Page },
  info: TestInfo,
) {
  await page.goto(entry("links"));
  const section = page.getByRole("region", {
    name: "Linked investment records",
  });
  const add = section.getByRole("button", {
    name: "Add linked investment record",
  });
  const viewRecords = section.getByRole("button", { name: "View records" });
  await expect(viewRecords).toHaveCount(0);
  await add.click();
  await select(page, "Source to link", /Demo Orbit Aerospace source/);
  await select(page, "Reported valuation to use", /^Use Tokenfolio/);
  await expect(section).toContainText("USD 5,200.00");
  await expect(section).toContainText("USD 6,000.00");
  await expect(section).toContainText("USD 15,600.00");
  await capture(page, info, "links-comparison");
  await section.getByRole("button", { name: "Apply link" }).click();
  await expect(section.getByText(/Supplies reported value/)).toBeVisible();
  await add.click();
  await select(page, "Link another source", /Demo Orbit V SPV/);
  await select(page, "Relationship", "Earlier SPV replaced by this one");
  await expect(
    section.getByRole("combobox", { name: "Reported valuation to use" }),
  ).toHaveCount(0);
  await expect(section).toContainText(
    "The earlier SPV moves to history. No sale or new contribution is recorded.",
  );
  await capture(page, info, "links-replacement");
  await section.getByRole("button", { name: "Apply link" }).click();
  await expect(
    section.getByText(/Historical · replaced by this SPV/),
  ).toBeVisible();
  await page.reload();
  await viewRecords.click();
  await expect(
    section.getByText(/Historical · replaced by this SPV/),
  ).toBeVisible();
  await expect(section.getByText(/Supplies reported value/)).toBeVisible();
  const reported = page.getByRole("group", {
    name: "Reported remaining value · Carry unspecified",
  });
  await expect(reported).toContainText("$15,600.00");
  await expect(reported).toContainText("Sep 17, 2026 · Tokenfolio");
  await expect(
    page
      .getByRole("region", { name: "Position summary" })
      .getByText("Cash paid", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      /Demo Orbit VII SPV · Demo Family LLC · Sydecar · Sep 20, 2026/,
    ),
  ).toBeVisible();
  await capture(page, info, "links-saved");
}

export async function correctInvestmentAndDistributions(
  { page }: { page: Page },
  info: TestInfo,
) {
  await page.clock.setFixedTime(new Date("2026-10-01T12:00:00Z"));
  await page.goto(entry("investment"));
  await page
    .getByRole("button", { name: "Edit investment", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Cash paid · $", exact: true })
    .fill("12000");
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Purchase source", exact: true }),
  ).toHaveValue("Synthetic subscription");
  await capture(page, info, "purchase-correction");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("$12,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,500.00", { exact: true })).toBeVisible();
  const afterCarry = page.getByRole("group", {
    name: "Estimated remaining value · After carry",
  });
  const invested = page.getByRole("group", { name: "Invested capital" });
  await expect(invested).toContainText("Net invested");
  await expect(invested).toContainText("$10,440.00");
  await expect(afterCarry).toContainText("$15,773.00");
  await capture(page, info, "purchase-saved");
  await page
    .getByRole("button", { name: "Capture controls and source" })
    .click();
  await select(
    page,
    "Distribution readback",
    "Updated holding fails to load once",
  );
  await page
    .getByRole("button", { name: "Capture controls and source" })
    .click();
  await page.getByRole("button", { name: "Edit distributions" }).click();
  await page
    .getByRole("textbox", { name: "Cash received · $", exact: true })
    .fill("1800");
  await expect(page.getByText("Saved values", { exact: true })).toBeVisible();
  await expect(page.locator(".distribution-preview")).toContainText(
    "$15,728.00",
  );
  await capture(page, info, "distribution-correction");
  await page.getByRole("button", { name: "Save distributions" }).click();
  const reload = page.getByRole("button", {
    name: "Reload saved distributions",
  });
  await expect(reload).toBeVisible();
  await expect(afterCarry).toHaveCount(0);
  await capture(page, info, "distribution-recovery");
  const saved = await savedPurchaseReceipt(page);
  expect(saved).toBeTruthy();
  await reload.click();
  await expect(page.getByText("$1,800.00", { exact: true })).toBeVisible();
  expect(await savedPurchaseReceipt(page)).toBe(saved);
  await page.reload();
  await expect(page.getByText("$12,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,800.00", { exact: true })).toBeVisible();
  await expect(afterCarry).toContainText("$15,728.00");
  await expect(invested).toContainText("$10,440.00");
  await expect(page.getByText("2% · Cash paid", { exact: true })).toHaveCount(
    0,
  );
  await capture(page, info, "investment-readback");
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  const calculation = page.locator(".holding-calculation");
  await expect(
    calculation.getByText("Estimated net capital", { exact: true }),
  ).toHaveCount(0);
  await expect(
    calculation.getByText("Net capital", { exact: true }),
  ).toBeVisible();
  await expect(calculation).toContainText("deducts carry already charged");
  await expect(calculation).toContainText("$10,440.00");
  await expect(calculation).toContainText("$1,800.00");
  await expect(calculation).toContainText("$1,152.00");
  await page.getByRole("button", { name: "Edit distributions" }).click();
  await chooseDate(page, "History through", "2026-10-02");
  const save = page.getByRole("button", { name: "Save distributions" });
  await save.click();
  await expect(
    page.getByText(/Cancel, reload this page, and reopen to review/),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  expect(await savedPurchaseReceipt(page)).toBe(saved);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Edit distributions" }).click();
  await expect(
    page.getByRole("textbox", { name: "Cash received · $", exact: true }),
  ).toHaveValue("1800");
  await expect(save).toBeDisabled();
}

export async function acceptFeeAndCarryTerms(
  { page }: { page: Page },
  info: TestInfo,
) {
  await page.goto(entry("terms"));
  const investment = page.getByRole("region", {
    name: "Investment",
    exact: true,
  });
  await expect(
    page.getByText(/Demo Cedar SPV · Demo Family LLC/),
  ).toBeVisible();
  await openImportedInvestment(page);
  const managementFee = investment.getByRole("textbox", {
    name: "Management fee paid · $",
    exact: true,
  });
  const carry = investment.getByRole("textbox", {
    name: "Carry · %",
    exact: true,
  });
  await expect(managementFee).toHaveValue("360");
  await expect(carry).toHaveValue("15");
  await managementFee.fill("420");
  await carry.fill("18");
  await select(page, "Carry gains above", "Net capital");
  await investment
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  const source = investment.getByRole("textbox", {
    name: "Purchase source",
    exact: true,
  });
  await source.fill("Synthetic amended subscription");
  const excessiveFees = investment.getByText(
    "Upfront fees exceed cash after refunds.",
    { exact: true },
  );
  await expect(excessiveFees).toBeHidden();
  await capture(page, info, "terms-review");
  await investment.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    investment.getByRole("definition").filter({ hasText: "$420.00" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    investment.getByRole("definition").filter({ hasText: "$420.00" }),
  ).toBeVisible();
  await expect(investment.getByText("18%", { exact: true })).toBeVisible();
  await expect(investment).toContainText("$200.00");
  await expect(page.getByText("$1,500.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await expect(page.locator(".holding-calculation")).toContainText(
    "Contributed-capital hurdle",
  );
  await expect(page.locator(".holding-calculation")).toContainText("$1,800.00");
  await capture(page, info, "terms-accepted");
  await openImportedInvestment(page);
  await expect(managementFee).toHaveValue("420");
  await expect(carry).toHaveValue("18");
  await expect(
    investment.getByRole("combobox", {
      name: "Carry gains above",
      exact: true,
    }),
  ).toContainText("Net capital");
  await investment
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(source).toHaveValue("Synthetic amended subscription");
  await capture(page, info, "terms-reopened");
  const accepted = await savedPurchaseReceipt(page);
  expect(accepted).toBeTruthy();
  await managementFee.fill("9300");
  const save = investment.getByRole("button", { name: "Save", exact: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(save).toBeEnabled();
    await save.click();
    await expect(excessiveFees).toBeVisible();
    await expect(managementFee).toHaveValue("9300");
    expect(await savedPurchaseReceipt(page)).toBe(accepted);
  }
  await expect(save).toBeEnabled();
  await capture(page, info, "terms-excessive-fees");
  await investment.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    investment.getByRole("definition").filter({ hasText: "$420.00" }),
  ).toBeVisible();
}
