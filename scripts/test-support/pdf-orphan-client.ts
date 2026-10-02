// Synthetic probe transport only. Its execution acknowledgment lets tests kill
// a caller at an observable barrier, without a guessed startup sleep.
import { spawn } from "node:child_process";
import { PdfSandboxError } from "../pdf-sandbox-error";

export async function startOrphanProbe(
  socket: string,
  directory: string,
  name: string,
) {
  const child = spawn(
    "docker",
    [
      "--config",
      directory,
      "--host",
      `unix://${socket}`,
      "start",
      "--attach",
      "--interactive",
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
  let output = "";
  let ready = false;
  let started = false;
  let markStarted: () => void = () => undefined;
  let failStarted: (error: unknown) => void = () => undefined;
  const barrier = new Promise<void>((resolve, reject) => {
    markStarted = resolve;
    failStarted = reject;
  });
  const failure = () =>
    new PdfSandboxError("extractor_unavailable", {
      stage: "start",
      reason: "unsafe_runtime",
    });
  const finished = new Promise<void>((resolve) => {
    child.once("error", (error) => {
      failStarted(error);
      resolve();
    });
    child.once("close", () => {
      if (!started) failStarted(failure());
      resolve();
    });
  });
  const timer = setTimeout(() => {
    failStarted(failure());
    child.kill("SIGKILL");
  }, 30_000);
  child.stdin.on("error", () => undefined);
  child.stdout.on("data", (data: Buffer) => {
    output += data.toString("utf8");
    if (!ready && output.startsWith("KEEL_PDF_SANDBOX_READY_V1\n")) {
      ready = true;
      child.stdin.end('{"mode":"orphan"}');
    }
    if (output === "KEEL_PDF_SANDBOX_READY_V1\nKEEL_PDF_ORPHAN_RUNNING_V1\n") {
      started = true;
      clearTimeout(timer);
      markStarted();
    } else if (output.length > 1024) {
      failStarted(failure());
      child.kill("SIGKILL");
    }
  });
  try {
    await barrier;
    return { finished, kill: () => child.kill("SIGKILL") };
  } catch (error) {
    child.kill("SIGKILL");
    await finished;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
