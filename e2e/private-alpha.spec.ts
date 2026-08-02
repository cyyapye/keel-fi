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

  await navigation.getByRole("button", { name: /Watch/ }).click();
  await expect(
    page.getByRole("heading", { name: "Portfolio Watch" }),
  ).toBeVisible();
  await expect(page.getByText("Public only · no inbox access")).toBeVisible();
  if (!mobile) {
    await page
      .getByRole("button", { name: "Scan synthetic public sources" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Synthetic Series C financing announcement",
      }),
    ).toBeVisible();
    await expect(page.getByText("Directly observed")).toBeVisible();
    await expect(page.getByText("Keel inference")).toBeVisible();
    await page.getByRole("button", { name: "Review proposal" }).click();
    await expect(
      page.getByRole("heading", { name: "Evidence Inbox" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Public financing announcement suggests a new valuation range",
      ),
    ).toBeVisible();
  }

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
    await navigation.getByRole("button", { name: /Evidence/ }).click();
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

  await navigation.getByRole("button", { name: /Scenarios/ }).click();
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
  await probabilitySlider.focus();
  await probabilitySlider.press("ArrowRight");
  await delaySlider.focus();
  await delaySlider.press("ArrowRight");
  await expect(page.getByText("Working draft preview")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "What changed" })).toHaveValue(
    /Liquidity probability: .*→.*; Timing delay: .*→.*/,
  );
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
    await navigation.getByRole("button", { name: /History/ }).click();
    await expect(page.locator(".history-list")).toContainText(
      "Scenario editor",
    );
  }

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
