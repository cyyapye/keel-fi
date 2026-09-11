import { ProviderBrowserSessionRepositoryError } from "@keel/database";

const stages = [
  "findIdentity",
  "requireRegisteredAgent",
  "touchAgent",
  "expireActive",
  "findActive",
  "findById",
  "requireSession",
  "requireLease",
] as const;

const reasons = [
  ["identity_missing", /No household is provisioned for this identity/u],
  ["read_limit", /free tier daily row read limit/u],
  ["write_limit", /free tier daily row write limit/u],
  ["query_limit", /Too many (?:API requests|subrequests|queries)/iu],
  ["database_overloaded", /D1 DB is overloaded/u],
  ["database_reset", /D1 DB.*(?:reset|time limit)/u],
  ["schema_missing", /no such (?:table|column)|D1_COLUMN_NOTFOUND/iu],
  ["constraint_failed", /constraint failed|SQLITE_CONSTRAINT/iu],
  ["binding_invalid", /D1_TYPE_ERROR/u],
  ["database_error", /D1_(?:ERROR|EXEC_ERROR)/u],
] as const;

/** Classify failures without retaining messages, SQL, parameters, or stacks. */
export function providerBrowserFailureDiagnostic(error: unknown) {
  let current = error;
  let reason: string = "unexpected_failure";
  let stage: (typeof stages)[number] | "unknown" = "unknown";
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) {
    if (current instanceof ProviderBrowserSessionRepositoryError) {
      reason = current.code;
      break;
    }
    const failure = current;
    const match = reasons.find(([, pattern]) => pattern.test(failure.message));
    if (
      match !== undefined &&
      (reason === "unexpected_failure" || reason === "database_error")
    ) {
      reason = match[0];
    }
    if (stage === "unknown") {
      stage =
        stages.find((name) => failure.stack?.includes(`.${name} (`)) ??
        "unknown";
    }
    current = current.cause;
  }
  const type =
    error instanceof TypeError
      ? "TypeError"
      : error instanceof RangeError
        ? "RangeError"
        : error instanceof Error
          ? "Error"
          : "UnknownError";
  return { reason, stage, type };
}
