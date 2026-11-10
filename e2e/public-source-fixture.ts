import { resolve } from "node:path";
import { test as base } from "@playwright/test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { unstable_readConfig } from "wrangler";
import { z } from "zod";
import type { createPublicSourceFixture } from "./public-source-fixture-worker";

const localConfig = z.object({
  name: z.string(),
  compatibility_date: z.string(),
  compatibility_flags: z.array(z.string()),
  vars: z.object({
    ENVIRONMENT: z.literal("local"),
    CONNECTOR_CREDENTIAL_KEY: z.string().min(1),
  }),
  d1_databases: z.tuple([
    z.object({
      binding: z.literal("DB"),
      database_id: z.literal("00000000-0000-0000-0000-000000000000"),
    }),
  ]),
  r2_buckets: z.tuple([
    z.object({
      binding: z.literal("DOCUMENTS"),
      bucket_name: z.literal("keel-local-private-documents"),
    }),
  ]),
});
const identifier = z.string().min(1).max(256);
const createdFixture = z
  .object({
    connectionId: identifier,
    importId: identifier,
    nonce: z.uuid(),
    hasNext: z.boolean(),
  })
  .strict();
const nextReport = z.object({ importId: identifier }).strict();

// Run the existing production fixture operations beside the isolated D1/R2
// state. Browser reads, reconciliation and every assertion still use the API.
export const test = base.extend<
  Record<never, never>,
  {
    publicSourceFixture: (
      label: string,
      verified?: boolean,
      addition?: boolean,
      inventory?: boolean,
    ) => ReturnType<typeof createPublicSourceFixture>;
  }
>({
  publicSourceFixture: [
    // Playwright requires dependency destructuring even with no dependencies.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const persist = process.env.KEEL_LOCAL_PERSIST_TO;
      if (
        !persist ||
        (resolve(persist) !== resolve(".keel-local/e2e") &&
          !resolve(persist).startsWith(resolve(".keel-local/e2e-lanes") + "/"))
      )
        throw new Error(
          "Public source fixtures require an isolated E2E profile.",
        );
      const config = localConfig.parse(
        unstable_readConfig({
          config: resolve("apps/api/wrangler.jsonc"),
          env: "local",
        }),
      );
      const bundled = await build({
        entryPoints: ["e2e/public-source-fixture-worker.ts"],
        bundle: true,
        write: false,
        format: "esm",
        platform: "neutral",
        target: "es2022",
        conditions: ["workerd", "worker", "browser"],
        mainFields: ["browser", "module", "main"],
        external: ["node:*", "cloudflare:*"],
        logLevel: "silent",
      });
      const runtime = new Miniflare({
        name: config.name,
        script: bundled.outputFiles[0]!.text,
        modules: true,
        compatibilityDate: config.compatibility_date,
        compatibilityFlags: config.compatibility_flags,
        defaultPersistRoot: resolve(persist, "v3"),
        d1Databases: { DB: config.d1_databases[0].database_id },
        r2Buckets: { DOCUMENTS: config.r2_buckets[0].bucket_name },
        bindings: config.vars,
      });
      const dispatch = async (body: object) => {
        const response = await runtime.dispatchFetch(
          "https://synthetic-source-fixture.invalid/",
          {
            method: "POST",
            body: JSON.stringify(body),
          },
        );
        if (!response.ok) throw new Error("Synthetic source setup failed.");
        return response.json();
      };
      try {
        await use(
          async (
            label,
            verified = false,
            addition = false,
            inventory = false,
          ) => {
            const result = createdFixture.parse(
              await dispatch({
                operation: "create",
                label,
                verified,
                addition,
                inventory,
              }),
            );
            return {
              connectionId: result.connectionId,
              importId: result.importId,
              nonce: result.nonce,
              ...(result.hasNext
                ? {
                    next: async (mode: "returned" | "empty" | "partial") =>
                      nextReport.parse(
                        await dispatch({
                          operation: "next",
                          nonce: result.nonce,
                          mode,
                        }),
                      ).importId,
                  }
                : {}),
            };
          },
        );
      } finally {
        await runtime.dispose();
      }
    },
    { scope: "worker" },
  ],
});
