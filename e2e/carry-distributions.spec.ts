import {
  chooseDate,
  openImportedInvestment,
} from "./holding-maintenance-parity";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { HoldingsPageSchema } from "../packages/domain/src/holdings-page";
import {
  AcceptDistributionsSchema,
  InvestmentHistorySchema,
  PurchaseReceiptSchema,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { prepareCarryPosition } from "./carry-fixtures";

test.use({ timezoneId: "UTC" });
test.setTimeout(90_000);

const workspace = (page: Page) => page.locator(".spv-holding");
const endpoint = (id: string) =>
  `/api/investment-positions/${encodeURIComponent(id)}/distributions`;

async function select(page: Page, label: string, value: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}

async function openHolding(page: Page, id: string) {
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z"));
  await page.goto(`/holdings?position=${encodeURIComponent(id)}`);
  await expect(workspace(page)).toBeVisible();
}

async function readOverview(page: Page, fresh = false) {
  const menu = page.getByRole("button", { name: "Open navigation menu" });
  if (await menu.isVisible()) await menu.click();
  const response = fresh
    ? page.waitForResponse(
        (result) => new URL(result.url()).pathname === "/api/alpha",
        { timeout: 5_000 },
      )
    : null;
  await page.getByRole("button", { name: /\bOverview$/u }).click();
  if (response) {
    const result = await response;
    expect(result.status(), await result.text()).toBe(200);
  }
  await expect(
    page.getByRole("region", { name: "Portfolio snapshot" }),
  ).toBeVisible();
}

async function fillReview(
  page: Page,
  options: {
    kind?: "Stock" | "Cash";
    amount?: string;
    priorCarry?: string;
    inclusion?: string;
  } = {},
) {
  await page
    .getByRole("button", { name: "Add distributions", exact: true })
    .click();
  if (
    (await page
      .getByRole("combobox", { name: "Received as", exact: true })
      .count()) === 0
  )
    await page
      .getByRole("button", { name: "Add distribution", exact: true })
      .click();
  await select(page, "Received as", options.kind ?? "Stock");
  await chooseDate(page, "Received on", "2026-06-01");
  if ((options.kind ?? "Stock") === "Stock") {
    await page
      .getByRole("textbox", { name: "Security received", exact: true })
      .fill("Synthetic common stock");
    await page
      .getByRole("textbox", { name: "Shares received", exact: true })
      .fill("60");
  }
  await page
    .getByRole("textbox", {
      name:
        options.kind === "Cash" ? "Cash received · $" : "Historical value · $",
      exact: true,
    })
    .fill(options.amount ?? "9000");
  await page
    .getByRole("textbox", { name: "Evidence", exact: true })
    .fill("Synthetic distribution notice");
  await select(
    page,
    "Distribution history",
    "All received distributions recorded",
  );
  await chooseDate(page, "History through", "2026-10-01");
  await page
    .getByRole("textbox", { name: "Carry already charged · $", exact: true })
    .fill(options.priorCarry ?? "0");
  await select(
    page,
    "Recorded distributions in provider total",
    options.inclusion ?? "Already included",
  );
}

async function saveReview(page: Page, id: string) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint(id)) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save distributions", exact: true })
    .click();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(201);
  const receipt = PurchaseReceiptSchema.parse(await response.json());
  await expect(
    page.getByRole("button", { name: "Edit distributions", exact: true }),
  ).toBeVisible();
  return receipt;
}

async function current(page: Page, id: string) {
  const response = await page.request.get("/api/holdings-page");
  expect(response.status(), await response.text()).toBe(200);
  const holding = HoldingsPageSchema.parse(await response.json()).holdings.find(
    (item) => item.id === id,
  );
  if (!holding?.purchaseContext?.receipt)
    throw new Error("Accepted holding receipt missing");
  return holding;
}

async function history(page: Page, id: string): Promise<PurchaseReceipt[]> {
  const response = await page.request.get(
    `/api/investment-positions/${encodeURIComponent(id)}/history`,
  );
  expect(response.status(), await response.text()).toBe(200);
  return InvestmentHistorySchema.parse(await response.json()).entries.flatMap(
    (entry) => (entry.kind === "investment" ? [entry.receipt] : []),
  );
}

async function capture(page: Page, name: string) {
  await expect(workspace(page)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  for (const target of await workspace(page)
    .locator(
      ".holding-detail-title h2, .holding-investment > .holding-section-heading, .distribution-amount",
    )
    .all()) {
    await target.evaluate((element) =>
      element.scrollIntoView({ block: "center", behavior: "instant" }),
    );
    await expect
      .poll(() =>
        target.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return (
            bounds.top >= 0 &&
            bounds.left >= 0 &&
            bounds.right <= innerWidth &&
            bounds.bottom <= innerHeight &&
            [...document.querySelectorAll(".topbar,.mobile-nav")].every(
              (node) => {
                const nav = node.getBoundingClientRect();
                return (
                  bounds.right <= nav.left ||
                  bounds.left >= nav.right ||
                  bounds.bottom <= nav.top ||
                  bounds.top >= nav.bottom
                );
              },
            )
          );
        }),
      )
      .toBe(true);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({
    path,
    fullPage: true,
    animations: "disabled",
    scale: "css",
  });
  await test.info().attach(name, { path, contentType: "image/png" });
}

async function focusedControlUsable(control: Locator, name: string) {
  try {
    await expect(control).toBeFocused();
    await expect
      .poll(
        () =>
          control.evaluate((element) => {
            const bounds = element.getBoundingClientRect();
            const label = element
              .closest("label")
              ?.querySelector('[data-slot="field-label"]');
            const labelBounds = label?.getBoundingClientRect();
            const inside = (box: DOMRect) =>
              box.top >= 0 &&
              box.left >= 0 &&
              box.right <= innerWidth &&
              box.bottom <= innerHeight;
            const overlaps = (left: DOMRect, right: DOMRect) =>
              left.left < right.right &&
              left.right > right.left &&
              left.top < right.bottom &&
              left.bottom > right.top;
            const navigation = [
              ...document.querySelectorAll(".topbar,.mobile-nav"),
            ].filter((node) => {
              const style = getComputedStyle(node);
              return style.display !== "none" && style.visibility !== "hidden";
            });
            const style = getComputedStyle(element);
            return {
              focused: element === document.activeElement,
              inside: inside(bounds),
              labelInside: !labelBounds || inside(labelBounds),
              clear: navigation.every(
                (node) =>
                  !overlaps(bounds, node.getBoundingClientRect()) &&
                  (!labelBounds ||
                    !overlaps(labelBounds, node.getBoundingClientRect())),
              ),
              focusVisible:
                element.matches(":focus-visible") &&
                style.outlineStyle !== "none" &&
                parseFloat(style.outlineWidth) > 0,
              hitTarget: element.contains(
                document.elementFromPoint(
                  bounds.left + bounds.width / 2,
                  bounds.top + bounds.height / 2,
                ),
              ),
              targetSize: bounds.height >= (innerWidth < 768 ? 44 : 40),
            };
          }),
        { message: `${name} stays focused, visible and unobscured` },
      )
      .toEqual({
        focused: true,
        inside: true,
        labelInside: true,
        clear: true,
        focusVisible: true,
        hitTarget: true,
        targetSize: true,
      });
  } catch (error) {
    const geometry = await control.evaluate((element) => ({
      bounds: element.getBoundingClientRect().toJSON(),
      viewport: { width: innerWidth, height: innerHeight },
      scrollY,
      focused: element === document.activeElement,
      scrollMargin: getComputedStyle(element).scrollMarginBlock,
    }));
    await test.info().attach("focus-geometry", {
      body: Buffer.from(JSON.stringify({ name, geometry }, null, 2)),
      contentType: "application/json",
    });
    throw error;
  }
}

async function checkStockKeyboard(page: Page) {
  const first = page.getByRole("combobox", {
    name: "Received as",
    exact: true,
  });
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(first).toBeFocused();
  for (const [role, name] of [
    ["button", "Received on"],
    ["textbox", "Security received"],
    ["textbox", "Shares received"],
    ["textbox", "Historical value · $"],
    ["textbox", "Evidence"],
    ["button", "Add distribution"],
    ["combobox", "Distribution history"],
    ["button", "History through"],
    ["textbox", "Carry already charged · $"],
    ["combobox", "Recorded distributions in provider total"],
    ["button", "Save distributions"],
    ["button", "Cancel"],
  ] as const) {
    await page.keyboard.press("Tab");
    await focusedControlUsable(
      page.getByRole(role, { name, exact: true }),
      name,
    );
  }
}

function expectPreserved(receipt: PurchaseReceipt, previous: PurchaseReceipt) {
  expect(receipt.details.lots).toEqual(previous.details.lots);
  expect(receipt.details.valuation).toEqual(previous.details.valuation);
  expect(receipt.details.investmentTerms).toEqual(
    previous.details.investmentTerms,
  );
  expect(receipt.details.coversPosition).toBe(previous.details.coversPosition);
  expect(receipt.details.cashCoversPosition).toBe(
    previous.details.cashCoversPosition,
  );
}

async function afterValue(page: Page, value: string) {
  await expect(
    workspace(page).getByRole("group", {
      name: /remaining value.*after carry/i,
    }),
  ).toContainText(value);
}

test("source links tolerate unfinished typing and persist only valid URLs", async ({
  page,
}) => {
  const prepared = await prepareCarryPosition(page.request, {
    providerRealizedValueMinor: 0,
    carryStatus: "before_carry",
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request
        .url()
        .endsWith(`/api/investment-positions/${prepared.positionId}/valuation`)
    )
      writes++;
  });
  await openHolding(page, prepared.positionId);
  await expect(
    workspace(page).getByRole("link", {
      name: "Synthetic carry GP statement",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Edit valuation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  const source = page.getByRole("textbox", {
    name: "Source link",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  for (const character of "https://") {
    await source.pressSequentially(character);
    await expect(source).toBeVisible();
    await expect(save).toBeDisabled();
  }
  await expect(source).toHaveValue("https://");
  await expect(
    page.getByRole("textbox", { name: "Position total · $", exact: true }),
  ).toHaveValue("40000");
  expect(errors).toEqual([]);
  expect(writes).toBe(0);
  expect(
    (await current(page, prepared.positionId)).purchaseContext!.receipt,
  ).toEqual(prepared.receipt);
  await capture(page, "source-link-incomplete");

  for (const invalid of [
    "http://example.com/source",
    "https://demo:invalid@example.com/source",
  ]) {
    await source.fill(invalid);
    await expect(source).toHaveValue(invalid);
    await expect(save).toBeDisabled();
  }
  const url = "https://example.com/synthetic-statement?document=1#page-2";
  await source.fill("");
  await source.pressSequentially(url);
  await expect(save).toBeEnabled();
  const acceptedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/investment-positions/${prepared.positionId}/valuation`),
  );
  await save.click();
  const response = await acceptedResponse;
  expect(response.status(), await response.text()).toBe(201);
  const accepted = PurchaseReceiptSchema.parse(await response.json());
  expect(accepted.details.lots).toEqual(prepared.receipt.details.lots);
  expect(accepted.details.investmentTerms).toEqual(
    prepared.receipt.details.investmentTerms,
  );
  expect(accepted.details.distributionReview).toEqual(
    prepared.receipt.details.distributionReview,
  );
  expect(
    accepted.details.valuation!.records.find((record) => record.id === "gp")
      ?.sourceUrl,
  ).toBe(url);
  await page.reload();
  await expect(
    workspace(page).getByRole("group", {
      name: "Reported remaining value · Before carry",
      exact: true,
    }),
  ).toContainText("$40,000");
  const sourceLink = workspace(page).getByRole("link", {
    name: "Synthetic carry GP statement",
    exact: true,
  });
  await expect(sourceLink).toHaveAttribute("href", url);
  await expect(sourceLink).toHaveAttribute("target", "_blank");
  await expect(sourceLink).toHaveAttribute("rel", "noreferrer");
  await expect(sourceLink).toHaveCSS("text-decoration-line", "underline");
  await expect(
    workspace(page).getByRole("heading", { level: 2 }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Copy position link", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Edit valuation", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await focusedControlUsable(sourceLink, "Valuation source link");
  await page
    .context()
    .route("https://example.com/synthetic-statement**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Synthetic source</title><p>Synthetic source evidence</p>",
      }),
    );
  const popupOpened = page.waitForEvent("popup");
  await sourceLink.press("Enter");
  const popup = await popupOpened;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toBe(url);
  expect(await popup.evaluate(() => window.opener === null)).toBe(true);
  await popup.close();
  await capture(page, "source-link-gp");
  await page
    .getByRole("button", { name: "Edit valuation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(source).toHaveValue(url);
  await expect(save).toBeDisabled();
  await source.fill("");
  await expect(save).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    (await current(page, prepared.positionId)).purchaseContext!.receipt,
  ).toEqual(accepted);
  expect(errors).toEqual([]);
  expect(writes).toBe(1);
  await capture(page, "source-link-saved");

  await page
    .getByRole("button", { name: "Edit valuation", exact: true })
    .click();
  await select(page, "Source", "My estimate");
  await page
    .getByRole("textbox", { name: "Position total · $", exact: true })
    .fill("18000");
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  const estimateUrl = "https://example.com/synthetic-estimate";
  await source.fill(estimateUrl);
  const estimateSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/investment-positions/${prepared.positionId}/valuation`),
  );
  await save.click();
  expect((await estimateSaved).status()).toBe(201);
  await page.reload();
  const estimateLink = workspace(page).getByRole("link", {
    name: "My estimate",
    exact: true,
  });
  await expect(estimateLink).toHaveAttribute("href", estimateUrl);
  await expect(estimateLink).toHaveAttribute("target", "_blank");
  await expect(sourceLink).toHaveCount(0);
  const estimateReceipt = (await current(page, prepared.positionId))
    .purchaseContext!.receipt!;
  expect(
    estimateReceipt.details.valuation!.records.find(
      (record) => record.id === "gp",
    )?.sourceUrl,
  ).toBe(url);
  await capture(page, "source-link-estimate");

  await page
    .getByRole("button", { name: "Edit valuation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await source.fill("");
  const cleared = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .endsWith(`/api/investment-positions/${prepared.positionId}/valuation`),
  );
  await save.click();
  expect((await cleared).status()).toBe(201);
  await page.reload();
  await expect(
    workspace(page).getByRole("group", {
      name: "My estimate of remaining value · Before carry",
      exact: true,
    }),
  ).toContainText("$18,000");
  await expect(estimateLink).toHaveCount(0);
  await expect(sourceLink).toHaveCount(0);
  const clearedReceipt = (await current(page, prepared.positionId))
    .purchaseContext!.receipt!;
  expect(
    clearedReceipt.details.valuation!.records.find(
      (record) => record.id === "mine",
    )?.sourceUrl,
  ).toBeNull();
  expect(
    clearedReceipt.details.valuation!.records.find(
      (record) => record.id === "gp",
    )?.sourceUrl,
  ).toBe(url);
  expect(errors).toEqual([]);
  expect(writes).toBe(3);
  await capture(page, "source-link-cleared");
});

async function checkHistoryControls(page: Page) {
  await workspace(page)
    .getByRole("button", { name: "Sources & history", exact: true })
    .click();
  const buttons = workspace(page).locator(
    ".holding-receipt-history [data-slot='collapsible-trigger']",
  );
  await expect(buttons.first()).toBeVisible();
  for (const button of await buttons.all()) {
    const geometry = await button.evaluate((element) => {
      const indicator = element.querySelector("svg")!.getBoundingClientRect();
      const title = element.querySelector("span")!.getBoundingClientRect();
      return {
        beside:
          indicator.left >= title.right &&
          indicator.top < title.bottom &&
          indicator.bottom > title.top,
        contained: indicator.right <= element.getBoundingClientRect().right,
      };
    });
    expect(geometry).toEqual({ beside: true, contained: true });
    const describedBy = await button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const time = page.locator(`[id=${JSON.stringify(describedBy)}]`);
    await expect(button).toHaveAccessibleDescription(await time.innerText());
  }
  await buttons.first().press("Enter");
  await expect(buttons.first()).toHaveAttribute("aria-expanded", "true");
}

test("stock distribution recalculates carry and persists correction, other edits and removal", async ({
  page,
}) => {
  const prepared = await prepareCarryPosition(page.request, {
    providerRealizedValueMinor: 900_000,
    carryStatus: "before_carry",
  });
  const beforeHistory = await history(page, prepared.positionId);
  await openHolding(page, prepared.positionId);
  await fillReview(page);
  await checkStockKeyboard(page);
  const calculation = workspace(page).getByRole("button", {
    name: "Calculation",
    exact: true,
  });
  await calculation.click();
  await expect(workspace(page).locator(".holding-calculation")).toContainText(
    "remaining value only",
  );
  await calculation.click();
  await expect(
    page.getByRole("combobox", { name: "Historical value", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Carry already charged", exact: true }),
  ).toHaveCount(0);
  await capture(page, "distribution-proposed");
  const first = await saveReview(page, prepared.positionId);
  expectPreserved(first, prepared.receipt);
  const review = first.details.distributionReview!;
  expect(review).toMatchObject({
    method: "capital_return_first_v1",
    events: [
      {
        kind: "in_kind",
        investorValueMinor: 900_000,
        quantityMicros: 60_000_000,
      },
    ],
    priorCarry: { status: "known", amountMinor: 0 },
    provider: {
      inclusion: "all",
      sourceSnapshotId: prepared.snapshotId,
      realizedValueMinor: 900_000,
    },
  });
  expect(
    (await current(page, prepared.positionId)).purchaseContext!.receipt,
  ).toEqual(first);
  await page.reload();
  await afterValue(page, "$36,200");
  await expect(
    workspace(page).getByLabel(/^Return before remaining carry /u),
  ).toBeVisible();

  await expect(
    workspace(page).getByLabel(/^Return after carry /u),
  ).toContainText(/\+67\.4/);
  await capture(page, "distribution-readback");
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await expect(
    workspace(page).locator(".holding-calculation"),
  ).not.toContainText("remaining value only");
  await expect(workspace(page).locator(".holding-calculation")).toContainText(
    "$21,000",
  );
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save distributions", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Historical value · $", exact: true })
    .fill("10000");
  const corrected = await saveReview(page, prepared.positionId);
  expect(corrected.details.distributionReview!.events[0]!.id).toBe(
    review.events[0]!.id,
  );
  expectPreserved(corrected, first);
  await afterValue(page, "$36,000");
  expect(prepared.holding.positionKind).toBe("spv_interest");
  expect(prepared.holding.purchaseContext?.currency).toBe("USD");
  await openImportedInvestment(page);
  await page
    .getByRole("textbox", {
      name: "Synthetic upfront deductions paid · $",
      exact: true,
    })
    .fill("3200");
  await page
    .getByRole("textbox", { name: "Carry · %", exact: true })
    .fill("18");
  await select(page, "Carry gains above", "Net capital");
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Purchase source", exact: true })
    .fill("Synthetic clarified subscription evidence");
  await page
    .getByRole("textbox", { name: "Quantity share basis", exact: true })
    .fill("5");
  const purchaseResponse = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(
          `/api/investment-positions/${encodeURIComponent(prepared.positionId)}/purchases`,
        ) && response.request().method() === "POST",
  );
  await workspace(page)
    .getByRole("button", { name: "Save", exact: true })
    .click();
  const changedPurchase = await purchaseResponse;
  expect(changedPurchase.status(), await changedPurchase.text()).toBe(201);
  const preserved = PurchaseReceiptSchema.parse(await changedPurchase.json());
  expect(preserved.details.lots[0]!.fees).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "synthetic-carry-upfront-fee",
        paidMinor: 320_000,
      }),
    ]),
  );
  expect(preserved.details.investmentTerms).toMatchObject({
    carryPpm: 180_000,
    carryBasis: "net_capital",
  });
  expect(preserved.details.distributionReview).toEqual(
    corrected.details.distributionReview,
  );
  expect(
    preserved.details.lots[0]!.quantityDetails?.shareBasis.unitsPerOriginal,
  ).toBe(5);
  await page.reload();
  await afterValue(page, "$35,824");
  await expect(workspace(page)).toContainText("$3,200");
  if (process.env.KEEL_HOLDING_MAINTENANCE_CAPTURE)
    await capture(page, "usd-fees-and-carry-readback");
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Remove distribution 1", exact: true })
    .click();
  const removed = await saveReview(page, prepared.positionId);
  expectPreserved(removed, preserved);
  expect(removed.details.distributionReview!.events).toEqual([]);
  const receipts = await history(page, prepared.positionId);
  expect(receipts).toHaveLength(beforeHistory.length + 4);
  expect(receipts.find((receipt) => receipt.id === first.id)).toEqual(first);
  expect(receipts.find((receipt) => receipt.id === corrected.id)).toEqual(
    corrected,
  );
  expect(receipts.find((receipt) => receipt.id === removed.id)).toEqual(
    removed,
  );
  await page.reload();
  await expect(workspace(page)).toContainText(
    "No received distributions recorded",
  );
  await checkHistoryControls(page);
  await expect(
    workspace(page).locator(".holding-receipt-history"),
  ).toContainText(/distribution/i);
  await capture(page, "distribution-history");
});

test("pending writes lock controls and real receipt conflicts retain drafts without another effect", async ({
  page,
}) => {
  const prepared = await prepareCarryPosition(page.request, {
    providerRealizedValueMinor: 900_000,
    carryStatus: "before_carry",
  });
  const originalHistory = await history(page, prepared.positionId);
  await openHolding(page, prepared.positionId);
  await fillReview(page);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let posts = 0;
  const routePattern = `**${endpoint(prepared.positionId)}`;
  await page.route(routePattern, async (route) => {
    posts++;
    await held;
    await route.continue();
  });
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint(prepared.positionId)) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save distributions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Saving…", exact: true }),
  ).toBeDisabled();
  for (const control of await workspace(page)
    .locator("fieldset")
    .getByRole("textbox")
    .all())
    await expect(control).toBeDisabled();
  for (const label of [
    "Received as",
    "Distribution history",
    "Recorded distributions in provider total",
  ])
    await expect(
      page.getByRole("combobox", { name: label, exact: true }),
    ).toBeDisabled();
  for (const label of [
    "Received on",
    "History through",
    "Add distribution",
    "Remove distribution 1",
    "Cancel",
  ])
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit investment", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Edit valuation", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(posts).toBe(1);
  expect(await history(page, prepared.positionId)).toEqual(originalHistory);
  const historyAction = workspace(page).getByRole("button", {
    name: "Sources & history",
    exact: true,
  });
  const linkedRecords = page.getByRole("button", {
    name: "Add linked investment record",
    exact: true,
  });
  await expect(historyAction).toHaveAttribute("aria-expanded", "false");
  await expect(linkedRecords).toBeVisible();
  await expect(linkedRecords).toBeDisabled();
  await expect(historyAction).toBeEnabled();
  await historyAction.click();
  await expect(
    workspace(page)
      .locator(".holding-receipt-history [data-slot='collapsible-trigger']")
      .first(),
  ).toBeEnabled();
  await capture(page, "distribution-saving");
  release();
  const response = await pending;
  expect(response.status(), await response.text()).toBe(201);
  const accepted = PurchaseReceiptSchema.parse(await response.json());
  await page.unroute(routePattern);
  await expect(
    page.getByRole("button", { name: "Edit distributions", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Historical value · $", exact: true })
    .fill("9500");
  const concurrentInput = AcceptDistributionsSchema.parse({
    expectedSnapshotId: prepared.snapshotId,
    expectedReceiptId: accepted.id,
    distributionReview: {
      ...accepted.details.distributionReview!,
      sourceUrl: "https://example.com/synthetic-review",
      note: "Synthetic retained review note",
      events: accepted.details.distributionReview!.events.map((event) => ({
        ...event,
        sourceUrl: "https://example.com/synthetic-distribution",
        note: "Synthetic retained event note",
      })),
    },
  });
  const concurrentResponse = await page.request.post(
    endpoint(prepared.positionId),
    {
      headers: { Origin: new URL(test.info().project.use.baseURL!).origin },
      data: concurrentInput,
    },
  );
  expect(concurrentResponse.status(), await concurrentResponse.text()).toBe(
    201,
  );
  const concurrent = PurchaseReceiptSchema.parse(
    await concurrentResponse.json(),
  );
  const rejected = page.waitForResponse(
    (result) =>
      result.url().endsWith(endpoint(prepared.positionId)) &&
      result.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save distributions", exact: true })
    .click();
  expect((await rejected).status()).toBe(409);
  await expect(workspace(page)).toContainText("reload this page");
  await expect(
    page.getByRole("textbox", { name: "Historical value · $", exact: true }),
  ).toHaveValue("9500");
  await expect(workspace(page)).toContainText(/changed|stale|reload|conflict/i);
  expect(
    (await current(page, prepared.positionId)).purchaseContext!.receipt,
  ).toEqual(concurrent);
  expect(await history(page, prepared.positionId)).toHaveLength(
    originalHistory.length + 2,
  );
  await capture(page, "distribution-conflict");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Historical value · $", exact: true })
    .fill("9500");
  const retried = await saveReview(page, prepared.positionId);
  expect(retried.details.distributionReview).toMatchObject({
    sourceUrl: concurrentInput.distributionReview.sourceUrl,
    note: concurrentInput.distributionReview.note,
    events: [
      {
        id: concurrentInput.distributionReview.events[0]!.id,
        investorValueMinor: 950_000,
        sourceUrl: concurrentInput.distributionReview.events[0]!.sourceUrl,
        note: concurrentInput.distributionReview.events[0]!.note,
      },
    ],
  });
  await afterValue(page, "$36,100");
});

test("cash receipts preserve unknown amounts and keep mixed-inclusion returns unavailable", async ({
  page,
}) => {
  const prepared = await prepareCarryPosition(page.request, {
    providerRealizedValueMinor: 0,
    carryStatus: "before_carry",
  });
  await openHolding(page, prepared.positionId);
  await fillReview(page, {
    kind: "Cash",
    priorCarry: "",
    inclusion: "Not included",
  });
  const unknown = await saveReview(page, prepared.positionId);
  expect(unknown.details.distributionReview!.priorCarry).toEqual({
    status: "unknown",
  });
  expectPreserved(unknown, prepared.receipt);
  await expect(
    workspace(page).getByRole("group", { name: /value.*after carry/i }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await expect(workspace(page)).toContainText("$21,000");
  await capture(page, "distribution-unknown-carry");
  await workspace(page)
    .getByRole("button", { name: "Calculation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Cash received · $", exact: true })
    .fill("");
  const unknownValue = await saveReview(page, prepared.positionId);
  expect(
    unknownValue.details.distributionReview!.events[0]!.investorValueMinor,
  ).toBeNull();
  await page.reload();
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Cash received · $", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("textbox", { name: "Cash received · $", exact: true })
    .fill("-1");
  await expect(
    page.getByRole("button", { name: "Save distributions", exact: true }),
  ).toBeDisabled();
  await expect(workspace(page)).toContainText(
    "Correct the highlighted amount to preview and save.",
  );
  await expect(workspace(page)).not.toContainText("required inputs");
  await capture(page, "distribution-invalid");
  await page
    .getByRole("textbox", { name: "Cash received · $", exact: true })
    .fill("9000");
  await page
    .getByRole("textbox", { name: "Carry already charged · $", exact: true })
    .fill("0");
  await select(
    page,
    "Recorded distributions in provider total",
    "Mixed · only some included",
  );
  const mixed = await saveReview(page, prepared.positionId);
  expect(mixed.details.distributionReview!.provider.inclusion).toBe(
    "unsupported_mixed",
  );
  await afterValue(page, "$36,200");
  await expect(workspace(page).locator(".holding-return")).toHaveCount(0);
  await workspace(page)
    .getByRole("button", { name: "Calculation", exact: true })
    .click();
  await expect(workspace(page).locator(".holding-calculation")).toContainText(
    "Provider-reported distributions include only some recorded distributions.",
  );
  await capture(page, "distribution-mixed");
  await page
    .getByRole("button", { name: "Edit distributions", exact: true })
    .click();
  await select(
    page,
    "Recorded distributions in provider total",
    "Not included",
  );
  await saveReview(page, prepared.positionId);
  await afterValue(page, "$36,200");
  await expect(
    workspace(page).getByRole("group", { name: /value.*after carry/i }),
  ).toContainText(/\+67\.4/);
  expect((await current(page, prepared.positionId)).realizedValueMinor).toBe(0);
});

test("an accepted write retries only readback when the holding refresh fails", async ({
  page,
}) => {
  const prepared = await prepareCarryPosition(page.request, {
    providerRealizedValueMinor: 900_000,
    carryStatus: "before_carry",
  });
  const before = await history(page, prepared.positionId);
  await openHolding(page, prepared.positionId);
  await fillReview(page);
  let posts = 0;
  page.on("request", (request) => {
    if (
      request.url().endsWith(endpoint(prepared.positionId)) &&
      request.method() === "POST"
    )
      posts++;
  });
  let failReadback = true;
  await page.route("**/api/holdings-page*", async (route) => {
    if (failReadback) {
      failReadback = false;
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic readback failure" }),
      });
    } else await route.continue();
  });
  const acceptedResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith(endpoint(prepared.positionId)) &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Save distributions", exact: true })
    .click();
  const response = await acceptedResponse;
  expect(response.status(), await response.text()).toBe(201);
  const accepted = PurchaseReceiptSchema.parse(await response.json());
  await expect(
    page.getByRole("button", {
      name: "Reload saved distributions",
      exact: true,
    }),
  ).toBeVisible();
  await expect(workspace(page)).toContainText("Distributions were saved");
  await expect(
    workspace(page).getByRole("region", {
      name: "Position summary",
      exact: true,
    }),
  ).toBeHidden();
  await expect(
    workspace(page).getByRole("button", { name: "Calculation", exact: true }),
  ).toBeHidden();
  await expect(workspace(page)).toContainText(
    "Updated values and returns will appear after reload.",
  );
  expect(
    (await current(page, prepared.positionId)).purchaseContext!.receipt,
  ).toEqual(accepted);
  await capture(page, "distribution-refresh-failed");
  await page
    .getByRole("button", { name: "Reload saved distributions", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit distributions", exact: true }),
  ).toBeVisible();
  await afterValue(page, "$36,200");
  expect(posts).toBe(1);
  expect(await history(page, prepared.positionId)).toHaveLength(
    before.length + 1,
  );
});

test("an explicitly undated provider review stays undated in detail and collection", async ({
  page,
}) => {
  const prepared = await prepareCarryPosition(page.request, {
    providerRealizedValueMinor: 0,
    carryStatus: "before_carry",
    undatedProviderReview: true,
  });
  expect(prepared.receipt.details.valuation).toBeUndefined();
  expect(
    prepared.receipt.details.investmentTerms!.reportedValueReview!
      .effectiveDate,
  ).toBeNull();
  await openHolding(page, prepared.positionId);
  await expect(workspace(page)).toContainText("Synthetic undated GP review");
  await expect(workspace(page)).not.toContainText("Value date unknown");
  await fillReview(page, { inclusion: "Not included" });
  const accepted = await saveReview(page, prepared.positionId);
  expectPreserved(accepted, prepared.receipt);
  await page.reload();
  await expect(
    workspace(page).getByRole("group", { name: /value.*after carry/i }),
  ).toHaveCount(0);
  await expect(workspace(page).locator(".holding-return")).toHaveCount(0);
  const response = await page.request.get("/api/holdings-page");
  expect(response.status(), await response.text()).toBe(200);
  const model = HoldingsPageSchema.parse(await response.json());
  const projected = model.investmentHoldings.exposureView.positions.find(
    (position) => position.id === prepared.positionId,
  );
  expect(projected).toMatchObject({
    valueMinor: 4_000_000,
    valueSource: "provider",
    valueEffectiveDate: null,
    reviewedInvestment: {
      distributionReview: accepted.details.distributionReview,
      terms: { reportedValueReview: { effectiveDate: null } },
    },
  });
  await capture(page, "distribution-unknown-date");
});

for (const carryStatus of ["unknown", "after_carry"] as const)
  test(`distribution edits preserve ${carryStatus} source treatment`, async ({
    page,
  }) => {
    const prepared = await prepareCarryPosition(page.request, {
      providerRealizedValueMinor: 0,
      carryStatus,
    });
    await openHolding(page, prepared.positionId);
    let unrelatedReads = 0;
    if (carryStatus === "after_carry") {
      await readOverview(page);
      await page.goBack();
      await expect(workspace(page)).toBeVisible();
      await page.route("**/api/alpha", async (route) => {
        unrelatedReads++;
        await route.abort("failed");
      });
    }
    await fillReview(page, {
      kind: "Cash",
      amount: "",
      priorCarry: "",
      inclusion: "Not included",
    });
    const accepted = await saveReview(page, prepared.positionId);
    expectPreserved(accepted, prepared.receipt);
    if (carryStatus === "after_carry") {
      expect(unrelatedReads).toBe(0);
      await page.unroute("**/api/alpha");
      await readOverview(page, true);
      await page.goBack();
      await expect(workspace(page)).toBeVisible();
    }
    await page.reload();
    if (carryStatus === "unknown") {
      await expect(
        workspace(page).getByRole("group", { name: /carry unspecified/i }),
      ).toContainText("$40,000");
      await expect(
        workspace(page).getByRole("group", { name: /value.*after carry/i }),
      ).toHaveCount(0);
    } else {
      await afterValue(page, "$40,000");
      await expect(
        workspace(page).getByRole("group", { name: /before carry/i }),
      ).toHaveCount(0);
    }
    await expect(workspace(page).locator(".holding-return")).toHaveCount(0);
    await workspace(page)
      .getByRole("button", { name: "Calculation", exact: true })
      .click();
    await expect(workspace(page).locator(".holding-calculation")).toContainText(
      "A historical distribution value is unknown.",
    );
    await capture(page, `distribution-source-${carryStatus}`);
  });
