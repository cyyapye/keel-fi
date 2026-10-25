import assert from "node:assert/strict";
import { request, type ClientRequest } from "node:http";
import { z } from "zod";

// Test-only, passive observers on the already validated rootless socket.
// Docker acknowledges registration in the response headers before waiting for
// the body. Both registrations must be acknowledged before the worker starts.
const CONTROL_MS = 10_000;
const WATCHDOG_MS = 32_000;
const MAX_RESPONSE_BYTES = 4096;
const WaitResponse = z.object({
  StatusCode: z.number().int(),
  Error: z.object({ Message: z.string() }).nullable().optional(),
});
type Phase = "orphan-exit" | "orphan-removal";

function failure(check: string) {
  return new assert.AssertionError({ message: check });
}

function registerWait(
  socket: string,
  name: string,
  condition: "next-exit" | "removed",
) {
  const phase: Phase =
    condition === "next-exit" ? "orphan-exit" : "orphan-removal";
  let acknowledge!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    acknowledge = resolve;
    rejectReady = reject;
  });
  let resolveResult!: (code: number) => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<number>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // A result may arrive while the caller is still proving its execution barrier.
  // Preserve that result/error without an unhandled rejection in the meantime.
  void ready.catch(() => undefined);
  void result.catch(() => undefined);
  let settled = false;
  let transport: ClientRequest | undefined;
  const fail = (check: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(registrationTimer);
    const error = failure(check);
    rejectReady(error);
    rejectResult(error);
    transport?.destroy();
  };
  const registrationTimer = setTimeout(
    () => fail(`${phase}-registration`),
    CONTROL_MS,
  );
  // The unversioned endpoint uses this daemon's current API. The wait response
  // is schema-checked; unsupported or malformed responses fail closed.
  try {
    transport = request(
      {
        socketPath: socket,
        method: "POST",
        path: `/containers/${encodeURIComponent(name)}/wait?condition=${condition}`,
        agent: false,
        headers: { "Content-Length": "0", Accept: "application/json" },
      },
      (response) => {
        response.on("error", () => fail(`${phase}-disconnected`));
        response.on("close", () => {
          if (!response.complete) fail(`${phase}-disconnected`);
        });
        if (
          response.statusCode !== 200 ||
          response.headers["content-type"]
            ?.split(";", 1)[0]
            ?.trim()
            .toLowerCase() !== "application/json"
        ) {
          fail(`${phase}-registration`);
          return;
        }
        clearTimeout(registrationTimer);
        acknowledge();
        let body = "";
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) fail(`${phase}-response`);
          else body += chunk.toString("utf8");
        });
        response.on("end", () => {
          if (settled) return;
          try {
            const value = WaitResponse.parse(JSON.parse(body));
            if (value.Error != null) {
              fail(`${phase}-daemon-error`);
              return;
            }
            settled = true;
            resolveResult(value.StatusCode);
          } catch {
            fail(`${phase}-response`);
          }
        });
      },
    );
    transport.on("error", () => fail(`${phase}-disconnected`));
    transport.end();
  } catch {
    fail(`${phase}-registration`);
  }
  return {
    ready,
    result,
    close: () => {
      fail(`${phase}-cancelled`);
      transport?.destroy();
    },
  };
}

async function bounded<T>(
  result: Promise<T>,
  ms: number,
  check: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      result,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(failure(check)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function observeWatchdogLifecycle(
  socket: string,
  name: string,
  startAndAbandon: () => Promise<void>,
) {
  const exit = registerWait(socket, name, "next-exit");
  const removal = registerWait(socket, name, "removed");
  const disconnected = new Promise<never>((_, reject) => {
    void exit.result.catch(reject);
    void removal.result.catch(reject);
  });
  void disconnected.catch(() => undefined);
  try {
    await Promise.race([
      Promise.all([exit.ready, removal.ready]),
      disconnected,
    ]);
    await startAndAbandon();
    // No deadline sleep or state polling. These are bounds on observation,
    // not changes to the attested 32s watchdog. A daemon error fails at once.
    const exitCode = await bounded(
      Promise.race([exit.result, disconnected]),
      WATCHDOG_MS + CONTROL_MS,
      "orphan-exit-deadline",
    );
    assert.equal(exitCode, 137, "orphan-exit-status");
    const removalCode = await bounded(
      Promise.race([removal.result, disconnected]),
      CONTROL_MS,
      "orphan-removal-deadline",
    );
    assert.equal(removalCode, exitCode, "orphan-removal-status");
    return { exitCode, removed: true };
  } finally {
    // Cancels observers only. Owner cleanup remains outside this proof and
    // cannot make a failed exit/removal observation pass.
    exit.close();
    removal.close();
  }
}
