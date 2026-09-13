import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";

// An explicit maintenance operation, never part of verification. Review the
// resulting diff with the corresponding accepted rule and test changes.
if (process.env.CI || process.env.KEEL_REQUIRED_TESTS === "1") {
  throw new Error(
    "Required case inventory cannot be refreshed during verification or CI",
  );
}
const root = resolve(import.meta.dirname, "..");
const parent = resolve(root, ".tugling/local/required-pilot");
mkdirSync(parent, { recursive: true });
const temporary = mkdtempSync(resolve(parent, "case-inventory-"));
const run = (args) =>
  execFileSync(process.execPath, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
try {
  const unitFile = resolve(temporary, "unit.json");
  run([
    resolve(root, "node_modules/vitest/vitest.mjs"),
    "list",
    `--json=${unitFile}`,
  ]);
  const vitest = JSON.parse(readFileSync(unitFile, "utf8")).map(
    (test) =>
      `${relative(root, test.file).replaceAll("\\", "/")} > ${test.name}`,
  );
  // Vitest list excludes skipped cases. This sole accepted platform exclusion
  // is still registered and must execute on Linux; the reporter checks that.
  const linuxCase =
    "scripts/browser-agent-runtime.test.ts > portfolio agent platform runtime > emits a unit accepted by the installed systemd parser";
  if (!vitest.includes(linuxCase)) vitest.push(linuxCase);
  const browser = JSON.parse(
    run([
      resolve(root, "node_modules/@playwright/test/cli.js"),
      "test",
      "--list",
      "--reporter=json",
    ]),
  );
  if (browser.errors.length) throw new Error("Browser discovery failed");
  const playwright = [];
  function collect(suites, parents = [], fileRoot = true) {
    for (const suite of suites) {
      const titles = fileRoot ? [] : [...parents, suite.title];
      for (const spec of suite.specs ?? []) {
        const file = relative(
          root,
          resolve(browser.config.rootDir, spec.file),
        ).replaceAll("\\", "/");
        for (const test of spec.tests) {
          playwright.push(
            `${test.projectName} > ${file} > ${[...titles, spec.title].join(" > ")}`,
          );
        }
      }
      collect(suite.suites ?? [], titles, false);
    }
  }
  collect(browser.suites);
  if (!vitest.length || !playwright.length)
    throw new Error("Required case inventory is empty");
  writeFileSync(
    resolve(root, ".tugling/required-cases.json"),
    `${JSON.stringify({ schemaVersion: 1, vitest: vitest.sort(), playwright: playwright.sort() }, null, 2)}\n`,
  );
  console.log(
    `Collected ${vitest.length} unit cases and ${playwright.length} browser cases. Review the inventory diff before committing.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
