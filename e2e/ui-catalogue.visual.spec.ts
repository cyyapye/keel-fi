import { fileURLToPath } from "node:url";
import { expect, test } from "./api-mocked-test";
import { buildUiCatalogue } from "../scripts/ui-catalogue";

let html: string;
test.beforeAll(async () => {
  html = await buildUiCatalogue();
});
test.beforeEach(async ({ page }) => {
  await page.route("**/keel-ui-catalogue.html", (route) =>
    route.fulfill({ contentType: "text/html", body: html }),
  );
});

// Evaluation artifacts only: controlled negative and clean holdout variants
// live in browser tests and never change the catalogue or production library.
test("captures blinded design-review variants and semantic holdouts", async ({
  page,
}, testInfo) => {
  await page.goto("/keel-ui-catalogue.html#forms");
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

  await page.goto("/keel-ui-catalogue.html#display");
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
});
const screenshotOptions = {
  animations: "disabled" as const,
  caret: "hide" as const,
  stylePath: fileURLToPath(
    new URL("./ui-catalogue/component-screenshot.css", import.meta.url),
  ),
};

test("record groups keep identities, values and actions readable", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#compositions");
  const example = page.getByRole("region", {
    name: "Alternating record rows",
    exact: true,
  });
  const group = example.getByRole("list", { name: "Example positions" });
  await expect(group.getByRole("listitem")).toHaveCount(3);
  await expect(group).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  for (const [index, row] of (
    await group.getByRole("listitem").all()
  ).entries()) {
    await expect(row).toHaveCSS(
      "background-color",
      index % 2 === 0 ? "rgba(38, 34, 56, 0.06)" : "rgba(0, 0, 0, 0)",
    );
    await expect(row).toHaveCSS("border-top-width", "0px");
  }
  const details = example.getByRole("button", {
    name: "Details for Fidelity brokerage",
    exact: true,
  });
  await details.focus();
  await details.press("Enter");
  await expect(example.getByRole("status")).toHaveText(
    "Fidelity brokerage selected",
  );
  expect(
    await details.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await expect(group).toHaveScreenshot(
    "shared-quiet-record-group.png",
    screenshotOptions,
  );
  await example.getByRole("button", { name: "Single", exact: true }).click();
  await expect(group.getByRole("listitem")).toHaveCount(1);
  await expect(group.getByRole("listitem")).toHaveCSS(
    "background-color",
    "rgba(38, 34, 56, 0.06)",
  );
  await example
    .getByRole("button", { name: "Unavailable", exact: true })
    .click();
  await expect(example.getByText("Known value", { exact: true })).toBeVisible();
  await expect(group.getByText("Unavailable", { exact: true })).toBeVisible();
  await expect(group).toHaveScreenshot(
    "shared-quiet-record-group-unavailable.png",
    screenshotOptions,
  );
  const geometry = await group.evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width);
  const toggle = example.getByRole("button", {
    name: /Northstar Robotics 2 positions/,
  });
  await toggle.focus();
  await toggle.press("Enter");
  await expect(group).not.toBeVisible();
  await toggle.press("Enter");
  await expect(group).toBeVisible();
  await example.getByRole("button", { name: "Empty", exact: true }).click();
  await expect(
    example.getByText("No positions", { exact: true }),
  ).toBeVisible();
  await expect(group).toHaveCount(0);
});

test("foundations distinguish selection from keyboard focus", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#foundations");
  await expect(
    page.getByRole("button", { name: /New components/ }),
  ).toHaveCount(0);
  const tabs = page.getByRole("tablist", { name: "Foundation tabs" });
  const profile = tabs.getByRole("tab", { name: "Profile", exact: true });
  const history = tabs.getByRole("tab", { name: "History", exact: true });
  await profile.focus();
  await profile.press("ArrowRight");
  await expect(history).toBeFocused();
  await expect(history).toHaveAttribute("aria-selected", "false");
  await expect(profile).toHaveAttribute("aria-selected", "true");
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
});

test("quiet buttons keep action spacing and textareas use the filled surface", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#forms");
  const primary = page.getByRole("button", { name: "Primary", exact: true });
  const quiet = page.getByRole("button", { name: "Quiet", exact: true });
  const primaryPadding = await primary.evaluate(
    (el) => getComputedStyle(el).paddingInline,
  );
  await expect(quiet).toHaveCSS("padding-inline", primaryPadding);
  await expect(quiet).toHaveCSS("padding-left", "16px");
  const actions = page.locator(".catalogue-example").filter({ has: quiet });
  await expect(actions).toHaveScreenshot(
    "shared-action-spacing.png",
    screenshotOptions,
  );
  await primary.focus();
  await primary.press("Tab");
  const secondary = page.getByRole("button", {
    name: "Secondary",
    exact: true,
  });
  await expect(secondary).toBeFocused();
  await expect(secondary).toHaveCSS("outline-style", "solid");
  await expect(secondary).toHaveCSS("outline-width", "1px");
  await expect(secondary).toHaveCSS("box-shadow", "none");
  await expect(actions).toHaveScreenshot(
    "shared-keyboard-focus.png",
    screenshotOptions,
  );
  const notes = page.getByRole("textbox", { name: "Notes", exact: true });
  const filled = page.getByRole("textbox", { name: "Legal name", exact: true });
  const surface = await filled.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  await expect(notes).toHaveCSS("background-color", surface);
  await expect(notes).toHaveCSS("padding-left", "12px");
  await notes.fill("Synthetic revised subscription note.");
  const form = page.locator(".catalogue-example").filter({ has: notes });
  await expect(form).toHaveScreenshot(
    "shared-filled-textarea.png",
    screenshotOptions,
  );
  await page.getByRole("link", { name: "Browse inventory" }).click();
  await expect(
    page.getByRole("heading", { name: "Component index", exact: true }),
  ).toBeVisible();
  await page.goto("/keel-ui-catalogue.html#additions");
  await expect(
    page.getByRole("heading", { name: "Forms & actions", exact: true }),
  ).toBeVisible();
});

test("section navigation preserves the active panel when its container narrows", async ({
  page,
}, info) => {
  await page.goto("/keel-ui-catalogue.html#interactions");
  const example = page.locator(".catalogue-example").filter({
    has: page.getByRole("heading", {
      name: "Tabs on narrow screens",
      exact: true,
    }),
  });
  const tabs = example.getByRole("tablist", { name: "Record view" });
  const dropdown = example.getByRole("combobox", { name: "Record view" });
  if (info.project.name === "chromium") {
    await tabs
      .getByRole("tab", { name: "Source documents", exact: true })
      .click();
  } else {
    await dropdown.click();
    await page.getByRole("option", { name: /Source documents/ }).click();
  }
  await expect(
    example.getByRole("tabpanel", { name: /Source documents/ }),
  ).toContainText("Formation certificate");
  await example
    .getByRole("button", { name: "Narrow column", exact: true })
    .click();
  await expect(tabs).toBeHidden();
  await expect(dropdown).toBeVisible();
  await expect(dropdown).toContainText("Source documents");
  await dropdown.click();
  await page.getByRole("option", { name: /Change history/ }).click();
  await expect(
    example.getByRole("tabpanel", { name: /Change history/ }),
  ).toContainText("Legal name updated");
  const preview = example.locator(".catalogue-navigation-preview");
  await expect(preview).toHaveScreenshot(
    "shared-narrow-section-navigation.png",
    screenshotOptions,
  );
  await example
    .getByRole("button", { name: "Available width", exact: true })
    .click();
  await expect(
    example.getByRole("tabpanel", { name: /Change history/ }),
  ).toContainText("Legal name updated");
  if (info.project.name === "chromium") {
    await expect(
      tabs.getByRole("tab", { name: "Change history", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(dropdown).toBeHidden();
  }
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("shared controls expose disabled states and styled keyboard tabs", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#interactions");
  for (const name of [
    "Unavailable while saving",
    "Unavailable selection",
    "Unavailable company selection",
    "Unavailable date",
  ]) {
    const control = page.getByRole(
      name.includes("selection") ? "combobox" : "button",
      { name, exact: true },
    );
    await expect(control).toBeDisabled();
    await expect(control).toHaveCSS("opacity", "0.4");
  }
  const tabs = page.getByRole("tablist", { name: "Record sections" });
  const profile = tabs.getByRole("tab", { name: "Profile", exact: true });
  await profile.focus();
  await profile.press("ArrowRight");
  await expect(
    tabs.getByRole("tab", { name: "History", exact: true }),
  ).toBeFocused();
  await expect(
    tabs.getByRole("tab", { name: "Unavailable", exact: true }),
  ).toBeDisabled();
  expect(
    await profile.evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(44);
  await expect(tabs).toHaveScreenshot("shared-tabs.png", screenshotOptions);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("choices preserve mixed selection, keyboard semantics and label targets", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#forms");
  const checkbox = page.getByRole("region", { name: "Checkbox", exact: true });
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
});

test("form failures are borderless, concise and preserve the editable draft", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#forms");
  const refresh = page.getByRole("region", {
    name: "LoadingStatus & Spinner",
    exact: true,
  });
  await refresh.getByRole("button", { name: "Failed", exact: true }).click();
  await expect(refresh.getByRole("alert")).toHaveText(
    "Sources could not be refreshed.",
  );
  await expect(refresh.getByRole("alert")).toHaveCSS("border-top-width", "0px");
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
  const input = form.getByRole("textbox", { name: "Source name", exact: true });
  await expect(input).toHaveAccessibleDescription(
    "Use the name printed on the document.",
  );
  await input.fill("Demo revised certificate");
  await form
    .getByRole("button", { name: "Save source name", exact: true })
    .click();
  await expect(form.getByRole("alert")).toHaveText(
    "The source name could not be saved.",
  );
  await expect(input).toHaveValue("Demo revised certificate");
  await expect(form).toHaveScreenshot(
    "shared-form-failure.png",
    screenshotOptions,
  );
  await form.getByRole("button", { name: "Retry save", exact: true }).click();
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
});

test("manual collections retain rows on failure and expose a terminal state", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#collection-loading");
  const collection = page.getByRole("region", {
    name: "CollectionFooter",
    exact: true,
  });
  await collection
    .getByRole("button", { name: "Load more records", exact: true })
    .click();
  await expect(collection.getByRole("alert")).toHaveText(
    "More records could not be loaded.",
  );
  await expect(collection.getByRole("listitem")).toHaveCount(3);
  await collection
    .getByRole("button", { name: "Try loading again", exact: true })
    .press("Enter");
  await expect(collection.getByRole("listitem")).toHaveCount(5);
  await expect(collection.locator('[data-record-index="3"]')).toBeFocused();
  await collection
    .getByRole("checkbox", { name: "Unknown total", exact: true })
    .check();
  await expect(collection.getByRole("status")).toHaveText("Showing 5 records");
  await collection
    .getByRole("button", { name: "Load more records", exact: true })
    .click();
  await expect(collection.getByRole("status")).toHaveText(
    "All 7 records shown",
  );
  await expect(
    collection.getByRole("button", { name: "Load more records", exact: true }),
  ).toHaveCount(0);
});

test("automatic collections stop after failure and keep automatic appends from stealing focus", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#collection-loading");
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
    collection.getByRole("button", { name: "Try loading again", exact: true }),
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
});

test("reduced motion disables the decorative spinner", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/keel-ui-catalogue.html#forms");
  const refresh = page.getByRole("region", {
    name: "LoadingStatus & Spinner",
    exact: true,
  });
  await refresh.getByRole("button", { name: "Loading", exact: true }).click();
  await expect(refresh.getByRole("status")).toHaveText("Refreshing sources…");
  await expect(refresh.locator('[data-slot="spinner"]')).toHaveCSS(
    "animation-name",
    "none",
  );
});

test("reading facts stay concise and statistics have readable separation", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#display");
  const facts = page.locator(".catalogue-example").filter({
    has: page.getByRole("heading", {
      name: "Facts when labels add meaning",
      exact: true,
    }),
  });
  await expect(facts).toContainText("2 linked sources · 1 reviewed change");
  const reading = page.locator(".catalogue-reading-view");
  await expect(reading).toContainText(
    "May 14, 2024 in Delaware, US · EIN •••4821",
  );
  await expect(reading).not.toContainText(
    /Your interest is held by|Formed|ending/,
  );
  await expect(reading.getByText("Demo Investor", { exact: true })).toHaveCSS(
    "font-size",
    "13px",
  );
  await expect(reading.locator(".catalogue-reading-metadata")).toHaveCSS(
    "font-size",
    "12px",
  );
  await expect(reading).toHaveScreenshot(
    "shared-reading-hierarchy.png",
    screenshotOptions,
  );
  const statistics = page.getByLabel("Record statistics");
  for (const stat of await statistics.locator(".stat").all()) {
    const value = await stat.locator(".stat__value").boundingBox();
    const label = await stat.locator(".stat__label").boundingBox();
    expect(value).not.toBeNull();
    expect(label!.y - (value!.y + value!.height)).toBeGreaterThanOrEqual(7);
    const detail = stat.locator(".stat__detail");
    if (await detail.count()) {
      const bounds = await detail.boundingBox();
      expect(bounds!.y - (label!.y + label!.height)).toBeGreaterThanOrEqual(7);
    }
  }
  await expect(
    page.locator(".catalogue-example").filter({ has: statistics }),
  ).toHaveScreenshot("shared-statistics-rhythm.png", screenshotOptions);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
});

test("chart points expose values by pointer and keyboard", async ({ page }) => {
  await page.goto("/keel-ui-catalogue.html#display");
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
});

test("featured carousel uses homepage presentation and the index remains current", async ({
  page,
}) => {
  await page.goto("/keel-ui-catalogue.html#display");
  const carousel = page.getByRole("region", {
    name: "Source examples",
    exact: true,
  });
  await expect(
    carousel.getByRole("button", { name: /Previous slide|Next slide/ }),
  ).toHaveCount(0);
  await carousel
    .getByRole("button", { name: "Show Subscription agreement", exact: true })
    .click();
  await expect(
    carousel.getByRole("heading", {
      name: "Subscription agreement",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    carousel.getByRole("heading", {
      name: "Formation certificate",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    carousel.getByRole("button", {
      name: "Show Subscription agreement",
      exact: true,
    }),
  ).toHaveAttribute("aria-current", "true");
  await expect(carousel).toHaveScreenshot(
    "shared-featured-carousel.png",
    screenshotOptions,
  );
  await carousel
    .getByRole("button", { name: "Show Subscription agreement", exact: true })
    .press("ArrowRight");
  await expect(
    carousel.getByRole("heading", { name: "Quarterly statement", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Adoption review/ }),
  ).toHaveCount(0);
  const navigationToggle = page.getByRole("button", {
    name: "Open navigation menu",
  });
  if (await navigationToggle.isVisible()) await navigationToggle.click();
  await page.getByRole("button", { name: /Component index/ }).click();
  await expect(
    page.getByRole("heading", { name: "Component index", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Carousel", exact: true }),
  ).toBeVisible();
  await page.goto("/keel-ui-catalogue.html#audit");
  await expect(
    page.getByRole("heading", { name: "Component index", exact: true }),
  ).toBeVisible();
});
