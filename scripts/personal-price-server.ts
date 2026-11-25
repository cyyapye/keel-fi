import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Plugin } from "vite";
import { resolveDevPorts } from "./dev-ports";
import { resolveLocalScenarioPersistRoot } from "./local-seed-scenarios";
import { dailyWindow } from "./personal-price-window";

export function personalPriceServer(
  profile = resolveLocalScenarioPersistRoot(
    "personal-prices",
    resolveDevPorts().rootDir,
  ),
): Plugin {
  return {
    name: "personal-daily-prices",
    apply: "serve",
    configureServer(server) {
      const { rootDir, webPort } = resolveDevPorts();
      const host = "127.0.0.1:" + webPort;
      if (server.config.server.host !== "127.0.0.1")
        throw new Error(
          "Personal prices require the loopback development server.",
        );
      let task = Promise.resolve();
      let stopped = false;
      const run = (mode: "scheduled" | "replay") => {
        task = task.then(async () => {
          if (stopped) return;
          try {
            const result = await promisify(execFile)(
              process.execPath,
              [
                "--import",
                "tsx",
                "scripts/personal-price-sync.ts",
                mode,
                profile,
              ],
              { cwd: rootDir, timeout: 60_000 },
            );
            if (result.stdout.includes("DAILY_PRICES_UPDATED"))
              server.ws.send({ type: "full-reload" });
            if (result.stdout.trim())
              server.config.logger.info(result.stdout.trim());
          } catch {
            server.config.logger.error(
              "Personal price sync unavailable. Keel retains the last accepted daily price.",
            );
          }
        });
      };
      let scheduled: ReturnType<typeof setTimeout>;
      let replay: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        if (stopped) return;
        run("scheduled");
        if (process.env.KEEL_PERSONAL_PROXY_DEMO === "1") return;
        const now = Date.now();
        scheduled = setTimeout(schedule, dailyWindow(now).next - now + 1000);
        scheduled.unref();
      };
      // Only the isolated walkthrough advances history after the user makes a choice.
      // The recurring feed runs independently of decisions and of open browser tabs.
      server.middlewares.use((req, res, next) => {
        if (
          req.headers.host === host &&
          req.method === "POST" &&
          /^\/api\/exposure-closes\/[\da-f-]+\/decision$/u.test(
            req.url ?? "",
          ) &&
          existsSync(join(profile, "daily-feed/first-session-replay"))
        ) {
          res.once("finish", () => {
            if (res.statusCode < 200 || res.statusCode >= 300 || stopped)
              return;
            clearTimeout(replay);
            replay = setTimeout(() => run("replay"), 12_000);
            replay.unref();
          });
        }
        next();
      });
      server.httpServer?.once("listening", schedule);
      server.httpServer?.once("close", () => {
        stopped = true;
        clearTimeout(scheduled);
        clearTimeout(replay);
      });
    },
  };
}
