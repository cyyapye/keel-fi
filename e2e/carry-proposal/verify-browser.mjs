import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const baseUrl = process.env.CARRY_PROPOSAL_URL ?? "http://127.0.0.1:14811";
const output = path.resolve(
  ".keel-local/carry-development/proposal/evidence-v5",
);
await mkdir(output, { recursive: true });
const sourceFiles = [
  "model.ts",
  "proposal.tsx",
  "proposal.css",
  "index.html",
  "build.mjs",
  "verify-browser.mjs",
  "model.unit.ts",
  "README.md",
  "tsconfig.json",
  "vitest.config.ts",
].map((file) => `e2e/carry-proposal/${file}`);
sourceFiles.push(
  "packages/domain/src/investment-details.ts",
  "packages/domain/src/position-economics.ts",
  "packages/ui/src/index.tsx",
  "packages/ui/src/styles.css",
);
const renderedFiles = ["index.html", "proposal.js", "proposal.css"].map(
  (file) => `.keel-local/carry-development/proposal/site/${file}`,
);
async function hashes(files) {
  return Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
}
const log = {
  proposal: "v5",
  baseUrl,
  boundary:
    "Standalone synthetic browser fixture; no production route, API, D1 or reload persistence claim.",
  screenshots: [],
  checks: [],
  errors: [],
  sourceHashes: await hashes(sourceFiles),
  renderedHashes: await hashes(renderedFiles),
};
const browser = await chromium.launch({ headless: true });
let activePage;

async function select(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: label, exact: true }),
  ).toContainText(option);
}

async function geometry(page, name, viewport) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Math.max(
            globalThis.document.documentElement.scrollWidth,
            globalThis.document.body.scrollWidth,
          ) <= globalThis.innerWidth,
      ),
    )
    .toBe(true);
  const targets = await page.locator("#simulated-product").evaluate((main) =>
    [...main.querySelectorAll("button,input,select,textarea")]
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return (
          bounds.width > 0 &&
          bounds.height > 0 &&
          !element.closest('[aria-hidden="true"]')
        );
      })
      .map((element) => ({
        name:
          element.getAttribute("aria-label") ??
          element.textContent?.trim() ??
          element.tagName,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      })),
  );
  for (const target of targets) {
    expect(
      target.height,
      `${name}: ${target.name} height`,
    ).toBeGreaterThanOrEqual(viewport === "390x844" ? 44 : 40);
    expect(
      target.width,
      `${name}: ${target.name} width`,
    ).toBeGreaterThanOrEqual(44);
  }
  log.checks.push({
    viewport,
    state: name,
    check:
      "no horizontal overflow; visible product controls >=44px on mobile, >=40px on desktop",
    targets,
  });
}

async function capture(page, name, viewport) {
  await geometry(page, name, viewport);
  await page.evaluate(() => globalThis.document.fonts.ready);
  const file = `${viewport}-${name}.png`;
  await page.screenshot({
    path: path.join(output, file),
    fullPage: true,
    scale: "css",
    animations: "disabled",
  });
  log.screenshots.push({
    file,
    viewport,
    state: name,
    scale: "css",
    fullPage: true,
    sha256: createHash("sha256")
      .update(await readFile(path.join(output, file)))
      .digest("hex"),
  });
}

async function historyAlignment(page, viewport, state) {
  const buttons = await page.locator(".holding-history-entry").all();
  for (let index = 0; index < buttons.length; index++) {
    const timestamp = await page
      .locator(".holding-history-line time")
      .nth(index)
      .innerText();
    await expect(buttons[index]).toHaveAccessibleDescription(timestamp);
  }
  const entries = await page
    .locator(".holding-history-entry")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const title = button.querySelector("span").getBoundingClientRect();
        const indicator = button.querySelector("svg").getBoundingClientRect();
        const bounds = button.getBoundingClientRect();
        return {
          title: {
            left: title.left,
            right: title.right,
            top: title.top,
            bottom: title.bottom,
          },
          indicator: {
            left: indicator.left,
            right: indicator.right,
            top: indicator.top,
            bottom: indicator.bottom,
          },
          button: {
            left: bounds.left,
            right: bounds.right,
            width: bounds.width,
            height: bounds.height,
          },
        };
      }),
    );
  for (const { title, indicator, button } of entries) {
    expect(indicator.left).toBeGreaterThanOrEqual(title.right);
    expect(indicator.top).toBeLessThan(title.bottom);
    expect(indicator.bottom).toBeGreaterThan(title.top);
    expect(indicator.right).toBeLessThanOrEqual(button.right);
    expect(button.height).toBeGreaterThanOrEqual(44);
  }
  log.checks.push({
    viewport,
    state,
    check:
      "history carets remain beside title text, including wrapped long labels",
    entries,
    passed: true,
  });
}

async function fieldAlignment(page, viewport) {
  const fields = await page
    .locator("#distribution-editor .holding-fields .field")
    .evaluateAll((elements) =>
      elements.map((field) => {
        const rect = (element) => {
          if (!element) return null;
          const r = element.getBoundingClientRect();
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            height: r.height,
          };
        };
        return {
          label: field.querySelector('[data-slot="field-label"]').textContent,
          field: rect(field),
          labelBounds: rect(field.querySelector('[data-slot="field-label"]')),
          control: rect(field.querySelector("input,button")),
          description: rect(
            field.querySelector('[data-slot="field-description"]'),
          ),
        };
      }),
    );
  for (const item of fields) {
    expect(item.control.top, item.label).toBeGreaterThanOrEqual(
      item.labelBounds.bottom,
    );
    if (item.description) {
      expect(item.description.top, item.label).toBeGreaterThanOrEqual(
        item.control.bottom,
      );
      expect(item.description.bottom, item.label).toBeLessThanOrEqual(
        item.field.bottom + 1,
      );
    }
    for (const sibling of fields) {
      if (
        item.field.left < sibling.field.left &&
        Math.abs(item.field.top - sibling.field.top) < 1 &&
        Math.abs(item.labelBounds.height - sibling.labelBounds.height) < 1
      )
        expect(
          Math.abs(item.control.top - sibling.control.top),
          `${item.label} and ${sibling.label}`,
        ).toBeLessThan(1);
    }
  }
  log.checks.push({
    viewport,
    check:
      "paired one-line field labels align their controls; descriptions remain below inputs without overlap",
    fields,
    passed: true,
  });
}

async function keyboard(page, viewport) {
  const steps = [];
  async function checkFocus() {
    const active = await page.evaluate(() => {
      const element = globalThis.document.activeElement;
      if (!(element instanceof globalThis.HTMLElement)) return null;
      const bounds = element.getBoundingClientRect();
      const style = globalThis.getComputedStyle(element);
      const overlap = globalThis.document.elementFromPoint(
        bounds.left + bounds.width / 2,
        bounds.top + bounds.height / 2,
      );
      return {
        name:
          element.getAttribute("aria-label") ??
          element
            .getAttribute("aria-labelledby")
            ?.split(" ")
            .map((id) => globalThis.document.getElementById(id)?.textContent)
            .join(" ") ??
          element.textContent?.trim(),
        top: bounds.top,
        bottom: bounds.bottom,
        visible:
          bounds.left >= 0 &&
          bounds.right <= globalThis.innerWidth &&
          bounds.top >= 0 &&
          bounds.bottom <= globalThis.innerHeight,
        unobscured: element === overlap || element.contains(overlap),
        outline:
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0,
      };
    });
    expect(
      active?.visible,
      "natural tab target must be contained in viewport",
    ).toBe(true);
    expect(active?.unobscured, "natural tab target must be unobscured").toBe(
      true,
    );
    expect(active?.outline, "natural tab target must show focus").toBe(true);
    steps.push(active);
    return active;
  }
  let reached = false;
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press("Tab");
    const active = await checkFocus();
    if (active.name === "Edit distributions") {
      reached = true;
      break;
    }
  }
  expect(reached).toBe(true);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("combobox", { name: "Received as", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Received on", exact: true }),
  ).toBeFocused();
  reached = false;
  for (let index = 0; index < 24; index++) {
    await page.keyboard.press("Tab");
    const active = await checkFocus();
    if (active.name === "Cancel") {
      reached = true;
      break;
    }
  }
  expect(
    reached,
    "keyboard must reach the form footer without mouse scrolling",
  ).toBe(true);
  log.checks.push({
    viewport,
    check:
      "natural keyboard traversal through navigation, edit entry, form and footer with navigation intact; no centering or target focus calls",
    steps,
  });
}

try {
  for (const viewport of [
    { width: 1778, height: 1566 },
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const name = `${viewport.width}x${viewport.height}`;
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      timezoneId: "America/Los_Angeles",
    });
    const page = await context.newPage();
    activePage = page;
    page.on("pageerror", (error) =>
      log.errors.push({ viewport: name, error: error.message }),
    );
    await page.clock.setFixedTime(new Date("2026-10-04T17:30:00Z"));
    await page.goto(baseUrl);
    await expect(
      page.getByRole("heading", { name: "Demo company", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toContainText("$36,200");
    await capture(page, "ordinary", name);
    await historyAlignment(page, name, "ordinary");
    const typography = await page
      .locator(".distribution-summary")
      .evaluate((record) => {
        const size = (selector) =>
          Number.parseFloat(
            globalThis.getComputedStyle(record.querySelector(selector))
              .fontSize,
          );
        return {
          amount: size(".distribution-amount strong"),
          identity: size("h4"),
          metadata: size(".holding-metadata"),
        };
      });
    expect(typography.amount).toBeGreaterThan(typography.identity);
    expect(typography.identity).toBeGreaterThan(typography.metadata);
    log.checks.push({
      viewport: name,
      check:
        "distribution amount, identity and supporting metadata have distinct type hierarchy",
      typography,
      passed: true,
    });
    await page
      .getByRole("button", { name: "Return calculation", exact: true })
      .click();
    await expect(page.locator(".holding-calculation")).toContainText(
      "Prior carry is not added back to investor return.",
    );
    await expect(
      page.getByRole("group", {
        name: "Reported remaining value",
        exact: true,
      }),
    ).toContainText("Total return · Before remaining carry");
    await capture(page, "ordinary-return-open", name);
    await page
      .getByRole("button", { name: "Return calculation", exact: true })
      .click();
    await page.goto(baseUrl);
    await keyboard(page, name);
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeDisabled();
    await capture(page, "editing", name);
    await fieldAlignment(page, name);
    const previewType = await page
      .locator(".distribution-preview")
      .evaluate((preview) => {
        const size = (selector) =>
          Number.parseFloat(
            globalThis.getComputedStyle(preview.querySelector(selector))
              .fontSize,
          );
        return {
          remaining: size(".distribution-preview-amount"),
          carry: size(".distribution-preview-carry"),
          label: size(".holding-metadata"),
        };
      });
    expect(previewType.remaining).toBeGreaterThan(previewType.carry);
    expect(previewType.carry).toBeGreaterThan(previewType.label);
    log.checks.push({
      viewport: name,
      check:
        "proposed remaining value and carry use separately labelled values with distinct prominence",
      typography: previewType,
      passed: true,
    });

    await page
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Demo corrected distribution notice");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit distributions", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".distribution-summary")).toContainText(
      "Demo corrected distribution notice",
    );
    await expect(page.locator(".holding-history-entry")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Read saved preview", exact: true })
      .click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "Demo corrected distribution notice",
    );
    await capture(page, "readback", name);

    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Evidence", exact: true }),
    ).toHaveValue("Demo corrected distribution notice");
    await capture(page, "later-edit", name);
    await page
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Demo retry notice");
    await select(page, "Next save", "Fail once");
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    await expect(
      page.getByText("Distributions could not be saved. Try again.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Evidence", exact: true }),
    ).toHaveValue("Demo retry notice");
    await expect(page.locator(".holding-history-entry")).toHaveCount(2);
    await capture(page, "failed", name);
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "Demo retry notice",
    );
    await expect(page.locator(".holding-history-entry")).toHaveCount(3);
    await page.locator(".holding-history-entry").first().click();
    await expect(
      page.getByText("Demo corrected distribution notice → Demo retry notice", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Remove distribution 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit distributions", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".holding-history-entry")).toHaveCount(4);
    await page.locator(".holding-history-entry").first().click();
    await expect(
      page.getByText("60 Demo common stock → Removed", { exact: true }),
    ).toBeVisible();
    await capture(page, "removed-history", name);
    log.checks.push({
      viewport: name,
      check:
        "changed save, saved preview, later edit, failed draft retention, retry, removal and predecessor mock receipts preserved",
      passed: true,
    });

    await select(page, "Preview scenario", "Saving · held for inspection");
    await expect(
      page.getByRole("button", { name: "Saving…", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("textbox", { name: "Evidence", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    await capture(page, "saving", name);
    await page
      .getByRole("button", { name: "Complete held save", exact: true })
      .click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "Demo corrected distribution notice",
    );

    await select(page, "Preview scenario", "Ordinary · stock distribution");
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Demo held-save notice");
    await select(page, "Next save", "Hold in saving state");
    await expect(page.locator(".holding-history-entry")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    const product = page.getByRole("main");
    const pendingControls = [
      ["combobox", "Received as"],
      ["button", "Received on"],
      ["textbox", "Security received"],
      ["textbox", "Shares received"],
      ["textbox", "Historical value · $"],
      ["textbox", "Evidence"],
      ["button", "Remove distribution 1"],
      ["button", "Add distribution"],
      ["combobox", "Distribution history"],
      ["button", "History through"],
      ["textbox", "Carry already charged · $"],
      ["combobox", "Recorded distributions in provider total"],
      ["button", "Saving…"],
      ["button", "Cancel"],
    ];
    for (const [role, label] of pendingControls) {
      await expect(
        product.getByRole(role, { name: label, exact: true }),
      ).toBeDisabled();
    }
    const pendingSave = product.getByRole("button", {
      name: "Saving…",
      exact: true,
    });
    await expect(pendingSave.click({ timeout: 250 })).rejects.toThrow(
      /Timeout/,
    );
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await expect(pendingSave).toBeDisabled();
    await expect(page.locator(".holding-history-entry")).toHaveCount(1);
    await expect(
      product.getByRole("textbox", { name: "Evidence", exact: true }),
    ).toHaveValue("Demo held-save notice");
    log.checks.push({
      viewport: name,
      check:
        "native held save locks every distribution field, Add/Remove, Cancel and Save; repeat pointer submission and Enter/Space create no accepted mock receipt",
      entry:
        "Ordinary scenario → Edit distributions → changed Evidence → Hold in saving state → Save distributions",
      disabledControls: pendingControls.map(([role, label]) => ({
        role,
        label,
      })),
      repeatedSubmission: {
        pointer: "native click rejected while disabled",
        keyboard: ["Enter", "Enter", "Space"],
      },
      receiptsBeforeSave: 1,
      receiptsWhilePending: 1,
      passed: true,
    });
    await page
      .getByRole("button", { name: "Complete held save", exact: true })
      .click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "Demo held-save notice",
    );
    await expect(page.locator(".holding-history-entry")).toHaveCount(2);
    await expect(
      page.getByRole("button", {
        name: /^Distribution history updated/,
      }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Complete held save", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Evidence", exact: true }),
    ).toHaveValue("Demo held-save notice");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".holding-history-entry")).toHaveCount(2);
    log.checks.push({
      viewport: name,
      check:
        "completing the held save once appends exactly one accepted mock receipt; changed fact reads back and unchanged replay is disabled",
      receiptsBeforeSave: 1,
      receiptsAfterCompletion: 2,
      newAcceptedMockReceipts: 1,
      passed: true,
    });

    await select(
      page,
      "Preview scenario",
      "No distributions · confirmed complete",
    );
    await expect(
      page.getByText("No received distributions recorded.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toContainText("$38,000");
    await capture(page, "empty", name);
    await select(page, "Preview scenario", "Historical stock value unknown");
    await expect(page.locator(".distribution-summary")).toContainText(
      "Historical value unknown",
    );
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(page.locator(".result-limit")).toHaveCount(1);
    await expect(page.locator(".result-limit")).toContainText(
      "No after-carry estimate or total return.",
    );
    await capture(page, "incomplete", name);
    await select(page, "Preview scenario", "Incomplete new distribution");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText("Enter the date each distribution was received.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Saved values", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Proposed effect", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".distribution-preview")).toContainText(
      "Complete the required inputs to preview these edits.",
    );
    await expect(page.locator(".distribution-preview")).not.toContainText(
      "historical distribution value is unknown",
    );
    await expect(
      page.locator(".distribution-preview .result-limit"),
    ).toHaveCount(0);
    await capture(page, "invalid", name);
    log.checks.push({
      viewport: name,
      check:
        "saved metrics and proposed effect labelled; missing required dates stay required input; identical unknown-value causes appear once per result context",
      passed: true,
    });

    await select(page, "Preview scenario", "Ordinary · stock distribution");
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    const historicalInput = page.getByRole("textbox", {
      name: "Historical value · $",
      exact: true,
    });
    await expect(
      page.getByRole("combobox", { name: "Historical value", exact: true }),
    ).toHaveCount(0);
    await historicalInput.fill("");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "Historical value unknown",
    );
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await expect(historicalInput).toHaveValue("");
    log.checks.push({
      viewport: name,
      check:
        "unknown historical value saved and read back; amount optional, dependent estimate absent",
      passed: true,
    });

    for (const amount of ["9000", "0", ""]) {
      await historicalInput.fill(amount);
      await expect(historicalInput).toHaveValue(amount);
      log.checks.push({
        viewport: name,
        check: "historical amount transition entered",
        amount,
      });
      await expect(
        page.getByRole("button", { name: "Save distributions", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Save distributions", exact: true })
        .click();
      await expect(page.locator(".distribution-summary")).toContainText(
        amount === ""
          ? "Historical value unknown"
          : amount === "0"
            ? "$0"
            : "$9,000",
      );
      await page
        .getByRole("button", { name: "Edit distributions", exact: true })
        .click();
      await expect(historicalInput).toHaveValue(amount);
    }
    for (const invalid of [
      "-1",
      "9.001",
      "not an amount",
      "9007199254740993.01",
    ]) {
      await historicalInput.fill(invalid);
      await expect(
        page.getByRole("button", { name: "Save distributions", exact: true }),
      ).toBeDisabled();
      await expect(page.locator(".distribution-preview")).toContainText(
        "Complete the required inputs",
      );
    }
    await historicalInput.fill("");
    await capture(page, "unknown-amount-editing", name);
    log.checks.push({
      viewport: name,
      check:
        "historical amount blank, entered value, explicit zero and blank each save/read back; malformed nonempty values cannot save",
      transitions: ["", "9000", "0", ""],
      rejected: ["-1", "9.001", "not an amount", "9007199254740993.01"],
      passed: true,
    });

    await select(page, "Preview scenario", "Carry already charged unknown");
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    const priorCarryInput = page.getByRole("textbox", {
      name: "Carry already charged · $",
      exact: true,
    });
    await expect(
      page.getByRole("combobox", {
        name: "Carry already charged",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(priorCarryInput).toHaveValue("");
    for (const amount of ["1000", "0", ""]) {
      await priorCarryInput.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      if (amount) await page.keyboard.insertText(amount);
      await expect(priorCarryInput).toHaveValue(amount);
      await expect(priorCarryInput).toBeFocused();
      await expect(
        page.getByRole("button", { name: "Save distributions", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Save distributions", exact: true })
        .click();
      if (amount === "") {
        await expect(
          page.getByRole("group", {
            name: "Estimated remaining value after carry",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(page.locator(".result-limit")).toContainText(
          "Carry already charged is unknown.",
        );
      } else {
        await expect(
          page.getByRole("group", {
            name: "Estimated remaining value after carry",
            exact: true,
          }),
        ).toHaveCount(1);
      }
      await page
        .getByRole("button", { name: "Edit distributions", exact: true })
        .click();
      await expect(priorCarryInput).toHaveValue(amount);
    }
    for (const invalid of [
      "-1",
      "9.001",
      "not an amount",
      "9007199254740993.01",
    ]) {
      await priorCarryInput.fill(invalid);
      await expect(
        page.getByRole("button", { name: "Save distributions", exact: true }),
      ).toBeDisabled();
    }
    await priorCarryInput.fill("");
    await capture(page, "prior-unknown-editing", name);
    log.checks.push({
      viewport: name,
      check:
        "native keyboard prior carry blank, entered value, explicit zero and blank retain focus and save/read back without inferring zero; invalid nonempty carry cannot save",
      transitions: ["", "1000", "0", ""],
      passed: true,
    });

    await select(
      page,
      "Preview scenario",
      "No distributions · confirmed complete",
    );
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await priorCarryInput.fill("");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText(
        "Confirm zero carry already charged for a complete history with no distributions.",
        { exact: true },
      ),
    ).toBeVisible();
    log.checks.push({
      viewport: name,
      check:
        "complete empty history cannot assert an unknown prior carry as zero",
      passed: true,
    });

    await select(
      page,
      "Preview scenario",
      "Multiple distributions · long labels",
    );
    await expect(page.locator(".distribution-summary")).toHaveCount(2);
    await expect(page.locator(".distribution-summary").first()).toContainText(
      "$6,000",
    );
    await expect(page.locator(".distribution-summary").last()).toContainText(
      "$3,000",
    );
    await historyAlignment(page, name, "multiple-long-labels");
    await capture(page, "multiple-long-labels", name);
    const history = page.locator(".holding-history-entry").first();
    await history.press("Enter");
    await expect(history).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText(
        "Demo advisor statement and dated stock distribution notice",
        { exact: true },
      ),
    ).toHaveCount(2);
    await history.press("Enter");
    await expect(history).toHaveAttribute("aria-expanded", "false");
    log.checks.push({
      viewport: name,
      check:
        "multiple distribution identities remain paired to values; long history labels expand/collapse by keyboard with indicator beside title",
      passed: true,
    });

    await select(page, "Preview scenario", "Cash distribution");
    await expect(page.locator(".distribution-summary")).toContainText(
      "Cash distribution",
    );
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await select(page, "Received as", "Stock");
    await expect(
      page.getByRole("button", { name: "Value as of", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("textbox", { name: "Shares received", exact: true })
      .fill("-1");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("textbox", { name: "Security received", exact: true })
      .fill("Demo distributed shares");
    await page
      .getByRole("textbox", { name: "Shares received", exact: true })
      .fill("60");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "60 Demo distributed shares",
    );
    log.checks.push({
      viewport: name,
      check:
        "cash and stock selection; unknown security/quantity optional, invalid supplied quantity rejected; save",
      passed: true,
    });

    await select(page, "Preview scenario", "Source carry treatment unknown");
    await expect(
      page.getByRole("group", {
        name: "Reported remaining value",
        exact: true,
      }),
    ).toContainText("Carry unspecified");
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        /No after-carry estimate\. The source value does not specify carry treatment/,
      ),
    ).toBeVisible();
    await expect(page.locator(".result-limit")).not.toContainText(
      "Review the valuation",
    );
    await capture(page, "source-unknown", name);
    await select(
      page,
      "Preview scenario",
      "Source already reports after carry",
    );
    await expect(
      page.getByRole("group", {
        name: "Reported remaining value",
        exact: true,
      }),
    ).toContainText("$40,000");
    await expect(
      page.getByRole("group", {
        name: "Reported remaining value",
        exact: true,
      }),
    ).toContainText("Total return · After carry");
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toHaveCount(0);

    await select(
      page,
      "Preview scenario",
      "Mixed provider inclusion · unsupported",
    );
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toContainText("$36,200");
    await expect(page.locator(".holding-value-return")).toHaveCount(0);
    await expect(
      page.getByText(
        /Return unavailable because mixed provider inclusion is not supported/,
      ),
    ).toBeVisible();
    await capture(page, "mixed-provider", name);
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", {
        name: "Recorded distributions in provider total",
        exact: true,
      }),
    ).toContainText("Mixed · only some included");
    await capture(page, "mixed-editing", name);
    await page
      .getByRole("textbox", {
        name: "Historical value · $",
        exact: true,
      })
      .fill("10000");
    await page
      .getByRole("textbox", { name: "Evidence", exact: true })
      .fill("Demo corrected mixed-inclusion notice");
    await expect(
      page.getByRole("combobox", {
        name: "Recorded distributions in provider total",
        exact: true,
      }),
    ).toContainText("Mixed · only some included");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeEnabled();
    await expect(page.locator(".distribution-preview")).toContainText(
      "$36,000",
    );
    await page
      .getByRole("button", { name: "Save distributions", exact: true })
      .click();
    await expect(page.locator(".distribution-summary")).toContainText(
      "$10,000",
    );
    await expect(page.locator(".distribution-summary")).toContainText(
      "Demo corrected mixed-inclusion notice",
    );
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toContainText("$36,000");
    await expect(page.locator(".holding-value-return")).toHaveCount(0);
    await expect(
      page.getByText(
        /Return unavailable because mixed provider inclusion is not supported/,
      ),
    ).toBeVisible();
    await expect(page.locator(".holding-history-entry")).toHaveCount(2);
    await page
      .getByRole("button", { name: "Edit distributions", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", {
        name: "Historical value · $",
        exact: true,
      }),
    ).toHaveValue("10000");
    await expect(
      page.getByRole("combobox", {
        name: "Recorded distributions in provider total",
        exact: true,
      }),
    ).toContainText("Mixed · only some included");
    await expect(
      page.getByRole("button", { name: "Save distributions", exact: true }),
    ).toBeDisabled();
    log.checks.push({
      viewport: name,
      check:
        "changed Mixed distribution facts save and read back with accurate Mixed inclusion retained; supported carry remains and dependent total returns stay withheld",
      savedHistoricalValueMinor: "1000000",
      supportedRemainingValueAfterCarryMinor: "3600000",
      providerInclusion: "Mixed · only some included",
      receiptsBeforeSave: 1,
      receiptsAfterSave: 2,
      totalReturnsRendered: 0,
      passed: true,
    });
    await select(
      page,
      "Preview scenario",
      "Carry already charged · known $1,000",
    );
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toContainText("$32,000");
    await page
      .getByRole("button", { name: "Carry details", exact: true })
      .click();
    await expect(page.locator(".carry-details")).toContainText("$8,000");
    await capture(page, "prior-carry", name);
    await page
      .getByRole("button", { name: "Return calculation", exact: true })
      .click();
    await expect(page.locator(".holding-calculation")).toContainText(
      "Historical investor distributions are already after advisor carry",
    );
    await expect(
      page.getByRole("group", {
        name: "Reported remaining value",
        exact: true,
      }),
    ).toContainText("+174.1%");
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toContainText("+144.4%");
    await capture(page, "prior-carry-return-open", name);
    await page
      .getByRole("button", { name: "Return calculation", exact: true })
      .click();
    await select(page, "Preview scenario", "Carry already charged unknown");
    await expect(
      page.getByRole("group", {
        name: "Estimated remaining value after carry",
        exact: true,
      }),
    ).toHaveCount(0);
    const capitalDetails = page.getByRole("button", {
      name: "Carry details",
      exact: true,
    });
    if ((await capitalDetails.getAttribute("aria-expanded")) !== "true")
      await capitalDetails.click();
    await expect(page.locator(".carry-details")).toContainText(
      "Capital still to return",
    );
    await expect(page.locator(".carry-details")).toContainText("$21,000");
    await expect(page.locator(".carry-details")).toContainText("Unknown");
    await expect(page.locator(".carry-details")).not.toContainText(
      "Carry already charged is unknown.",
    );
    await capture(page, "prior-unknown-capital", name);
    log.checks.push({
      viewport: name,
      check:
        "unknown source preserved; after-carry source passes through; mixed inclusion withholds returns only; positive prior carry gives $8,000 remaining carry and $32,000 proceeds",
      passed: true,
    });
    await context.close();
  }
  expect(log.errors).toEqual([]);
  expect(await hashes(sourceFiles)).toEqual(log.sourceHashes);
  expect(
    await hashes(log.screenshots.map(({ file }) => path.join(output, file))),
  ).toEqual(
    Object.fromEntries(
      log.screenshots.map(({ file, sha256 }) => [
        path.join(output, file),
        sha256,
      ]),
    ),
  );
  expect(await hashes(renderedFiles)).toEqual(log.renderedHashes);
  log.result = "PASS";
} catch (error) {
  log.result = "FAIL";
  log.failure = error.stack ?? String(error);
  if (activePage && !activePage.isClosed()) {
    await writeFile(
      path.join(output, "failure-visible.txt"),
      await activePage.locator("body").innerText(),
    );
    await activePage.screenshot({
      path: path.join(output, "failure.png"),
      fullPage: true,
      scale: "css",
    });
  }
  throw error;
} finally {
  await writeFile(
    path.join(output, "browser-checks.json"),
    JSON.stringify(log, null, 2),
  );
  await browser.close();
}
console.log(
  `PASS: ${log.screenshots.length} screenshots and ${log.checks.length} checks in ${output}`,
);
