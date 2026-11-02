import { describe, expect, it, vi } from "vitest";
import { D1ServiceUnavailableError } from "../packages/domain/src/d1-service";
import { runProviderAgentPolling } from "./provider-agent-polling";

const DAY = 86_400_000;
const pause = () =>
  new D1ServiceUnavailableError({
    error: "Synthetic database allowance exhausted",
    code: "d1_quota_exhausted",
    retryAt: new Date(DAY).toISOString(),
    outcome: "unknown",
  });

describe("provider database quota pause", () => {
  it.each(["reconnect", "update", "renewal"] as const)(
    "pauses every auxiliary loop for a full quota day after %s failure",
    async (failed) => {
      let now = 0;
      const controller = new AbortController();
      const checks = { reconnect: 0, update: 0, renewal: 0 };
      const onError = vi.fn(() => "retryable" as const);
      await runProviderAgentPolling({
        checkReconnect: () => {
          checks.reconnect++;
          if (failed === "reconnect") return Promise.reject(pause());
          return Promise.resolve("idle" as const);
        },
        checkUpdates: () => {
          checks.update++;
          return failed === "update"
            ? Promise.reject(pause())
            : Promise.resolve();
        },
        checkSessionRenewal: () => {
          checks.renewal++;
          return failed === "renewal"
            ? Promise.reject(pause())
            : Promise.resolve();
        },
        updateIntervalMs: 60_000,
        onError,
        now: () => now,
        sleep: (duration) => {
          now += duration;
          if (now >= DAY) controller.abort();
          return Promise.resolve();
        },
        signal: controller.signal,
      });
      expect(checks.reconnect).toBe(1);
      expect(checks.update).toBe(failed === "reconnect" ? 0 : 1);
      expect(checks.renewal).toBe(failed === "renewal" ? 1 : 0);
      expect(onError).toHaveBeenCalledOnce();
      expect(now).toBe(DAY);
    },
  );
});
