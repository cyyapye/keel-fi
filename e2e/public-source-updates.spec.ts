import { resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { HoldingImportPreviewSchema } from "../packages/domain/src/index";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import { test } from "./public-source-fixture";

const SOURCE_CAPTURE_STYLE = `
  .topbar,.mobile-nav{visibility:hidden!important}
  .investment-institution:not([data-keel-source-capture]){display:none!important}
`;

async function captureSource(
  locator: Locator,
  state: string,
  includeSection = false,
) {
  const root = process.env.KEEL_SOURCE_REVIEW_DIR;
  if (!root) return;
  await locator.evaluate((element) =>
    element.setAttribute("data-keel-source-capture", ""),
  );
  try {
    const capture = includeSection
      ? locator.page().locator(".investment-institutions")
      : locator;
    await capture.screenshot({
      path: resolve(root, `source-${state}-${test.info().project.name}.png`),
      animations: "disabled",
      scale: "css",
      style: SOURCE_CAPTURE_STYLE,
    });
  } finally {
    await locator.evaluate((element) =>
      element.removeAttribute("data-keel-source-capture"),
    );
  }
}
async function expectSourceSnapshot(
  page: Page,
  source: Locator,
  name: string,
  hoveredAction?: Locator,
) {
  if (test.info().config.metadata.screenshotMode !== "canonical") {
    await expect(source).toHaveScreenshot(name, { animations: "disabled" });
    return;
  }
  // Keep the source's document position independent of other synthetic accounts.
  // This mask is capture-only; navigation and geometry use the complete page.
  await source.evaluate((element) =>
    element.setAttribute("data-keel-source-capture", ""),
  );
  const mask = await page.addStyleTag({ content: SOURCE_CAPTURE_STYLE });
  try {
    if (hoveredAction) {
      // Establish the reference's hover after masking has settled the layout.
      // Otherwise the pointer's previous position can land outside the action.
      await source.scrollIntoViewIfNeeded();
      await hoveredAction.hover();
    }
    await expect(source).toHaveScreenshot(name, { animations: "disabled" });
  } finally {
    await mask.evaluate((element) => {
      element.parentNode?.removeChild(element);
    });
    await source.evaluate((element) =>
      element.removeAttribute("data-keel-source-capture"),
    );
  }
}
async function focusNaturally(
  page: Page,
  control: Locator,
  minimumHeight = 44,
) {
  for (let step = 0; step < 80; step++) {
    if (await control.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(control).toBeFocused();
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(minimumHeight);
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

test.use({ timezoneId: "UTC" });
test.setTimeout(90_000);

test("keeps safe updates automatic and records each selected identity correction through the real API and D1", async ({
  page,
  publicSourceFixture,
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
    source.getByText(
      "2 unreported holdings are still counted at their Oct 31, 2026 values.",
      {
        exact: true,
      },
    ),
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
  // Other stateful journeys add independent connections to this shared D1
  // profile. Bind this composition's image to the source under review.
  await expectSourceSnapshot(page, source, "public-source-decision.png");
  let releaseRefresh: () => void = () => undefined;
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/portfolio-baseline/refresh", async (route) => {
    await refreshGate;
    return route.fallback();
  });
  await form
    .getByRole("button", { name: "Confirm same holding", exact: true })
    .click();
  await expect(
    source.getByText("Same holding confirmed. Your decision is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(source.locator(".investment-institution__value")).toHaveText(
    "Refresh pending",
  );
  await expect(
    source.locator(".investment-institution__summary"),
  ).not.toContainText("decision");
  await expect(
    source.getByText(
      "12 positions updated automatically. 1 decision needs you.",
      {
        exact: true,
      },
    ),
  ).toHaveCount(0);
  await captureSource(source, "saved-refreshing");
  releaseRefresh();
  await expect(source.locator(".investment-institution__value")).toHaveText(
    "$215,100.00",
  );
  await page.unroute("**/api/portfolio-baseline/refresh");
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
  await form
    .getByRole("button", { name: "Add as a new holding instead", exact: true })
    .click();
  await expect(
    form.getByText(
      "Count both holdings separately. Restore Microsoft to its Oct 31, 2026 accepted value of $10,375.00.",
      { exact: true },
    ),
  ).toBeVisible();
  await captureSource(source, "later-edit");
  await form.getByRole("button", { name: "Add MSFT", exact: true }).click();
  await expect(
    source.getByText("Added as a separate holding. Your decision is saved.", {
      exact: true,
    }),
  ).toBeVisible();
  positions = await readPositions();
  expect(positions.filter((item) => item.ticker === "MSFT")).toHaveLength(2);
  expect(
    positions
      .filter((item) => item.ticker === "MSFT")
      .map((item) => item.valueMinor),
  ).toEqual(expect.arrayContaining([1_037_500, 1_062_500]));
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
  publicSourceFixture,
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
    source.getByText(
      "1 unreported holding is still counted at its Oct 31, 2026 value.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await captureSource(source, "automatic");
  await expectSourceSnapshot(page, source, "public-source-automatic.png");
});

for (const failurePhase of ["planning", "sources"] as const) {
  test(`keeps a failed decision draft and recovers ${failurePhase} readback without another receipt`, async ({
    page,
    publicSourceFixture,
  }) => {
    const label = `Synthetic failure ${failurePhase} ${test.info().project.name}`;
    const addition = failurePhase === "sources";
    const actionName = addition ? "Add PHOT" : "Confirm same holding";
    const ticker = addition ? "PHOT" : "MSFT";
    const decisionText = addition
      ? "Added as a separate holding"
      : "Same holding confirmed";
    const fixture = await publicSourceFixture(label, false, addition);
    await page.goto("/holdings/sources");
    const source = page.locator(".investment-institution").filter({
      has: page.getByRole("heading", { name: label, exact: true }),
    });
    await source
      .getByRole("button", { name: "Resolve 1 decision", exact: true })
      .click();
    const form = source.locator(".public-source-decision");
    await expect(
      form.getByRole("button", { name: actionName, exact: true }),
    ).toBeEnabled();
    let writes = 0;
    let releaseFailure: () => void = () => undefined;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const path = `**/api/holding-imports/${fixture.importId}/rows/*/review`;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname.startsWith(
          `/api/holding-imports/${fixture.importId}/rows/`,
        ) &&
        new URL(request.url()).pathname.endsWith("/review")
      )
        writes++;
    });
    await page.route(path, async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await failureGate;
      if (addition) {
        const accepted = await route.fetch();
        expect(accepted.ok()).toBe(true);
      }
      await route.fulfill({
        status: 503,
        json: {
          error:
            "Keel could not confirm this decision. Check its status before trying again.",
        },
      });
    });
    let completionCalls = 0;
    await page.route(
      `**/api/holding-imports/${fixture.importId}/exposures/refresh`,
      async (route) => {
        completionCalls++;
        if (addition && completionCalls === 1)
          return route.fulfill({
            status: 503,
            json: { error: "Synthetic source grouping outage." },
          });
        return route.fallback();
      },
    );
    await form.getByRole("button", { name: actionName, exact: true }).click();
    await expect(
      form.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await captureSource(source, "saving");
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
      form.getByRole("button", { name: actionName, exact: true }),
    ).toBeDisabled();
    expect(writes).toBe(1);
    await captureSource(source, "failure");
    const read = HoldingImportPreviewSchema.parse(
      await (
        await page.request.get(`/api/holding-imports/${fixture.importId}`)
      ).json(),
    );
    expect(read.summary.quarantinedCount).toBe(addition ? 0 : 1);
    if (addition)
      expect(
        read.rows.find((row) => row.ticker === ticker)?.sourceReview?.decision,
      ).toBe("separate");
    else
      expect(
        read.rows.find((row) => row.ticker === ticker)?.sourceReview,
      ).toBeNull();
    if (addition) {
      const pending = HoldingsPageSchema.parse(
        await (await page.request.get("/api/holdings-page")).json(),
      );
      const positions =
        pending.investmentHoldings.exposureView.positions.filter(
          (position) =>
            position.connectionId === fixture.connectionId &&
            position.ticker === "PHOT",
        );
      expect(positions).toHaveLength(2);
      expect(
        positions.filter((position) => position.mappedExposureIds.length === 0),
      ).toHaveLength(1);
      expect(completionCalls).toBe(0);
    }
    await form
      .getByRole("button", { name: "Check decision status", exact: true })
      .click();
    if (!addition) {
      await expect(
        form.getByRole("button", { name: actionName, exact: true }),
      ).toBeEnabled();
    }
    expect(writes).toBe(1);
    await page.unroute(path);
    let planningCalls = 0;
    await page.route("**/api/portfolio-baseline/refresh", async (route) => {
      planningCalls++;
      if (failurePhase === "planning" && planningCalls === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic planning refresh outage." },
        });
      return route.fallback();
    });
    let connectionReads = 0;
    await page.route("**/api/investment-connections", async (route) => {
      connectionReads++;
      if (failurePhase === "sources" && connectionReads === 1)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic source readback outage." },
        });
      return route.fallback();
    });
    if (!addition) {
      await form.getByRole("button", { name: actionName, exact: true }).click();
    }
    await expect(
      page.getByText(
        `${decisionText}. Your decision is saved; the latest holdings or planning view could not be refreshed.`,
        { exact: true },
      ),
    ).toBeVisible();
    await expect(source.locator(".investment-institution__value")).toHaveText(
      "Refresh pending",
    );
    await expect(
      source.locator(".investment-institution__summary"),
    ).not.toContainText("decision");
    await expect(
      page.getByText("Reviewed holdings were not changed.", { exact: false }),
    ).toHaveCount(0);
    await expect(
      source.getByRole("button", { name: "Check now", exact: true }),
    ).toBeDisabled();
    await captureSource(source, `refresh-failure-${failurePhase}`);
    const savedBefore = HoldingImportPreviewSchema.parse(
      await (
        await page.request.get(`/api/holding-imports/${fixture.importId}`)
      ).json(),
    ).rows.find((row) => row.ticker === ticker)!.sourceReview!.id;
    if (addition) {
      await captureSource(source, "grouping-failure");
      await page
        .getByRole("button", {
          name: "Refresh holdings and planning",
          exact: true,
        })
        .click();
      await expect.poll(() => connectionReads).toBe(1);
      await expect(
        source.getByRole("button", {
          name: "Refresh holdings and planning",
          exact: true,
        }),
      ).toBeEnabled();
      await expect(source.locator(".investment-institution__value")).toHaveText(
        "Refresh pending",
      );
      await expect(
        page.getByText(
          `${decisionText}. Your decision is saved; the latest holdings or planning view could not be refreshed.`,
          { exact: true },
        ),
      ).toBeVisible();
      await captureSource(source, "grouping-readback-failure");
    }
    await page
      .getByRole("button", {
        name: "Refresh holdings and planning",
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        "Your decision is saved. Holdings and planning are refreshed.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(planningCalls).toBe(2);
    expect(connectionReads).toBe(failurePhase === "planning" ? 1 : 2);
    await expect(source.locator(".investment-institution__value")).toHaveText(
      addition ? "$10,250.00" : "$215,100.00",
    );
    expect(
      HoldingImportPreviewSchema.parse(
        await (
          await page.request.get(`/api/holding-imports/${fixture.importId}`)
        ).json(),
      ).rows.find((row) => row.ticker === ticker)!.sourceReview!.id,
    ).toBe(savedBefore);
    expect(
      HoldingImportPreviewSchema.parse(
        await (
          await page.request.get(`/api/holding-imports/${fixture.importId}`)
        ).json(),
      ).rows.find((row) => row.ticker === ticker)?.sourceReview?.decision,
    ).toBe(addition ? "separate" : "same");
    expect(writes).toBe(addition ? 1 : 2);
    expect(completionCalls).toBe(addition ? 3 : 2);
    if (addition) {
      const holdings = HoldingsPageSchema.parse(
        await (await page.request.get("/api/holdings-page")).json(),
      );
      const owned = holdings.investmentHoldings.exposureView.positions.filter(
        (position) => position.connectionId === fixture.connectionId,
      );
      const photon = owned.filter((position) => position.ticker === "PHOT");
      expect(photon).toHaveLength(2);
      expect(
        photon.every(
          (position) =>
            position.mappedExposureIds.length === 1 &&
            position.unallocatedValueMinor === 0,
        ),
      ).toBe(true);
      expect(
        new Set(photon.flatMap((position) => position.mappedExposureIds)).size,
      ).toBe(1);
      const groupId = photon[0]!.mappedExposureIds[0]!;
      const group = holdings.investmentHoldings.exposureView.exposures.find(
        (item) => item.exposure.id === groupId,
      )!;
      expect(group.contributions).toHaveLength(2);
      expect(group.totals[0]?.allocatedValueMinor).toBe(375_000);
      expect(
        owned.find((position) => position.ticker === "ORBT")?.valueMinor,
      ).toBe(650_000);
      await page.goto("/holdings");
      await page
        .getByRole("searchbox", { name: "Search holdings" })
        .fill("PHOT");
      const visibleGroup = page.locator(`[data-exposure-id="${groupId}"]`);
      await expect(visibleGroup).toBeVisible();
      await expect(visibleGroup).toContainText("2 positions");
      const toggle = visibleGroup.getByRole("button").first();
      if ((await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
      await visibleGroup.scrollIntoViewIfNeeded();
      await expect(visibleGroup).toBeInViewport();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await page.getByRole("tab", { name: /^Needs resolution/u }).click();
      await expect(
        page
          .getByRole("tabpanel", { name: /^Needs resolution/u })
          .getByText("PHOT", { exact: true }),
      ).toHaveCount(0);
      await page.getByRole("tab", { name: "All exposures" }).click();
      await visibleGroup.scrollIntoViewIfNeeded();
      const root = process.env.KEEL_SOURCE_REVIEW_DIR;
      if (root)
        await visibleGroup.screenshot({
          path: resolve(
            root,
            `source-grouped-addition-${test.info().project.name}.png`,
          ),
          animations: "disabled",
          scale: "css",
        });
    }
  });
}

test("reconciles a complete brokerage inventory automatically and keeps historical reports read-only", async ({
  page,
  publicSourceFixture,
}) => {
  const label = `Synthetic inventory ${test.info().project.name}`;
  const fixture = await publicSourceFixture(label, false, false, true);
  if (!fixture.next) throw new Error("Inventory fixture was not prepared");
  const reconcile = async (importId: string) => {
    const response = await page.request.post(
      `/api/holding-imports/${importId}/reconcile`,
      { headers: { Origin: new URL(test.info().project.use.baseURL!).origin } },
    );
    expect(response.ok(), await response.text()).toBe(true);
    const report = HoldingImportPreviewSchema.parse(
      await (await page.request.get(`/api/holding-imports/${importId}`)).json(),
    );
    return report;
  };
  const updated = await reconcile(fixture.importId);
  expect(updated.summary).toMatchObject({
    autoAppliedCount: 3,
    quarantinedCount: 0,
    preservedPositionCount: 0,
  });
  expect(updated.inventory?.closedPositions[0]).toMatchObject({
    ticker: "CORE",
    quantityMicros: 20_000_000,
    valueMinor: 200000,
  });
  const originalId = updated.inventory!.closedPositions[0]!.positionId;
  await page.goto("/holdings/sources");
  await expect(
    page.getByText(
      "Clear updates happen automatically. Missing holdings are removed only after a verified complete account report.",
      { exact: true },
    ),
  ).toBeVisible();
  const source = page
    .locator(".investment-institution")
    .filter({ has: page.getByRole("heading", { name: label, exact: true }) });
  await expect(
    source.getByText("4 changes applied automatically. No decisions needed.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(source.getByRole("button", { name: /Resolve/ })).toHaveCount(0);
  await expect(
    source.getByText("1 unreported holding removed from current totals.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    source.getByText(/still counted|Missing positions have not/),
  ).toHaveCount(0);
  const activity = source.getByRole("button", {
    name: "View activity",
    exact: true,
  });
  await focusNaturally(
    page,
    activity,
    test.info().project.name === "mobile-chromium" ? 44 : 40,
  );
  await captureSource(source, "inventory-closed");
  await captureSource(source, "inventory-context", true);
  await page.keyboard.press("Enter");
  const closed = source
    .getByRole("listitem")
    .filter({ hasText: "CORE · No longer held" });
  await expect(closed.getByText("0 shares", { exact: true })).toBeVisible();
  await expect(closed.getByText(/20 shares → 0 shares/)).toBeVisible();
  await expectSourceSnapshot(page, source, "public-inventory-updated.png");
  await captureSource(source, "inventory-updated");
  await closed.getByRole("button", { name: "Details", exact: true }).click();
  await expect(
    closed.getByText(
      /does not establish sale price, proceeds or realized return/,
    ),
  ).toBeVisible();
  if (test.info().project.name === "chromium") {
    const row = await closed.boundingBox();
    const identity = await closed
      .locator(".record-row__identity")
      .boundingBox();
    expect(identity!.width).toBeGreaterThan(row!.width / 3);
  }
  await captureSource(source, "inventory-details");
  const earlierButton = source.getByRole("button", {
    name: "Earlier activity",
    exact: true,
  });
  let finishHistoryFailure: () => void = () => undefined;
  const historyFailure = new Promise<void>((resolve) => {
    finishHistoryFailure = resolve;
  });
  await page.route(
    `**/api/holding-imports/${updated.inventory!.previousImportId}`,
    async (route) => {
      await historyFailure;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic history read failed." }),
      });
    },
    { times: 1 },
  );
  await earlierButton.click();
  await expect(
    source.getByRole("button", {
      name: "Loading earlier activity…",
      exact: true,
    }),
  ).toBeDisabled();
  await captureSource(source, "inventory-history-loading");
  finishHistoryFailure();
  await expect(
    source.getByText("Earlier activity could not be loaded. Try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(earlierButton).toBeFocused();
  await captureSource(source, "inventory-history-failed");
  await earlierButton.click();
  const history = source.getByRole("region", {
    name: "Earlier account report",
  });
  await expect(
    history.getByText(/Historical activity. Current holdings are unchanged/),
  ).toBeVisible();
  await expect(history.getByText("$2,000.00", { exact: true })).toBeVisible();
  await expect(
    history.getByRole("button", { name: /Change decision|Confirm|Add/ }),
  ).toHaveCount(0);
  await captureSource(source, "inventory-history");
  // The history read and an identical financial reconciliation preserve one receipt.
  const repeated = await reconcile(fixture.importId);
  expect(repeated.inventory).toEqual(updated.inventory);
  const returnedId = await fixture.next("returned");
  const returned = await reconcile(returnedId);
  expect(returned.inventory?.returnedPositionIds).toEqual([originalId]);
  expect(returned.rows.find((row) => row.ticker === "CORE")?.positionId).toBe(
    originalId,
  );
  await page.reload();
  await source
    .getByRole("button", { name: "View activity", exact: true })
    .click();
  await expect(source.getByText(/CORE.*Holding returned/)).toBeVisible();
  await expect(
    source.getByText("SYN · Synthetic Systems · No change", { exact: true }),
  ).toBeVisible();
  await expect(
    source.getByText("NOVA · Synthetic Nova Technologies · No change", {
      exact: true,
    }),
  ).toBeVisible();
  await captureSource(source, "inventory-returned");
  const emptyId = await fixture.next("empty");
  const empty = await reconcile(emptyId);
  expect(empty.inventory?.closedPositions).toHaveLength(4);
  await page.reload();
  await expect(source.locator(".investment-institution__value")).toHaveText(
    "$0.00",
  );
  await source.locator(".investment-institution__trigger").click();
  await expect(
    source.locator(".investment-institution__account-value strong"),
  ).toHaveText("$0.00");
  await source.locator(".investment-institution__trigger").click();
  await source
    .getByRole("button", { name: "View activity", exact: true })
    .click();
  await expect(
    source.getByRole("listitem").filter({ hasText: "No longer held" }),
  ).toHaveCount(3);
  await expectSourceSnapshot(
    page,
    source,
    "public-inventory-empty.png",
    test.info().project.name === "chromium"
      ? source.getByRole("button", { name: "Check now", exact: true })
      : source.getByRole("button", { name: "Hide activity", exact: true }),
  );
  await captureSource(source, "inventory-empty");
  const partialId = await fixture.next("partial");
  const partial = await reconcile(partialId);
  expect(partial.inventory?.acceptedAt).toBeNull();
  expect(partial.summary.autoAppliedCount).toBe(0);
  await page.reload();
  // An incomplete report with no actual carryovers needs no carryover warning.
  await expect(
    source.getByText(/still counted|Missing positions have not been removed/),
  ).toHaveCount(0);
  await expect(source.locator(".investment-institution__value")).toHaveText(
    "$0.00",
  );
  await captureSource(source, "inventory-incomplete");
  await expect(page.locator("body")).toHaveJSProperty(
    "scrollWidth",
    await page.locator("body").evaluate((element) => element.clientWidth),
  );
});
