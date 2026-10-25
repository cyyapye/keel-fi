import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import { PdfSandboxError } from "./pdf-sandbox-error";
import { describeSandboxProofFailure } from "./test-support/sandbox-proof-diagnostics";

describe("sandbox proof diagnostics", () => {
  it("identifies an allowed assertion without revealing actual or expected data", () => {
    let failure: unknown;
    try {
      assert.equal(
        "synthetic private document text",
        "synthetic private expected value",
        "orphan-removal-deadline",
      );
    } catch (error) {
      failure = error;
    }
    expect(describeSandboxProofFailure(failure)).toBe(
      "sandbox verification failed (check: orphan-removal-deadline)",
    );
  });

  it("keeps unknown assertions and error messages private, including aggregates", () => {
    const privateAssertion = new assert.AssertionError({
      message: "orphan-removal-deadline: synthetic private detail",
      actual: "synthetic private document text",
    });
    expect(
      describeSandboxProofFailure(
        new AggregateError([
          privateAssertion,
          new Error("orphan-removal-deadline"),
          new PdfSandboxError("extractor_unavailable", {
            stage: "cleanup",
            reason: "cleanup_failed",
          }),
        ]),
      ),
    ).toBe(
      "sandbox verification failed; sandbox verification failed; extractor_unavailable (cleanup: cleanup_failed)",
    );
  });
});
