import { fileURLToPath } from "node:url";
import type { Page, TestInfo } from "@playwright/test";
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
