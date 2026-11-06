import { D1ServiceUnavailableError } from "@keel/domain/d1-service";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startBoundedPolling } from "./bounded-polling";

const DAY = 86_400_000;
afterEach(() => vi.useRealTimers());
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  let visible = true;
  let notify: () => void = () => undefined;
  return {
    environment: {
      now: Date.now,
      visible: () => visible,
      setTimeout: (callback: () => void, delay: number) =>
        Number(setTimeout(callback, delay)),
      clearTimeout: (timer: number) => clearTimeout(timer),
      onVisible: (callback: () => void) => {
        notify = callback;
        return () => {
          notify = () => undefined;
        };
      },
    },
    visibility: (next: boolean) => {
      visible = next;
      notify();
    },
    focus: () => notify(),
  };
}

describe("browser request budgets", () => {
  it("honors a quota pause across focus events and stops at the existing deadline", async () => {
    const clock = fixture();
    const check = vi.fn(() =>
      Promise.reject(
        new D1ServiceUnavailableError({
          error: "Synthetic quota pause",
          code: "d1_quota_exhausted",
          retryAt: new Date(DAY).toISOString(),
          outcome: "unknown",
        }),
      ),
    );
    const timeout = vi.fn();
    startBoundedPolling({
      environment: clock.environment,
      intervalMs: 5_000,
      deadline: 900_000,
      check,
      onError: () => undefined,
      onTimeout: timeout,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    for (let index = 0; index < 10; index++) {
      clock.focus();
      clock.visibility(false);
      clock.visibility(true);
    }
    await vi.advanceTimersByTimeAsync(DAY);
    expect(check).toHaveBeenCalledOnce();
    expect(timeout).toHaveBeenCalledOnce();
  });

  it("caps every active browser loop across a full healthy and failure day", async () => {
    const clock = fixture();
    const calls = [0, 0];
    const timeouts = [0, 0];
    // Three provider status widgets, investment status, three reconnects and
    // legacy sign-in. This deliberately overcounts what one Sources page shows.
    for (const failed of [false, true]) {
      for (const [intervalMs, duration] of [
        ...Array.from({ length: 4 }, () => [10_000, 1_800_000]),
        ...Array.from({ length: 4 }, () => [5_000, 900_000]),
      ]) {
        startBoundedPolling({
          environment: clock.environment,
          intervalMs: intervalMs!,
          deadline: duration!,
          check: () => {
            calls[Number(failed)]!++;
            return failed
              ? Promise.reject(new Error("synthetic outage"))
              : Promise.resolve(true);
          },
          onError: () => undefined,
          onTimeout: () => {
            timeouts[Number(failed)]!++;
          },
        });
      }
    }
    await vi.advanceTimersByTimeAsync(DAY);
    expect(calls[0]).toBeLessThanOrEqual(1_440);
    expect(calls[1]).toBeLessThanOrEqual(72);
    expect(timeouts).toEqual([8, 8]);
  });

  it("pauses hidden tabs and cannot turn focus events into extra requests", async () => {
    const clock = fixture();
    const check = vi.fn(() => Promise.resolve(true));
    startBoundedPolling({
      environment: clock.environment,
      intervalMs: 5_000,
      deadline: 900_000,
      check,
      onError: () => undefined,
      onTimeout: () => undefined,
    });
    for (let second = 0; second < 60; second++) {
      clock.focus();
      clock.focus();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(check).toHaveBeenCalledTimes(12);
    clock.visibility(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(12);
    clock.visibility(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(13);
  });

  it("never overlaps slow requests and stops after a terminal response", async () => {
    const clock = fixture();
    let finish!: (active: boolean) => void;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    startBoundedPolling({
      environment: clock.environment,
      intervalMs: 5_000,
      deadline: 900_000,
      check,
      onError: () => undefined,
      onTimeout: () => undefined,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    clock.focus();
    clock.visibility(true);
    expect(check).toHaveBeenCalledOnce();
    finish(false);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(check).toHaveBeenCalledOnce();
  });

  it("retains five-second healthy detection and the server lease deadline", async () => {
    const clock = fixture();
    const detected: number[] = [];
    const timeout = vi.fn();
    startBoundedPolling({
      environment: clock.environment,
      intervalMs: 5_000,
      deadline: 15_000,
      check: () => {
        detected.push(Date.now());
        return Promise.resolve(true);
      },
      onError: () => undefined,
      onTimeout: timeout,
    });
    await vi.advanceTimersByTimeAsync(DAY);
    expect(detected).toEqual([5_000, 10_000]);
    expect(timeout).toHaveBeenCalledOnce();
  });
});
