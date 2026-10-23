import { positionLinkSuggestionFixture } from "../scripts/test-support/position-link-suggestion";
import { expect, test, type Page } from "@playwright/test";
import { HoldingSchema } from "../packages/domain/src/index";
import {
  AcceptPositionLinkSchema,
  type PositionLinkReceipt,
  type PositionLinkWorkspace,
} from "../packages/domain/src/position-links";
import { investmentHoldingsViewFor } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { navigateToScreen } from "./navigation";

test.use({ timezoneId: "UTC" });

test("review duplicate sources and replacement history with no typing, saved reload and failed-draft retention", async ({
  page,
}, info) => {
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
  await navigateToScreen(
    page,
    info.project.name === "mobile-chromium",
    "Holdings",
  );
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
  await expect(section.getByText("Find a record", { exact: true })).toHaveCount(
    0,
  );
  await search.fill("missing record");
  await expect(page.getByText("No matching investment records.")).toBeVisible();
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
    info.project.name === "mobile-chromium" ? "32px" : "40px",
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot("position-replacement-review.png", {
    animations: "disabled",
    fullPage: true,
  });
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
  if (info.project.name === "mobile-chromium") await historicalInfo.tap();
  else await historicalInfo.hover();
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
  await expect(page).toHaveScreenshot("position-unlink-info.png", {
    animations: "disabled",
    fullPage: true,
  });
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
  // Settle the anchor's viewport position before keyboard activation. Opening
  // during focus scrolling can leave different subpixel popup text rendering.
  await sourcedInfo.scrollIntoViewIfNeeded();
  await sourcedInfo.press("Space");
  const sourcedPopup = page.getByRole("dialog", {
    name: "About unlinking Demo Orbit Aerospace source",
    exact: true,
  });
  await expect(sourcedPopup).toContainText(
    "This link will stop supplying reported value.",
  );
  await expect(sourcedPopup).toContainText("Records and history are kept.");
  await expect(page).toHaveScreenshot("position-unlink-sourced-info.png", {
    animations: "disabled",
    fullPage: true,
  });
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
});

async function openHistoricalRenameReview(page: Page) {
  const { LegalEntityInventorySchema } =
    await import("../packages/domain/src/legal-entities");
  const { routeInvestmentReview } =
    await import("./investment-review-fixtures");
  await page.clock.setFixedTime(new Date("2026-09-20T12:00:00.000Z"));
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const style = document.createElement("style");
      style.textContent =
        ".topbar, .mobile-nav { visibility: hidden !important; }";
      document.head.appendChild(style);
    });
  });
  const { positions, availablePositions, unrelatedPositions } =
    positionLinkSuggestionFixture();
  const sources = positions.map((p) => ({
    source: { kind: "holding_position" as const, id: p.id },
    sourceDisplayName: p.reportedExposureName!,
    sourceLabel: p.source.label,
    sourceAsOf: p.source.effectiveDate,
    currentOwner: p.ownerLabel!,
    currentDecisionId: null,
    suggestedEntityType: "limited_partnership" as const,
    relationship: "investment_vehicle" as const,
    interestStatus: "historical" as const,
    financials: null,
    openedOn: p.openedOn,
    legalEntityNameEvidence: p.legalEntityNameEvidence,
  }));
  const inventory = LegalEntityInventorySchema.parse({
    version: 3,
    asOf: "2026-09-20T12:00:00.000Z",
    entities: [
      {
        id: "synthetic-existing-entity",
        versionId: "synthetic-existing-version",
        version: 1,
        recordedAt: "2026-09-01T12:00:00.000Z",
        legalName: "Synthetic Circuit SPV, LP",
        entityType: "limited_partnership",
        relationship: "investment_vehicle",
        currentOwner: "Synthetic Family LLC",
        jurisdiction: null,
        formedOn: null,
        einLastFour: null,
        ownershipInterestPpm: null,
        interestStatus: "historical",
        taxClassification: null,
        notes: null,
        sources: [],
      },
    ],
    candidates: sources,
    excludedCandidates: [],
    exactBatch: {
      revision: "a".repeat(64),
      sourceCount: 0,
      entityCount: 0,
      existingEntityCount: 0,
      newEntityCount: 0,
      llcEntityCount: 0,
      limitedPartnershipEntityCount: 0,
      remainingCandidateCount: 2,
    },
  });
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: inventory }),
  );
  for (const source of sources)
    await routeInvestmentReview(page, source, {
      snapshotId: positions.find((p) => p.id === source.source.id)!.snapshot.id,
      positionKind: "spv_interest",
      committedMinor: 310000,
      fundedMinor: 310000,
    });
  let returnedPositions: PositionLinkWorkspace["positions"] = [
    ...availablePositions,
    ...unrelatedPositions,
  ];
  let links: PositionLinkReceipt[] = [];
  const history: PositionLinkReceipt[] = [];
  let reject = false;
  await page.route("**/api/investment-positions/*/history", (route) =>
    route.fulfill({
      json: {
        entries: history.map((receipt) => ({
          kind: "link",
          receipt,
          sourceLabel: positions.find((p) => p.id === receipt.sourcePositionId)!
            .legalVehicleName,
          targetLabel: positions.find((p) => p.id === receipt.targetPositionId)!
            .legalVehicleName,
        })),
        next: null,
      },
    }),
  );
  await page.route("**/api/investment-position-links", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          positions: returnedPositions,
          links,
          history,
        },
      });
    if (reject)
      return route.fulfill({
        status: 409,
        json: { error: "Source terms changed. Reload and review again." },
      });
    const input = AcceptPositionLinkSchema.parse(
      route.request().postDataJSON(),
    );
    const receipt = {
      ...input,
      id: crypto.randomUUID(),
      acceptedAt: "2026-09-20T12:00:00.000Z",
      companyName: "Synthetic Circuit Works",
      formerCompanyName: "Synthetic Circuit Labs",
    };
    links = [receipt];
    history.unshift(receipt);
    return route.fulfill({ status: 201, json: receipt });
  });
  await page.goto("/holdings/entities");
  await page.getByRole("button", { name: /^Needs your review/u }).click();
  await page
    .getByRole("link", { name: "Same investment / company renamed" })
    .last()
    .click();
  const section = page.getByRole("region", {
    name: "Linked investment records",
  });
  return {
    section,
    availablePositions,
    unrelatedPositions,
    links: () => links,
    setPositions: (next: PositionLinkWorkspace["positions"]) => {
      returnedPositions = next;
    },
    reject: (value: boolean) => {
      reject = value;
    },
  };
}

test("reviews historical company rename from a pending card, keeps the existing identity and reverses without typing", async ({
  page,
}, info) => {
  const fixture = await openHistoricalRenameReview(page);
  const { section } = fixture;
  await expect(
    section.getByRole("combobox", { name: "Investment record to keep" }),
  ).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "Link existing entity" }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Existing legal entity" }),
  ).toContainText("Synthetic Circuit SPV, LP");
  await expect(
    section.getByRole("combobox", { name: "Investment record to keep" }),
  ).toContainText("Sep 1, 2026");
  await expect(
    section.getByRole("combobox", {
      name: /^(Source to link|Link another source)$/,
    }),
  ).toContainText("Sep 2, 2026");
  await expect(
    section.getByRole("combobox", { name: "Relationship" }),
  ).toContainText("company renamed");
  expect(fixture.links()).toHaveLength(0);
  const keep = section.getByRole("combobox", {
    name: "Investment record to keep",
  });
  const member = section.getByRole("combobox", {
    name: /^(Source to link|Link another source)$/,
  });
  await expect(
    section.getByText(/Participation kept: historical/),
  ).toBeVisible();
  await expect(
    section.getByText(/Management unknown · Carry unknown · Reviewed/),
  ).toBeVisible();
  await expect(
    section
      .locator(".data-list__item")
      .filter({ hasText: "Reviewed cash contribution kept" }),
  ).toContainText("USD 3,350.00");
  await expect(
    section.getByRole("combobox", { name: "Reported valuation to use" }),
  ).toHaveCount(0);
  await expect(
    section.getByText(/Carry 17.5%.*Source reported, not accepted/),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Apply link" }),
  ).toBeEnabled();
  await expect(section).toHaveScreenshot("historical-rename-review.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  fixture.reject(true);
  await section.getByRole("combobox", { name: "Relationship" }).click();
  await page
    .getByRole("option", {
      name: "Same investment, another source",
      exact: true,
    })
    .click();
  await section.getByRole("button", { name: "Apply link" }).click();
  await expect(section.getByRole("alert")).toContainText(
    "Source terms changed",
  );
  await section.getByRole("button", { name: "Reload records" }).click();
  await expect(keep).toContainText("Sep 1, 2026");
  await expect(member).toContainText("Sep 2, 2026");
  await expect(
    section.getByRole("combobox", { name: "Relationship" }),
  ).toContainText("Same investment, another source");
  await section.getByRole("combobox", { name: "Relationship" }).click();
  await page
    .getByRole("option", {
      name: "Same investment, company renamed",
      exact: true,
    })
    .click();
  fixture.reject(false);
  await section.getByRole("button", { name: "Apply link" }).click();
  await expect(
    section.getByText(
      "Synthetic Circuit Works (formerly Synthetic Circuit Labs)",
    ),
  ).toBeVisible();
  await page.reload();
  await expect(
    section.getByText(
      "Synthetic Circuit Works (formerly Synthetic Circuit Labs)",
    ),
  ).toBeVisible();
  await section.getByRole("button", { name: "Unlink record" }).click();
  await section.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    section.getByRole("button", { name: /^Unlinked ·/ }),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: /^Linked ·/ }),
  ).toBeVisible();
  await section.getByRole("button", { name: /^Unlinked ·/ }).click();
  await expect(section).toContainText(
    "Synthetic Circuit Labs → Synthetic Circuit Works",
  );
  await expect(section).toContainText("The source is separate again");
  await expect(section).toHaveScreenshot("historical-rename-history.png", {
    animations: "disabled",
  });
  expect(fixture.links()[0]?.state).toBe("unlinked");
  expect(fixture.links()[0]?.useSourceValue).toBe(false);
  expect(info.project.name).toMatch(/chromium/);
});

test("suggests a unique retained historical source without accepting missing account or company identity", async ({
  page,
}) => {
  const fixture = await openHistoricalRenameReview(page);
  const { section, availablePositions, unrelatedPositions } = fixture;
  const retained = {
    ...availablePositions[0]!,
    ownershipContainerId: "synthetic-history-container",
    sourceProvider: "angellist" as const,
    reviewedHistory: true,
    companyReview: null,
  };
  const current = {
    ...availablePositions[1]!,
    sourceProvider: "angellist" as const,
    reviewedHistory: false,
    companyReview: null,
  };
  fixture.setPositions([retained, current, ...unrelatedPositions]);
  await page.reload();
  const keep = section.getByRole("combobox", {
    name: "Investment record to keep",
  });
  const member = section.getByRole("combobox", {
    name: /^(Source to link|Link another source)$/,
  });
  await expect(keep).toContainText("Sep 2, 2026");
  await expect(member).toContainText("Sep 1, 2026");
  await expect(
    section.getByRole("combobox", { name: "Relationship" }),
  ).toContainText("company renamed");
  await expect(
    section.getByText(/This older source needs its provider account/),
  ).toBeVisible();
  await expect(
    section.getByRole("button", { name: "Apply link" }),
  ).toBeDisabled();
  expect(fixture.links()).toHaveLength(0);
  await expect(section).toHaveScreenshot("retained-rename-suggestion.png", {
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // The full identity matrix runs against suggestPositionLink directly.
  for (const mismatch of [{ sourceProvider: "sydecar" as const }]) {
    fixture.setPositions([
      { ...retained, ...mismatch },
      current,
      ...unrelatedPositions,
    ]);
    await page.reload();
    await expect(member).toContainText("Choose a source record");
  }
  fixture.setPositions([
    retained,
    { ...retained, id: "synthetic-ambiguous-history" },
    current,
    ...unrelatedPositions,
  ]);
  await page.reload();
  await expect(member).toContainText("Choose a source record");
  expect(fixture.links()).toHaveLength(0);
});

test("prefills only one exact investment pair and preserves manual choices across identity and ambiguity holdouts", async ({
  page,
}) => {
  const fixture = await openHistoricalRenameReview(page);
  const { section, availablePositions, unrelatedPositions } = fixture;
  const keep = section.getByRole("combobox", {
    name: "Investment record to keep",
  });
  const member = section.getByRole("combobox", {
    name: /^(Source to link|Link another source)$/,
  });
  // Retain incompatible and ambiguous UI wiring; domain tests own permutations.
  for (const mismatch of [
    { ownershipContainerId: "synthetic-other-account" },
  ]) {
    fixture.setPositions([
      { ...availablePositions[0]!, ...mismatch },
      availablePositions[1]!,
      ...unrelatedPositions,
    ]);
    await page.reload();
    await expect(member).toContainText("Choose a source record");
    await expect(
      section.getByRole("button", { name: "Apply link" }),
    ).toHaveCount(0);
  }
  fixture.setPositions([
    ...availablePositions,
    { ...availablePositions[0]!, id: "synthetic-third-match" },
    ...unrelatedPositions,
  ]);
  await page.reload();
  await expect(member).toContainText("Choose a source record");
  await expect(section.getByRole("button", { name: "Apply link" })).toHaveCount(
    0,
  );
  // Relationship and evidence priority matrices run in position-link-suggestion.test.ts.
  fixture.setPositions([...availablePositions, ...unrelatedPositions]);
  await page.reload();
  await expect(keep).toContainText("Sep 1, 2026");
  await expect(member).toContainText("Sep 2, 2026");
  expect(fixture.links()).toHaveLength(0);
  // An optional manual survivor choice remains editable and is never saved on open.
  await keep.click();
  await page.getByRole("option", { name: /Sep 2, 2026/ }).click();
  await expect(member).toContainText("Choose a source record");
  await keep.click();
  await page
    .getByRole("option", { name: /Sep 1, 2026/ })
    .first()
    .click();
  await expect(member).toContainText("Sep 2, 2026");
});
