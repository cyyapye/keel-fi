// One minute is the existing queued-update response target. Keep all idle
// work on this clock so an auxiliary reconnect loop cannot bypass its budget.
export const PROVIDER_AGENT_IDLE_INTERVAL_MS = 60_000;
export const PROVIDER_AGENT_MAX_RETRY_INTERVAL_MS = 15 * 60_000;
export const PROVIDER_SESSION_DISCOVERY_INTERVAL_MS = 60 * 60_000;

type PollingOptions = {
  checkReconnect: () => Promise<"idle" | "connected" | "handled">;
  checkUpdates: () => Promise<void>;
  checkSessionRenewal?: () => Promise<void>;
  updateIntervalMs: number;
  onError: (error: unknown) => "authorization" | "retryable";
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  signal?: AbortSignal;
};

export async function runProviderAgentPolling(
  options: PollingOptions,
): Promise<void> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let nextUpdateCheckAt = 0;
  let nextSessionCheckAt = 0;
  let reconnectRetryMs = PROVIDER_AGENT_IDLE_INTERVAL_MS;
  let updateRetryMs = PROVIDER_AGENT_IDLE_INTERVAL_MS;
  const failureDelay = (error: unknown, interval: number) =>
    options.onError(error) === "authorization"
      ? PROVIDER_AGENT_MAX_RETRY_INTERVAL_MS
      : interval;
  const increaseDelay = (interval: number) =>
    Math.min(interval * 2, PROVIDER_AGENT_MAX_RETRY_INTERVAL_MS);

  while (!options.signal?.aborted) {
    let reconnect: "idle" | "connected" | "handled";
    try {
      reconnect = await options.checkReconnect();
      reconnectRetryMs = PROVIDER_AGENT_IDLE_INTERVAL_MS;
    } catch (error) {
      const delay = failureDelay(error, reconnectRetryMs);
      reconnectRetryMs = increaseDelay(delay);
      if (!options.signal?.aborted) await sleep(delay);
      continue;
    }
    if (
      reconnect === "connected" ||
      (reconnect === "idle" && now() >= nextUpdateCheckAt)
    ) {
      try {
        await options.checkUpdates();
        nextUpdateCheckAt = now() + options.updateIntervalMs;
        updateRetryMs = PROVIDER_AGENT_IDLE_INTERVAL_MS;
      } catch (error) {
        const delay = failureDelay(error, updateRetryMs);
        nextUpdateCheckAt = now() + delay;
        updateRetryMs = increaseDelay(delay);
      }
    }
    if (
      reconnect === "idle" &&
      options.checkSessionRenewal &&
      now() >= nextSessionCheckAt
    ) {
      try {
        await options.checkSessionRenewal();
      } catch (error) {
        options.onError(error);
      } finally {
        // Share the existing process/clock. Errors cannot fall through to a
        // one-minute renewal retry; D1 separately admits at most three failures.
        nextSessionCheckAt = now() + PROVIDER_SESSION_DISCOVERY_INTERVAL_MS;
      }
    }
    // A failed capture or browser must not delay the reconnect that repairs it.
    if (!options.signal?.aborted) {
      await sleep(PROVIDER_AGENT_IDLE_INTERVAL_MS);
    }
  }
}
