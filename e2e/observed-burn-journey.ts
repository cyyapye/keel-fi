import {
  CashFlowReviewInputSchema,
  PlanInputSaveSchema,
  type PlanInputSave,
} from "../packages/domain/src/index";
import { createObservedBurnExample } from "./ui-catalogue/observed-burn-fixture";
import { expect, type Page } from "@playwright/test";

/** The product and its synthetic capture must cross the same explicit save boundary. */
export async function expectBurnPlanFollowUp(
  page: Page,
  openLaterOverview: () => Promise<void>,
) {
  const flow = page.locator(".cash-flow-review");
  const editor = page.locator(".plan-inputs-editor");
  const household = editor.getByRole("textbox", { name: /Household burn/ });
  const business = editor.getByRole("textbox", { name: /Business burn/ });
  const save = editor.getByRole("button", { name: "Save plan", exact: true });
  await expect(flow).toContainText("Three complete months through Jul 2026");
  const description = await flow.locator(".cash-flow__heading p").boundingBox();
  const count = await flow.locator(".cash-flow__heading small").boundingBox();
  expect(
    description &&
      count &&
      (count.x >= description.x + description.width ||
        count.y >= description.y + description.height),
    "The institution count must not cover the spending period.",
  ).toBe(true);
  await expect(household).toHaveValue("4,000");
  await expect(save).toBeDisabled();
  await flow
    .getByRole("combobox", { name: "General services treatment" })
    .click();
  await page.getByRole("option", { name: "Business burn" }).click();
  await flow.getByRole("button", { name: "Prepare plan draft" }).click();
  await expect(
    editor.getByText("Unsaved draft", { exact: true }),
  ).toBeVisible();
  await expect(editor.getByText("Version 3", { exact: true })).toBeVisible();
  await expect(household).toHaveValue("5,000");
  await expect(business).toHaveValue("3,000");
  await expect(editor.getByText("15 months", { exact: true })).toBeVisible();
  await save.click();
  await expect(editor.getByRole("status")).toHaveText(
    "Plan saved with forecast version 4.",
  );
  await expect(save).toBeDisabled();
  await openLaterOverview();
  const monitoring = page.locator(".plan-monitoring");
  const details = monitoring.getByRole("button", {
    name: /Monitoring needs attention/,
  });
  await expect(details).toHaveAttribute("aria-expanded", "false");
  await details.click();
  const burn = monitoring.getByRole("article").filter({
    has: page.getByRole("heading", {
      name: "Reviewed burn differs from the saved plan",
    }),
  });
  await expect(burn).toContainText("Observed Nov 15, 2026");
  for (const [label, value] of [
    ["Saved plan", "$8k"],
    ["Reviewed actual", "$10k"],
    ["Difference", "$2k"],
  ] as const) {
    await expect(
      burn.getByText(label, { exact: true }).locator(".."),
    ).toContainText(value);
  }
  await burn.getByRole("button", { name: "Review plan inputs" }).click();
  await expect(flow).toContainText("Three complete months through Oct 2026");
  await expect(
    flow.getByRole("button", { name: "Load plan draft" }),
  ).toBeVisible();
  await expect(editor.getByText("Version 4", { exact: true })).toBeVisible();
  await expect(household).toHaveValue("5,000");
  await expect(business).toHaveValue("3,000");
  await expect(save).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

export async function expectEditedBurnDraftKeepsItsOwnVersion(page: Page) {
  const flow = page.locator(".cash-flow-review");
  const editor = page.locator(".plan-inputs-editor");
  const household = editor.getByRole("textbox", { name: /Household burn/ });
  const save = editor.getByRole("button", { name: "Save plan", exact: true });
  await flow
    .getByRole("combobox", { name: "General services treatment" })
    .click();
  await page.getByRole("option", { name: "Business burn" }).click();
  await flow.getByRole("button", { name: "Prepare plan draft" }).click();
  await expect(household).toHaveValue("5,000");
  await household.fill("5100");
  await save.click();
  await expect(editor.getByRole("status")).toHaveText(
    "Plan saved with forecast version 4.",
  );
  await expect(
    page.getByRole("button", {
      name: "Continue capture to the later Overview",
    }),
  ).toHaveCount(0);
  await flow.getByRole("button", { name: "Load plan draft" }).click();
  await expect(household).toHaveValue("5,000");
  await save.click();
  await expect(
    editor.getByText(
      "Observed cash-flow proposal is stale. Your draft is still here.",
    ),
  ).toBeVisible();
  await expect(editor.getByText("Version 4", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(household).toHaveValue("5,100");
}

export async function installBurnPlanSource(page: Page) {
  const example = createObservedBurnExample();
  const saved: PlanInputSave[] = [];
  await page.route("**/api/cash-flow", async (route) => {
    await route.fulfill({
      json: await example.cashFlowRequests.loadCashFlow(),
    });
  });
  await page.route("**/api/cash-flow-proposals/*/review", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const input = CashFlowReviewInputSchema.parse(
      route.request().postDataJSON(),
    );
    await route.fulfill({
      status: 201,
      json: await example.cashFlowRequests.reviewCashFlow(id, input),
    });
  });
  await page.route("**/api/plan-inputs", async (route) => {
    if (route.request().method() === "POST") {
      const input = PlanInputSaveSchema.parse(route.request().postDataJSON());
      saved.push(input);
      await route.fulfill({
        status: 201,
        json: await example.planRequests.savePlanInputs(input),
      });
    } else {
      await route.fulfill({
        json: await example.planRequests.loadPlanInputs(),
      });
    }
  });
  await page.route("**/api/plan-actual-monitoring", async (route) => {
    await route.fulfill({
      json: await example.monitoringRequests.loadPlanActualMonitoring(),
    });
  });
  return { saved, openLaterObservation: example.openLaterObservation };
}
