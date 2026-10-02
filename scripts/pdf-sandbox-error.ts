export type PdfSandboxProblem =
  "extractor_unavailable" | "limit_reached" | "unreadable";
export type PdfSandboxStage =
  | "admission"
  | "engine"
  | "create"
  | "attest"
  | "start"
  | "execute"
  | "cleanup"
  | "input"
  | "output";
export type PdfSandboxReason =
  | "runtime_busy"
  | "owner_unavailable"
  | "owner_lost"
  | "control_timeout"
  | "startup_timeout"
  | "execution_timeout"
  | "output_limit"
  | "input_limit"
  | "worker_killed"
  | "unsafe_runtime"
  | "cleanup_failed"
  | "creation_unconfirmed";

// Only fixed tokens leave this boundary. No Docker stderr, paths or PDF text.
export class PdfSandboxError extends Error {
  constructor(
    public readonly problem: PdfSandboxProblem,
    public readonly diagnostic?: {
      stage: PdfSandboxStage;
      reason: PdfSandboxReason;
    },
  ) {
    super(problem);
  }
}

export function describeSandboxFailure(error: unknown): string {
  if (error instanceof AggregateError)
    return error.errors.map(describeSandboxFailure).join("; ");
  if (error instanceof PdfSandboxError)
    return error.diagnostic
      ? `${error.problem} (${error.diagnostic.stage}: ${error.diagnostic.reason})`
      : error.problem;
  return "sandbox verification failed";
}
