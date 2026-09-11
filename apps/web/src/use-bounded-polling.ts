import { useEffect, useRef } from "react";
import { startBoundedPolling } from "./bounded-polling";

export function useBoundedPolling(options: {
  active: boolean;
  identity: string;
  intervalMs: number;
  expiresAt?: string | undefined;
  check: () => Promise<boolean>;
  onError: (error: unknown) => void;
  onTimeout: () => void;
}) {
  const callbacks = useRef(options);
  useEffect(() => {
    callbacks.current = options;
  });
  const { active, identity, intervalMs, expiresAt } = options;
  useEffect(() => {
    if (!active) return;
    // A status object or callback replacement must not restart the clock.
    return startBoundedPolling({
      intervalMs,
      deadline: Math.min(
        Date.now() + 30 * 60_000,
        expiresAt === undefined ? Infinity : Date.parse(expiresAt),
      ),
      check: () => callbacks.current.check(),
      onError: (error) => callbacks.current.onError(error),
      onTimeout: () => callbacks.current.onTimeout(),
      environment: {
        now: Date.now,
        visible: () => document.visibilityState === "visible",
        setTimeout: (callback, delay) => window.setTimeout(callback, delay),
        clearTimeout: (timer) => window.clearTimeout(timer),
        onVisible: (callback) => {
          document.addEventListener("visibilitychange", callback);
          window.addEventListener("focus", callback);
          window.addEventListener("pageshow", callback);
          return () => {
            document.removeEventListener("visibilitychange", callback);
            window.removeEventListener("focus", callback);
            window.removeEventListener("pageshow", callback);
          };
        },
      },
    });
  }, [active, identity, intervalMs, expiresAt]);
}
