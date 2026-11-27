import {
  adjustOverlappingCash,
  reviewUpdatedCash,
} from "./portfolio-baseline-parity";
import { join } from "node:path";
import { areas } from "./ui-catalogue/journey-spec";
import {
  clinicReport,
  financingReport,
  markReport,
} from "./ui-catalogue/watch-evidence-reports";
import { expectBurnPlanFollowUp } from "./observed-burn-journey";
import { expectSelectedFinancingReport } from "./watch-evidence-parity";
import { taskJourneys } from "./ui-catalogue/task-journey-spec";
import { fileURLToPath } from "node:url";
import type { Locator, Page, TestInfo } from "@playwright/test";
import { expect, test } from "./api-mocked-test";

if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1") {
  test(
    "captures blinded design-review variants and semantic holdouts",
    captureDesignVariants,
  );
}

async function captureDesignVariants(
  { page }: { page: Page },
  testInfo: TestInfo,
) {
  await page.goto("/ui/#forms");
  const actions = page.locator(".catalogue-example").filter({
    has: page.getByRole("heading", { name: "Buttons & links", exact: true }),
  });
  const disabled = actions.getByRole("button", {
    name: "Disabled",
    exact: true,
  });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS("opacity", "0.4");
  await actions.screenshot({
    path: testInfo.outputPath("controls-reference.png"),
    ...screenshotOptions,
  });
  const mutation = await page.addStyleTag({
    content: ".button:disabled { opacity: 1 !important; }",
  });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS("opacity", "1");
  await actions.screenshot({
    path: testInfo.outputPath("controls-variant.png"),
    ...screenshotOptions,
  });
  await mutation.evaluate((element) => {
    element.parentNode?.removeChild(element);
  });

  await page.goto("/ui/#display");
  const facts = page.locator(".catalogue-example").filter({
    has: page.getByRole("heading", {
      name: "Facts when labels add meaning",
      exact: true,
    }),
  });
  await facts.locator("dd").evaluateAll((values) => {
    for (const value of values) value.textContent = "Demo Cedar LLC";
  });
  await facts.locator(".catalogue-note").evaluate((element) => {
    element.textContent =
      "The accepted version confirms the existing legal name.";
  });
  await expect(facts.getByText("Demo Cedar LLC", { exact: true })).toHaveCount(
    2,
  );
  await facts.screenshot({
    path: testInfo.outputPath("equal-values-holdout.png"),
    ...screenshotOptions,
  });

  const reading = page.locator(".catalogue-example").filter({
    has: page.getByRole("heading", { name: "Reading view", exact: true }),
  });
  await reading.locator(".catalogue-reading-view").evaluate((element) => {
    element.innerHTML =
      '<h3>Demo Cedar investment</h3><p class="text-role text-role--primary">$24,000</p><p class="text-role text-role--body">Proxy estimate · before carry</p><p class="text-role text-role--supporting">Based on another vehicle’s reported share price, using this holding’s reviewed shares.</p>';
  });
  await reading.screenshot({
    path: testInfo.outputPath("estimate-holdout.png"),
    ...screenshotOptions,
  });
}
const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const,
  stylePath: fileURLToPath(
    new URL("./ui-catalogue/component-screenshot.css", import.meta.url),
  ),
};

// Ancillary reference links above a component shift its fractional crop origin.
// Their visible navigation remains covered by the separate Journey round trips.
async function isolateComponentReference(page: Page) {
  await page.addStyleTag({
    content:
      ".catalogue-example > .catalogue-journey-usage { display: none !important; }",
  });
}

test(
  "foundations distinguish selection from keyboard focus",
  { tag: "@desktop-only" },
  async ({ page }) => {
    await page.goto("/ui/#foundations");
    const tabs = page.getByRole("tablist", { name: "Foundation tabs" });
    const profile = tabs.getByRole("tab", { name: "Profile", exact: true });
    const history = tabs.getByRole("tab", { name: "History", exact: true });
    await profile.focus();
    await profile.press("ArrowRight");
    await expect(history).toBeFocused();
    await expect(history).toHaveAttribute("aria-selected", "false");
    await expect(profile).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("button", { name: /New components/, includeHidden: true }),
    ).toHaveCount(0);
    await expect(history).toHaveCSS("outline-style", "solid");
    await expect(history).toHaveCSS("box-shadow", "none");
    await expect(
      tabs.getByRole("tab", { name: "Unavailable", exact: true }),
    ).toBeDisabled();
    const example = page
      .locator(".catalogue-foundations > section")
      .filter({ has: tabs });
    await expect(example).toHaveScreenshot(
      "foundation-tab-states.png",
      screenshotOptions,
    );
    await history.press("Enter");
    await expect(history).toHaveAttribute("aria-selected", "true");
    await expect(
      example.getByRole("tabpanel", { name: "History", exact: true }),
    ).toContainText("Legal name updated");
  },
);

test(
  "choices preserve mixed selection, keyboard semantics and label targets",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.goto("/ui/#forms");
    await isolateComponentReference(page);
    const checkbox = page.getByRole("region", {
      name: "Checkbox",
      exact: true,
    });
    const all = checkbox.getByRole("checkbox", {
      name: "All available columns",
      exact: true,
    });
    await expect(all).toHaveAttribute("aria-checked", "mixed");
    await all.press("Space");
    await expect(checkbox.getByRole("status")).toHaveText("3 columns selected");
    await all.press("Space");
    await expect(checkbox.getByRole("alert")).toHaveText(
      "Choose at least one column.",
    );
    await expect(
      checkbox.getByRole("checkbox", { name: "Tax identifier", exact: true }),
    ).toBeDisabled();
    const target = checkbox.locator('[data-slot="checkbox-field"]').first();
    expect(
      await target.evaluate((el) => el.getBoundingClientRect().height),
    ).toBeGreaterThanOrEqual(44);
    const radio = page.getByRole("radio", {
      name: "Formation certificate",
      exact: true,
    });
    await radio.focus();
    await radio.press("ArrowDown");
    await expect(
      page.getByRole("radio", { name: "Subscription agreement", exact: true }),
    ).toBeChecked();
    await checkbox.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await expect(checkbox).toHaveScreenshot(
      "shared-checkbox-validation.png",
      screenshotOptions,
    );
  },
);

test(
  "form failures are borderless, concise and preserve the editable draft",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.clock.install();
    await page.goto("/ui/#forms");
    await isolateComponentReference(page);
    const refresh = page.getByRole("region", {
      name: "LoadingStatus & Spinner",
      exact: true,
    });
    await refresh.getByRole("button", { name: "Failed", exact: true }).click();
    await expect(refresh.getByRole("alert")).toHaveText(
      "Sources could not be refreshed.",
    );
    await expect(refresh.getByRole("alert")).toHaveCSS(
      "border-top-width",
      "0px",
    );
    await expect(refresh.locator(".record-item__heading p").first()).toHaveCSS(
      "margin-top",
      "8px",
    );
    await expect(refresh).toHaveScreenshot(
      "shared-soft-failure.png",
      screenshotOptions,
    );
    const form = page.getByRole("region", {
      name: "Field, validation & pending actions",
      exact: true,
    });
    const input = form.getByRole("textbox", {
      name: "Source name",
      exact: true,
    });
    await expect(input).toHaveAccessibleDescription(
      "Use the name printed on the document.",
    );
    await input.fill("Demo revised certificate");
    await form
      .getByRole("button", { name: "Save source name", exact: true })
      .click();
    await page.clock.fastForward(1000);
    await expect(form.getByRole("alert")).toHaveText(
      "The source name could not be saved.",
    );
    await expect(input).toHaveValue("Demo revised certificate");
    await expect(form).toHaveScreenshot(
      "shared-form-failure.png",
      screenshotOptions,
    );
    await form.getByRole("button", { name: "Retry save", exact: true }).click();
    await page.clock.fastForward(1000);
    await expect(form.getByRole("status")).toHaveText(
      "Source name saved in this preview.",
    );
    await expect(
      form.getByRole("button", { name: "Save source name", exact: true }),
    ).toBeDisabled();
    await input.fill("");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAccessibleDescription(
      "Use the name printed on the document. Enter a source name.",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await refresh.getByRole("button", { name: "Loading", exact: true }).click();
    await expect(refresh.getByRole("status")).toHaveText("Refreshing sources…");
    await expect(refresh.locator('[data-slot="spinner"]')).toHaveCSS(
      "animation-name",
      "none",
    );
  },
);

test(
  "manual collections retain rows on failure and expose a terminal state",
  { tag: "@desktop-only" },
  async ({ page }) => {
    await page.clock.install();
    await page.goto("/ui/#collection-loading");
    const collection = page.getByRole("region", {
      name: "CollectionFooter",
      exact: true,
    });
    await collection
      .getByRole("button", { name: "Load more records", exact: true })
      .click();
    await page.clock.fastForward(1000);
    await expect(collection.getByRole("alert")).toHaveText(
      "More records could not be loaded.",
    );
    await expect(collection.getByRole("listitem")).toHaveCount(3);
    await collection
      .getByRole("button", { name: "Try loading again", exact: true })
      .press("Enter");
    await page.clock.fastForward(1000);
    await expect(collection.getByRole("listitem")).toHaveCount(5);
    await expect(collection.locator('[data-record-index="3"]')).toBeFocused();
    await collection
      .getByRole("checkbox", { name: "Unknown total", exact: true })
      .check();
    await expect(collection.getByRole("status")).toHaveText(
      "Showing 5 records",
    );
    await collection
      .getByRole("button", { name: "Load more records", exact: true })
      .click();
    await page.clock.fastForward(1000);
    await expect(collection.getByRole("status")).toHaveText(
      "All 7 records shown",
    );
    await expect(
      collection.getByRole("button", {
        name: "Load more records",
        exact: true,
      }),
    ).toHaveCount(0);
  },
);

test(
  "automatic collections stop after failure and keep automatic appends from stealing focus",
  { tag: "@mobile-only" },
  async ({ page }) => {
    await page.goto("/ui/#collection-loading");
    const collection = page.getByRole("region", {
      name: "Automatically loaded records",
      exact: true,
    });
    await collection
      .locator('[data-slot="collection-footer"]')
      .scrollIntoViewIfNeeded();
    await expect(collection.getByRole("alert")).toHaveText(
      "More records could not be loaded.",
    );
    await page.clock.install();
    await page.clock.runFor(2000);
    await expect(collection.getByRole("listitem")).toHaveCount(5);
    await expect(
      collection.getByRole("button", {
        name: "Try loading again",
        exact: true,
      }),
    ).toBeEnabled();
    await collection
      .getByRole("button", { name: "Try loading again", exact: true })
      .press("Enter");
    await expect(
      collection.getByRole("button", { name: "Loading…", exact: true }),
    ).toBeDisabled();
    await page.clock.runFor(700);
    await expect(collection.getByRole("listitem")).toHaveCount(10);
    await expect(collection.locator('[data-record-index="5"]')).toBeFocused();
    await collection
      .locator('[data-slot="collection-footer"]')
      .scrollIntoViewIfNeeded();
    await page.clock.runFor(700);
    await expect(collection.getByRole("status")).toHaveText(
      "All 15 records shown",
    );
    await expect(collection.locator('[data-record-index="5"]')).toBeFocused();
    expect(
      await collection.evaluate((el) => el.nextElementSibling === null),
    ).toBe(true);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    ).toBe(true);
  },
);

test(
  "chart points expose values by pointer and keyboard",
  { tag: "@desktop-only" },
  async ({ page }) => {
    await page.goto("/ui/#display");
    await isolateComponentReference(page);
    const chart = page.getByLabel(
      "Synthetic reviewed document counts: July 3, August 5, September 8, October 10.",
    );
    const dots = chart.locator(".recharts-area-dot");
    await expect(dots).toHaveCount(4);
    await dots.nth(1).hover();
    const tooltip = chart.locator(".keel-chart-tooltip");
    await expect(tooltip).toContainText("Aug");
    await expect(tooltip).toContainText("Documents reviewed");
    await expect(tooltip).toContainText("5");
    await expect(chart).toHaveScreenshot(
      "shared-chart-point-tooltip.png",
      screenshotOptions,
    );
    await page.mouse.move(0, 0);
    const surface = chart.getByRole("application");
    await surface.focus();
    await surface.press("ArrowRight");
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toContainText("Documents reviewed");
  },
);

test("Journeys preserves company scope, lot uncertainty and component round trips", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/portfolio");
  await page
    .getByRole("link", { name: "View Northstar Robotics exposure" })
    .click();
  await page.getByRole("link", { name: "Open position", exact: true }).click();
  await page
    .getByRole("region", { name: "Synthetic screen preview" })
    .getByRole("link", { name: "Activity", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Source", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Source", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Capture date is not the trade date/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Account activity", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Tax lots", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Position activity", exact: true })
    .click();
  await page.getByRole("tab", { name: "Tax lots", exact: true }).click();
  await page.getByRole("combobox", { name: "Scenario", exact: true }).click();
  await page
    .getByRole("option", { name: "No reported lots", exact: true })
    .click();
  await expect(page.getByText(/does not mean zero holdings/)).toBeVisible();
  await page
    .getByRole("link", { name: "Back to holdings", exact: true })
    .click();
  await expect(
    page.getByText("$30K total · independent account positions"),
  ).toBeVisible();
  await page.getByRole("link", { name: "RecordGroup", exact: true }).click();
  await expect(page).toHaveURL(/#compositions\?component=RecordGroup/);
  await page
    .getByRole("link", { name: "Company exposure", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/#journeys\/company/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Journeys component references resolve to real examples and recover safely", async ({
  page,
}) => {
  const { steps, componentPage } = await import("./ui-catalogue/journey-spec");
  const names = [...new Set(steps.flatMap((step) => [...step.components]))];
  for (const name of names) {
    await page.goto(`/ui/#${componentPage(name)}?component=${name}`);
    const card = page
      .locator(`.catalogue-example[data-components~="${name}"]`)
      .first();
    await expect(card).toBeVisible();
    await expect(card).toBeFocused();
    const usage = card.locator(".catalogue-journey-usage");
    await expect(usage).toBeVisible();
    const reverse = usage.locator('a[href^="#journeys/"]').first();
    await expect(reverse).toBeVisible();
    const destination = await reverse.getAttribute("href");
    await reverse.click();
    expect(new URL(page.url()).hash).toBe(destination);
    await expect(
      page.getByRole("region", { name: "Synthetic screen preview" }),
    ).toBeVisible();
  }
  await page.goto("/ui/#journeys/unknown");
  await expect(
    page.getByRole("heading", { name: "Step not found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to Journeys" }).click();
  await expect(
    page.getByRole("heading", { name: "Browse by area" }),
  ).toBeVisible();
  await page.goto("/ui/#inventory");
  await expect(
    page.getByRole("heading", { name: "Component index", exact: true }),
  ).toBeVisible();
});

test("Journeys company position uses an accessible chevron", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/company");
  const link = page.getByRole("link", { name: "Open position", exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveText("");
  await expect(link.locator('svg[aria-hidden="true"]')).toBeVisible();
  const target = await link.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < 50; i++) {
    if (await link.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#journeys\/position/);
  await expect(page.getByText("Brokerage A · holding position")).toBeVisible();
});

test("Journeys portfolio exposure chevron preserves named keyboard navigation", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/portfolio");
  const link = page.getByRole("link", {
    name: "View Northstar Robotics exposure",
    exact: true,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveText("");
  await expect(link.locator('svg[aria-hidden="true"]')).toBeVisible();
  const target = await link.boundingBox();
  expect(target!.width).toBeGreaterThanOrEqual(44);
  expect(target!.height).toBeGreaterThanOrEqual(44);
  for (let i = 0; i < 50; i++) {
    if (await link.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#journeys\/company/);
  await expect(
    page.getByText("$30K total · independent account positions"),
  ).toBeVisible();
});

test("Journeys drill-in composition is an accessible navigation example", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "Drill into details",
    exact: true,
  });
  const link = card.getByRole("link", {
    name: "Open Northstar Robotics position details",
    exact: true,
  });
  await expect(link).toBeVisible();
  await expect(link).toHaveText("");
  for (let i = 0; i < 50; i++) {
    if (await link.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#journeys\/position/);
  await expect(page.getByText("Brokerage A · holding position")).toBeVisible();
  expect(await page.getByRole("link").allTextContents()).not.toEqual(
    expect.arrayContaining([expect.stringMatching(/→\s*$/)]),
  );
});

test("Journeys company amounts share a value column without a fake action", async ({
  page,
}) => {
  for (const width of [1053, 1440, 393]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ui/#journeys/company");
    const rows = page.locator(".catalogue-company-positions > .record-row");
    const first = rows.nth(0).locator(".record-row__value");
    const second = rows.nth(1).locator(".record-row__value");
    await expect(first).toHaveText("$20K");
    await expect(second).toHaveText("$10K");
    const a = (await first.boundingBox())!;
    const b = (await second.boundingBox())!;
    expect(Math.abs(a.x + a.width - b.x - b.width)).toBeLessThanOrEqual(1);
    await expect(rows.nth(1).getByText("Context only")).toBeVisible();
    await expect(rows.nth(1).locator("a,button,[tabindex]")).toHaveCount(0);
    await expect(
      rows.nth(0).getByRole("link", { name: "Open position", exact: true }),
    ).toBeVisible();
  }
});

test("Journeys navigation and reverse links remain legible at narrow widths", async ({
  page,
}) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/ui/#journeys/company");
    const nav = page.getByRole("navigation", { name: "Journey steps" });
    await expect(nav.locator('[aria-current="step"]')).toHaveCount(1);
    await expect(nav.locator('[aria-current="step"]')).toContainText(
      "Company exposure",
    );
    for (const link of await nav.getByRole("link").all())
      await expect(link).toBeVisible();
    for (const route of ["interactions", "forms", "compositions"]) {
      await page.goto(`/ui/#${route}`);
      for (const group of await page
        .locator(".catalogue-journey-usage")
        .all()) {
        const links = await group.getByRole("link").all();
        for (let i = 0; i < links.length; i++) {
          const a = (await links[i]!.boundingBox())!;
          expect(a.height).toBeGreaterThanOrEqual(44);
          if (i) {
            const b = (await links[i - 1]!.boundingBox())!;
            expect(a.y >= b.y + b.height - 1 || a.x >= b.x + b.width + 4).toBe(
              true,
            );
          }
        }
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
  }
});

test("catalogue import keeps native choice, validation and failed-save selection", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "Import table & file selection",
    exact: true,
  });
  await card.getByRole("button", { name: "Try other cases" }).click();
  await card
    .getByRole("button", { name: "Known failure", exact: true })
    .click();
  const input = card.locator('input[type="file"]');
  const chooser = page.waitForEvent("filechooser");
  for (let i = 0; i < 180; i++) {
    if (await input.evaluate((element) => element === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(input).toBeFocused();
  await page.keyboard.press("Enter");
  await (
    await chooser
  ).setFiles({
    name: "wrong.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("demo"),
  });
  await expect(
    card.getByText("Choose a CSV file no larger than 1 MB."),
  ).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  const name =
    "a-very-long-synthetic-brokerage-export-name-that-needs-to-wrap-on-mobile.csv";
  await input.setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from("synthetic"),
  });
  await expect(card.getByRole("status")).toContainText(name);
  await card.getByRole("button", { name: "Preview file", exact: true }).click();
  const selection = card.getByRole("checkbox", {
    name: "Include Northstar SPV I, LLC",
  });
  await expect(selection).toBeChecked();
  await card
    .getByRole("checkbox", { name: "Include Meridian SPV I, LLC", exact: true })
    .uncheck();
  await card
    .getByRole("button", { name: "Apply 1 update", exact: true })
    .click();
  await expect(
    card.getByText("Updates were not saved. Selections kept."),
  ).toBeVisible();
  await expect(selection).toBeChecked();
  await expect(card.getByRole("status")).toContainText(name);
  await expect(
    card.getByRole("checkbox", {
      name: "Include Meridian SPV I, LLC",
      exact: true,
    }),
  ).not.toBeChecked();
  await card
    .getByRole("button", { name: "Retry 1 update", exact: true })
    .click();
  await expect(
    card.getByText("Applied in preview", { exact: true }),
  ).toHaveCount(1);
  await expect(card.getByText("Left unchanged", { exact: true })).toHaveCount(
    1,
  );
  await input.setInputFiles({
    name: "large.csv",
    mimeType: "text/csv",
    buffer: Buffer.alloc(1000001),
  });
  await expect(
    card.getByText("Choose a CSV file no larger than 1 MB."),
  ).toBeVisible();
  await card
    .getByRole("button", { name: "Use sample CSV", exact: true })
    .click();
  await expect(card.getByRole("status")).toContainText(
    "keel-demo-entities.csv",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("catalogue record detail chevrons retain button behavior and return meaning", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "Alternating record rows",
    exact: true,
  });
  const button = card.getByRole("button", {
    name: "Details for Fidelity brokerage",
    exact: true,
  });
  await expect(button).toHaveText("");
  await expect(button.locator("svg")).toBeVisible();
  await expect(
    card.getByText("Percentages show total return.", { exact: false }),
  ).toBeVisible();
  const row = card
    .getByRole("listitem")
    .filter({ hasText: "Fidelity brokerage" });
  await expect(row.locator(".candidate-basis-return")).toContainText(
    "Basis $3.6K",
  );
  await expect(
    row.locator(".candidate-basis-return .visually-hidden"),
  ).toHaveText("+33% total return");
  await expect(
    row.locator('.candidate-basis-return [aria-hidden="true"]'),
  ).toHaveText("· +33%");
  for (let i = 0; i < 100; i++) {
    if (await button.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(card.getByRole("status")).toHaveText(
    "Fidelity brokerage selected",
  );
  await expect(button).toBeFocused();
  await card.getByRole("button", { name: "Unavailable", exact: true }).click();
  await expect(card.locator(".candidate-basis-return")).toHaveCount(2);
  expect(
    await card.locator(".candidate-basis-return").allTextContents(),
  ).toEqual(["Basis $20K", "Basis $15K"]);
});

test("catalogue history exposes source inline with its outer change", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "History, changes & source citations",
    exact: true,
  });
  const trigger = card.getByRole("button", { name: /Legal name corrected/ });
  await expect(
    card.getByText("Demo formation certificate · page 1", { exact: false }),
  ).not.toBeVisible();
  for (let i = 0; i < 160; i++) {
    if (await trigger.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("Previous", { exact: true })).toBeVisible();
  await expect(card.getByText("Accepted", { exact: true })).toBeVisible();
  await expect(card.locator("blockquote")).toContainText(
    "Northstar SPV I, LLC",
  );
  await expect(
    card.getByText("Demo formation certificate · page 1", { exact: false }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: /Source excerpt/ }),
  ).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await card
    .getByRole("button", { name: "Source unavailable", exact: true })
    .click();
  await expect(
    card.getByText(
      "The source excerpt is unavailable. The recorded change is retained.",
    ),
  ).toBeVisible();
  await expect(card.getByText("Accepted", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("catalogue exposure aggregate stays visible collapsed without averaging returns", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "Alternating record rows",
    exact: true,
  });
  const parent = card.locator(".catalogue-record-summary");
  await expect(parent).toContainText("Basis $7.6K");
  await expect(
    parent.locator('.candidate-parent-return [aria-hidden="true"]'),
  ).toHaveText("+32%");
  await parent.click();
  await expect(parent).toHaveAttribute("aria-expanded", "false");
  await expect(parent.getByText("Basis $7.6K", { exact: false })).toBeVisible();
  await expect(
    card.getByText("Fidelity brokerage", { exact: true }),
  ).not.toBeVisible();
  await page.keyboard.press("Enter");
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  await card.getByRole("button", { name: "Single", exact: true }).click();
  await expect(parent).toContainText("Basis $3.6K");
  await expect(
    parent.locator('.candidate-parent-return [aria-hidden="true"]'),
  ).toHaveText("+33%");
  await card.getByRole("button", { name: "Unavailable", exact: true }).click();
  await expect(parent).toContainText("Known value");
  await expect(parent).toContainText("Total basis $35K. Return unavailable.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("catalogue missing-value summary stays compact and explicit when collapsed", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "Alternating record rows",
    exact: true,
  });
  await card.getByRole("button", { name: "Unavailable", exact: true }).click();
  const parent = card.locator(".catalogue-record-summary");
  await expect(
    parent.locator('.candidate-parent-return [aria-hidden="true"]'),
  ).toHaveText("1 value missing · Basis $35K");
  await expect(parent).toContainText("Known value");
  await expect(parent).toContainText("Return unavailable.");
  await parent.click();
  await expect(parent).toHaveAttribute("aria-expanded", "false");
  await expect(parent.locator(".candidate-parent-return")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("Unavailable", { exact: true })).toHaveCount(2);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("catalogue inline details, source hierarchy and table alignment preserve behavior", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const records = page.getByRole("region", {
    name: "Record rows",
    exact: true,
  });
  const detail = records.getByRole("button", {
    name: "Details for Northstar SPV I, LLC",
    exact: true,
  });
  await expect(detail).toHaveText("");
  await expect(detail).toHaveAttribute("aria-expanded", "false");
  await detail.click();
  await expect(detail).toHaveAttribute("aria-expanded", "true");
  await expect(records.getByText("Formed May 14, 2024")).toBeVisible();
  const ein = records.locator(".catalogue-fact-values p").last();
  await expect(ein).toHaveText("EIN ending ••-•••4821");
  await expect(ein.locator('[aria-hidden="true"]')).toHaveText("••-•••");
  await expect(ein.locator(".visually-hidden")).toHaveText("EIN ending ");
  await expect(ein.getByRole("button")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(detail).toHaveAttribute("aria-expanded", "false");
  await expect(detail).toBeFocused();
  const history = page.getByRole("region", {
    name: "History, changes & source citations",
    exact: true,
  });
  await history.getByRole("button", { name: /Legal name corrected/ }).click();
  await expect(
    history.getByRole("heading", { name: "Source", exact: true }),
  ).toBeVisible();
  await history
    .getByRole("button", { name: "Source unavailable", exact: true })
    .click();
  await expect(
    history.getByRole("heading", { name: "Source", exact: true }),
  ).toBeVisible();
  await expect(
    history.getByText(
      "The source excerpt is unavailable. The recorded change is retained.",
    ),
  ).toBeVisible();
  const card = page.getByRole("region", {
    name: "Import table & file selection",
    exact: true,
  });
  await card
    .getByRole("button", { name: "Use sample CSV", exact: true })
    .click();
  await card.getByRole("button", { name: "Preview file", exact: true }).click();
  await expect(card.locator('td[data-label="Jurisdiction"]').first()).toHaveCSS(
    "vertical-align",
    "middle",
  );
  await card
    .getByRole("checkbox", { name: "Include Meridian SPV I, LLC", exact: true })
    .uncheck();
  await card
    .getByRole("checkbox", {
      name: "Include Northstar SPV I, LLC",
      exact: true,
    })
    .check();
  await card
    .getByRole("button", { name: "Apply 1 update", exact: true })
    .click();
  await expect(
    card.getByText("Applied in preview", { exact: true }),
  ).toBeVisible();
  await expect(card.locator('td[data-label="Decision"]').first()).toHaveCSS(
    "vertical-align",
    "middle",
  );
});

test("catalogue manual import defaults eligible only and resolves unknown attempts before reset", async ({
  page,
}) => {
  await page.addInitScript(() => {
    File.prototype.text = () =>
      Promise.reject(new Error("File contents must not be read"));
    File.prototype.arrayBuffer = () =>
      Promise.reject(new Error("File contents must not be read"));
  });
  await page.goto("/ui/#compositions");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const card = page.getByRole("region", {
    name: "Import table & file selection",
    exact: true,
  });
  const sample = card.getByRole("button", {
    name: "Use sample CSV",
    exact: true,
  });
  const preview = card.getByRole("button", {
    name: "Preview file",
    exact: true,
  });
  const reset = card.getByRole("button", { name: "Reset import", exact: true });
  const northstar = card.getByRole("checkbox", {
    name: "Include Northstar SPV I, LLC",
    exact: true,
  });
  const meridian = card.getByRole("checkbox", {
    name: "Include Meridian SPV I, LLC",
    exact: true,
  });
  await sample.click();
  await preview.click();
  await expect(northstar).toBeChecked();
  await expect(meridian).toBeChecked();
  const apply = card.getByRole("button", {
    name: "Apply 2 updates",
    exact: true,
  });
  await expect(apply).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    card.getByText("Applied in preview", { exact: true }),
  ).toHaveCount(2);
  await expect(card.getByRole("button", { name: /^Apply / })).toHaveCount(0);
  await expect(reset).toBeFocused();
  await card
    .getByRole("button", { name: "Try other cases", exact: true })
    .click();
  await card.getByRole("button", { name: "Mixed", exact: true }).click();
  await sample.click();
  await preview.click();
  await expect(northstar).toBeChecked();
  await expect(meridian).not.toBeChecked();
  await expect(meridian).toBeDisabled();
  await expect(
    card.getByText("Invalid · unchanged", { exact: true }),
  ).toBeVisible();
  await expect(card.getByText("No change", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Apply 1 update", exact: true }),
  ).toBeEnabled();
  await card
    .getByRole("button", { name: "Resolve identity", exact: true })
    .click();
  await expect(
    card.getByRole("button", { name: "Use confirmed DEMO-B", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(meridian).toBeChecked();
  await expect(apply).toBeFocused();
  await card.screenshot({
    path:
      ".keel-local/journeys/import-mixed-" +
      page.viewportSize()!.width +
      ".png",
  });
  await card
    .getByRole("button", { name: "Unknown outcome", exact: true })
    .click();
  await sample.click();
  await preview.click();
  await apply.click();
  const status = card.getByRole("button", {
    name: "Check status",
    exact: true,
  });
  await expect(status).toBeFocused();
  for (const control of [
    sample,
    preview,
    reset,
    card.locator('input[type="file"]'),
    northstar,
    meridian,
    card.getByRole("button", { name: "Ordinary", exact: true }),
  ])
    await expect(control).toBeDisabled();
  await expect(
    card.getByRole("button", { name: /^(Apply|Retry) / }),
  ).toHaveCount(0);
  await card.screenshot({
    path:
      ".keel-local/journeys/import-unknown-" +
      page.viewportSize()!.width +
      ".png",
  });
  await page.keyboard.press("Enter");
  await expect(
    card.getByText("Applied in preview", { exact: true }),
  ).toHaveCount(2);
  await expect(reset).toBeFocused();
  await expect(reset).toBeEnabled();
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Journey step hover stays unadorned and Activity source stays inline", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/portfolio");
  const step = page.locator(".catalogue-journey-navigation a").first();
  const initial = await step.evaluate((e) => ({
    padding: getComputedStyle(e).paddingInlineStart,
    x: e.firstElementChild!.getBoundingClientRect().x,
  }));
  expect(Number.parseFloat(initial.padding)).toBeGreaterThanOrEqual(8);
  await step.hover();
  expect(
    await step.evaluate((e) => e.firstElementChild!.getBoundingClientRect().x),
  ).toBe(initial.x);
  await expect(step).toHaveCSS("padding-inline-start", initial.padding);
  await expect(step).toHaveCSS("text-decoration-line", "none");
  await expect(step).toHaveAttribute("aria-current", "step");
  expect((await step.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await step.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(step).toBeFocused();
  expect(await step.evaluate((e) => getComputedStyle(e).outlineStyle)).not.toBe(
    "none",
  );
  await page.goto("/ui/#journeys/activity");
  const record = page
    .locator("article.record-item")
    .filter({ hasText: "Buy · Northstar Robotics" });
  const heading = record.getByRole("heading", { name: "Source", exact: true });
  await expect(heading).toBeVisible();
  await expect(record.getByRole("button")).toHaveCount(0);
  const evidence = record.getByText(/Fixture brokerage observation/);
  await expect(evidence).toBeVisible();
  expect(await heading.evaluate((e) => getComputedStyle(e).color)).not.toBe(
    await evidence.evaluate((e) => getComputedStyle(e).color),
  );
  await page
    .getByRole("button", { name: "Account activity", exact: true })
    .click();
  await expect(heading).toBeVisible();
  await expect(evidence).toBeVisible();
  await page
    .getByRole("button", { name: "Position activity", exact: true })
    .click();
  await expect(heading).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("App Access keeps scope, lifetime and failures distinct without authorizing", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/app-access-settings");
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  const demo = page.getByRole("region", { name: "App access walkthrough" });
  const controls = demo.getByRole("button", {
    name: "Prototype controls and source",
  });
  const choose = async (name: string) => {
    await controls.click();
    await demo.getByRole("button", { name, exact: true }).click();
    await controls.click();
  };
  const view = () =>
    demo.getByRole("button", { name: "View access", exact: true });
  await expect(
    demo.getByText("Demo analysis app", { exact: true }),
  ).toBeVisible();
  await expect(
    demo.getByText("Until disconnected", { exact: true }),
  ).toBeVisible();
  // Natural traversal must reach the native tab and scope disclosure.
  for (
    let i = 0;
    i < 30 && !(await view().evaluate((e) => e === document.activeElement));
    i++
  )
    await page.keyboard.press("Tab");
  await expect(view()).toBeFocused();
  await expect(view()).toBeInViewport();
  expect(
    await view().evaluate((e) => getComputedStyle(e).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(demo.getByText("Read only", { exact: true })).toHaveCount(4);
  await expect(
    demo.getByText("Full portfolio outlook and what-if previews are included."),
  ).toBeVisible();
  await choose("Limited scope");
  await view().click();
  await expect(demo.getByText("No access", { exact: true })).toHaveCount(2);
  await expect(
    demo.getByText(/Selected areas remain accessible/),
  ).toBeVisible();
  for (const [state, text] of [
    ["Loading", "Loading access…"],
    [
      "List unavailable",
      "Access could not be loaded. Existing connections may still have access.",
    ],
    ["Empty list", "No apps connected"],
  ] as const) {
    await choose(state);
    await expect(demo.getByText(text, { exact: true })).toBeVisible();
    await expect(view()).toHaveCount(0);
  }
  for (const state of ["Expired", "Disconnected"]) {
    await choose(state);
    await expect(demo.getByText(/No current access/)).toBeVisible();
    await view().click();
    await expect(
      demo.getByText(
        "Saved permissions below are inactive, not usable access.",
      ),
    ).toBeVisible();
    await expect(
      demo.getByText(
        "Full portfolio outlook and what-if previews are included.",
      ),
    ).toHaveCount(0);
  }
  await choose("Active");
  await demo.getByRole("tab", { name: "API keys", exact: true }).click();
  await expect(
    demo.getByText("Demo planning script", { exact: true }),
  ).toBeVisible();
  await expect(
    demo.getByText("Expires 16 February 2027", { exact: true }),
  ).toBeVisible();
  await view().click();
  await expect(demo.getByText("Manage goals", { exact: true })).toBeVisible();
  await expect(
    demo.getByText(/Financial records cannot be changed/),
  ).toBeVisible();
  await demo
    .getByRole("link", { name: "Access lifetime and key rotation" })
    .click();
  await expect(demo.getByRole("tab", { name: "API keys" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    demo.getByText(
      /Replacing a key keeps its permissions and original access expiry/,
    ),
  ).toBeVisible();
  await demo.getByRole("link", { name: "Back to app access" }).click();
  await demo.getByRole("tab", { name: "Connected apps" }).click();
  await demo
    .getByRole("link", { name: "Inspect a connection request" })
    .click();
  await expect(
    demo.getByText("Incoming request · Not connected"),
  ).toBeVisible();
  await expect(
    demo.getByText("Read only selected · Manage goals requested"),
  ).toBeVisible();
  await expect(demo.getByText("90 days", { exact: true })).toBeVisible();
  for (const state of ["Invalid request", "Request unavailable"]) {
    await choose(state);
    await expect(demo.getByText(/No access has been granted/)).toBeVisible();
    await expect(demo.getByText("90 days", { exact: true })).toHaveCount(0);
  }
  await demo.getByRole("link", { name: "Back to app access" }).click();
  await expect(
    demo.getByText("Demo analysis app", { exact: true }),
  ).toBeVisible();
  await expect(demo.locator("form, input, textarea, select")).toHaveCount(0);
  await expect(
    demo.getByRole("button", {
      name: /^(Allow access|Disconnect|Create key|Replace key|Copy|Cancel)$/,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "All journeys", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "What can a connected app access?",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/ui/#journeys/unknown-task");
  await expect(page.getByText("Step not found", { exact: true })).toBeVisible();
  await page
    .getByRole("link", { name: "Return to Journeys", exact: true })
    .click();
  expect(requests).toEqual([]);
});

test("every area inventory entry links to its associated independent journeys", async ({
  page,
}) => {
  for (const [id, title] of areas) {
    await page.goto("/ui/#journeys");
    const area = page.getByRole("region", {
      name: `${title} area`,
      exact: true,
    });
    const expected = taskJourneys
      .filter((journey) => journey.areas.includes(id))
      .map((journey) => journey.steps[0]!.id);
    if (id === "overview" || id === "holdings") expected.unshift("portfolio");
    if (id === "holdings") expected.push("closing-price", "holdings-total");
    if (id === "watch") expected.push("closing-price-watch");
    expect(expected.length).toBeGreaterThan(0);
    await expect(area.getByRole("link")).toHaveCount(expected.length);
    for (const step of expected) {
      const link = area.locator(`a[href="#journeys/${step}"]`);
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(new RegExp(`#journeys/${step}$`));
      await page
        .getByRole("link", { name: "All journeys", exact: true })
        .click();
    }
  }
});

test("step strips indicate current location without redundant status copy", async ({
  page,
}) => {
  for (const id of ["company", "planning-goal"]) {
    await page.goto(`/ui/#journeys/${id}`);
    const nav = page.getByRole("navigation", {
      name: "Journey steps",
      exact: true,
    });
    const current = nav.locator('[aria-current="step"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveCSS("font-weight", "600");
    await expect(nav.getByText("Current step", { exact: true })).toHaveCount(0);
    await current.hover();
    await expect(current).toHaveCSS("text-decoration-line", "none");
    expect((await current.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(
      parseFloat(
        await current.evaluate((e) => getComputedStyle(e).paddingInlineStart),
      ),
    ).toBeGreaterThanOrEqual(8);
    await current.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(current).toBeFocused();
    expect(
      await current.evaluate((e) => getComputedStyle(e).outlineStyle),
    ).not.toBe("none");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});

test("Collapsible reference keeps source inline and disabled state intact", async ({
  page,
}) => {
  await page.goto("/ui/#interactions");
  const card = page.locator("section.catalogue-example").filter({
    has: page.getByRole("heading", { name: "Collapsible", exact: true }),
  });
  const outer = card.getByRole("button", {
    name: "Sources & history",
    exact: true,
  });
  await outer.focus();
  await page.keyboard.press("Enter");
  await expect(
    card.getByRole("heading", { name: "Source", exact: true }),
  ).toBeVisible();
  await expect(
    card.getByText("Demo formation certificate · May 14, 2024", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Source details", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Space");
  await expect(outer).toHaveAttribute("aria-expanded", "false");
  await expect(outer).toBeFocused();
  await expect(
    card.getByRole("button", { name: "Unavailable while saving", exact: true }),
  ).toBeDisabled();
});

test("actionable position row has one native full-row detail target", async ({
  page,
}) => {
  await page.goto("/ui/#compositions");
  const card = page.getByRole("region", {
    name: "Alternating record rows",
    exact: true,
  });
  const row = card.locator("article.record-row").first();
  const button = row.getByRole("button", {
    name: "Details for Fidelity brokerage",
    exact: true,
  });
  await expect(row.locator("button, a, input, [tabindex]")).toHaveCount(1);
  await button.evaluate((e) => {
    e.dataset.activationCount = "0";
    e.addEventListener("click", () => {
      e.dataset.activationCount = String(Number(e.dataset.activationCount) + 1);
    });
  });
  await row.scrollIntoViewIfNeeded();
  for (const [x, y] of [
    [0.1, 0.2],
    [0.5, 0.5],
    [0.8, 0.3],
    [0.95, 0.5],
  ]) {
    const box = (await row.boundingBox())!;
    await page.mouse.click(box.x + box.width * x!, box.y + box.height * y!);
  }
  await button.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("data-activation-count", "6");
  await expect(card.getByRole("status")).toHaveText(
    "Fidelity brokerage selected",
  );
  await expect(button).toBeFocused();
  await expect(button.locator("svg")).toHaveAttribute("aria-hidden", "true");
  await expect(row.getByText("Basis $3.6K", { exact: true })).toBeVisible();
  const parent = card.locator(".catalogue-record-summary");
  await parent.click();
  await expect(parent).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(parent).toHaveAttribute("aria-expanded", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("equivalent single-destination rows retain native links and context-only exclusions", async ({
  page,
}) => {
  const cases = [
    {
      route: "portfolio",
      selector: ".catalogue-drill-in-row",
      target: "company",
    },
    {
      route: "company",
      selector: ".catalogue-company-positions .record-row:first-child",
      target: "position",
    },
    {
      route: "composition",
      selector: ".catalogue-drill-in-row",
      target: "position",
    },
  ];
  for (const item of cases) {
    const url =
      item.route === "composition"
        ? "/ui/#compositions"
        : `/ui/#journeys/${item.route}`;
    for (const [x, y] of [
      [0.1, 0.2],
      [0.5, 0.5],
      [0.8, 0.7],
      [0.95, 0.5],
    ]) {
      await page.goto(url);
      const row = page.locator(item.selector);
      await expect(row.locator("a,button,input,[tabindex]")).toHaveCount(1);
      await row.scrollIntoViewIfNeeded();
      const box = (await row.boundingBox())!;
      await page.mouse.click(box.x + box.width * x!, box.y + box.height * y!);
      await expect(page).toHaveURL(new RegExp(`#journeys/${item.target}$`));
    }
    await page.goto(url);
    const link = page.locator(item.selector).getByRole("link");
    await link.focus();
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`#journeys/${item.target}$`));
  }
  await page.goto("/ui/#journeys/company");
  const context = page
    .locator(".catalogue-company-positions .record-row")
    .last();
  await expect(context).toContainText("Context only");
  await expect(context.locator("a,button,[tabindex]")).toHaveCount(0);
  await expect(
    page.locator('.catalogue-journey-navigation [aria-current="step"]'),
  ).toContainText("Company exposure");
});

test("planning simulation requires a note, preserves retry and receipt, and never auto-navigates or writes", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/ui/#journeys/planning-history");
  await expect(
    page.getByText("Version 1 · baseline", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Application navigation", exact: true })
    .getByRole("link", { name: "Overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Edit goal", exact: true }).click();
  const save = page.getByRole("button", {
    name: "Save new version",
    exact: true,
  });
  await save.click();
  await expect(
    page.getByText("Enter a goal name and describe what changed.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("Goal name", { exact: true }).fill("Demo updated goal");
  await page
    .getByLabel("What changed", { exact: true })
    .fill("Synthetic rename");
  await page
    .getByText("Scope, source & demo controls", { exact: true })
    .click();
  await page.getByRole("button", { name: "Fail next goal save: off" }).click();
  await save.click();
  await expect(
    page.getByText("The goal could not be saved. Your draft is kept.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("What changed", { exact: true })).toHaveValue(
    "Synthetic rename",
  );
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Saved as version 2 with a matching forecast snapshot.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/planning-goal$/);
  await page.getByLabel("What changed", { exact: true }).fill("Unsaved draft");
  const navigation = page.getByRole("navigation", {
    name: "Application navigation",
    exact: true,
  });
  await navigation
    .getByRole("link", { name: "Scenarios", exact: true })
    .click();
  await expect(page.getByText("Demo base case", { exact: true })).toBeVisible();
  await navigation
    .getByRole("link", { name: "Forecast History", exact: true })
    .click();
  await expect(
    page.getByText("Synthetic rename", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Unsaved draft", { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/planning-scenario$/);
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("journeys lead the landing with secondary area lookup and consistent return links", async ({
  page,
}) => {
  await page.goto("/ui/#journeys");
  const titles = await page.getByRole("heading").allTextContents();
  const areaIndex = titles.indexOf("Browse by area");
  expect(areaIndex).toBeGreaterThan(
    titles.indexOf("What do I own in this company?"),
  );
  for (const journey of taskJourneys)
    expect(areaIndex).toBeGreaterThan(titles.indexOf(journey.title));
  for (const route of ["company", "planning-overview"]) {
    await page.goto(`/ui/#journeys/${route}`);
    const back = page.getByRole("link", { name: "All journeys", exact: true });
    await back.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#journeys$/);
    await expect(
      page.getByRole("heading", { name: "Browse by area", exact: true }),
    ).toBeVisible();
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Planning target meter preserves measured runway, saved readback and scenario spacing", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/planning-goal");
  const target = page.getByLabel("Target · optional", { exact: true });
  const meter = page.getByRole("meter");
  await expect(meter).toHaveAttribute("aria-valuenow", "75");
  await target.fill("15");
  await expect(meter).toHaveAttribute("aria-valuenow", "60");
  await expect(meter).toHaveAttribute("aria-valuetext", "9 of 15 months");
  for (const value of ["", "0", "-1", "1.5", "9007199254740992"]) {
    await target.fill(value);
    await expect(meter).toHaveCount(0);
  }
  await target.fill("3");
  await expect(meter).toHaveAttribute("aria-valuenow", "100");
  await expect(meter).toHaveAttribute(
    "aria-valuetext",
    "9 of 3 months; target exceeded",
  );
  await target.fill("15");
  await page
    .getByLabel("How success is measured", { exact: true })
    .fill("Demo runway");
  await page.getByLabel("What changed", { exact: true }).fill("Raise target");
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(
    page.getByText("Saved as version 2 with a matching forecast snapshot.", {
      exact: true,
    }),
  ).toBeVisible();
  await target.fill("20");
  const nav = page.getByRole("navigation", {
    name: "Application navigation",
    exact: true,
  });
  await nav.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(meter).toHaveAttribute("aria-valuenow", "60");
  await nav
    .getByRole("link", { name: "Forecast History", exact: true })
    .click();
  await expect(
    page.getByText(
      /Demo runway · Target: 15 months · Measured runway: 9 months/,
    ),
  ).toBeVisible();
  await nav.getByRole("link", { name: "Scenarios", exact: true }).click();
  await expect(page.getByText("Liquidity", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Current saved forecast output", { exact: true }),
  ).toHaveCount(0);
  const note = page.getByText(
    "No scenario changes or saves in this walkthrough.",
    { exact: true },
  );
  const metrics = page.locator(".planning-scenario-metrics");
  const bounds = await metrics.boundingBox(),
    next = await note.boundingBox();
  expect(next!.y - (bounds!.y + bounds!.height)).toBeGreaterThanOrEqual(24);
});

test("accepted source journey explains value reuse and preserves a selected alternative", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/source-updates-sources");
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") mutations.push(request.url());
  });
  const open = page.getByRole("link", {
    name: "View value outcome for Demo Cedar Fund",
    exact: true,
  });
  const sourceRow = page.locator(
    ".source-update-outcome .catalogue-drill-in-row",
  );
  const rowBox = (await sourceRow.boundingBox())!;
  const linkBox = (await open.boundingBox())!;
  const indicatorBox = (await open
    .locator('[data-slot="disclosure-indicator"]')
    .boundingBox())!;
  expect(indicatorBox.x).toBeGreaterThan(rowBox.x + rowBox.width / 2);
  expect(Math.abs(linkBox.x - rowBox.x)).toBeLessThanOrEqual(1);
  expect(linkBox.width).toBeGreaterThanOrEqual(rowBox.width - 1);
  expect(linkBox.height).toBeGreaterThanOrEqual(44);
  await open.focus();
  await page.keyboard.press("Enter");
  const outcome = page.getByRole("region", {
    name: "Accepted source value outcome",
  });
  await expect(outcome).toBeFocused();
  await expect(outcome.getByText("$26,000", { exact: true })).toBeVisible();
  await expect(
    outcome.getByText("Updated automatically", { exact: true }),
  ).toBeVisible();
  await expect(
    outcome.getByText("GP-reported total · As of 15 November 2026", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(outcome.getByRole("button", { name: /^Apply/ })).toHaveCount(0);
  const details = outcome.getByRole("button", {
    name: "Report details",
    exact: true,
  });
  await details.focus();
  await page.keyboard.press("Enter");
  await expect(
    outcome.getByText("Latest source report", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(
    outcome.getByText("Latest source report", { exact: true }),
  ).not.toBeVisible();
  await outcome
    .getByRole("button", { name: "Prototype controls and source", exact: true })
    .click();
  for (const [label, value, title, asOf] of [
    [
      "Selected estimate",
      "$21,000",
      "Selected value unchanged",
      "10 November 2026",
    ],
    ["Missing amount", "$24,000", "Previous value retained", "1 November 2026"],
    ["Missing date", "$24,000", "Previous value retained", "1 November 2026"],
    ["Next report", "$28,000", "Updated automatically", "16 November 2026"],
  ] as const) {
    await outcome.getByRole("button", { name: label, exact: true }).click();
    await expect(outcome.getByText(value, { exact: true })).toBeVisible();
    await expect(outcome.getByText(title, { exact: true })).toBeVisible();
    await expect(outcome.getByText(new RegExp(`As of ${asOf}$`))).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await outcome
    .getByRole("link", { name: "Back to sources", exact: true })
    .click();
  await open.click();
  await expect(outcome.getByText("$28,000", { exact: true })).toBeVisible();
  await expect(
    outcome.getByText("Latest source report", { exact: true }),
  ).not.toBeVisible();
  await page.getByRole("link", { name: "All journeys", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Browse by area", exact: true }),
  ).toBeVisible();
  expect(mutations).toEqual([]);
});

test("Watch opens the selected report and offers decisions for its claim", async ({
  page,
}, testInfo) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      writes.push(request.url());
  });
  await page.goto("/ui/#journeys/evidence-watch");
  await expect(page.getByText("Shipped", { exact: true })).toBeVisible();
  const watch = page.getByRole("region", { name: "Watch updates" });
  const row = watch.getByRole("article", {
    name: financingReport.headline,
    exact: true,
  });
  const clinic = watch.getByRole("article", {
    name: clinicReport.headline,
    exact: true,
  });
  const capture = async (name: string, area: typeof row) => {
    if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS !== "1") return;
    await page.evaluate(() => document.fonts.ready);
    await area.screenshot({
      path: testInfo.outputPath("watch-" + name + ".png"),
      scale: "css",
      animations: "disabled",
      style: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
  };
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1") {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: testInfo.outputPath("watch-entry.png"),
      scale: "css",
      animations: "disabled",
    });
  }
  await capture("updates", watch);
  await expect(
    clinic.getByRole("button", { name: "Review decision" }),
  ).toHaveCount(0);
  await clinic.getByRole("button", { name: "Details", exact: true }).click();
  await clinic.getByRole("button", { name: "View evidence" }).click();
  const clinicCard = page.locator('[id="evidence-' + clinicReport.id + '"]');
  await expect(clinicCard).toBeFocused();
  await page.goBack();
  await row.getByRole("button", { name: "Mark read", exact: true }).click();
  await expect(row).toHaveCount(0);
  await watch
    .getByRole("button", { name: "Decisions (1)", exact: true })
    .click();
  await expect(
    row.getByRole("button", { name: "Mark unread", exact: true }),
  ).toBeVisible();
  await row
    .getByRole("button", { name: "Review decision", exact: true })
    .press("Enter");
  await expect(page).toHaveURL(
    new RegExp("#journeys/evidence-review/" + financingReport.id + "$"),
  );
  const selected = await expectSelectedFinancingReport(page);
  await page.reload();
  await expect(selected).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  if (testInfo.project.name === "mobile-chromium") {
    await expect
      .poll(() =>
        selected.evaluate((card) => {
          const bar = document.querySelector(".topbar");
          return (
            !!bar &&
            card.getBoundingClientRect().top >=
              bar.getBoundingClientRect().bottom
          );
        }),
      )
      .toBe(true);
  }
  await capture("financing", selected);
  const controls = page.getByRole("button", {
    name: "Capture controls and source",
  });
  await controls.click();
  await page.getByRole("button", { name: "Fail next review" }).click();
  await selected.getByRole("button", { name: "Scenario only" }).click();
  await expect(page.getByText("Evidence review returned 503.")).toBeVisible();
  await expect(
    selected.getByText("pending review", { exact: true }),
  ).toBeVisible();
  await selected.getByRole("button", { name: "Scenario only" }).click();
  const scenario = page.getByRole("region", {
    name: "Scenario workspace excerpt",
  });
  await expect(scenario.getByRole("status")).toContainText(
    financingReport.headline,
  );
  await expect(scenario.getByRole("status")).toContainText(
    "Holding impact not calculated.",
  );
  await capture("scenario", scenario);
  await page.reload();
  await expect(scenario.getByRole("status")).toHaveCount(0);
  await page.getByRole("link", { name: "Evidence Inbox", exact: true }).click();
  await expect(
    selected.getByText("scenario only", { exact: true }),
  ).toBeVisible();
  const mark = page.locator('[id="evidence-' + markReport.id + '"]');
  await mark.getByRole("button", { name: "Accept evidence" }).click();
  await expect(
    mark.getByText("Update External mark: $18,000.00 → $20,000.00"),
  ).toBeVisible();
  await capture("mapped-preview", mark);
  await mark.getByRole("button", { name: "Accept without applying" }).click();
  await mark.getByRole("button", { name: "Apply accepted evidence" }).click();
  await mark.getByRole("button", { name: "Confirm & apply" }).click();
  await expect(
    mark.getByText("Accepted and applied to External mark."),
  ).toBeVisible();
  await clinicCard.getByRole("button", { name: "Reject" }).click();
  await expect(clinicCard.getByText("rejected", { exact: true })).toBeVisible();
  await expect(
    selected.getByText("scenario only", { exact: true }),
  ).toBeVisible();
  await controls.click();
  await page.getByRole("button", { name: "Open unavailable report" }).click();
  await expect(
    page.getByText("This update is no longer available in the inbox."),
  ).toBeVisible();
  await expect(
    clinicCard.getByRole("heading", { name: clinicReport.headline }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Explore the Apply / Ignore proposal" })
    .click();
  await expect(page.getByText("Proposal", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Ignore", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("specialized task routes preserve their native context and separate legal-entity reference", async ({
  page,
}) => {
  for (const journey of taskJourneys.filter(
    (item) => item.id === "obligations",
  )) {
    for (const step of journey.steps) {
      await page.goto(`/ui/#journeys/${step.id}`);
      await expect(
        page.getByRole("heading", { name: journey.title, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Obligations",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "Inbox", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("tab", { name: "History", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Step not found", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page
        .getByRole("link", { name: "All journeys", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Browse by area", exact: true }),
      ).toBeVisible();
    }
  }
  await page.goto("/ui/#journeys/source-updates-sources");
  await page
    .getByRole("link", { name: "Legal entity context", exact: true })
    .click();
  const legal = taskJourneys
    .find((journey) => journey.id === "source-updates")!
    .steps.find((step) => step.id === "source-updates-entities")!;
  await expect(
    page.getByText(`Product route: ${legal.route}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(legal.context, { exact: true })).toBeVisible();
  await expect(page.getByText(legal.alternate, { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Previous step", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Accepted source value outcome" }),
  ).toBeVisible();
});

test("one exposure decision applies each close to both SPVs", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/closing-price");
  const company = page.getByRole("button", {
    name: /Cedar Robotics.*2 positions/,
  });
  await expect(
    page.getByRole("heading", { name: "Holdings", exact: true }),
  ).toBeVisible();
  await expect(company).toHaveAttribute("aria-expanded", "false");
  const companyBox = await company.boundingBox();
  const indicator = await company
    .locator(".exposure-group__indicator")
    .boundingBox();
  expect(indicator!.y).toBeGreaterThanOrEqual(companyBox!.y);
  expect(indicator!.y + indicator!.height).toBeLessThanOrEqual(
    companyBox!.y + companyBox!.height,
  );
  const review = page.getByRole("link", {
    name: /^Review valuation\b/,
  });
  await expect(company).toContainText("1 estimate");
  const approve = page.getByRole("button", {
    name: "Follow CDR for 2 positions",
  });
  const pendingReview = page.getByRole("link", {
    name: "Review valuation for Cedar Robotics",
    exact: true,
  });
  await expect(pendingReview).toBeVisible();
  const holdingsBounds = (await company.boundingBox())!;
  await pendingReview.hover();
  await expect(pendingReview).toHaveCSS("text-decoration-line", "none");
  await company.focus();
  await page.keyboard.press("Tab");
  await expect(pendingReview).toBeFocused();
  await expect(pendingReview).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Enter");
  await expect(approve).toBeVisible();
  await page.getByRole("link", { name: "Back to Holdings" }).click();
  await expect(company).toHaveAttribute("aria-expanded", "false");
  await expect(pendingReview).toBeVisible();
  await company.focus();
  await page.keyboard.press("Enter");
  const exposure = page.getByRole("region", { name: "Exposure valuation" });
  const grove = exposure.getByRole("listitem").filter({ hasText: "Grove SPV" });
  const summit = exposure
    .getByRole("listitem")
    .filter({ hasText: "Summit SPV" });
  await expect(approve).toBeHidden();
  for (const name of ["Grove SPV", "Summit SPV"]) {
    await exposure.getByRole("link", { name: `Open ${name}` }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(approve).toBeHidden();
    await page.goBack();
    await expect(company).toHaveAttribute("aria-expanded", "true");
  }
  await review.click();
  await expect(
    page.getByRole("heading", { name: "Valuation source" }),
  ).toBeFocused();
  await expect(exposure).toBeHidden();
  const security = page.getByText("CDR · Class A", { exact: true });
  await expect(security).toBeVisible();
  const affected = page.getByRole("table", { name: "Position values" });
  const tableBounds = (await affected.boundingBox())!;
  expect(tableBounds.x).toBeCloseTo(holdingsBounds.x, 0);
  expect(tableBounds.width).toBeCloseTo(holdingsBounds.width, 0);
  await expect(affected.getByRole("columnheader").nth(1)).toHaveText(
    "Current sources",
  );
  await expect(affected.getByRole("columnheader").last()).toContainText(
    "Estimated at close",
  );
  for (const [position, close] of [
    ["Grove SPV", "$5,000"],
    ["Summit SPV", "$2,700"],
  ] as const) {
    await expect(
      affected
        .getByRole("row", { name: new RegExp(position) })
        .getByRole("cell")
        .last(),
    ).toContainText(close);
  }
  const select = page.getByRole("combobox", { name: "Source for 2 positions" });
  const choose = async (name: string) => {
    await select.click();
    await page.getByRole("option", { name, exact: true }).click();
  };
  await expect(
    affected.getByRole("row", { name: /Summit SPV/u }),
  ).toContainText("Tracks the % change in CDR");
  await choose("Keep current sources");
  const keep = page.getByRole("button", {
    name: "Keep sources for 2 positions",
  });
  await keep.click();
  await expect(company).toBeFocused();
  await expect(pendingReview).toHaveCount(0);
  await company.click();
  await expect(review).toBeHidden();
  await company.click();
  await expect(grove).toContainText("$4,000");
  await expect(summit).toContainText("$2,700");
  const reopenReview = exposure.getByRole("link", {
    name: "Review valuation",
    exact: true,
  });
  await reopenReview.hover();
  await expect(reopenReview).toHaveCSS("text-decoration-line", "none");
  await reopenReview.click();
  await choose("Follow CDR closes");
  await approve.click();
  await expect(company).toHaveAttribute("aria-expanded", "true");
  await expect(grove).toContainText("$5,000");
  await expect(summit).toContainText("$2,700");
  await expect(company).toContainText("$7,700");
  await expect(exposure.getByText("$50/share · Jun 2, 2026")).toBeVisible();
  await expect(review).toBeHidden();
  await grove.getByRole("link").click();
  const valuation = page.getByRole("region", {
    name: "Valuation",
    exact: true,
  });
  const gpMark = valuation
    .getByRole("definition")
    .filter({ hasText: "Grove SPV" });
  const closingPrice = valuation
    .getByRole("definition")
    .filter({ hasText: "$50/share" });
  await expect(valuation).toContainText(
    "100 Class A shares at CDR’s closing price",
  );
  await expect(closingPrice).toContainText("Jun 2, 2026 · Demo Exchange");
  await expect(gpMark).toContainText("$40/share");
  await expect(gpMark).toContainText("May 29, 2026");
  await page.getByRole("button", { name: "Preview next GP mark" }).click();
  await expect(gpMark).toContainText("$42/share");
  await expect(gpMark).toContainText("Jun 3, 2026");
  await expect(closingPrice).toContainText("Jun 2, 2026");
  await expect(valuation).toContainText("$5,000");
  await page.getByRole("link", { name: "Back to Holdings" }).click();
  await expect(company).toContainText("$7,700");
  await expect(review).toBeHidden();
  await summit.getByRole("link").click();
  const gpEstimate = valuation
    .getByRole("definition")
    .filter({ hasText: "Summit SPV" });
  await expect(gpEstimate).toContainText("$2,700");
  await expect(gpEstimate).toContainText("May 29, 2026");
  await page.getByRole("link", { name: "Back to Holdings" }).click();
  await page.getByRole("button", { name: "Preview next trading day" }).click();
  await expect(grove).toContainText("$5,200");
  await expect(summit).toContainText("$2,808");
  await expect(company).toContainText("$8,008");
  await expect(exposure.getByText("$52/share · Jun 3, 2026")).toBeVisible();
  await expect(company).toContainText("2 estimates");
  await expect(approve).toBeHidden();
  await grove.getByRole("link").click();
  await expect(valuation).toContainText("$5,200");
  await expect(valuation).toContainText("$52/share");
  await expect(gpMark).toContainText("$42/share");
  await page.getByRole("link", { name: "Back to Holdings" }).click();
  const changeSource = exposure.getByRole("link", {
    name: "Change source for both Cedar Robotics positions",
    exact: true,
  });
  await changeSource.click();
  await expect(security).toBeVisible();
  await expect(affected.getByRole("columnheader").nth(1)).toContainText(
    "Estimated at close",
  );
  await expect(affected.getByRole("columnheader").last()).toHaveText(
    "Prior sources",
  );
  await expect(
    affected.getByRole("row", { name: /Total/ }).getByRole("cell"),
  ).toHaveText(["$8,008", "$6,700"]);
  await approve.click();
  await expect(company).toContainText("$8,008");
  await expect(exposure.getByText("$52/share · Jun 3, 2026")).toBeVisible();
  await expect(review).toHaveCount(0);
  await changeSource.click();
  await choose("Restore prior sources");
  await page
    .getByRole("button", { name: "Restore sources for 2 positions" })
    .click();
  await expect(company).toContainText("$6,700");
  await expect(company).toContainText("1 estimate");
  await expect(pendingReview).toHaveCount(0);
  await expect(
    exposure.getByRole("link", { name: "Review valuation", exact: true }),
  ).toBeVisible();
  await reopenReview.click();
  await choose("Follow CDR closes");
  await approve.click();
  await expect(summit).toContainText("$2,700");
  await expect(company).toContainText("$7,900");
});

test("an IPO filing is news and one Watch decision resolves both Holdings estimates", async ({
  page,
}) => {
  await page.goto("/ui/#journeys");
  await page.getByRole("link", { name: "Start from Portfolio Watch" }).click();
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const link = (name: string) => page.getByRole("link", { name, exact: true });
  const chip = link("Review valuation for Cedar Robotics");
  const company = page.getByRole("button", {
    name: /Cedar Robotics.*2 positions/,
  });
  const position = (name: string) =>
    page
      .getByRole("list", { name: "Positions in Cedar Robotics" })
      .getByRole("listitem")
      .filter({ hasText: name });
  await expect(button("Unread (1)")).toHaveAttribute("aria-pressed", "true");
  const filing = page.getByRole("article", {
    name: "Cedar Robotics files for an IPO",
  });
  const headline = filing.getByRole("link", {
    name: "Cedar Robotics files for an IPO",
  });
  const [source] = await Promise.all([
    page.waitForEvent("popup"),
    headline.click(),
  ]);
  await expect(source).toHaveTitle("Cedar Robotics · Sample Form S-1");
  await expect(
    source.getByText("Sample filing · Fictional company"),
  ).toBeVisible();
  await expect(
    source.getByRole("heading", { name: "Proposed offering" }),
  ).toBeVisible();
  await source.close();
  await expect(button("Unread (1)")).toHaveAttribute("aria-pressed", "true");
  await expect(button("Decisions (0)")).toBeVisible();
  await expect(link("View Holdings")).toHaveCount(0);
  await filing.getByRole("button", { name: "Mark read" }).click();
  await expect(button("Unread (0)")).toBeVisible();
  await button("All updates").click();
  await expect(headline).toBeVisible();
  await expect(link("View Holdings")).toHaveCount(0);
  await page.goto("/ui/#journeys/closing-price");
  await expect(company).toContainText("$6,700");
  await expect(chip).toHaveCount(0);
  await link("Portfolio Watch").click();
  await button("Preview first close").click();
  await expect(button("Decisions (1)")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("article", { name: "First public close" }),
  ).toContainText("Cedar Robotics closes at $50/share");
  await expect(link("View Holdings")).toHaveCount(0);
  await page.goto("/ui/#journeys/closing-price");
  await expect(company).toContainText("$6,700");
  await expect(chip).toBeVisible();
  await link("Portfolio Watch").click();
  await chip.click();
  await expect(link("Back to Decisions")).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Position values" })
      .locator("tbody")
      .getByRole("row"),
  ).toHaveCount(2);
  await button("Follow CDR for 2 positions").click();
  await expect(button("Decisions (0)")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByText("No decisions needed", { exact: true }),
  ).toBeVisible();
  await link("View Holdings").click();
  await expect(company).toContainText("$7,700");
  await expect(chip).toHaveCount(0);
  await expect(position("Grove SPV")).toContainText("$5,000");
  await expect(position("Summit SPV")).toContainText("$2,700");
  await expect(position("Grove SPV")).toContainText("Closing-price estimate");
  await expect(position("Summit SPV")).toContainText("Closing-price proxy");
  await page.reload();
  await expect(company).toContainText("$7,700");
  await expect(chip).toHaveCount(0);
  await button("Preview next trading day").click();
  await expect(position("Grove SPV")).toContainText("$5,200");
  await expect(position("Summit SPV")).toContainText("$2,808");
  await link("Portfolio Watch").click();
  await expect(button("Decisions (0)")).toBeVisible();
  await button("All updates").click();
  await expect(filing).toBeVisible();
  await expect(
    page.getByRole("article", { name: "First public close" }),
  ).toContainText("Both positions follow the close");
});

test("GP marks respect the source selected for each position", async ({
  page,
}) => {
  const company = page.getByRole("button", {
    name: /Cedar Robotics.*positions/,
  });
  const pending = page.getByRole("link", {
    name: "Review valuation for Cedar Robotics",
  });
  const position = (name: string) =>
    page
      .getByRole("list", { name: "Positions in Cedar Robotics" })
      .getByRole("listitem")
      .filter({ has: page.getByRole("link", { name: "Open " + name }) });
  const next = page.getByRole("button", { name: "Preview next GP mark" });
  await page.goto("/ui/#journeys/gp-separate");
  await company.click();
  await expect(pending).toHaveCount(0);
  await expect(position("Grove SPV")).toContainText("GP report · $40/share");
  await expect(position("Summit SPV")).toContainText("GP report · $45/share");
  for (const [scenario, expected] of [
    ["Followed GP mark", "$2.5K"],
    ["One-time GP proxy", "$2.4K"],
  ]) {
    await page.getByRole("combobox", { name: "Walkthrough scenario" }).click();
    await page.getByRole("option", { name: scenario!, exact: true }).click();
    await next.click();
    await expect(pending).toHaveCount(0);
    await expect(position("Grove SPV")).toContainText("$4K");
    await expect(position("Summit SPV")).toContainText(expected!);
  }
  await position("Summit SPV").getByRole("link").click();
  await page.getByRole("link", { name: "Edit valuation" }).click();
  await page
    .getByRole("button", { name: "Save source for Summit SPV" })
    .click();
  await expect(position("Summit SPV")).toContainText("$2.5K");
});

test("choosing a GP proxy through Holdings prices only the unvalued SPV", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/gp-choice");
  const review = page.getByRole("link", {
    name: "Review valuation for Cedar Robotics",
  });
  const company = page.getByRole("button", {
    name: /Cedar Robotics.*3 positions/,
  });
  await expect(company).toContainText("$6.7K");
  await expect(company).toContainText("2 of 3 positions valued");
  await expect(company).toContainText("Known value before carry");
  await review.click();
  const save = page.getByRole("button", { name: "Save source for Vale SPV" });
  await expect(save).toBeDisabled();
  await page.getByRole("link", { name: "Leave Vale unvalued" }).click();
  await expect(review).toHaveCount(0);
  const vale = page
    .getByRole("list", { name: "Positions in Cedar Robotics" })
    .getByRole("listitem")
    .filter({ hasText: "Vale SPV" })
    .filter({ has: page.getByRole("link", { name: "Open Vale SPV" }) });
  await expect(vale).toContainText("Value unavailable");
  await vale.getByRole("link").click();
  await page.getByRole("link", { name: "Edit valuation" }).click();
  const source = page.getByRole("combobox", { name: "Source", exact: true });
  await source.click();
  await page.getByRole("option", { name: /Summit SPV/ }).click();
  const preview = page
    .getByRole("status")
    .filter({ hasText: "Estimate before carry" });
  await expect(preview).toContainText("$900");
  await expect(preview).toContainText("20 shares × $45/share · May 29");
  await page.getByRole("button", { name: "Walkthrough controls" }).click();
  await page.getByRole("button", { name: "Preview a failed save" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText(
    "Couldn’t save the price source",
  );
  await expect(source).toContainText("Summit SPV");
  await save.click();
  await expect(vale).toContainText("$900");
  await expect(company).not.toContainText("2 of 3");
  await expect(company).not.toContainText("Known value");
  await page.getByRole("button", { name: "Preview next GP mark" }).click();
  await expect(vale).toContainText("$940");
  await expect(company).toContainText("$7.6K");
  await expect(review).toHaveCount(0);
  await vale.getByRole("link").click();
  await page.getByRole("link", { name: "Edit valuation" }).click();
  await source.click();
  await page.getByRole("option", { name: /Grove SPV/ }).click();
  await expect(preview).toContainText("$800");
  await expect(preview).toContainText("20 shares × $40/share · May 29");
  await save.click();
  await expect(vale).toContainText("$800");
  await expect(company).toContainText("$7.5K");
});

test("reconciles fund attribution and a missing position value independently", async ({
  page,
}, testInfo) => {
  await page.goto("/ui/#journeys");
  await page
    .getByRole("link", { name: "Reconcile holdings", exact: true })
    .first()
    .click();
  const journey = page.getByRole("region", { name: "Holdings total journey" });
  const total = journey.locator(".stat");
  const summary = (name: string) =>
    journey.getByRole("button", { name: new RegExp("^" + name + "\\b") });
  async function capture(state: string) {
    if (process.env.KEEL_CAPTURE_DESIGN_VARIANTS !== "1") return;
    await page.evaluate(() => document.fonts.ready);
    await expect(
      journey.locator("[data-starting-style], [data-ending-style]"),
    ).toHaveCount(0);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(state + ".png"),
      animations: "disabled",
      scale: "css",
    });
  }
  async function statement(label: string) {
    await journey
      .getByRole("combobox", { name: "Simulated fund statement" })
      .click();
    await page.getByRole("option", { name: label, exact: true }).click();
  }
  await expect(total).toContainText("Known total");
  await expect(total).toContainText("$950K");
  await expect(total).toContainText("4 exposures · 7 positions");
  await expect(summary("SYNF")).toContainText("$90K");
  await expect(summary("Harbor Health Systems")).toContainText("Outside total");
  await capture("initial");
  await summary("Beacon Robotics").click();
  await expect(
    journey.getByRole("list", { name: "Beacon Robotics positions" }),
  ).toContainText("Portfolio Watch estimate");
  await expect(summary("Beacon Robotics")).toContainText("$120K");
  await capture("single-company");
  await summary("Beacon Robotics").click();
  await statement("40% Cloud disclosed");
  await expect(summary("Cloud Basket")).toContainText("$36K");
  await expect(summary("SYNF")).toContainText("$54K");
  await expect(total).toContainText("$950K");
  await capture("partial");
  await statement("40% Cloud · 60% Infrastructure");
  await expect(summary("SYNF")).toHaveCount(0);
  await expect(summary("Infrastructure Basket")).toContainText("$54K");
  await expect(total).toContainText("$950K");
  await journey.getByRole("tab", { name: "Needs resolution (1)" }).click();
  const add = journey.getByRole("link", { name: "Add valuation" });
  await capture("resolution");
  await add.click();
  const picker = journey.getByRole("combobox", {
    name: "Simulated valuation evidence",
  });
  await expect(page).toHaveURL(/#journeys\/holdings-total-valuation$/u);
  await expect(total).toHaveCount(0);
  await expect(picker).toBeFocused();
  await journey.getByRole("button", { name: "Cancel" }).click();
  await expect(add).toBeFocused();
  await add.click();
  const change = journey.getByRole("link", {
    name: "Change valuation",
    exact: true,
  });
  for (const [evidence, button, expected, source] of [
    [
      "Reconciled capital statement",
      "Use $18,000.00 at cost",
      "$968K",
      "At cost · Net invested",
    ],
    ["GP statement", "Use $25,000.00 GP mark", "$975K", "GP mark"],
    ["GP write-off", "Use $0.00 GP mark", "$950K", "GP mark"],
  ] as const) {
    await picker.click();
    await page.getByRole("option", { name: evidence, exact: true }).click();
    if (evidence === "Reconciled capital statement") {
      await expect(
        journey.getByText(
          /Net invested is \$18,000\.00 after \$500\.00 in upfront fees and a \$1,500\.00 refund/,
        ),
      ).toBeVisible();
      await capture("cost-evidence");
    }
    await journey.getByRole("button", { name: button, exact: true }).click();
    await expect(change).toBeFocused();
    await expect(
      journey.getByRole("region", { name: "Valuation" }),
    ).toContainText(source);
    await journey.getByRole("link", { name: "Back to holdings" }).click();
    await expect(total.locator(".stat__label")).toHaveText("Total");
    await expect(total).toContainText(expected);
    await expect(summary("Harbor Health Systems")).toContainText(source);
    if (evidence === "Reconciled capital statement")
      await capture("cost-accepted");
    if (evidence === "GP write-off") {
      await expect(summary("Harbor Health Systems")).toContainText("$0");
      await capture("zero");
      await journey
        .getByRole("tab", { name: "Needs resolution", exact: true })
        .click();
      await expect(journey.getByText("All positions valued")).toBeVisible();
    } else {
      await expect(summary("Infrastructure Basket")).toContainText("$54K");
      await change.click();
      await expect(picker).toHaveText(evidence);
      await journey.getByRole("button", { name: "Cancel" }).click();
      await expect(change).toBeFocused();
      await expect(
        journey.getByRole("region", { name: "Valuation" }),
      ).toContainText(source);
      await change.click();
    }
  }
});

test("a bookmarked GP estimate review enters the same IPO decision and retries without losing its selection", async ({
  page,
}) => {
  await page.goto("/ui/#journeys/estimate-proxy-review");
  const selector = page.getByRole("combobox", {
    name: "Source for 2 positions",
  });
  await selector.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("option", { name: "Keep current sources" }).click();
  await page.getByRole("button", { name: "Walkthrough controls" }).click();
  await page.getByRole("button", { name: "Preview a failed save" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expect(page.getByRole("alert")).toContainText("Couldn’t save");
  await expect(selector).toContainText("Keep current sources");
  await page
    .getByRole("button", { name: "Keep sources for 2 positions" })
    .click();
  await expect(page).toHaveURL(/#journeys\/closing-price$/u);
  const scenario = page.getByRole("combobox", { name: "Walkthrough scenario" });
  await expect(scenario).toContainText("IPO listing");
  await scenario.click();
  await expect(page.getByRole("option", { name: /IPO/u })).toHaveCount(1);
  await page.getByRole("option", { name: "Different GP marks" }).click();
  await expect(scenario).toHaveText("Different GP marks");
});

test("Cash history keeps the account and visible page through a failed read", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  await page.goto("/ui/#journeys/cash-history");
  await expect(page.getByText("Shipped", { exact: true })).toBeVisible();
  const cash = page.locator(".cash-holdings");
  const savings = cash.getByRole("button", { name: /Robinhood.*Savings/ });
  const full = cash.getByRole("button", { name: "View full history" });
  const back = cash.getByRole("button", { name: "← Back to cash" });
  const retry = cash.getByRole("button", { name: "Try again" });
  const controls = page.getByRole("button", {
    name: "Capture controls and source",
  });
  const choose = async (name: string) => {
    await controls.click();
    await page.getByRole("combobox", { name: "History example" }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await controls.click();
  };
  const capture = async (state: string, area = cash) => {
    const out = process.env.KEEL_CASH_JOURNEY_REVIEW_DIR;
    if (!out) return;
    await page.evaluate(() => document.fonts.ready);
    if (state === "accounts")
      await page.screenshot({
        path: join(out, "entry-" + testInfo.project.name + ".png"),
        scale: "css",
        animations: "disabled",
      });
    await area.screenshot({
      style: ".topbar, .mobile-nav { visibility: hidden !important; }",
      path: join(out, state + "-" + testInfo.project.name + ".png"),
      animations: "disabled",
      scale: "css",
    });
  };
  await expect(savings).toBeVisible();
  await capture("accounts");
  if (process.env.KEEL_CASH_JOURNEY_REVIEW_DIR) {
    await controls.click();
    await capture(
      "controls",
      page.locator('[data-slot="collapsible"]').filter({ has: controls }),
    );
    await controls.click();
  }
  await choose("Older page fails once");
  await savings.press("Enter");
  await expect(cash.getByText("Latest 5 of 12 entries")).toBeVisible();
  await capture("recent");
  await full.press("Enter");
  await expect(back).toBeFocused();
  await expect(cash.getByText("1–10 of 12 entries")).toBeVisible();
  await expect(cash.getByText("$82,400.00", { exact: true })).toBeVisible();
  await capture("full");
  const older = cash.getByRole("button", { name: "Older", exact: true });
  await older.click();
  await expect(cash).toContainText(
    "Older entries could not be loaded. Showing 1–10 of 12 entries.",
  );
  await capture("failure");
  await retry.press("Enter");
  await expect(cash.getByText("11–12 of 12 entries")).toBeVisible();
  await expect(cash.getByText("First recorded balance")).toBeVisible();
  await expect(older).toBeDisabled();
  await back.press("Enter");
  await expect(full).toBeFocused();
  await savings.click();
  await cash.getByRole("button", { name: /Capital One.*Checking/ }).click();
  await expect(cash.getByText("First recorded balance")).toBeVisible();
  await expect(cash.getByText("Latest 5 of 12 entries")).toHaveCount(0);
  await choose("Recent history fails once");
  await savings.click();
  await expect(cash).toContainText("Balance history could not be loaded.");
  await retry.click();
  await expect(full).toBeFocused();
  await expect(cash.getByText("Latest 5 of 12 entries")).toBeVisible();
  await choose("No recorded history");
  await savings.click();
  await expect(cash.getByText("No recorded balance history.")).toBeVisible();
  await capture("empty");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(requests).toEqual([]);
});

test("Planning baseline refreshes routine changes and preserves the selected overlap decision on retry", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      requests.push(request.url());
  });
  const capture = async (state: string, area?: Locator) => {
    const out = process.env.KEEL_BASELINE_JOURNEY_REVIEW_DIR;
    if (!out) return;
    await page.evaluate(() => document.fonts.ready);
    await (area ?? page).screenshot({
      path: join(out, state + "-" + testInfo.project.name + ".png"),
      scale: "css",
      animations: "disabled",
    });
  };
  const controls = page.getByRole("button", {
    name: "Capture controls and source",
  });
  const choose = async (name: string) => {
    await controls.click();
    await page.getByRole("combobox", { name: "Baseline example" }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await controls.click();
  };
  const finished = page.getByText(/Capture result · The plan now uses/);
  await page.goto("/ui/#journeys/baseline-refresh");
  await expect(page.getByText("Shipped", { exact: true })).toBeVisible();
  await expect(finished).toContainText("$263,000.00");
  await expect(page.locator(".portfolio-baseline-review")).toHaveCount(0);
  await capture("routine");
  await choose("Refresh fails once");
  const retry = page.getByRole("button", { name: "Retry automatic update" });
  await expect(retry).toBeVisible();
  await capture("refresh-error", page.locator(".portfolio-baseline--error"));
  await retry.press("Enter");
  await expect(finished).toContainText("$263,000.00");

  await page
    .getByRole("link", { name: "Inspect a source that needs review" })
    .click();
  await expect(page).toHaveURL(/#journeys\/baseline-exceptions$/);
  const queue = page.getByRole("region", {
    name: /sources? needs? your decision/,
  });
  await expect(
    queue.getByRole("heading", { name: "2 sources need your decision" }),
  ).toBeVisible();
  await capture("queue", queue);
  await choose("Source changes during review");
  await adjustOverlappingCash(page);
  const selected = page.getByRole("region", { name: "Synthetic reserve cash" });
  await capture("cash", selected);
  const save = selected.getByRole("button", {
    name: "Include cash with this amount",
  });
  await save.click();
  await expect(selected).toContainText(
    "The portfolio or forecast changed. Review the latest baseline before confirming.",
  );
  await expect(
    selected.getByLabel("Cash held elsewhere", { exact: true }),
  ).toHaveValue("20,000.00");
  await capture("save-error", selected);
  await save.press("Enter");
  await expect(selected).toContainText(
    "Review the latest baseline before confirming.",
  );
  await reviewUpdatedCash(page);
  await save.click();
  await page.reload();
  await expect(
    queue.getByRole("heading", { name: "1 source needs your decision" }),
  ).toBeVisible();
  await expect(
    queue.getByRole("button", { name: "Review Synthetic reserve cash" }),
  ).toHaveCount(0);
  await queue
    .getByRole("button", { name: "Review Synthetic missing holding" })
    .click();
  await expect(
    page.getByText("$264,000.00 → $263,000.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Decide later" }).click();
  await expect(
    queue.getByRole("button", { name: "Review Synthetic missing holding" }),
  ).toBeVisible();

  await choose("Possible holding overlap");
  await queue
    .getByRole("button", { name: "Review Synthetic incoming holding" })
    .click();
  const holding = page.getByRole("region", {
    name: "Synthetic incoming holding",
  });
  await expect(holding).toContainText("same account or ownership scope");
  await expect(
    holding.getByText("$263,000.00 → $263,750.00", { exact: true }),
  ).toBeVisible();
  await capture("holding", holding);
  await holding
    .getByRole("button", { name: "Include as separate source" })
    .click();
  await queue
    .getByRole("button", { name: "Review Synthetic missing holding" })
    .click();
  await expect(
    page.getByText("$263,750.00 → $262,750.00", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Remove from plan" }).click();
  await expect(finished).toContainText("$262,750.00");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  expect(requests).toEqual([]);
});

test("Observed burn capture keeps draft, save and later reviewed drift distinct", async ({
  page,
}) => {
  const calls: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      calls.push(request.url());
  });
  await page.goto("/ui/#journeys/observed-burn");
  await expect(page.getByText("Shipped", { exact: true })).toBeVisible();
  await expectBurnPlanFollowUp(page, async () => {
    await page
      .getByRole("button", { name: "Continue capture to the later Overview" })
      .click();
    await expect(
      page.getByRole("region", { name: "Overview capture" }),
    ).toBeFocused();
  });
  await expect(
    page.getByRole("region", { name: "Scenarios capture" }),
  ).toBeFocused();
  expect(calls).toEqual([]);
});
