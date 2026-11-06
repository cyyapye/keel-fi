import { z } from "zod";

export const D1ServiceFailureSchema = z.object({
  error: z.string().min(1).max(512),
  code: z.enum(["d1_quota_exhausted", "d1_budget_unavailable"]),
  retryAt: z.iso.datetime().nullable(),
  outcome: z.enum(["not_started", "unknown"]),
});

export type D1ServiceFailure = z.infer<typeof D1ServiceFailureSchema>;

export class D1ServiceUnavailableError extends Error {
  readonly code: D1ServiceFailure["code"];
  readonly retryAt: string | null;
  readonly outcome: D1ServiceFailure["outcome"];

  constructor(failure: D1ServiceFailure) {
    super(failure.error);
    this.name = "D1ServiceUnavailableError";
    this.code = failure.code;
    this.retryAt = failure.retryAt;
    this.outcome = failure.outcome;
  }
}

export function d1ServiceError(
  body: unknown,
): D1ServiceUnavailableError | null {
  const parsed = D1ServiceFailureSchema.safeParse(body);
  return parsed.success ? new D1ServiceUnavailableError(parsed.data) : null;
}

export function d1ServiceRetryAt(error: unknown): number | null {
  if (!(error instanceof D1ServiceUnavailableError) || error.retryAt === null)
    return null;
  return Date.parse(error.retryAt);
}
