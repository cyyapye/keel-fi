import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PdfSandboxError } from "./pdf-sandbox-error";

const FailureSchema = z
  .object({
    reason: z.enum([
      "runtime_busy",
      "control_timeout",
      "cleanup_failed",
      "owner_lost",
      "owner_unavailable",
      "creation_unconfirmed",
    ]),
  })
  .strict();

export async function acquireSandboxOwner(
  socket: string,
  directory: string,
  name: string,
) {
  const child = spawn(
    "python3",
    [
      "-I",
      "-B",
      fileURLToPath(new URL("./pdf-sandbox-owner.py", import.meta.url)),
      socket,
      directory,
      name,
    ],
    {
      cwd: directory,
      env: {
        PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
        LANG: "C.UTF-8",
      },
      stdio: ["pipe", "pipe", "ignore"],
    },
  );
  const controller = new AbortController();
  let ready = false;
  let released = false;
  let valid = true;
  let reportedFailure = false;
  let createRequested = false;
  let createConfirmed = false;
  let markCreated: () => void = () => undefined;
  const created = new Promise<void>((resolve) => {
    markCreated = resolve;
  });
  let code: number | null = null;
  let output = "";
  let length = 0;
  let reason: z.infer<typeof FailureSchema>["reason"] = "owner_unavailable";
  let markReady: () => void = () => undefined;
  const admitted = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    child.once("error", () => {
      controller.abort();
      resolve();
    });
    child.once("close", (exitCode) => {
      code = exitCode;
      controller.abort();
      resolve();
    });
  });
  child.stdin.on("error", () => undefined);
  child.stdout.on("data", (data: Buffer) => {
    if (!valid) return;
    length += data.length;
    try {
      if (length > 1024) throw new Error("bounded protocol");
      output += data.toString("utf8");
      let newline: number;
      while ((newline = output.indexOf("\n")) >= 0) {
        const line = output.slice(0, newline);
        output = output.slice(newline + 1);
        if (line === "KEEL_PDF_OWNER_READY_V1" && !ready && !released) {
          ready = true;
          markReady();
        } else if (
          line === "KEEL_PDF_OWNER_CREATE_SETTLED_V1" &&
          ready &&
          createRequested &&
          !createConfirmed &&
          !released
        ) {
          createConfirmed = true;
          markCreated();
        } else if (
          line === "KEEL_PDF_OWNER_RELEASED_V1" &&
          ready &&
          !released
        ) {
          released = true;
        } else {
          reason = FailureSchema.parse(JSON.parse(line)).reason;
          reportedFailure = true;
          controller.abort();
          child.stdin.end();
        }
      }
    } catch {
      valid = false;
      controller.abort();
      child.stdin.end();
    }
  });
  await Promise.race([admitted, closed]);
  if (!ready || !valid || controller.signal.aborted) {
    child.stdin.end();
    await closed;
    throw new PdfSandboxError("extractor_unavailable", {
      stage: "admission",
      reason,
    });
  }
  return {
    signal: controller.signal,
    async creationSettled() {
      createRequested = true;
      child.stdin.write("KEEL_PDF_OWNER_CREATE_SETTLED_V1\n");
      await Promise.race([created, closed]);
      if (!createConfirmed || controller.signal.aborted)
        throw new PdfSandboxError("extractor_unavailable", {
          stage: "create",
          reason: "creation_unconfirmed",
        });
    },
    async release(options: { creationNeverStarted?: boolean } = {}) {
      if (options.creationNeverStarted && !createRequested)
        child.stdin.write("KEEL_PDF_OWNER_NO_CREATE_V1\n");
      child.stdin.end();
      await closed;
      if (!released || !valid || reportedFailure || code !== 0 || output !== "")
        throw new PdfSandboxError("extractor_unavailable", {
          stage: "cleanup",
          reason: reportedFailure ? reason : "cleanup_failed",
        });
    },
  };
}
