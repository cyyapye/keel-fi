import { resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { HoldingImportPreviewSchema } from "../packages/domain/src/index";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import { publicSourceFixture } from "./public-source-fixture";

async function captureSource(locator: Locator, state: string) {
  const root = process.env.KEEL_SOURCE_REVIEW_DIR;
  if (root)
    await locator.screenshot({
      path: resolve(root, `source-${state}-${test.info().project.name}.png`),
      animations: "disabled",
      scale: "css",
      style: ".topbar,.mobile-nav{visibility:hidden!important}",
    });
}
async function focusNaturally(page: Page, control: Locator) {
  for (let step = 0; step < 80; step++) {
    if (await control.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.use({ timezoneId: "UTC" });
test.setTimeout(90_000);

test("keeps safe updates automatic and records each selected identity correction through the real API and D1", async ({
  page,
}) => {
  const label = `Synthetic review ${test.info().project.name}`;
  const fixture = await publicSourceFixture(label);
  await page.goto("/holdings/sources");
  const source = page
    .locator(".investment-institution")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
  await expect(
    source.getByText(
      "12 positions updated automatically. 1 decision needs you.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    source.getByText("2 prior holdings kept at their Oct 31, 2026 values.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(source.getByText("Up to date", { exact: true })).toHaveCount(0);
  await source
    .getByRole("button", { name: "Resolve 1 decision", exact: true })
    .click();
  const form = source.locator(".public-source-decision");
  await expect(
    form.getByRole("heading", { name: "MSFT: is this the same holding?" }),
  ).toBeVisible();
  await expect(
    form.getByText("Accepted holdings after this choice: $215,100.00", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    form.getByText("Accepted holdings after this choice: $225,475.00", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    form.getByText("Accepted holdings after this choice: $214,850.00", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    form.getByText("25 shares · $10,375.00", { exact: true }),
  ).toBeVisible();
  await expect(
    form.getByText("25 shares · $10,625.00", { exact: true }),
  ).toBeVisible();
  await focusNaturally(
    page,
    form.getByRole("button", { name: "Confirm same holding", exact: true }),
  );
  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: 320, height: viewport.height });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  const confirmBox = await form
    .getByRole("button", { name: "Confirm same holding", exact: true })
    .boundingBox();
  expect(confirmBox!.x).toBeGreaterThanOrEqual(0);
  expect(confirmBox!.x + confirmBox!.width).toBeLessThanOrEqual(320);
  await page.setViewportSize(viewport);
  await captureSource(source, "decision");
  await expect(page).toHaveScreenshot("public-source-decision.png", {
    fullPage: true,
    animations: "disabled",
  });
  await form
    .getByRole("button", { name: "Confirm same holding", exact: true })
    .click();
  await expect(
    source.getByText("Same holding confirmed. Your decision is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  await captureSource(source, "saved");
  let preview = HoldingImportPreviewSchema.parse(
    await (
      await page.request.get(`/api/holding-imports/${fixture.importId}`)
    ).json(),
  );
  const row = preview.rows.find((item) => item.ticker === "MSFT")!;
  expect(row.sourceReview).toMatchObject({
    decision: "same",
    decisionSource: "manual",
  });
  expect(preview.summary.quarantinedCount).toBe(0);
  expect(preview.preservedPositions).toHaveLength(1);
  const readPositions = async () => {
    const holdings = HoldingsPageSchema.parse(
      await (await page.request.get("/api/holdings-page")).json(),
    );
    return holdings.investmentHoldings.exposureView.positions.filter(
      (position) => position.connectionId === fixture.connectionId,
    );
  };
  let positions = await readPositions();
  expect(positions.filter((item) => item.ticker === "MSFT")).toHaveLength(1);
  expect(positions.find((item) => item.ticker === "MSFT")?.valueMinor).toBe(
    1_062_500,
  );
  await page.reload();
  await expect(source.getByRole("button", { name: /Resolve/ })).toHaveCount(0);
  await source
    .getByRole("button", { name: "View activity", exact: true })
    .click();
  await source
    .getByRole("button", { name: "Change decision", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Current decision", exact: true }),
  ).toBeDisabled();
  await expect(
    form.getByText(
      "This report only; repeated copies won’t ask again. Restore Microsoft to its Oct 31, 2026 accepted value of $10,375.00.",
      { exact: true },
    ),
  ).toBeVisible();
  await captureSource(source, "later-edit");
  await form
    .getByRole("button", { name: "Add separately", exact: true })
    .click();
  await expect(
    source.getByText("Added as a separate holding. Your decision is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  positions = await readPositions();
  expect(positions.filter((item) => item.ticker === "MSFT")).toHaveLength(2);
  await source
    .getByRole("button", { name: "Change decision", exact: true })
    .click();
  await form
    .getByRole("button", { name: "Ignore for this report", exact: true })
    .click();
  await expect(
    source.getByText("Reported position ignored. Your decision is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  positions = await readPositions();
  expect(positions.filter((item) => item.ticker === "MSFT")).toHaveLength(1);
  expect(positions.find((item) => item.ticker === "MSFT")?.valueMinor).toBe(
    1_037_500,
  );
  preview = HoldingImportPreviewSchema.parse(
    await (
      await page.request.get(`/api/holding-imports/${fixture.importId}`)
    ).json(),
  );
  expect(
    preview.rows.find((item) => item.id === row.id)?.sourceReview?.id,
  ).not.toBe(row.sourceReview?.id);
  expect(
    preview.rows.find((item) => item.id === row.id)?.sourceReview?.decision,
  ).toBe("ignore");
  await page.reload();
  await expect(source.getByRole("button", { name: /Resolve/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("a unique verified security match needs no human decision and keeps omissions in optional activity", async ({
  page,
}) => {
  const label = `Synthetic automatic ${test.info().project.name}`;
  await publicSourceFixture(label, true);
  await page.goto("/holdings/sources");
  const source = page
    .locator(".investment-institution")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
  await expect(
    source.getByText(
      "13 positions updated automatically. No decisions needed.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    source.getByRole("button", { name: /Resolve|Review/ }),
  ).toHaveCount(0);
  await expect(
    source.getByText("1 prior holding kept at its Oct 31, 2026 value.", {
      exact: true,
    }),
  ).toBeVisible();
  await captureSource(source, "automatic");
  await expect(page).toHaveScreenshot("public-source-automatic.png", {
    fullPage: true,
    animations: "disabled",
  });
});

test("keeps a failed decision draft and checks status before an explicit retry", async ({
  page,
}) => {
  const label = `Synthetic failure ${test.info().project.name}`;
  const fixture = await publicSourceFixture(label);
  await page.goto(`/holdings/imports/${fixture.importId}`);
  const form = page.locator(".public-source-decision");
  await expect(
    form.getByRole("button", { name: "Confirm same holding", exact: true }),
  ).toBeEnabled();
  let writes = 0;
  let releaseFailure: () => void = () => undefined;
  const failureGate = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const path = `**/api/holding-imports/${fixture.importId}/rows/*/review`;
  await page.route(path, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes++;
    await failureGate;
    await route.fulfill({
      status: 503,
      json: {
        error:
          "Keel could not confirm this decision. Check its status before trying again.",
      },
    });
  });
  await form
    .getByRole("button", { name: "Confirm same holding", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  await captureSource(page.locator(".public-source-update"), "saving");
  releaseFailure();
  await expect(form.getByRole("alert")).toContainText(
    "Check its status before trying again.",
  );
  await expect(form.getByRole("alert")).toBeInViewport({ ratio: 1 });
  await expect(
    form.getByRole("button", { name: "Check decision status", exact: true }),
  ).toBeFocused();
  await expect(
    form.getByRole("button", { name: "Check decision status", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    form.getByRole("button", { name: "Confirm same holding", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
  await captureSource(page.locator(".public-source-update"), "failure");
  const read = HoldingImportPreviewSchema.parse(
    await (
      await page.request.get(`/api/holding-imports/${fixture.importId}`)
    ).json(),
  );
  expect(read.summary.quarantinedCount).toBe(1);
  expect(
    read.rows.find((row) => row.ticker === "MSFT")?.sourceReview,
  ).toBeNull();
  await form
    .getByRole("button", { name: "Check decision status", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "Confirm same holding", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
  await page.unroute(path);
  let planningCalls = 0;
  await page.route("**/api/portfolio-baseline/refresh", async (route) => {
    planningCalls++;
    if (planningCalls === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Synthetic planning refresh outage." },
      });
    return route.fallback();
  });
  await form
    .getByRole("button", { name: "Confirm same holding", exact: true })
    .click();
  await expect(
    page.getByText(
      "Same holding confirmed. Your decision is saved; the latest holdings or planning view could not be refreshed.",
      { exact: true },
    ),
  ).toBeVisible();
  await captureSource(page.locator(".public-source-update"), "refresh-failure");
  const savedBefore = HoldingImportPreviewSchema.parse(
    await (
      await page.request.get(`/api/holding-imports/${fixture.importId}`)
    ).json(),
  ).rows.find((row) => row.ticker === "MSFT")!.sourceReview!.id;
  await page
    .getByRole("button", { name: "Refresh holdings and planning", exact: true })
    .click();
  await expect(
    page.getByText(
      "Your decision is saved. Holdings and planning are refreshed.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(planningCalls).toBe(2);
  expect(
    HoldingImportPreviewSchema.parse(
      await (
        await page.request.get(`/api/holding-imports/${fixture.importId}`)
      ).json(),
    ).rows.find((row) => row.ticker === "MSFT")!.sourceReview!.id,
  ).toBe(savedBefore);
  expect(
    HoldingImportPreviewSchema.parse(
      await (
        await page.request.get(`/api/holding-imports/${fixture.importId}`)
      ).json(),
    ).rows.find((row) => row.ticker === "MSFT")?.sourceReview?.decision,
  ).toBe("same");
});
