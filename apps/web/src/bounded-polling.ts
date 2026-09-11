export type PollingEnvironment = {
  now: () => number;
  visible: () => boolean;
  setTimeout: (callback: () => void, delay: number) => number;
  clearTimeout: (timer: number) => void;
  onVisible: (callback: () => void) => () => void;
};

/** One request at a time; activity, failures and tab events share one clock. */
export function startBoundedPolling(options: {
  check: () => Promise<boolean>;
  intervalMs: number;
  deadline: number;
  onError: (error: unknown) => void;
  onTimeout: () => void;
  environment: PollingEnvironment;
}): () => void {
  const { environment: clock } = options;
  let stopped = false;
  let checking = false;
  let failures = 0;
  let nextDue = clock.now() + options.intervalMs;
  let timer: number | undefined;
  const schedule = () => {
    if (stopped || checking) return;
    if (timer !== undefined) clock.clearTimeout(timer);
    const due = clock.visible()
      ? Math.min(nextDue, options.deadline)
      : options.deadline;
    timer = clock.setTimeout(() => check(), Math.max(0, due - clock.now()));
  };
  const check = async () => {
    if (stopped || checking) return;
    if (clock.now() >= options.deadline) {
      stop();
      options.onTimeout();
      return;
    }
    if (!clock.visible()) {
      schedule();
      return;
    }
    checking = true;
    try {
      const active = await options.check();
      if (!active) stop();
      failures = 0;
    } catch (error) {
      failures++;
      if (!stopped) options.onError(error);
    } finally {
      checking = false;
      nextDue =
        clock.now() +
        (failures === 0
          ? options.intervalMs
          : Math.min(60_000 * 2 ** Math.min(failures - 1, 3), 300_000));
      schedule();
    }
  };
  const removeVisibilityListener = clock.onVisible(schedule);
  function stop() {
    stopped = true;
    if (timer !== undefined) clock.clearTimeout(timer);
    removeVisibilityListener();
  }
  schedule();
  return stop;
}
