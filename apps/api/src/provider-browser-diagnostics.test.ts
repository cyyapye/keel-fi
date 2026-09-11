import { describe, expect, it } from "vitest";

import { providerBrowserFailureDiagnostic } from "./provider-browser-diagnostics";

describe("provider browser failure diagnostics", () => {
  it("keeps only allowlisted metadata from nested database failures", () => {
    const cause = new Error(
      "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. synthetic-private-value",
    );
    cause.stack =
      "Error: synthetic-private-value\n at D1ProviderBrowserSessionRepository.expireActive (synthetic-private-path:12:3)";
    const result = providerBrowserFailureDiagnostic(
      new Error("synthetic-private-message", { cause }),
    );
    expect(result).toEqual({
      reason: "write_limit",
      stage: "expireActive",
      type: "Error",
    });
    expect(JSON.stringify(result)).not.toContain("synthetic-private");
  });

  it("bounds cyclic causes and excludes arbitrary messages and error names", () => {
    const error = new Error("synthetic-private-message");
    error.name = "synthetic-private-name";
    error.cause = error;
    expect(providerBrowserFailureDiagnostic(error)).toEqual({
      reason: "unexpected_failure",
      stage: "unknown",
      type: "Error",
    });
  });
});
