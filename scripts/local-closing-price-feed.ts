// This Vite middleware is available only in the dedicated synthetic local scenario.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Plugin } from "vite";
import { resolveDevPorts } from "./dev-ports";

export function localClosingPriceFeed(): Plugin {
  return {
    name: "local-closing-price-feed",
    apply: "serve",
    configureServer(server) {
      const { rootDir, webPort } = resolveDevPorts();
      const deliveries = process.env.KEEL_LOCAL_SCENARIO === "pre-distribution";
      const origin = `http://127.0.0.1:${webPort}`;
      server.middlewares.use("/local-feed", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (req.headers.host !== new URL(origin).host) {
          res.writeHead(403).end();
          return;
        }
        if (req.method === "GET") {
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Local market feed</title><main style="font:1rem system-ui;max-width:36rem;margin:12vh auto;padding:1rem"><h1>Local market feed</h1><p>Cedar Robotics · Synthetic events</p><form method="post"><button>Send the next close at $52</button></form>${deliveries ? '<p>Each delivery includes an SPV notice and an independent brokerage statement.</p><form method="post" action="?batch=first"><button>Receive the first 25 shares</button></form><p></p><form method="post" action="?batch=second"><button>Receive another 15 shares</button></form>' : ""}</main></html>`,
          );
          return;
        }
        if (req.method !== "POST" || req.headers.origin !== origin) {
          res.writeHead(403).end();
          return;
        }
        void sendClose();
        async function sendClose() {
          try {
            const batch = new URL(req.url ?? "/", origin).searchParams.get(
              "batch",
            );
            if (
              batch &&
              (!deliveries || !["first", "second"].includes(batch))
            ) {
              res.writeHead(400).end();
              return;
            }
            const { stdout } = await promisify(execFile)(
              process.execPath,
              [
                "--import",
                "tsx",
                ...(batch
                  ? ["scripts/preview-stock-distribution.ts", batch]
                  : [
                      "scripts/seed-closing-price.ts",
                      process.env.KEEL_LOCAL_SCENARIO === "pre-distribution"
                        ? ".keel-local/scenarios/pre-distribution"
                        : ".keel-local/scenarios/closing-price",
                      "--next",
                    ]),
              ],
              { cwd: rootDir, timeout: 30000 },
            );
            const id = stdout.trim().split("\n").at(-1);
            if (!id || !/^[a-f0-9-]{36}$/i.test(id))
              throw new Error("Missing synthetic exposure.");
            res
              .writeHead(303, {
                Location: "/holdings?exposure=" + encodeURIComponent(id),
              })
              .end();
          } catch (error) {
            server.config.logger.error(String(error));
            res
              .writeHead(503)
              .end("The local market feed could not send the close.");
          }
        }
      });
    },
  };
}
