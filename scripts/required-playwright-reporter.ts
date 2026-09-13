import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
} from "@playwright/test/reporter";
import { readFileSync } from "node:fs";
import { z } from "zod";
import {
  assertRequiredFiles,
  projectTestPath,
  requiredTestFiles,
} from "./required-test-inventory";

const Exclusions = z.array(
  z
    .object({
      file: z.string(),
      reason: z.string(),
      titles: z.array(z.string()).min(1),
    })
    .strict(),
);

export default class RequiredPlaywrightReporter implements Reporter {
  private suite?: Suite;

  onBegin(_config: FullConfig, suite: Suite) {
    this.suite = suite;
  }

  onEnd(result: FullResult): Promise<{ status: "failed" } | undefined> {
    try {
      const root = process.cwd();
      const tests = this.suite?.allTests() ?? [];
      const expected = requiredTestFiles(root, "playwright");
      for (const project of ["chromium", "mobile-chromium"]) {
        assertRequiredFiles(
          expected,
          new Set(
            tests
              .filter((test) => test.parent.project()?.name === project)
              .map((test) => projectTestPath(root, test.location.file)),
          ),
        );
      }
      const exclusions = Exclusions.parse(
        JSON.parse(
          readFileSync(
            new URL("../.tugling/browser-exclusions.json", import.meta.url),
            "utf8",
          ),
        ),
      );
      const passed = (test: TestCase) =>
        test.expectedStatus === "passed" &&
        test.results.length > 0 &&
        test.results.at(-1)?.status === "passed";
      for (const test of tests) {
        if (passed(test)) continue;
        const file = projectTestPath(root, test.location.file);
        const excluded =
          test.parent.project()?.name === "mobile-chromium" &&
          test.results.length > 0 &&
          test.results.every((run) => run.status === "skipped") &&
          exclusions.some(
            (entry) =>
              entry.file === file &&
              entry.titles.includes(test.title) &&
              test.annotations.some(
                (annotation) =>
                  annotation.type === "skip" &&
                  annotation.description === entry.reason,
              ),
          ) &&
          tests.some(
            (desktop) =>
              desktop.parent.project()?.name === "chromium" &&
              desktop.location.file === test.location.file &&
              desktop.title === test.title &&
              passed(desktop),
          );
        if (!excluded)
          throw new Error(
            `Required browser test did not pass: ${file} > ${test.title}`,
          );
      }
      if (result.status !== "passed")
        return Promise.resolve({ status: "failed" });
    } catch (error) {
      console.error(error);
      return Promise.resolve({ status: "failed" });
    }
    return Promise.resolve(undefined);
  }
}
