import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { RequestOptions } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observeWatchdogLifecycle } from "./test-support/watchdog-removal";
import { describeSandboxProofFailure } from "./test-support/sandbox-proof-diagnostics";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:http", () => ({ request }));

type Response = PassThrough & {
  statusCode: number;
  headers: Record<string, string>;
  complete: boolean;
};
type Transport = EventEmitter & {
  destroy: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};
let calls: {
  options: RequestOptions;
  acknowledge: (response: Response) => void;
  transport: Transport;
  response: Response;
}[];

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  request
    .mockReset()
    .mockImplementation(
      (options: RequestOptions, acknowledge: (response: Response) => void) => {
        const response = Object.assign(new PassThrough(), {
          statusCode: 200,
          headers: { "content-type": "application/json" },
          complete: false,
        });
        const transport = Object.assign(new EventEmitter(), {
          destroy: vi.fn(() => response.destroy()),
          end: vi.fn(),
        });
        calls.push({ options, acknowledge, transport, response });
        return transport;
      },
    );
});
afterEach(() => {
  for (const call of calls) call.response.destroy();
  vi.useRealTimers();
});

function begin(callback: () => Promise<void> = () => Promise.resolve()) {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const start = vi.fn(() => {
    markStarted();
    return callback();
  });
  const result = observeWatchdogLifecycle(
    "/synthetic/rootless.sock",
    "synthetic-probe",
    start,
  );
  const outcome = result.catch(describeSandboxProofFailure);
  return { start, started, result, outcome };
}
function acknowledge(index: number) {
  const call = calls[index]!;
  call.acknowledge(call.response);
}
function reply(
  index: number,
  body: unknown = { StatusCode: 137, Error: null },
) {
  const response = calls[index]!.response;
  response.complete = true;
  response.end(JSON.stringify(body));
}
async function registered() {
  const run = begin();
  acknowledge(0);
  acknowledge(1);
  await run.started;
  return run;
}

describe("independent watchdog lifecycle proof", () => {
  it("registers both passive waits before starting and handles immediate removal without missing it", async () => {
    const run = begin();
    expect(run.start).not.toHaveBeenCalled();
    acknowledge(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(run.start).not.toHaveBeenCalled();
    acknowledge(1);
    await run.started;
    // Notifications may be delivered out of order across the two HTTP streams.
    reply(1);
    reply(0);
    await expect(run.result).resolves.toEqual({ exitCode: 137, removed: true });
    expect(run.start).toHaveBeenCalledTimes(1);
    expect(calls.map(({ options }) => options)).toEqual(
      ["next-exit", "removed"].map((condition) => ({
        socketPath: "/synthetic/rootless.sock",
        method: "POST",
        path: `/containers/synthetic-probe/wait?condition=${condition}`,
        agent: false,
        headers: { "Content-Length": "0", Accept: "application/json" },
      })),
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    expect(
      calls.every(({ transport }) => transport.destroy.mock.calls.length > 0),
    ).toBe(true);
  });

  it("accepts delayed exit and removal notifications beyond the old polling window without retries", async () => {
    const run = await registered();
    await vi.advanceTimersByTimeAsync(38_000);
    reply(0);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(4_000);
    reply(1);
    await expect(run.result).resolves.toEqual({ exitCode: 137, removed: true });
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts when a registration is missing and cancels its sibling observer", async () => {
    const run = begin();
    acknowledge(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(run.outcome).resolves.toContain("orphan-removal-registration");
    expect(run.start).not.toHaveBeenCalled();
    expect(
      calls.every(({ transport }) => transport.destroy.mock.calls.length > 0),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when opening an observer throws synchronously", async () => {
    const open = request.getMockImplementation()!;
    request.mockImplementationOnce(open).mockImplementationOnce(() => {
      throw new Error("synthetic private connection detail");
    });
    const run = begin();
    await expect(run.outcome).resolves.toContain("orphan-removal-registration");
    expect(run.start).not.toHaveBeenCalled();
    expect(calls[0]!.transport.destroy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a worker with no observed exit at the fixed watchdog plus transport deadline", async () => {
    const run = await registered();
    let settled = false;
    void run.outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(41_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run.outcome).resolves.toContain("orphan-exit-deadline");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails a stopped but unremoved worker on a separate cleanup deadline", async () => {
    const run = await registered();
    reply(0);
    await vi.advanceTimersByTimeAsync(0);
    let settled = false;
    void run.outcome.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(run.outcome).resolves.toContain("orphan-removal-deadline");
    expect(vi.getTimerCount()).toBe(0);
  });

  for (const [index, phase] of [
    [0, "exit"],
    [1, "removal"],
  ] as const) {
    it(`fails immediately and safely when the ${phase} observer disconnects`, async () => {
      const run = await registered();
      calls[index]!.response.emit(
        "error",
        new Error("synthetic private daemon detail"),
      );
      await expect(run.outcome).resolves.toBe(
        `sandbox verification failed (check: orphan-${phase}-disconnected)`,
      );
      expect(request).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  for (const statusCode of [404, 500]) {
    it(`does not treat HTTP ${statusCode} as registration or proof of removal`, async () => {
      const run = begin();
      calls[1]!.response.statusCode = statusCode;
      acknowledge(1);
      await expect(run.outcome).resolves.toContain(
        "orphan-removal-registration",
      );
      expect(run.start).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("rejects an explicit removal failure even if exit has not arrived yet", async () => {
    const run = await registered();
    reply(1, {
      StatusCode: 137,
      Error: { Message: "synthetic private removal detail" },
    });
    await expect(run.outcome).resolves.toBe(
      "sandbox verification failed (check: orphan-removal-daemon-error)",
    );
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects an incomplete response stream without waiting for a timeout", async () => {
    const run = await registered();
    calls[1]!.response.write('{"StatusCode":');
    calls[1]!.response.destroy();
    await expect(run.outcome).resolves.toContain("orphan-removal-disconnected");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not accept an HTML response as a registered Docker wait", async () => {
    const run = begin();
    calls[0]!.response.headers["content-type"] = "text/html";
    acknowledge(0);
    await expect(run.outcome).resolves.toContain("orphan-exit-registration");
    expect(run.start).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("requires a killed exit, not a successful early return", async () => {
    const run = await registered();
    reply(0, { StatusCode: 0 });
    reply(1, { StatusCode: 0 });
    await expect(run.outcome).resolves.toContain("orphan-exit-status");
  });

  it("rejects mismatched removal status", async () => {
    const run = await registered();
    reply(0);
    reply(1, { StatusCode: 0 });
    await expect(run.outcome).resolves.toContain("orphan-removal-status");
  });

  for (const body of [
    "not json",
    JSON.stringify({ StatusCode: "137" }),
    "x".repeat(4097),
  ]) {
    it(`fails closed on malformed or oversized wait output (${body.length} bytes)`, async () => {
      const run = await registered();
      const response = calls[0]!.response;
      response.complete = true;
      response.end(body);
      await expect(run.outcome).resolves.toContain("orphan-exit-response");
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it("cancels both waits when the caller proof itself fails", async () => {
    const run = begin(() =>
      Promise.reject(new Error("synthetic caller failed")),
    );
    acknowledge(0);
    acknowledge(1);
    await expect(run.outcome).resolves.toBe("sandbox verification failed");
    expect(
      calls.every(({ transport }) => transport.destroy.mock.calls.length > 0),
    ).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
