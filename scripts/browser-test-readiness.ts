import type { Plugin, ViteDevServer } from "vite";

export const BROWSER_TEST_VITE_READINESS_PATH = "/__keel_browser_test_ready";

const browserWarmupModules = [
  "/src/main.tsx",
  "/src/App.tsx",
  "/src/PortfolioSnapshot.tsx",
  "/src/collection-search.ts",
] as const;

async function warmBrowserModuleGraph(server: ViteDevServer): Promise<void> {
  for (const moduleUrl of browserWarmupModules) {
    const result = await server.transformRequest(moduleUrl);
    if (result === null) {
      throw new Error(`Vite did not transform ${moduleUrl}.`);
    }
  }

  // Vite pre-transforms static imports in the background and intentionally
  // suppresses those errors. Revisit each newly discovered graph layer through
  // the public transform API so readiness fails closed on a broken import.
  for (let graphLayer = 0; graphLayer < 20; graphLayer += 1) {
    await server.waitForRequestsIdle();
    const incompleteModules = [
      ...server.environments.client.moduleGraph.urlToModuleMap.values(),
    ].filter(
      (module) => module.type !== "asset" && module.transformResult === null,
    );
    if (incompleteModules.length === 0) return;
    for (const module of incompleteModules) {
      const result = await server.transformRequest(module.url);
      if (result === null) {
        throw new Error(`Vite did not transform ${module.url}.`);
      }
    }
  }

  throw new Error("Vite browser module warmup exceeded 20 graph layers.");
}

export function browserTestReadinessPlugin(): Plugin {
  return {
    name: "keel-browser-test-readiness",
    apply: "serve",
    configureServer(server) {
      let warmup: Promise<void> | undefined;
      let apiReadiness: Promise<boolean> | undefined;
      let apiReady = false;
      let fatalWarmupReported = false;

      async function verifyApiReadiness(): Promise<boolean> {
        const readinessPath = process.env.KEEL_BROWSER_API_READINESS_PATH;
        if (readinessPath === undefined) return true;
        if (apiReady) return true;
        if (apiReadiness !== undefined) return apiReadiness;

        const webPort = process.env.KEEL_WEB_PORT;
        if (webPort === undefined) return false;
        apiReadiness = (async () => {
          try {
            // Use Vite's proxy so readiness covers the same route the browser
            // consumes, while bounding a server that accepts but never replies.
            const response = await fetch(
              new URL(readinessPath, `http://127.0.0.1:${webPort}`),
              { signal: AbortSignal.timeout(5_000) },
            );
            await response.arrayBuffer();
            apiReady = response.ok;
            return apiReady;
          } catch {
            return false;
          } finally {
            apiReadiness = undefined;
          }
        })();
        return apiReadiness;
      }

      server.middlewares.use((request, response, next) => {
        void (async () => {
          const requestPath = new URL(request.url ?? "/", "http://127.0.0.1")
            .pathname;
          if (requestPath !== BROWSER_TEST_VITE_READINESS_PATH) {
            next();
            return;
          }

          response.setHeader("Cache-Control", "no-store");
          warmup ??= warmBrowserModuleGraph(server);
          try {
            await warmup;
          } catch (error) {
            response.statusCode = 500;
            response.end("Browser module warmup failed.\n");
            if (!fatalWarmupReported) {
              fatalWarmupReported = true;
              server.config.logger.error(
                `Browser module warmup failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              process.exitCode = 1;
              setImmediate(() => void server.close());
            }
            return;
          }

          if (!(await verifyApiReadiness())) {
            response.statusCode = 503;
            response.end("Browser API is not ready.\n");
            return;
          }

          response.statusCode = 204;
          response.end();
        })();
      });
    },
  };
}
