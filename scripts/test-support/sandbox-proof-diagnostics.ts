import { AssertionError } from "node:assert";
import { describeSandboxFailure } from "../pdf-sandbox-error";

// Only fixed test labels leave this boundary, never AssertionError's actual,
// expected, stack, Docker stderr, container names or document content.
const checks = new Set([
  "orphan-created",
  "orphan-inspection-query",
  "orphan-alive-query",
  "orphan-survives-caller",
  ...["orphan-exit", "orphan-removal"].flatMap((phase) =>
    [
      "registration",
      "disconnected",
      "response",
      "daemon-error",
      "cancelled",
      "deadline",
      "status",
    ].map((reason) => `${phase}-${reason}`),
  ),
]);

export function describeSandboxProofFailure(error: unknown): string {
  if (error instanceof AggregateError)
    return error.errors.map(describeSandboxProofFailure).join("; ");
  if (error instanceof AssertionError && !error.generatedMessage) {
    // Node may append an actual/expected diff even to an explicit message.
    const check = error.message.split("\n", 1)[0]!;
    if (checks.has(check))
      return `sandbox verification failed (check: ${check})`;
  }
  return describeSandboxFailure(error);
}
