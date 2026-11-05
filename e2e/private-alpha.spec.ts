import { expect, test, type Page } from "@playwright/test";
import {
  PlanInputSaveResultSchema,
  PlanInputStateSchema,
  PortfolioWatchScanResultSchema,
} from "../packages/domain/src/index";
import { PortfolioWatchActivitySchema } from "../packages/domain/src/portfolio-watch-activity";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";

import { navigateToScreen } from "./navigation";

function waitForApiResponse(page: Page, path: string, method: "GET" | "POST") {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      new URL(response.url()).pathname === path,
  );
}

async function readPlanWhenOpened(page: Page, navigate: () => Promise<void>) {
  const [response] = await Promise.all([
    waitForApiResponse(page, "/api/plan-inputs", "GET"),
    navigate(),
  ]);
  expect(response.ok()).toBe(true);
  return PlanInputStateSchema.parse(await response.json());
}

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
  const fiEligibleMetric = page
    .locator(".portfolio-outlook__metric")
    .filter({ hasText: "FI-eligible liquid" });
  await expect(
    fiEligibleMetric.getByRole("button", { name: "View holdings" }),
  ).toBeVisible();
  await expect(page.getByText("Private · Access protected")).toHaveCount(0);
  const monitoringSummary = page.getByRole("button", {
    name: /Monitoring is limited/u,
  });
  await expect(monitoringSummary).toBeVisible();
  await expect(monitoringSummary).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("heading", {
      name: "Monitoring is ready for connected actuals",
    }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: /2031 liquidity range/ })
    .first()
    .click();
  await expect(page.locator(".chart-tooltip")).toContainText("Middle");

  const mobile = test.info().project.name === "mobile-chromium";

  const [holdingsResponse] = await Promise.all([
    waitForApiResponse(page, "/api/holdings-page", "GET"),
    fiEligibleMetric.getByRole("button", { name: "View holdings" }).click(),
  ]);
  expect(holdingsResponse.ok()).toBe(true);
  const holdingsPage = HoldingsPageSchema.parse(await holdingsResponse.json());
  const hasNoHoldings =
    holdingsPage.holdings.length === 0 &&
    holdingsPage.acceptedCashAccounts.length === 0 &&
    holdingsPage.investmentHoldings.exposureView.positions.length === 0;

  await expect(
    page.getByRole("heading", { name: "Holdings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Company holdings" }),
  ).toHaveCount(0);
  const welcome = page.getByRole("heading", {
    name: "Your holdings, in one place",
    exact: true,
  });
  const exposures = page.getByRole("heading", {
    name: "Exposures",
    exact: true,
  });
  if (hasNoHoldings) {
    await expect(welcome).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Manage sources" }),
    ).toHaveAttribute("href", "/holdings/sources");
    await expect(exposures).toHaveCount(0);
  } else {
    await expect(exposures).toBeVisible();
    await expect(welcome).toHaveCount(0);
  }
  for (const retiredCompany of [
    "Harbor Health Systems",
    "Lattice Grove Energy",
    "Northstar Robotics",
  ]) {
    await expect(page.getByText(retiredCompany, { exact: true })).toHaveCount(
      0,
    );
  }

  await navigateToScreen(page, mobile, /Obligations/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Obligations" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Institution import needs Plaid settings. Manual review is available.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add manually" }).click();
  await expect(
    page.getByRole("heading", { name: "Add an obligation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();

  await navigateToScreen(page, mobile, /Watch/);
  await expect(
    page.getByRole("heading", { name: "Portfolio Watch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Updates", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("searchbox", { name: "Search companies" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Coverage", exact: true }).click();
  await page
    .getByRole("button", { name: "Check history", exact: true })
    .click();
  await expect(
    page.getByText(/Healthy sources are checked weekly/),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Reading news does not change a holding. Financial changes have their own review.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Check now" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /manage sources|add source/i }),
  ).toHaveCount(0);
  if (!mobile) {
    const scanResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/watch/scan") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Check now" }).click();
    const response = await scanResponse;
    expect(response.status()).toBe(202);
    const scan = PortfolioWatchScanResultSchema.parse(await response.json());
    const storedResponse = await page.request.get("/api/watch/activity");
    expect(storedResponse.ok()).toBe(true);
    const stored = PortfolioWatchActivitySchema.parse(
      await storedResponse.json(),
    );
    if (scan.queuedCount === 0) {
      await expect(page.getByRole("status")).toHaveText(
        "No eligible sources were available to check. Open Coverage for details.",
      );
    } else {
      expect(stored.runs[0]?.trigger).toBe("manual");
      expect(stored.runs[0]?.totalCount).toBe(scan.queuedCount);

      await expect(page.locator(".watch-run-list")).toContainText(
        "Manual check",
      );
    }
    await page.getByRole("tab", { name: "Updates", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "No unread updates" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Synthetic Series C financing announcement",
      }),
    ).toHaveCount(0);
  }

  let planWrites = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/plan-inputs"
    )
      planWrites++;
  });
  await navigateToScreen(page, mobile, /Overview/);
  const acceptedPlan = await readPlanWhenOpened(page, () =>
    page
      .locator(".portfolio-outlook__metric")
      .filter({ hasText: "Protected runway" })
      .getByRole("button", { name: "View plan inputs" })
      .click(),
  );
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  const planInputs = page.locator(".plan-inputs-editor");
  await expect(
    planInputs.getByRole("heading", { name: "Plan inputs" }),
  ).toBeVisible();
  const savePlanButton = planInputs.getByRole("button", {
    name: "Save plan",
  });
  await expect(savePlanButton).toBeDisabled();
  const householdBurn = planInputs.getByRole("textbox", {
    name: /Household burn/,
  });
  const savedHouseholdBurn = await householdBurn.inputValue();
  const draftBurnMinor =
    BigInt(acceptedPlan.values.householdBurnMonthlyMinor) + 1_000_000n;
  const wholeDollars = draftBurnMinor / 100n;
  const cents = (draftBurnMinor % 100n).toString().padStart(2, "0");
  await householdBurn.fill(`${wholeDollars.toString()}.${cents}`);
  await expect(planInputs.getByText("Unsaved draft")).toBeVisible();
  await expect(
    planInputs.getByRole("textbox", { name: "What changed" }),
  ).toHaveValue(/Household burn: .*→.*/);
  await expect(savePlanButton).toBeEnabled();
  let expectedPlan = acceptedPlan;
  if (mobile) {
    await planInputs.getByRole("button", { name: "Reset" }).click();
    await expect(householdBurn).toHaveValue(savedHouseholdBurn);
    await expect(savePlanButton).toBeDisabled();
  } else {
    const [saved] = await Promise.all([
      waitForApiResponse(page, "/api/plan-inputs", "POST"),
      savePlanButton.click(),
    ]);
    expect(saved.ok()).toBe(true);
    expectedPlan = PlanInputSaveResultSchema.parse(await saved.json()).plan;
    expect(BigInt(expectedPlan.values.householdBurnMonthlyMinor)).toBe(
      draftBurnMinor,
    );
    await expect(planInputs.getByRole("status")).toHaveText(
      /Plan saved with forecast version \d+\./,
    );
  }

  await navigateToScreen(page, mobile, /Goals/);
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Create a new version" }),
  ).toBeVisible();
  if (mobile) {
    await expect(page.locator(".goal-preview")).toBeHidden();
  } else {
    await expect(page.locator(".goal-preview")).toBeVisible();
  }
  await expect(page.getByText("Prior decisions stay visible")).toBeVisible();
  await expect(page.getByText("immutable snapshot")).toHaveCount(0);

  await navigateToScreen(page, mobile, /Evidence/);
  await expect(
    page.getByRole("heading", { name: "Evidence Inbox" }),
  ).toBeVisible();
  await expect(
    page.getByText("New preferred financing terms detected"),
  ).toBeVisible();

  await page.route("**/api/evidence/*/review", async (route) => {
    await route.fulfill({ status: 204 });
  });
  const scenarioOnlyButton = page
    .locator(".evidence-card")
    .filter({ hasText: "Commercial launch timing moved" })
    .getByRole("button", { name: "Scenario only" });
  if (await scenarioOnlyButton.isVisible()) {
    await scenarioOnlyButton.click();
    await expect(
      page.getByRole("heading", { name: "Scenarios" }),
    ).toBeVisible();
    await expect(page.getByText("Scenario-only evidence")).toBeVisible();
    await navigateToScreen(page, mobile, /Evidence/);
    await expect(
      page.getByRole("heading", { name: "Evidence Inbox" }),
    ).toBeVisible();
  }

  const directAcceptButton = page
    .locator(".evidence-card")
    .filter({ hasText: "New preferred financing terms detected" })
    .locator("button:not([disabled])")
    .filter({ hasText: "Accept evidence" });
  if (await directAcceptButton.isVisible()) {
    await directAcceptButton.click();
    await expect(
      page.getByRole("button", { name: "Confirm & apply" }),
    ).toBeVisible();
    await expect(page.getByText(/Update External mark:/)).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
  }

  const reopenedPlan = await readPlanWhenOpened(page, () =>
    navigateToScreen(page, mobile, /Scenarios/),
  );
  expect(reopenedPlan).toEqual(expectedPlan);
  if (mobile) {
    // The menu returns focus to its trigger on the next frame.
    await expect(
      page.getByRole("button", { name: "Open navigation menu" }),
    ).toBeFocused();
  }
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "FI Underwriting" }),
  ).toHaveAttribute("aria-selected", "true");
  const saveScenarioButton = page.getByRole("button", {
    name: "Save scenario",
  });
  await expect(saveScenarioButton).toBeDisabled();
  const scenarioSliders = page.locator('input[type="range"]');
  await expect(scenarioSliders).toHaveCount(2);
  const probabilitySlider = scenarioSliders.nth(0);
  const delaySlider = scenarioSliders.nth(1);
  await probabilitySlider.press("ArrowRight");
  await delaySlider.press("ArrowRight");
  await expect(page.getByText("Working draft preview")).toBeVisible();
  await expect(
    page
      .locator(".scenario-grid")
      .getByRole("textbox", { name: "What changed" }),
  ).toHaveValue(/Liquidity probability: .*→.*; Timing delay: .*→.*/);
  await expect(page.getByText(/probability · \d+-month delay/)).toBeVisible();
  await expect(
    page.getByText(
      "Editing previews the impact. Save when the assumptions look right.",
    ),
  ).toHaveCount(0);
  await expect(saveScenarioButton).toBeEnabled();
  if (!mobile) {
    await saveScenarioButton.click();
    await expect(page.getByText("Scenario saved.")).toBeVisible();
  }

  await navigateToScreen(page, mobile, /Overview/);
  await page.getByRole("button", { name: "Review goal" }).click();
  await expect(page.getByRole("heading", { name: "Goals" })).toBeVisible();

  await navigateToScreen(page, mobile, /History/);
  await expect(
    page.getByRole("heading", { name: "Forecast History" }),
  ).toBeVisible();
  await expect(
    page.getByText("Northstar financing mark incorporated"),
  ).toBeVisible();
  if (!mobile) {
    await expect(page.locator(".history-list")).toContainText("Plan inputs");
    await expect(page.locator(".history-list")).toContainText(
      "Scenario editor",
    );
  }
  expect(planWrites).toBe(mobile ? 0 : 1);
});
