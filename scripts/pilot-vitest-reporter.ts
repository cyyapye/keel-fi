import type { Reporter, TestModule } from "vitest/node";

// JSON's final status alone labels expected failures and retry successes as
// passed. Read native task metadata before accepting a required execution.
export default class PilotVitestReporter implements Reporter {
  onTestRunEnd(modules: readonly TestModule[]) {
    const invalid: string[] = [];
    for (const module of modules) {
      for (const test of module.children.allTests()) {
        const diagnostic = test.diagnostic();
        if (
          test.options.fails ||
          diagnostic?.retryCount ||
          diagnostic?.repeatCount ||
          diagnostic?.flaky
        ) {
          invalid.push(`${module.moduleId} :: ${test.fullName}`);
        }
      }
    }
    if (invalid.length) {
      throw new Error(
        `Required native cases cannot use expected failures, retries or repeats:\n${invalid.join("\n")}`,
      );
    }
  }
}
