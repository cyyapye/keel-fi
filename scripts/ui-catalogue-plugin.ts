import { resolve } from "node:path";
import type { Plugin } from "vite";
import { buildUiCatalogue } from "./ui-catalogue";
import { buildUiGuide, guideIndex } from "./ui-guide";

const repository = resolve(import.meta.dirname, "..");

export async function catalogueAssets() {
  const guide = buildUiGuide();
  return new Map([
    ["/ui/index.html", await buildUiCatalogue()],
    ["/ui/agent-index.json", JSON.stringify(guideIndex(guide), null, 2)],
    ...guide.entries.map((entry): [string, string] => [
      entry.reference,
      JSON.stringify(entry, null, 2),
    ]),
  ]);
}

/** A separate static reference page, never part of the financial app's JS graph. */
export function uiCataloguePlugin(): Plugin {
  return {
    name: "keel-ui-catalogue",
    configureServer(server) {
      let pending: ReturnType<typeof catalogueAssets> | undefined;
      const roots = [
        "packages/ui/src",
        "apps/web/src",
        "e2e/ui-catalogue",
        "docs/product",
        "scripts/ui-guide.ts",
        "scripts/ui-catalogue.ts",
      ].map((path) => resolve(repository, path));
      server.watcher.add(roots);
      server.watcher.on("all", (_event, path) => {
        if (roots.some((root) => path === root || path.startsWith(`${root}/`)))
          pending = undefined;
      });
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? "/", "http://localhost").pathname;
        if (path !== "/ui" && !path.startsWith("/ui/")) {
          next();
          return;
        }
        if (path === "/ui") {
          response.writeHead(302, { Location: "/ui/" });
          response.end();
          return;
        }
        void (async () => {
          try {
            pending ??= catalogueAssets().catch((error: unknown) => {
              pending = undefined;
              throw error;
            });
            const assets = await pending;
            const asset = assets.get(path === "/ui/" ? "/ui/index.html" : path);
            response.writeHead(asset === undefined ? 404 : 200, {
              "Content-Type": path.endsWith(".json")
                ? "application/json; charset=utf-8"
                : "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            response.end(asset ?? "Catalogue reference not found.");
          } catch (error) {
            next(error);
          }
        })();
      });
    },
    async generateBundle() {
      for (const [path, source] of await catalogueAssets()) {
        this.emitFile({ type: "asset", fileName: path.slice(1), source });
      }
    },
  };
}
