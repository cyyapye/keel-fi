import { expect, test, type Locator, type Page } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  AcceptPositionLinkSchema,
  type PositionLinkReceipt,
} from "../packages/domain/src/position-links";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

test.use({ timezoneId: "UTC" });

async function captureInformationPopup(
  page: Page,
  popup: Locator,
  anchor: Locator,
  name: string,
) {
  await expect(popup.locator("..")).toHaveCSS("opacity", "1");
  const anchorTop = (await anchor.boundingBox())!.y;
  const geometry = await popup.evaluate((element, anchorTop) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element.parentElement!);
    return {
      viewport: innerWidth,
      pageWidth: document.documentElement.scrollWidth,
      left: rect.left,
      right: rect.right,
      gap: anchorTop - rect.bottom,
      width: rect.width,
      position: [
        "position",
        "left",
        "top",
        "right",
        "bottom",
        "transform",
        "width",
        "height",
      ]
        .map((name) => `${name}: ${style.getPropertyValue(name)} !important;`)
        .join(""),
    };
  }, anchorTop);
  expect(geometry.viewport).toBe(page.viewportSize()!.width);
  expect(geometry.pageWidth).toBe(geometry.viewport);
  expect(geometry.left).toBeGreaterThanOrEqual(12);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewport - 12);
  expect(Math.abs(geometry.gap - 8)).toBeLessThan(1);
  const frozenPosition = await page.addStyleTag({
    content: `
      [data-slot="info-tip-positioner"] { ${geometry.position} }
      [data-slot="info-tip"] {
        width: ${geometry.width}px !important;
        max-width: ${geometry.width}px !important;
      }
    `,
  });
  try {
    await expect(page).toHaveScreenshot(name, {
      animations: "disabled",
      fullPage: true,
    });
  } finally {
    await frozenPosition.evaluate((element) => {
      element.parentNode?.removeChild(element);
    });
  }
}

test(
  "review duplicate sources and replacement history with no typing, saved reload and failed-draft retention",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-09-20T12:00:00.000Z"));
    const links: PositionLinkReceipt[] = [];
    let reject = false,
      writes = 0;
    const records = [
      {
        id: "current",
        name: "Demo Orbit VII SPV",
        provider: "Sydecar",
        amount: 600000,
        value: null,
      },
      {
        id: "source",
        name: "Demo Orbit Aerospace source",
        provider: "Tokenfolio",
        amount: 520000,
        value: 1560000,
      },
      {
        id: "previous",
        name: "Demo Orbit V SPV",
        provider: "Sydecar",
        amount: 600000,
        value: null,
      },
    ].map((p) =>
      HoldingSchema.parse({
        id: p.id,
        companyId: "synthetic-orbit",
        positionName: p.name,
        exposureName: "Demo Orbit Aerospace",
        ownerLabel: "Demo Family LLC",
        positionKind: "spv_interest",
        administratorNavMinor: p.value,
        administratorNavState: p.value === null ? "not_set" : "reported",
        externalMarkMinor: null,
        underwritingValueMinor: null,
        scenarioValueMinor: null,
        usableLiquidityMinor: null,
        sourceStatus: "verified",
        sourceLabel: p.provider,
        effectiveDate: "2026-09-20",
        retrievedAt: "2026-09-20T12:00:00.000Z",
        confidencePpm: null,
        investedMinor: p.amount,
        committedMinor: p.amount,
        realizedValueMinor: 0,
        instrumentType: "SPV interest",
        positionValueContext: {
          snapshotId: `snapshot_${p.id}`,
          currency: "USD",
          providerValueState: p.value === null ? "not_reported" : "reported",
          providerValueMinor: p.value,
          acceptedAdjustment: null,
          projectedEstimate: null,
        },
      }),
    );
    const native = investmentHoldingsViewFor(
      records,
    ).positionView.connections.flatMap((c) =>
      c.containers.flatMap((c) => c.positions),
    );
    for (const position of native) position.ownerLabel = "Demo Family LLC";
    const visible = () =>
      records
        .filter(
          (p) =>
            !links.some(
              (l) => l.sourcePositionId === p.id && l.state === "linked",
            ),
        )
        .map((p) => ({
          ...p,
          linkedReportedValue:
            p.id === "current" &&
            links.some((l) => l.useSourceValue && l.state === "linked")
              ? {
                  reviewId: "synthetic-review",
                  sourcePositionId: "source",
                  snapshotId: "snapshot_source",
                  sourceLabel: "Tokenfolio",
                  observedAt: "2026-09-20T12:00:00.000Z",
                  state: "reported" as const,
                  minor: 1560000,
                }
              : null,
          administratorNavMinor:
            p.id === "current" &&
            links.some((l) => l.useSourceValue && l.state === "linked")
              ? 1560000
              : p.administratorNavMinor,
          administratorNavState:
            p.id === "current" &&
            links.some((l) => l.useSourceValue && l.state === "linked")
              ? ("reported" as const)
              : p.administratorNavState,
        }));
    await routeHoldingsPage(page, () => ({
      householdName: "Demo Household",
      holdings: visible(),
      investmentHoldings: investmentHoldingsViewFor(visible()),
      acceptedCashAccounts: [],
      pendingImports: [],
    }));
    await page.route("**/api/investment-position-links", async (route) => {
      if (route.request().method() === "GET")
        return route.fulfill({ json: { positions: native, links } });
      writes++;
      if (reject)
        return route.fulfill({
          status: 409,
          json: { error: "The records changed. Reload and review again." },
        });
      const input = AcceptPositionLinkSchema.parse(
        route.request().postDataJSON(),
      );
      const prior = links.findIndex(
        (l) => l.sourcePositionId === input.sourcePositionId,
      );
      const receipt = {
        ...input,
        companyName: null,
        formerCompanyName: null,
        id: crypto.randomUUID(),
        acceptedAt: "2026-09-20T12:00:00.000Z",
      };
      if (prior < 0) links.push(receipt);
      else links[prior] = receipt;
      return route.fulfill({ status: 201, json: receipt });
    });
    await page.goto("/");
    await navigateToScreen(page, true, "Holdings");
    await page
      .getByRole("button", { name: /Demo Orbit Aerospace \d position/ })
      .click();
    await page
      .getByRole("button", { name: "View Demo Orbit VII SPV holding details" })
      .click();
    await page
      .getByRole("button", { name: /^Ownership, sources & history/ })
      .click();
    const section = page.getByRole("region", {
      name: "Linked investment records",
    });
    await section
      .getByRole("button", { name: "Linked investment records" })
      .click();
    await section
      .getByRole("combobox", { name: /^(Source to link|Link another source)$/ })
      .click();
    const search = page.getByRole("combobox", {
      name: "Search investment or source",
    });
    await expect(search).toBeVisible();
    await expect(
      section.getByText("Find a record", { exact: true }),
    ).toHaveCount(0);
    await search.fill("missing record");
    await expect(
      page.getByText("No matching investment records."),
    ).toBeVisible();
    await search.fill("tokenfolio aerospace");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.locator(".search-select")).toHaveScreenshot(
      "position-link-search.png",
      {
        animations: "disabled",
        caret: "hide",
      },
    );
    await search.fill("");
    await page
      .getByRole("option", { name: /Demo Orbit Aerospace source/ })
      .click();
    await expect(
      section.getByRole("button", { name: "Apply link" }),
    ).toBeEnabled();
    await section
      .getByRole("combobox", { name: "Reported valuation to use" })
      .click();
    await page.getByRole("option", { name: /^Use Tokenfolio/ }).click();
    await expect(section.getByRole("checkbox")).toHaveCount(0);
    await expect(section.getByText("Other source ownership")).toBeVisible();
    await expect(
      section
        .locator(".position-link-comparison .data-list__item")
        .filter({ hasText: "Other source amount" }),
    ).toContainText("USD 5,200.00");
    await expect(section.locator(".position-link-comparison")).toHaveCSS(
      "row-gap",
      "32px",
    );
    const valuation = section.getByRole("combobox", {
      name: "Reported valuation to use",
    });
    await valuation.focus();
    await expect(valuation).toHaveCSS("border-bottom-width", "0px");
    await expect(section.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot("position-link-review.png", {
      animations: "disabled",
      fullPage: true,
    });
    reject = true;
    await section.getByRole("button", { name: "Apply link" }).click();
    await expect(section.getByText(/The records changed/)).toBeVisible();
    await expect(section.getByRole("checkbox")).toHaveCount(0);
    await expect(
      section.getByRole("combobox", { name: "Reported valuation to use" }),
    ).toContainText("Use Tokenfolio");
    reject = false;
    await section.getByRole("button", { name: "Apply link" }).click();
    await expect(section.getByText(/Supplies reported value/)).toBeVisible();
    for (const metadata of await section
      .locator(".position-link-record > p")
      .all()) {
      await expect(metadata).toHaveCSS("font-size", "13px");
      await expect(metadata).toHaveCSS("line-height", "19.5px");
    }
    await section
      .getByRole("combobox", { name: /^(Source to link|Link another source)$/ })
      .click();
    await page.getByRole("option", { name: /Demo Orbit V SPV/ }).click();
    await expect(
      section
        .locator(".position-link-comparison .data-list__item")
        .filter({ hasText: "Other source amount" }),
    ).toContainText("USD 6,000.00");
    await section.getByRole("combobox", { name: "Relationship" }).click();
    await page
      .getByRole("option", { name: "Earlier SPV replaced by this one" })
      .click();
    await expect(
      section.getByRole("combobox", { name: "Reported valuation to use" }),
    ).toHaveCount(0);
    await expect(section.getByRole("checkbox")).toHaveCount(0);
    await expect(section.getByRole("alert")).toHaveCount(0);
    await section.getByRole("button", { name: "Apply link" }).click();
    await expect(section.getByText(/Historical · replaced/)).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Demo Orbit Aerospace", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /^Ownership, sources & history/ })
      .click();
    await section
      .getByRole("button", { name: "Linked investment records" })
      .click();
    await expect(section.getByText(/Historical · replaced/)).toBeVisible();
    await expect(section.getByText(/Supplies reported value/)).toBeVisible();
    for (const trigger of await page
      .locator(
        '.holding-detail-workspace [data-slot="collapsible-trigger"]:visible',
      )
      .all()) {
      await expect(trigger).toHaveAttribute("data-layout", "inline");
      await expect(trigger).toHaveCSS("column-gap", "12px");
      await expect(trigger).toHaveCSS("justify-content", "flex-start");
      expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    await expect(section.getByRole("alert")).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot("position-links-saved.png", {
      animations: "disabled",
      fullPage: true,
    });
    const recordsInSection = section.locator(".position-link-record");
    const historicalRecord = recordsInSection.filter({
      hasText: "Demo Orbit V SPV",
    });
    const historicalInfo = historicalRecord.getByRole("button", {
      name: "About unlinking Demo Orbit V SPV",
      exact: true,
    });
    const writesBeforeInfo = writes;
    await historicalInfo.scrollIntoViewIfNeeded();
    await historicalInfo.tap();
    const popup = page.getByRole("dialog", {
      name: "About unlinking Demo Orbit V SPV",
      exact: true,
    });
    await expect(popup).toContainText("separate investment again");
    await expect(popup).toContainText(
      "Records and history are kept. You can link it again.",
    );
    await expect(section.getByText(/Historical · replaced/)).toBeVisible();
    expect(writes).toBe(writesBeforeInfo);
    expect((await historicalInfo.boundingBox())!.height).toBeGreaterThanOrEqual(
      44,
    );

    await page.addStyleTag({
      // The popup is portaled, so capture the page. Keep unrelated sticky chrome
      // out of this capture; its scroll position varies after keyboard focus.
      content:
        ".sidebar, .topbar, .mobile-nav { visibility: hidden !important; }",
    });
    await captureInformationPopup(
      page,
      popup,
      historicalInfo,
      "position-unlink-info.png",
    );
    // Keyboard access does not accept a decision; Escape returns focus to the icon.
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await historicalInfo.press("Enter");
    await expect(popup).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await expect(historicalInfo).toBeFocused();
    await historicalRecord
      .getByRole("button", { name: "Unlink record", exact: true })
      .click();
    await expect(section.getByText(/Historical · replaced/)).toHaveCount(0);
    expect(writes).toBe(writesBeforeInfo + 1);
    const disclosure = section.getByRole("button", {
      name: "Linked investment records",
      exact: true,
    });
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await expect(
      section.getByRole("combobox", {
        name: /^(Source to link|Link another source)$/,
      }),
    ).toHaveCount(0);
    await disclosure.click();
    await expect(section.getByText(/Supplies reported value/)).toBeVisible();
    await expect(
      section.getByText("Review history", { exact: true }),
    ).toHaveCount(0);
    const sourcedRecord = recordsInSection.filter({
      hasText: "Demo Orbit Aerospace source",
    });
    const sourcedInfo = sourcedRecord.getByRole("button", {
      name: "About unlinking Demo Orbit Aerospace source",
      exact: true,
    });
    await sourcedInfo.press("Space");
    const sourcedPopup = page.getByRole("dialog", {
      name: "About unlinking Demo Orbit Aerospace source",
      exact: true,
    });
    await expect(sourcedPopup).toContainText(
      "This link will stop supplying reported value.",
    );
    await expect(sourcedPopup).toContainText("Records and history are kept.");
    // An outside tap dismisses the supplementary explanation without a write.
    await section
      .getByRole("heading", { name: "Linked investment records", exact: true })
      .click();
    await expect(sourcedPopup).toHaveCount(0);
    expect(writes).toBe(writesBeforeInfo + 1);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  },
);
