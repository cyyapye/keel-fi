import { spawnSync, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");

async function fixture(runner: "vitest" | "playwright") {
  const parent = resolve(root, ".tugling/local/required-pilot");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(resolve(parent, "native-runner-"));
  const browser = runner === "playwright";
  const testDirectory = browser ? "e2e" : "scripts";
  const suffix = browser ? "spec" : "test";
  const config = browser ? "playwright.config.ts" : "vitest.config.ts";
  await mkdir(resolve(directory, testDirectory));
  await writeFile(resolve(directory, "package.json"), '{"type":"module"}\n');
  await writeFile(
    resolve(directory, config),
    browser
      ? `export default {
        testDir: "./e2e", forbidOnly: true, retries: 0, workers: 1,
        projects: [{ name: "chromium" }, { name: "mobile-chromium" }],
        reporter: [[${JSON.stringify(resolve(root, "scripts/required-playwright-reporter.ts"))}]],
      };\n`
      : `import RequiredReporter from ${JSON.stringify(resolve(root, "scripts/required-vitest-reporter.ts"))};
       export default { test: { allowOnly: false, passWithNoTests: false,
         maxWorkers: 1, reporters: [new RequiredReporter()] } };\n`,
  );
  const first = `${testDirectory}/first.${suffix}.ts`;
  const second = `${testDirectory}/second.${suffix}.ts`;
  const source = (mode = "") =>
    browser
      ? `import { test, expect } from "@playwright/test";
       test${mode}("synthetic required case", () => { expect(2 + 2).toBe(4); });\n`
      : `import { it, expect } from "vitest";
       it${mode}("synthetic required case", () => { expect(2 + 2).toBe(4); });\n`;
  await writeFile(resolve(directory, first), source());
  await writeFile(resolve(directory, second), source());
  execFileSync("git", ["init", "-q", directory]);
  execFileSync("git", ["add", "."], { cwd: directory });
  const run = (...filters: string[]) =>
    spawnSync(
      process.execPath,
      browser
        ? [
            resolve(root, "node_modules/@playwright/test/cli.js"),
            "test",
            ...filters,
          ]
        : [resolve(root, "node_modules/vitest/vitest.mjs"), "run", ...filters],
      {
        cwd: directory,
        env: { ...process.env, KEEL_REQUIRED_TESTS: "1" },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
  return { directory, first, second, source, run };
}

describe("required native verification", () => {
  it.each(["vitest", "playwright"] as const)(
    "%s rejects skipped and omitted cases through the actual native CLI",
    async (runner) => {
      const probe = await fixture(runner);
      try {
        const good = probe.run();
        expect(good.error).toBeUndefined();
        expect(good.status, good.stdout + good.stderr).toBe(0);

        await writeFile(
          resolve(probe.directory, probe.second),
          probe.source(".skip"),
        );
        const skipped = probe.run();
        expect(skipped.error).toBeUndefined();
        expect(skipped.status, skipped.stdout + skipped.stderr).not.toBe(0);
        expect(skipped.stdout + skipped.stderr).toContain("Required");

        await writeFile(resolve(probe.directory, probe.second), probe.source());
        const filtered = probe.run(probe.first);
        expect(filtered.error).toBeUndefined();
        expect(filtered.status, filtered.stdout + filtered.stderr).not.toBe(0);
        expect(filtered.stdout + filtered.stderr).toContain(
          "Required test files missing",
        );

        await writeFile(
          resolve(probe.directory, probe.second),
          probe.source(".only"),
        );
        const focused = probe.run();
        expect(focused.error).toBeUndefined();
        expect(focused.status, focused.stdout + focused.stderr).not.toBe(0);

        await writeFile(resolve(probe.directory, probe.second), probe.source());
        const restored = probe.run();
        expect(restored.status, restored.stdout + restored.stderr).toBe(0);

        if (runner === "playwright") {
          const excludedFile = "e2e/provider-session.spec.ts";
          const source = `import { test, expect } from "@playwright/test";
            test("tokenfolio accepts a saved sign-in after a real Chrome restart", ({}, info) => {
              test.skip(info.project.name === "mobile-chromium", "The background provider browser always uses a desktop viewport.");
              expect(2 + 2).toBe(4);
            });`;
          await rm(resolve(probe.directory, probe.second));
          await writeFile(resolve(probe.directory, excludedFile), source);
          execFileSync("git", ["add", "-A"], { cwd: probe.directory });
          const excluded = probe.run();
          expect(excluded.status, excluded.stdout + excluded.stderr).toBe(0);
          await writeFile(
            resolve(probe.directory, excludedFile),
            source.replace('info.project.name === "mobile-chromium"', "true"),
          );
          const desktopSkipped = probe.run();
          expect(
            desktopSkipped.status,
            desktopSkipped.stdout + desktopSkipped.stderr,
          ).not.toBe(0);
          expect(desktopSkipped.stdout + desktopSkipped.stderr).toContain(
            "Required browser test did not pass",
          );
        }
      } finally {
        await rm(probe.directory, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it("rejects skipped or missing Python cleanup regressions through their native entry point", async () => {
    const parent = resolve(root, ".tugling/local/required-pilot");
    await mkdir(parent, { recursive: true });
    const directory = await mkdtemp(resolve(parent, "python-runner-"));
    try {
      const original = await readFile(
        resolve(root, "scripts/test_linux_test_run.py"),
        "utf8",
      );
      await writeFile(
        resolve(directory, "linux-test-run.py"),
        await readFile(resolve(root, "scripts/linux-test-run.py")),
      );
      for (const source of [
        original.replace(
          "    def test_signal_cleans_checkout",
          '    @unittest.skip("synthetic negative control")\n    def test_signal_cleans_checkout',
        ),
        original.replace(
          "    def test_signal_cleans_checkout",
          "    def omitted_signal_check",
        ),
      ]) {
        await writeFile(resolve(directory, "test_linux_test_run.py"), source);
        const result = spawnSync("python3", ["test_linux_test_run.py"], {
          cwd: directory,
          encoding: "utf8",
          timeout: 30_000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status, result.stdout + result.stderr).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(
          "Required temporary-runner tests",
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("preserves the accepted source and maps the complete pilot to native gates", async () => {
    const accepted = JSON.parse(
      await readFile(resolve(root, ".tugling/project.json"), "utf8"),
    );
    const pilot = JSON.parse(
      await readFile(resolve(root, ".tugling/pilot.json"), "utf8"),
    );
    const map = z
      .object({
        flows: z.array(z.object({ argv: z.array(z.string()) })),
        requirements: z.array(z.object({ id: z.string() })),
      })
      .parse(
        JSON.parse(
          await readFile(resolve(root, ".tugling/verification.json"), "utf8"),
        ),
      );
    expect(accepted.tugling).toMatchObject({
      version: "0.4.0",
      revision: "e709bd77128e3d14ebc8ded37ccc2afe8f4b6eba",
    });
    expect(accepted.project).not.toHaveProperty("verification");
    expect(pilot.tugling).toMatchObject({
      version: "0.5.0",
      revision: "24aa7ec64524b5816858b09037e504c92af5251e",
    });
    expect(pilot.project.canonical_verify).toEqual(["make", "verify"]);
    expect(map.flows.map((flow: { argv: string[] }) => flow.argv)).toEqual([
      ["make", "test-linux-cleanup"],
      ["make", "db-verify"],
      ["make", "verify"],
    ]);
    expect(map.requirements.map((rule: { id: string }) => rule.id)).toEqual([
      "synthetic-only",
      "canonical-state-and-history",
      "integer-finance",
      "validated-auth-boundaries",
      "recorded-source-decisions",
      "projection-only-reads",
      "d1-scale-and-billing",
      "recurring-work-and-retry-budgets",
      "shared-ui-and-user-workflows",
      "web-entry-capacity",
      "pdf-and-document-security",
      "artifact-ownership-and-recovery",
      "release-and-verification-integrity",
    ]);
    const makefile = await readFile(resolve(root, "Makefile"), "utf8");
    expect(makefile).toContain(
      "verify:\n\t$(MAKE) pdf-sandbox-verify\n\tKEEL_REQUIRED_TESTS=1 $(MAKE) check\n\tKEEL_REQUIRED_TESTS=1 $(MAKE) e2e",
    );
    const workflow = await readFile(
      resolve(root, ".github/workflows/tugling-pilot.yml"),
      "utf8",
    );
    expect(workflow).toContain(`ref: ${pilot.tugling.revision as string}`);
    expect(workflow).toMatch(
      /run:\s+make verify-required TUGLING_SOURCE=\.tugling\/checkouts\/required-pilot/u,
    );
    expect(workflow).toContain("runs-on: [self-hosted, Linux, X64, keel-ci]");
    expect(workflow).not.toMatch(
      /pull_request_target|continue-on-error|secrets\.|deploy-preview|paths-ignore/,
    );
  });
});
