import type { Reporter, TestModule } from "vitest/node";
import {
  assertRequiredCases,
  assertRequiredFiles,
  projectTestPath,
  requiredTestFiles,
} from "./required-test-inventory";

export default class RequiredVitestReporter implements Reporter {
  onTestRunEnd(modules: readonly TestModule[]) {
    const root = process.cwd();
    assertRequiredFiles(
      requiredTestFiles(root, "vitest"),
      new Set(modules.map((module) => projectTestPath(root, module.moduleId))),
    );
    assertRequiredCases(
      root,
      "vitest",
      modules.flatMap((module) =>
        [...module.children.allTests()].map(
          (test) =>
            `${projectTestPath(root, module.moduleId)} > ${test.fullName}`,
        ),
      ),
    );
    for (const module of modules) {
      const file = projectTestPath(root, module.moduleId);
      const tests = [...module.children.allTests()];
      if (tests.length === 0)
        throw new Error(`Required test file is empty: ${file}`);
      for (const test of tests) {
        const state = test.result().state;
        // Existing systemd parser proof is Linux-only; CI executes it on Linux.
        const platformExclusion =
          process.platform !== "linux" &&
          file === "scripts/browser-agent-runtime.test.ts" &&
          test.name ===
            "emits a unit accepted by the installed systemd parser" &&
          state === "skipped";
        if (state !== "passed" && !platformExclusion) {
          throw new Error(
            `Required test did not pass (${state}): ${file} > ${test.fullName}`,
          );
        }
      }
    }
  }
}
