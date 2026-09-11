import type { Page } from "@playwright/test";

/** Setup needs proof of application access, not a full portfolio projection. */
export async function waitForKeelSession(
  page: Pick<Page, "url" | "evaluate">,
  keelOrigin: URL,
  timeoutMs: number,
  clock = {
    now: Date.now,
    sleep: (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  },
): Promise<boolean> {
  const deadline = clock.now() + timeoutMs;
  let failures = 0;
  while (clock.now() < deadline) {
    let failed = false;
    if (new URL(page.url()).origin === keelOrigin.origin) {
      const result = await page
        .evaluate(async () => {
          try {
            const response = await fetch("/api/session", {
              credentials: "same-origin",
              headers: { Accept: "application/json" },
              signal: AbortSignal.timeout(10_000),
            });
            const json: unknown = (
              response.headers.get("Content-Type") ?? ""
            ).includes("application/json")
              ? await response.json()
              : null;
            return {
              ready:
                response.ok &&
                typeof json === "object" &&
                json !== null &&
                "authenticated" in json &&
                json.authenticated === true,
              failed: response.status >= 500,
            };
          } catch {
            return { ready: false, failed: true };
          }
        })
        .catch(() => ({ ready: false, failed: true }));
      if (result.ready) return true;
      failed = result.failed;
    }
    failures = failed ? failures + 1 : 0;
    const delay = failed
      ? Math.min(60_000 * 2 ** Math.min(failures - 1, 3), 300_000)
      : 5_000;
    await clock.sleep(Math.min(delay, Math.max(0, deadline - clock.now())));
  }
  return false;
}
