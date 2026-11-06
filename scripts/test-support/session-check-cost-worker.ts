import type { Page } from "@playwright/test";
import { z } from "zod";
import { createApp } from "../../apps/api/src/app";
import type { Env } from "../../apps/api/src/types";
import { handleRequest } from "../../apps/web/src/worker";
import { waitForKeelSession } from "../keel-session-check";
import { measureD1 } from "./d1-meter";

const count = z.number().int().nonnegative().safe();
export const SessionCheckCostResultSchema = z
  .object({
    scenarios: z
      .array(
        z
          .object({
            scenario: z.enum(["pending", "failure", "ready"]),
            attempts: z
              .array(
                z.object({ ready: z.boolean(), elapsedMs: count }).strict(),
              )
              .length(3),
            requests: count,
            cost: z
              .object({
                roundTrips: count,
                statements: count,
                rowsRead: count,
                rowsWritten: count,
              })
              .strict(),
          })
          .strict(),
      )
      .length(3),
    unexpectedRequests: count,
    assetRequests: count,
    unauthenticatedStatus: count,
    beforeUnauthenticated: count,
    afterUnauthenticated: count,
  })
  .strict();

const origin = new URL("https://keel.example.com");
let running = false;

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    if (running) return new Response(null, { status: 409 });
    running = true;
    const fetchBefore = globalThis.fetch;
    const infoBefore = console.info;
    try {
      const measured = measureD1(bindings.DB);
      let subject = "synthetic-unprovisioned-subject";
      const app = createApp({
        verifyAccess: () =>
          Promise.resolve({ kind: "user" as const, subject, email: null }),
      });
      const env: Env = {
        DB: measured.database,
        ENVIRONMENT: "preview",
        DOCUMENTS: {} as R2Bucket,
        INGESTION_QUEUE: {} as Queue,
      };
      let requests = 0;
      let failed = false;
      let unexpectedRequests = 0;
      let assetRequests = 0;
      console.info = () => undefined;
      globalThis.fetch = async (path, init) => {
        if (path !== "/api/session") {
          unexpectedRequests++;
          throw new Error("Unexpected setup request");
        }
        requests++;
        const response = await handleRequest(
          new Request(new URL(path, origin), {
            ...init,
            headers: { "Cf-Access-Jwt-Assertion": "synthetic-test-assertion" },
          }),
          {
            API: { fetch: async (next) => app.fetch(next, env) },
            ASSETS: {
              fetch: () => {
                assetRequests++;
                throw new Error("Session check fetched assets");
              },
            },
          },
        );
        return failed
          ? new Response("Synthetic proxy failure", { status: 503 })
          : response;
      };
      const page = {
        url: () => origin.href,
        evaluate: (callback: () => unknown) => callback(),
      } as unknown as Pick<Page, "url" | "evaluate">;
      const scenarios = [];
      for (const scenario of ["pending", "failure", "ready"] as const) {
        failed = scenario === "failure";
        subject =
          scenario === "pending"
            ? "synthetic-unprovisioned-subject"
            : "synthetic-access-subject";
        measured.reset();
        requests = 0;
        const attempts = [];
        for (let agent = 0; agent < 3; agent++) {
          let now = 0;
          const ready = await waitForKeelSession(page, origin, 30 * 60_000, {
            now: () => now,
            sleep: (delay) => {
              now += delay;
              return Promise.resolve();
            },
          });
          attempts.push({ ready, elapsedMs: now });
        }
        scenarios.push({
          scenario,
          attempts,
          requests,
          cost: { ...measured.cost },
        });
      }
      const beforeUnauthenticated = measured.cost.roundTrips;
      const unauthenticated = await app.request("/api/session", {}, env);
      return Response.json(
        SessionCheckCostResultSchema.parse({
          scenarios,
          unexpectedRequests,
          assetRequests,
          unauthenticatedStatus: unauthenticated.status,
          beforeUnauthenticated,
          afterUnauthenticated: measured.cost.roundTrips,
        }),
      );
    } finally {
      globalThis.fetch = fetchBefore;
      console.info = infoBefore;
      running = false;
    }
  },
};
