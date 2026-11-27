import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./api-mocked-test";

test.beforeEach(async ({ page }) => {
  // Every action in the synthetic catalogue must stay within the example.
  await page.route("**/api/**", async (route) => {
    await route.abort();
    throw new Error(
      "The catalogue attempted an application request: " +
        new URL(route.request().url()).pathname,
    );
  });
});

const entry = (step: string) => "/ui/#journeys/maintenance-" + step;
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

test("manual holding recovery opens the committed position or retries only after checking for it", async ({
  page,
}, info) => {
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
    await page
      .getByRole("button", { name: "Save holding", exact: true })
      .click();
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
    await selected.getByRole("link", { name: "Back to holdings" }).click();
    await expect(page.getByText(name, { exact: true })).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Add holding", exact: true }),
    ).toBeFocused();
    if (mode === "Saved, response lost")
      await page
        .getByRole("button", { name: "Capture controls and source" })
        .click();
  }
});

test("linked reports can supply value while a replacement stays historical", async ({
  page,
}, info) => {
  await page.goto(entry("links"));
  async function openLinks() {
    await page
      .getByRole("button", { name: "Ownership, sources & history" })
      .click();
    await page
      .getByRole("button", { name: "Linked investment records", exact: true })
      .click();
  }
  await openLinks();
  const section = page.getByRole("region", {
    name: "Linked investment records",
  });
  await select(page, "Source to link", /Demo Orbit Aerospace source/);
  await select(page, "Reported valuation to use", /^Use Tokenfolio/);
  await section.getByRole("button", { name: "Apply link" }).click();
  await expect(section.getByText(/Supplies reported value/)).toBeVisible();
  await select(page, "Link another source", /Demo Orbit V SPV/);
  await select(page, "Relationship", "Earlier SPV replaced by this one");
  await expect(
    section.getByRole("combobox", { name: "Reported valuation to use" }),
  ).toHaveCount(0);
  await section.getByRole("button", { name: "Apply link" }).click();
  await page.reload();
  await openLinks();
  await expect(
    section.getByText(/Historical · replaced by this SPV/),
  ).toBeVisible();
  await expect(section.getByText(/Supplies reported value/)).toBeVisible();
  await expect(
    page.getByText("$15,600.00 · Tokenfolio", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("$6,000.00", { exact: true }).first(),
  ).toBeVisible();
  await capture(page, info, "links-saved");
});

test("a purchase correction preserves distributions and saved distributions reload without another write", async ({
  page,
}, info) => {
  await page.goto(entry("investment"));
  await page
    .getByRole("button", { name: "Edit investment", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Cash paid · $", exact: true })
    .fill("12000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("$12,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,500.00", { exact: true })).toBeVisible();
  const afterCarry = page.getByRole("group", {
    name: "Estimated remaining value · After carry",
  });
  await expect(afterCarry).toContainText("$15,773.00");
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
  await page.getByRole("button", { name: "Save distributions" }).click();
  const reload = page.getByRole("button", {
    name: "Reload saved distributions",
  });
  await expect(reload).toBeVisible();
  await expect(afterCarry).toHaveCount(0);
  await capture(page, info, "distribution-recovery");
  const receipt = () =>
    page.evaluate(() =>
      sessionStorage.getItem("keel-ui:holding-maintenance:purchases:v1"),
    );
  const saved = await receipt();
  expect(saved).toBeTruthy();
  await reload.click();
  await expect(page.getByText("$1,800.00", { exact: true })).toBeVisible();
  expect(await receipt()).toBe(saved);
  await page.reload();
  await expect(page.getByText("$12,000.00", { exact: true })).toBeVisible();
  await expect(page.getByText("$1,800.00", { exact: true })).toBeVisible();
  await expect(afterCarry).toContainText("$15,728.00");
  await capture(page, info, "investment-readback");
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  const calculation = page.locator(".holding-calculation");
  await expect(calculation).toContainText("$10,440.00");
  await expect(calculation).toContainText("$1,800.00");
  await expect(calculation).toContainText("$1,152.00");
});

test("SPV fees and carry are reviewed before the accepted terms reopen on the same position", async ({
  page,
}, info) => {
  await page.goto(entry("terms"));
  await page.getByRole("button", { name: "Fees & carry" }).click();
  await page.getByRole("button", { name: "Review fee & carry" }).click();
  await select(page, "Imported amount", "Before fees · gross commitment");
  const fee = page.getByLabel("Management fee rate", { exact: true });
  const carry = page.getByLabel("Carry", { exact: true });
  await expect(fee).toHaveValue("2");
  await expect(carry).toHaveValue("20");
  await fee.fill("3");
  await carry.fill("18");
  await page.getByLabel("Fee term").fill("1");
  await page.getByLabel("Setup fee", { exact: true }).fill("0");
  await page
    .getByLabel("What changed")
    .fill("Reviewed synthetic subscription terms.");
  await page.getByRole("button", { name: "Review terms" }).click();
  const preview = page.locator(".position-economics__review");
  await expect(preview).toContainText("3.0% · $3,000.00");
  await expect(preview).toContainText("$97,000.00");
  await expect(preview).toContainText("18.0%");
  await capture(page, info, "terms-review");
  await preview.getByRole("button", { name: "Accept terms" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Fees & carry" }).click();
  await expect(
    page.getByRole("button", { name: "Update fee & carry" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Harbor Health Systems" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Update fee & carry" }).click();
  await expect(fee).toHaveValue("3");
  await expect(carry).toHaveValue("18");
});
