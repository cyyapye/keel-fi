import {
  expect,
  test,
  type Response,
  type Request,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import {
  purchaseCapital,
  purchaseFeeSummary,
} from "../packages/domain/src/position-purchases";

const captureDesignReview = process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1";
const captureStyle = ".topbar, .mobile-nav { visibility: hidden !important; }";

test.use({ timezoneId: "UTC" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-01T18:45:00.000Z"));
});

async function recordMobileGeometry(
  page: Page,
  testInfo: TestInfo,
  readback: string,
  actions: readonly { name: string; locator: Locator }[],
) {
  if (testInfo.project.name !== "mobile-chromium") return;
  const measured = [];
  for (const action of actions) {
    await action.locator.scrollIntoViewIfNeeded();
    await expect(action.locator).toBeVisible();
    const rect = await action.locator.boundingBox();
    expect(
      rect,
      `${action.name} must have a native CSS-pixel bounding box`,
    ).not.toBeNull();
    expect(
      rect!.height,
      `${action.name} hit height in CSS pixels`,
    ).toBeGreaterThanOrEqual(44);
    const accessibleName =
      (await action.locator.getAttribute("aria-label")) ??
      (await action.locator.innerText()).replace(/\s+/gu, " ").trim();
    measured.push({ name: action.name, accessibleName, rect });
  }
  const viewport = await page.evaluate(() => ({
    viewportCssWidth: window.innerWidth,
    clientCssWidth: document.documentElement.clientWidth,
    scrollCssWidth: document.documentElement.scrollWidth,
    bodyScrollCssWidth: document.body.scrollWidth,
    devicePixelRatio: window.devicePixelRatio,
  }));
  expect(viewport.scrollCssWidth).toBeLessThanOrEqual(
    viewport.viewportCssWidth,
  );
  const output = testInfo.outputPath(`manual-${readback}-geometry.json`);
  await writeFile(
    output,
    `${JSON.stringify({ readback, project: testInfo.project.name, measurement: "Playwright Locator.boundingBox in CSS pixels", minimumHitHeightCssPx: 44, viewport, actions: measured }, null, 2)}\n`,
  );
  await testInfo.attach(`manual-${readback}-geometry`, {
    path: output,
    contentType: "application/json",
  });
}

async function select(page: Page, name: string, choice: string) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: choice, exact: true }).click();
}
async function chooseValuationDate(page: Page) {
  await page
    .getByRole("button", { name: "Valuation date", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Previous month", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Thursday, October 15, 2026", exact: true })
    .click();
}
async function start(
  page: Page,
  kind: "Direct" | "SPV" | "Fund",
  name: string,
) {
  await page.goto("/holdings/new");
  await expect(
    page.getByRole("heading", { name: "Add holding", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Loading owner and company choices…", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("radio", { name: kind, exact: true }).check();
  await page
    .getByLabel(
      kind === "SPV"
        ? "SPV legal name"
        : kind === "Fund"
          ? "Fund name"
          : "Investment name",
      { exact: true },
    )
    .fill(name);
  await select(page, "Held by", "Add an owner or account…");
  await page
    .getByLabel("Owner or account name", { exact: true })
    .fill("Synthetic manual owner");
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Save holding", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings\?position=[^&]+$/u);
  const positionId = new URL(page.url()).searchParams.get("position");
  expect(positionId).not.toBeNull();
  return positionId!;
}
const holdingsRequest = (request: Request) =>
  new URL(request.url()).pathname === "/api/holdings-page" &&
  request.method() === "GET";

async function readResponse(response: Response | null, positionId: string) {
  expect(response).not.toBeNull();
  expect(response!.ok()).toBe(true);
  const result = HoldingsPageSchema.parse(await response!.json());
  const holding = result.holdings.find((item) => item.id === positionId);
  expect(holding).toBeDefined();
  return holding!;
}

test(
  "retains an uncertain holding draft through database quota exhaustion without replay",
  { tag: "@desktop-only" },
  async ({ page }, testInfo) => {
    const name = `Synthetic quota draft ${testInfo.project.name}`;
    const retryAfterSeconds = 3_600;
    const retryAt = new Date("2026-11-02T00:00:00.000Z");
    // Timers and Date must both advance past the server's reset.
    await page.clock.setSystemTime(new Date("2026-11-01T18:45:00.000Z"));
    await start(page, "Direct", name);
    const attempts = await page.evaluateHandle(() => {
      const endpoint = new URL("/api/manual-holdings", location.href).href;
      const count = { value: 0 };
      const send = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input;
        const method =
          init?.method ?? (input instanceof Request ? input.method : "GET");
        if (
          method.toUpperCase() === "POST" &&
          new URL(url, location.href).href === endpoint
        ) {
          count.value++;
        }
        return send(input, init);
      };
      return count;
    });
    let submissions = 0;
    const message =
      "Database capacity is temporarily unavailable. Check for this holding before trying again.";
    await page.route("**/api/manual-holdings", async (route) => {
      expect(route.request().method()).toBe("POST");
      submissions++;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "Retry-After": String(retryAfterSeconds) },
        body: JSON.stringify({
          error: message,
          code: "d1_quota_exhausted",
          retryAt: retryAt.toISOString(),
          outcome: "unknown",
        }),
      });
    });
    await page
      .getByRole("button", { name: "Save holding", exact: true })
      .click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.clock.fastForward(retryAfterSeconds * 1_000);
    const now = await page.evaluate(() => Date.now());
    await page.clock.fastForward(retryAt.getTime() - now + 1);
    expect(await attempts.evaluate((count) => count.value)).toBe(1);
    await expect(
      page.getByLabel("Investment name", { exact: true }),
    ).toHaveValue(name);
    await expect(
      page.getByLabel("Owner or account name", { exact: true }),
    ).toHaveValue("Synthetic manual owner");
    expect(submissions).toBe(1);
    await expect(page).toHaveURL(/\/holdings\/new$/u);
    if (captureDesignReview) {
      await testInfo.attach("database-quota-retained-draft", {
        body: await page.screenshot({
          path: testInfo.outputPath("database-quota-retained-draft.png"),
          fullPage: true,
        }),
        contentType: "image/png",
      });
    }
  },
);

test(
  "persists and reopens an unassigned Direct holding with unknown financial facts",
  { tag: captureDesignReview ? [] : "@mobile-only" },
  async ({ page }, testInfo) => {
    const name = `Synthetic manual Direct ${testInfo.project.name}`;
    await start(page, "Direct", name);
    const positionId = await save(page);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const [reloadedRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const holding = await readResponse(
      await reloadedRequest.response(),
      positionId,
    );
    expect(holding.positionKind).toBe("direct");
    expect(holding.manualContext?.classification).toBe("private_paper");
    expect(holding.sourceLabel).toBe("Entered by you");
    expect(holding.sourceStatus).toBe("manual");
    expect(holding.investedMinor).toBeNull();
    expect(holding.committedMinor).toBeNull();
    expect(holding.realizedValueMinor).toBeNull();
    expect(holding.administratorNavMinor).toBeNull();
    expect(holding.purchaseContext?.openedOn).toBeNull();
    await expect(
      page.getByRole("button", { name: "Add valuation", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("$0", { exact: true })).toHaveCount(0);
    await expect(page.locator(".holding-value-summary")).toHaveCount(0);
    await expect(page.locator(".holding-investment")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Investment", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Add investment details", exact: true }),
    ).toHaveCount(1);
    await expect(
      page
        .locator(".holding-detail-actions")
        .getByRole("button", { name: "Add valuation", exact: true }),
    ).toBeVisible();
    await recordMobileGeometry(page, testInfo, "unknown-financial-facts", [
      {
        name: "identity edit",
        locator: page.getByRole("button", {
          name: "Edit holding details",
          exact: true,
        }),
      },
      {
        name: "add investment details",
        locator: page.getByRole("button", {
          name: "Add investment details",
          exact: true,
        }),
      },
      {
        name: "add valuation",
        locator: page.getByRole("button", {
          name: "Add valuation",
          exact: true,
        }),
      },
      {
        name: "sources and history",
        locator: page.getByRole("button", {
          name: "Sources & history",
          exact: true,
        }),
      },
    ]);
    if (captureDesignReview) {
      await testInfo.attach("manual-unknown-financial-facts", {
        body: await page.locator(".spv-holding").screenshot({
          path: testInfo.outputPath("manual-unknown-financial-facts.png"),
          animations: "disabled",
          style: captureStyle,
        }),
        contentType: "image/png",
      });
    }
    await page
      .getByRole("button", { name: "Add investment details", exact: true })
      .click();
    await expect(page.getByLabel("Cash paid · $", { exact: true })).toHaveValue(
      "",
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Add valuation", exact: true })
      .click();
    await expect(
      page.getByLabel("Position total · $", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "As of", exact: true }),
    ).toContainText(/choose date|not set|select date/iu);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Back to holdings", exact: true })
      .click();
    await page
      .getByRole("searchbox", { name: "Search holdings", exact: true })
      .fill(name);
    const detail = page.getByRole("button", {
      name: `View ${name} holding details`,
      exact: true,
    });
    await expect(detail).toBeVisible();
    await detail.click();
    await expect(page).toHaveURL(new RegExp(`position=${positionId}`));
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add valuation", exact: true }),
    ).toBeVisible();
  },
);

test(
  "keeps explicit zero cash separate from a dated estimate through valuation and identity edits",
  { tag: captureDesignReview ? [] : "@mobile-only" },
  async ({ page }, testInfo) => {
    const name = `Synthetic dated manual SPV ${testInfo.project.name}`;
    await start(page, "SPV", name);
    await page
      .getByRole("button", {
        name: "Add investment or valuation details",
        exact: true,
      })
      .click();
    await page.getByLabel("Cash paid · USD", { exact: true }).fill("0");
    await page
      .getByLabel("Estimated value · USD", { exact: true })
      .fill("30,000.01");
    await chooseValuationDate(page);
    await select(page, "Carry treatment", "Before carry");
    const positionId = await save(page);
    const [firstRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("$30,000.01", { exact: true }).first(),
    ).toBeVisible();
    const first = await readResponse(await firstRequest.response(), positionId);
    expect(first.positionKind).toBe("spv_interest");
    expect(first.investedMinor).toBe(0);
    await expect(
      page
        .locator(".spv-holding")
        .getByRole("group", { name: "Cash paid", exact: true }),
    ).toContainText("$0.00");
    expect(first.committedMinor).toBeNull();
    expect(first.realizedValueMinor).toBeNull();
    expect(first.administratorNavMinor).toBeNull();
    const initialValuation = first.purchaseContext?.receipt?.details.valuation;
    const initialRecord = initialValuation?.records.find(
      (record) => record.id === initialValuation.selected?.recordId,
    );
    expect(initialRecord).toMatchObject({
      origin: "judgment",
      totalMinor: 3_000_001,
      effectiveDate: "2026-10-15",
      carryStatus: "before_carry",
    });
    await page
      .getByRole("button", { name: "Edit valuation", exact: true })
      .click();
    await expect(
      page.getByLabel("Position total · $", { exact: true }),
    ).toHaveValue("30000.01");
    await page
      .getByLabel("Position total · $", { exact: true })
      .fill("32,000.02".replaceAll(",", ""));
    await page
      .getByRole("form", { name: "Edit valuation", exact: true })
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("form", { name: "Edit valuation", exact: true }),
    ).toHaveCount(0);
    const [secondRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    await expect(
      page.getByText("$32,000.02", { exact: true }).first(),
    ).toBeVisible();
    const second = await readResponse(
      await secondRequest.response(),
      positionId,
    );
    expect(second.investedMinor).toBe(0);
    const updatedValuation = second.purchaseContext?.receipt?.details.valuation;
    expect(
      updatedValuation?.records.find(
        (record) => record.id === updatedValuation.selected?.recordId,
      ),
    ).toMatchObject({
      totalMinor: 3_200_002,
      effectiveDate: "2026-10-15",
      carryStatus: "before_carry",
    });
    await page
      .getByRole("button", { name: "Edit holding details", exact: true })
      .click();
    await expect(
      page.getByLabel("SPV legal name", { exact: true }),
    ).toHaveValue(name);
    await expect(
      page.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("SPV legal name", { exact: true })
      .fill(`${name} Revised`);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `${name} Revised`, exact: true }),
    ).toBeVisible();
    const [revisedRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    const revised = await readResponse(
      await revisedRequest.response(),
      positionId,
    );
    expect(revised.positionName).toBe(`${name} Revised`);
    expect(revised.manualContext?.version).toBe(2);
    expect(revised.investedMinor).toBe(0);
    expect(revised.purchaseContext?.receipt?.details.valuation).toEqual(
      second.purchaseContext?.receipt?.details.valuation,
    );
    await page
      .getByRole("button", { name: "Sources & history", exact: true })
      .click();
    const history = page.locator(".holding-receipt-history");
    await expect(
      history.getByText("Holding created", { exact: true }),
    ).toBeVisible();
    await history
      .getByRole("button", { name: /Holding details corrected/u })
      .click();
    await expect(history).toContainText(`${name} → ${name} Revised`);
    await expect(history.getByText("Name", { exact: true })).toHaveCount(1);
    await expect(history.getByText("Held by", { exact: true })).toHaveCount(0);
    await expect(
      history.getByText("Investment type", { exact: true }),
    ).toHaveCount(0);
    await expect(history.getByText("Company", { exact: true })).toHaveCount(0);
    await history.getByRole("button", { name: /Holding created/u }).click();
    await expect(history.getByText("Cash paid", { exact: true })).toHaveCount(
      1,
    );
    await expect(history.getByText("$0.00", { exact: true })).toBeVisible();
    await expect(
      history.getByText("$30,000.01", { exact: true }),
    ).toBeVisible();
    await expect(history).not.toContainText("judgment");
    await expect(
      history.getByText("Entered by you · Type", { exact: true }),
    ).toHaveCount(0);
    await expect(history).toContainText("Oct 15, 2026");
    await expect(history).toContainText("Before carry");
    for (const label of ["Position total", "Valuation date", "Carry"]) {
      await expect(
        history
          .locator("dt")
          .filter({ hasText: new RegExp(`^${label}$`, "u") }),
      ).toHaveCount(1);
      await expect(
        history.getByText(`Entered by you · ${label}`, { exact: true }),
      ).toHaveCount(0);
    }
    await recordMobileGeometry(page, testInfo, "identity-history", [
      {
        name: "sources and history",
        locator: page.getByRole("button", {
          name: "Sources & history",
          exact: true,
        }),
      },
      {
        name: "holding details correction",
        locator: history.getByRole("button", {
          name: /Holding details corrected/u,
        }),
      },
      {
        name: "holding creation",
        locator: history.getByRole("button", { name: /Holding created/u }),
      },
    ]);
    if (captureDesignReview) {
      await history.screenshot({
        path: testInfo.outputPath("manual-identity-history.png"),
        animations: "disabled",
        style: captureStyle,
      });
    }
  },
);

test(
  "shows contributed cash beside an estimate without inventing fees, capital or return, and preserves a later purchase date",
  { tag: captureDesignReview ? [] : "@desktop-only" },
  async ({ page }, testInfo) => {
    const name = `Synthetic cash and estimate SPV ${testInfo.project.name}`;
    await start(page, "SPV", name);
    await page
      .getByRole("button", {
        name: "Add investment or valuation details",
        exact: true,
      })
      .click();
    await page.getByLabel("Cash paid · USD", { exact: true }).fill("25,000");
    await page
      .getByLabel("Estimated value · USD", { exact: true })
      .fill("30,000");
    await chooseValuationDate(page);
    await select(page, "Carry treatment", "Before carry");
    const positionId = await save(page);
    const [createdRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    const detail = page.locator(".spv-holding");
    await expect(detail.getByText("$25,000.00", { exact: true })).toHaveCount(
      1,
    );
    await expect(detail.locator(".holding-investment")).toHaveCount(0);
    await expect(
      detail.getByRole("button", { name: "Edit investment", exact: true }),
    ).toHaveCount(1);
    await expect(
      detail.getByRole("group", { name: "Cash paid", exact: true }),
    ).toContainText("Cash paid");
    await expect(
      detail.getByRole("group", { name: "Cash paid", exact: true }),
    ).toContainText("$25,000");
    await expect(
      detail.getByText("$30,000.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(detail.locator("[aria-label^='Return ']")).toHaveCount(0);
    await expect(detail.getByText("+20.00%", { exact: true })).toHaveCount(0);
    await recordMobileGeometry(page, testInfo, "cash-and-estimate", [
      {
        name: "identity edit",
        locator: page.getByRole("button", {
          name: "Edit holding details",
          exact: true,
        }),
      },
      {
        name: "metric investment edit",
        locator: page.getByRole("button", {
          name: "Edit investment",
          exact: true,
        }),
      },
      {
        name: "metric valuation edit",
        locator: page.getByRole("button", {
          name: "Edit valuation",
          exact: true,
        }),
      },
      {
        name: "sources and history",
        locator: page.getByRole("button", {
          name: "Sources & history",
          exact: true,
        }),
      },
    ]);
    if (captureDesignReview) {
      await testInfo.attach("manual-cash-and-estimate", {
        body: await detail.screenshot({
          path: testInfo.outputPath("manual-cash-and-estimate.png"),
          animations: "disabled",
          style: captureStyle,
        }),
        contentType: "image/png",
      });
    }
    const created = await readResponse(
      await createdRequest.response(),
      positionId,
    );
    expect(created.purchaseContext?.receipt?.details.cashCoversPosition).toBe(
      false,
    );
    const valuation = created.purchaseContext?.receipt?.details.valuation;
    const purchaseSaves: Request[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname ===
          `/api/investment-positions/${positionId}/purchases`
      )
        purchaseSaves.push(request);
    });
    const lot = created.purchaseContext?.receipt?.details.lots[0];
    expect(lot).toMatchObject({
      grossCashMinor: 2_500_000,
      netCapitalMinor: null,
      purchasedOn: null,
    });
    expect(lot).toBeDefined();
    expect(purchaseCapital(lot!).upfrontDeductionsMinor).toBeNull();
    expect(purchaseFeeSummary(lot!)).toBeNull();
    expect(created.realizedValueMinor).toBeNull();
    expect(created.administratorNavMinor).toBeNull();
    await page
      .getByRole("button", { name: "Edit investment", exact: true })
      .click();
    await page.getByLabel("Cash paid · $", { exact: true }).fill("26000");
    await detail
      .getByRole("button", { name: "Source details", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Purchase date", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Previous month", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Thursday, October 15, 2026", exact: true })
      .click();
    await detail
      .locator(".holding-investment")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit investment", exact: true }),
    ).toBeVisible();
    const [datedRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    const dated = await readResponse(await datedRequest.response(), positionId);
    expect(dated.purchaseContext?.receipt?.details.lots[0]).toMatchObject({
      grossCashMinor: 2_600_000,
      netCapitalMinor: null,
      feesComplete: false,
      purchasedOn: "2026-10-15",
    });
    expect(
      purchaseCapital(dated.purchaseContext!.receipt!.details.lots[0]!)
        .upfrontDeductionsMinor,
    ).toBeNull();
    expect(
      purchaseFeeSummary(dated.purchaseContext!.receipt!.details.lots[0]!),
    ).toBeNull();
    expect(dated.purchaseContext?.receipt?.details.cashCoversPosition).toBe(
      false,
    );
    expect(dated.purchaseContext?.receipt?.details.valuation).toEqual(
      valuation,
    );
    expect(dated.purchaseContext?.openedOn).toBeNull();
    await expect(detail.locator(".holding-investment")).toContainText(
      "Oct 15, 2026",
    );
    await expect(
      detail.getByRole("button", { name: "Record distributions", exact: true }),
    ).toBeDisabled();
    await expect(
      detail.getByText(
        "Recording distributions requires a known provider-reported distribution total.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      detail.getByRole("form", { name: "Distribution editor" }),
    ).toHaveCount(0);
    await expect(
      detail.getByRole("group", { name: "Cash paid", exact: true }),
    ).toContainText("$26,000.00");
    await expect(detail.getByText("$25,000.00", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      detail
        .locator(".holding-investment")
        .getByText("Cash paid", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit holding details", exact: true })
      .click();
    await page
      .getByLabel("SPV legal name", { exact: true })
      .fill(`${name} Renamed`);
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `${name} Renamed`, exact: true }),
    ).toBeVisible();
    const [renamedRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    const renamed = await readResponse(
      await renamedRequest.response(),
      positionId,
    );
    expect(renamed.purchaseContext?.receipt?.details.lots[0]?.purchasedOn).toBe(
      "2026-10-15",
    );
    expect(renamed.purchaseContext?.openedOn).toBeNull();
    expect(renamed.realizedValueMinor).toBeNull();
    await expect(detail.locator("[aria-label^='Return ']")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit investment", exact: true })
      .click();
    await page.getByLabel("Cash paid · $", { exact: true }).fill("");
    await detail
      .locator(".holding-investment")
      .getByRole("button", { name: "Save", exact: true })
      .click();
    await expect(
      detail.getByRole("group", { name: "Cash paid", exact: true }),
    ).toHaveCount(0);
    const [clearedRequest] = await Promise.all([
      page.waitForRequest(holdingsRequest),
      page.reload(),
    ]);
    const cleared = await readResponse(
      await clearedRequest.response(),
      positionId,
    );
    const clearedLot = cleared.purchaseContext!.receipt!.details.lots[0]!;
    expect(clearedLot).toMatchObject({
      grossCashMinor: null,
      purchasedOn: "2026-10-15",
    });
    expect(cleared.purchaseContext?.receipt?.details.cashCoversPosition).toBe(
      false,
    );
    expect(cleared.purchaseContext?.receipt?.details.valuation).toEqual(
      valuation,
    );
    expect(cleared.administratorNavMinor).toBeNull();
    expect(cleared.realizedValueMinor).toBeNull();
    expect(purchaseCapital(clearedLot).netCapitalMinor).toBeNull();
    expect(purchaseFeeSummary(clearedLot)).toBeNull();
    await expect(
      detail.getByRole("heading", { name: `${name} Renamed`, exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("group", { name: "Cash paid", exact: true }),
    ).toHaveCount(0);
    for (const amount of ["$25,000.00", "$26,000.00", "$0.00"])
      await expect(detail.getByText(amount, { exact: true })).toHaveCount(0);
    await expect(
      detail.getByText("$30,000.00", { exact: true }).first(),
    ).toBeVisible();
    await expect(detail.locator("[aria-label^='Return ']")).toHaveCount(0);
    expect(purchaseSaves).toHaveLength(2);
  },
);
