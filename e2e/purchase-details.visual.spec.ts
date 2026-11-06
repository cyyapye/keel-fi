import { fileURLToPath } from "node:url";
import type { Locator } from "@playwright/test";
import { expect, test, type Page } from "./api-mocked-test";
import {
  alphaFixture,
  emptyPortfolioBaseline,
  emptyInvestmentConnections,
  emptyPrivateExposureReviews,
} from "./holdings-detail-fixtures";
import {
  PurchaseReceiptSchema,
  AcceptPurchasesSchema,
  valuationSharesKey,
  type PurchaseReceipt,
} from "../packages/domain/src/position-purchases";
import { AcceptValuationSchema } from "../packages/domain/src/valuation-record";
import {
  purchaseDetailProjection,
  purchaseDetailReceipt,
} from "./purchase-detail-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";

test.use({ timezoneId: "UTC" });

async function select(page: Page, label: string, option: string) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  await expect(page.locator(".spv-holding")).toHaveScreenshot(name, {
    animations: "disabled",
    stylePath: fileURLToPath(
      new URL("./purchase-details.capture.css", import.meta.url),
    ),
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function expectFocusedControlUsable(control: Locator) {
  await expect(control).toBeFocused();
  await expect(control).toBeVisible();
  await expect
    .poll(() =>
      control.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const label = element
          .closest("label")
          ?.querySelector('[data-slot="field-label"]');
        const labelBox = label?.getBoundingClientRect();
        const contained = (bounds: DOMRect) =>
          bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= 0 &&
          bounds.top >= 0 &&
          bounds.right <= innerWidth &&
          bounds.bottom <= innerHeight;
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right &&
          a.right > b.left &&
          a.top < b.bottom &&
          a.bottom > b.top;
        const navigation = [
          ...document.querySelectorAll(".topbar, .mobile-nav"),
        ].filter((node) => {
          const style = getComputedStyle(node);
          return style.visibility !== "hidden" && style.display !== "none";
        });
        const style = getComputedStyle(element);
        return {
          controlInViewport: contained(box),
          labelInViewport: !labelBox || contained(labelBox),
          controlClearOfNavigation: navigation.every(
            (node) => !overlaps(box, node.getBoundingClientRect()),
          ),
          labelClearOfNavigation: navigation.every(
            (node) =>
              !labelBox || !overlaps(labelBox, node.getBoundingClientRect()),
          ),
          hitTarget: element.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          ),
          focusVisible: element.matches(":focus-visible"),
          outlineVisible:
            style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
          mobileTargetSize: innerWidth >= 768 || box.height >= 44,
          noHorizontalOverflow:
            document.documentElement.scrollWidth <= innerWidth,
        };
      }),
    )
    .toEqual({
      controlInViewport: true,
      labelInViewport: true,
      controlClearOfNavigation: true,
      labelClearOfNavigation: true,
      hitTarget: true,
      focusVisible: true,
      outlineVisible: true,
      mobileTargetSize: true,
      noHorizontalOverflow: true,
    });
}

async function checkBasisKeyboardNavigation(
  page: Page,
  options: {
    previous: Locator;
    basis: Locator;
    following: Locator[];
  },
) {
  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCSS("visibility", "visible");
  await options.previous.click();
  if ((await options.previous.getAttribute("role")) === "combobox") {
    await expect(options.previous).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(options.previous).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("listbox")).toBeHidden();
  }
  await expect(options.previous).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    options.basis.locator("..").locator('[data-slot="field-label"]'),
  ).toBeVisible();
  await expectFocusedControlUsable(options.basis);
  await page.keyboard.press("Tab");
  await expect(options.following[0]!).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expectFocusedControlUsable(options.basis);
  for (const control of options.following) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }
  await expectFocusedControlUsable(options.following.at(-1)!);
}

async function setup(
  page: Page,
  configure?: (receipt: PurchaseReceipt) => void,
  relatedNames: string[] = [],
  shareClass = "Preferred",
) {
  await page.route("**/api/portfolio-baseline", (route) =>
    route.request().method() !== "GET"
      ? route.fallback()
      : route.fulfill({ json: emptyPortfolioBaseline }),
  );
  await page.route("**/api/investment-connections", (route) =>
    route.request().method() !== "GET"
      ? route.fallback()
      : route.fulfill({ json: emptyInvestmentConnections }),
  );
  await page.route("**/api/private-exposure-reviews", (route) =>
    route.request().method() !== "GET"
      ? route.fallback()
      : route.fulfill({ json: emptyPrivateExposureReviews }),
  );
  await page.route("**/api/portfolio-baseline/refresh", (route) =>
    route.request().method() !== "POST"
      ? route.fallback()
      : route.fulfill({ json: emptyPortfolioBaseline }),
  );
  await page.route("**/api/alpha", (route) =>
    route.request().method() !== "GET"
      ? route.fallback()
      : route.fulfill({ json: alphaFixture }),
  );
  await page.clock.setFixedTime(new Date("2026-10-08T12:00:00.000Z"));
  let receipt = purchaseDetailReceipt();
  configure?.(receipt);
  let reject = false,
    revision = 1;
  let pendingSave: Promise<void> | null = null;
  let releaseSave: (() => void) | undefined;
  const history = [receipt];
  const projection = () => purchaseDetailProjection(receipt, relatedNames);
  await routeHoldingsPage(page, () => ({
    householdName: "Demo Household",
    ...projection(),
    acceptedCashAccounts: [],
    pendingImports: [],
  }));
  await page.route(
    "**/api/investment-positions/synthetic-holding/share-price-evidence",
    (route) =>
      route.fulfill({
        json: {
          prices: [
            {
              id: `proxy-price-${revision}`,
              positionId: "another-spv",
              positionLabel: "Other Cedar SPV",
              sourceLabel: "Tokenfolio",
              observedAt: "2026-09-30T12:00:00.000Z",
              capturedAt: "2026-10-01T12:00:00.000Z",
              markMicros: 210_000_000 + (revision - 1) * 1_000_000,
              markDate: "2026-09-30",
              costMicros: null,
              shareClass,
              shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
            },
          ],
          watch: [
            {
              id: "watch",
              title: "Synthetic Cedar funding update",
              url: "https://example.com/cedar",
              publishedAt: "2026-09-28",
              fact: "Synthetic financing evidence",
            },
          ],
        },
      }),
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/history",
    (route) =>
      route.fulfill({
        json: {
          entries: history.map((r, i) => ({
            kind: "investment",
            receipt: r,
            previous: history[i + 1] ?? null,
          })),
          next: null,
        },
      }),
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/links",
    (route) =>
      route.fulfill({
        json: {
          version: 1,
          positionId: "synthetic-holding",
          links: [],
          candidates: [],
          history: [],
        },
      }),
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/valuation",
    async (route) => {
      const input = AcceptValuationSchema.parse(route.request().postDataJSON());
      if (reject) {
        await route.fulfill({
          status: 409,
          json: {
            error: "This source price changed. Reload the available sources.",
          },
        });
        return;
      }
      if (pendingSave) await pendingSave;
      const previous = receipt;
      receipt = PurchaseReceiptSchema.parse({
        ...receipt,
        id: `receipt-${history.length + 1}`,
        acceptedAt: `2026-10-01T12:00:${String(history.length).padStart(2, "0")}.000Z`,
        details: {
          ...receipt.details,
          valuation: {
            snapshotId: "snapshot",
            records: [
              ...(receipt.details.valuation?.records ?? []).filter(
                (r) => r.id !== input.record.id,
              ),
              input.record,
            ],
            selected: {
              recordId: input.record.id,
              method: input.method,
              sharesKey:
                input.method === "shares"
                  ? valuationSharesKey(receipt.details)
                  : null,
            },
          },
        },
      });
      expect(receipt.details.lots).toEqual(previous.details.lots);
      history.unshift(receipt);
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  await page.route(
    "**/api/investment-positions/synthetic-holding/purchases",
    async (route) => {
      const input = AcceptPurchasesSchema.parse(route.request().postDataJSON());
      if (reject) {
        await route.fulfill({
          status: 500,
          json: { error: "Investment could not be saved." },
        });
        return;
      }
      if (pendingSave) await pendingSave;
      receipt = PurchaseReceiptSchema.parse({
        ...receipt,
        id: `receipt-${history.length + 1}`,
        acceptedAt: `2026-10-01T12:00:${String(history.length).padStart(2, "0")}.000Z`,
        details: { ...input.details, valuation: receipt.details.valuation },
      });
      history.unshift(receipt);
      await route.fulfill({ status: 201, json: receipt });
    },
  );
  await page.goto("/holdings?position=synthetic-holding");
  await expect(
    page.getByRole("heading", { name: "Demo Cedar AI", exact: true }),
  ).toBeVisible();
  return {
    receipt: () => receipt,
    pauseSave: () => {
      pendingSave = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    },
    resumeSave: () => {
      releaseSave?.();
      pendingSave = null;
    },
    reject: (value: boolean) => {
      reject = value;
    },
    refreshPrice: () => {
      revision++;
    },
  };
}

test("holding summary pairs value and return and keeps fees in Investment", async ({
  page,
}) => {
  const relatedNames = [
    "Demo Cedar Growth I SPV",
    "Demo Cedar Growth II SPV",
    "Demo Cedar Artificial Intelligence and Enterprise Infrastructure Opportunity III SPV",
  ];
  await setup(page, undefined, relatedNames);
  const related = page.getByRole("list", { name: "Also held through" });
  await expect(related.getByRole("listitem")).toHaveCount(3);
  for (const [index, name] of relatedNames.entries()) {
    const link = related.getByRole("link", { name, exact: true });
    await expect(link).toHaveAttribute(
      "href",
      `/holdings?position=synthetic-related-${index}`,
    );
    await expect(link).toHaveCSS("white-space", "normal");
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(
      page.viewportSize()!.width <= 620 ? 44 : 40,
    );
  }
  const rows = await related.getByRole("listitem").all();
  for (let i = 1; i < rows.length; i++) {
    expect((await rows[i]!.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await rows[i - 1]!.boundingBox())!.y +
        (await rows[i - 1]!.boundingBox())!.height,
    );
  }
  const before = page.getByRole("group", {
    name: "Reported remaining value · Before carry",
    exact: true,
  });
  await expect(before).toContainText("$16,880.00");
  await expect(before).toContainText("+100.00%");
  const after = page.getByRole("group", {
    name: "Estimated remaining value · After carry",
    exact: true,
  });
  await expect(after).toContainText("$15,698.00");
  await expect(after).toContainText("+85.99%");
  await expect(
    page.getByRole("group", { name: "Invested capital" }),
  ).toContainText("$8,440.00");
  await expect(page.getByRole("heading", { name: "Fees & carry" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Edit investment" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toHaveCount(1);
  await screenshot(page, "holding-summary.png");
  await page.getByRole("button", { name: "Calculation", exact: true }).click();
  await expect(page.locator(".holding-calculation")).toContainText("$1,182.00");
  await expect(page.locator(".holding-calculation")).toContainText(
    "Net capital$8,440.00",
  );
  await expect(page.locator(".holding-calculation")).toContainText(
    "÷ net capital",
  );
  await screenshot(page, "holding-calculation.png");
});

test(
  "valuation choices compare both amounts and preserve investment shares after save",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const state = await setup(page, (r) => {
      r.details.valuation!.records[0]!.totalMinor = 1_748_000;
    });
    await page.getByRole("button", { name: "Edit valuation" }).click();
    await expect(
      page.getByRole("radio", { name: /Reported by GP/ }),
    ).toBeChecked();
    await expect(
      page.getByRole("radio", { name: /Calculated from your shares/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: "Choose the valuation shown for this holding",
      }),
    ).toContainText("84.4 shares in Investment × $200.00/share");
    await screenshot(page, "valuation-choice.png");
    await page.getByRole("radio", { name: /Reported by GP/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("radio", { name: /Calculated from your shares/ }),
    ).toBeChecked();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit valuation", exact: true }),
    ).toBeVisible();
    expect(state.receipt().details.valuation!.selected!.method).toBe("shares");
    expect(state.receipt().details.valuation!.records[0]!.totalMinor).toBe(
      1_748_000,
    );
    expect(state.receipt().details.lots[0]!.remainingSharesMicros).toBe(
      84_400_000,
    );
    await page.reload();
    await page.getByRole("button", { name: "Edit valuation" }).click();
    await expect(
      page.getByRole("textbox", { name: "Position total · $" }),
    ).toHaveValue("17480");
  },
);

test(
  "source conflicts recover with current prices while preserving user input",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const state = await setup(
      page,
      (r) => {
        r.details.lots[0]!.quantityDetails = {
          status: "estimated",
          derivation: "Synthetic net allocation divided by entry price",
          evidence: "Synthetic subscription",
          shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
        };
        r.details.valuation!.records[0]!.shareBasis = {
          key: "issuer-original",
          unitsPerOriginal: 1,
        };
      },
      [],
      "Common",
    );
    await page.getByRole("button", { name: "Edit valuation" }).click();
    await select(page, "Source", "Tokenfolio · Other SPV");
    const save = page.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    await select(
      page,
      "Different share class",
      "Use as an indicative cross-class proxy",
    );
    await expect(save).toBeEnabled();
    state.reject(true);
    state.refreshPrice();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Reload sources" }),
    ).toBeVisible();
    state.reject(false);
    await page.getByRole("button", { name: "Reload sources" }).click();
    await page.getByRole("button", { name: "Use updated price" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Edit valuation", exact: true }),
    ).toBeVisible();
    expect(
      state
        .receipt()
        .details.valuation!.records.find((r) => r.origin === "proxy"),
    ).toMatchObject({
      priceMicros: 211_000_000,
      crossClassProxy: true,
      priceSourcePositionId: "another-spv",
    });
  },
);

test("custom quantity share bases save, reload and preserve equivalent proxy values", async ({
  page,
}) => {
  const state = await setup(page, (r) => {
    r.details.lots[0]!.quantityDetails = {
      status: "estimated",
      derivation: "Synthetic allocation estimate",
      evidence: "Synthetic split notice",
      shareBasis: { key: "issuer-original", unitsPerOriginal: 1 },
    };
  });
  const basis = page.getByRole("textbox", {
    name: "Quantity share basis",
    exact: true,
  });
  const shares = page.getByRole("textbox", { name: "Shares", exact: true });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toBeVisible();
  for (const invalid of [
    "",
    "0",
    "-1",
    "1.5",
    "abc",
    "1e1",
    "0x5",
    "1000001",
  ]) {
    await basis.fill(invalid);
    await expect(basis).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    expect(state.receipt().id).toBe("receipt-1");
  }
  await basis.fill("");
  await expect(basis).toHaveValue("");
  await expect(save).toBeDisabled();
  await basis.fill("5");
  await shares.fill("422");
  await checkBasisKeyboardNavigation(page, {
    previous: page.getByRole("combobox", {
      name: "Quantity status",
      exact: true,
    }),
    basis,
    following: [
      page.getByRole("textbox", { name: "Quantity derivation", exact: true }),
      page.getByRole("textbox", { name: "Quantity evidence", exact: true }),
      page.getByRole("textbox", { name: "Purchase source", exact: true }),
      page.getByRole("button", { name: "Add acquisition", exact: true }),
      page.getByRole("textbox", { name: "Carry · %", exact: true }),
      page.getByRole("combobox", { name: "Carry gains above", exact: true }),
      save,
    ],
  });
  state.reject(true);
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "Investment could not be saved",
  );
  await expect(basis).toHaveValue("5");
  await expect(shares).toHaveValue("422");
  state.reject(false);
  state.pauseSave();
  await save.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(basis).toBeDisabled();
  state.resumeSave();
  await expect(
    page.getByRole("button", { name: "Edit investment" }),
  ).toBeVisible();
  expect(state.receipt().details.lots[0]!.quantityDetails).toMatchObject({
    status: "estimated",
    evidence: "Synthetic split notice",
    shareBasis: { key: "issuer-original", unitsPerOriginal: 5 },
  });
  expect(state.receipt().details.lots[0]!.remainingSharesMicros).toBe(
    422_000_000,
  );
  await page.reload();
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("5");
  await expect(
    page.getByRole("combobox", { name: "Quantity status", exact: true }),
  ).toContainText("Estimated shares");
  await basis.fill("10");
  await shares.fill("844");
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit investment" }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Edit investment" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("10");
  await expect(shares).toHaveValue("844");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await select(page, "Source", "Tokenfolio · Other SPV");
  const preview = page.getByRole("form", { name: "Edit valuation" });
  await expect(preview).toContainText("$17,724.00");
  await expect(preview).toContainText("Estimated shares");
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("group", {
      name: "Tokenfolio proxy remaining value · Before carry",
      exact: true,
    }),
  ).toContainText("$17,724.00");
});

test("custom price share bases save, reload and preserve equivalent valuations", async ({
  page,
}) => {
  const state = await setup(page, (r) => {
    r.details.lots[0]!.remainingSharesMicros = 422_000_000;
    r.details.lots[0]!.quantityDetails = {
      status: "estimated",
      derivation: "Synthetic allocation estimate",
      evidence: "Synthetic split notice",
      shareBasis: { key: "issuer-original", unitsPerOriginal: 5 },
    };
    r.details.valuation!.records[0]!.shareBasis = {
      key: "issuer-original",
      unitsPerOriginal: 1,
    };
    r.details.valuation!.records[0]!.totalMinor = null;
    r.details.valuation!.selected = {
      recordId: "gp",
      method: "shares",
      sharesKey: valuationSharesKey(r.details),
    };
  });
  const basis = page.getByRole("textbox", {
    name: "Price share basis",
    exact: true,
  });
  const price = page.getByRole("textbox", {
    name: "Share price · $",
    exact: true,
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  const summary = page.getByRole("group", {
    name: "Estimated remaining value · Before carry",
    exact: true,
  });
  await expect(summary).toContainText("$16,880.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toBeVisible();
  for (const invalid of ["0", "-1", "1.5", "abc", "1e1", "0x5", "1000001"]) {
    await basis.fill(invalid);
    await expect(basis).toHaveAttribute("aria-invalid", "true");
    await expect(save).toBeDisabled();
    expect(state.receipt().id).toBe("receipt-1");
  }
  await basis.fill("5");
  await price.fill("40");
  await checkBasisKeyboardNavigation(page, {
    previous: page.getByRole("textbox", { name: "Share class", exact: true }),
    basis,
    following: [
      page.getByRole("textbox", { name: "Source name", exact: true }),
      page.getByRole("textbox", { name: "Source link", exact: true }),
      save,
    ],
  });
  state.reject(true);
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "This source price changed",
  );
  await expect(basis).toHaveValue("5");
  await expect(price).toHaveValue("40");
  state.reject(false);
  await page
    .getByRole("button", { name: "Reload sources", exact: true })
    .click();
  await expect(save).toBeEnabled();
  state.pauseSave();
  await save.click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(basis).toBeDisabled();
  state.resumeSave();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  expect(state.receipt().details.valuation!.records[0]).toMatchObject({
    priceMicros: 40_000_000,
    shareBasis: { key: "issuer-original", unitsPerOriginal: 5 },
  });
  await page.reload();
  await expect(summary).toContainText("$16,880.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("5");
  await expect(price).toHaveValue("40");
  await basis.fill("10");
  await price.fill("20");
  await expect(page.locator(".holding-valuation-preview")).toContainText(
    "Estimated shares",
  );
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  await page.reload();
  await expect(summary).toContainText("$16,880.00");
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("10");
  await expect(price).toHaveValue("20");
  await page.getByRole("textbox", { name: "Position total · $" }).fill("16880");
  await basis.fill("");
  await save.click();
  await expect(
    page.getByRole("button", { name: "Edit valuation" }),
  ).toBeVisible();
  expect(state.receipt().details.valuation!.records[0]!.shareBasis).toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Source details", exact: true })
    .click();
  await expect(basis).toHaveValue("");
});
