// Test-only entrypoint: production routes and authentication inside workerd.
import { createApp } from "../../apps/api/src/app";
import type { Env } from "../../apps/api/src/types";
import { D1AngelListMacAgentRepository } from "../../packages/database/src/angellist-mac-agent";
import { D1MacAgentCredentialRepository } from "../../packages/database/src/mac-agent-credentials";
import { D1ProviderBrowserSessionRepository } from "../../packages/database/src/provider-browser-sessions";
import { D1ProviderPortfolioAgentRepository } from "../../packages/database/src/provider-portfolio-agent";
import { measureD1 } from "./d1-meter";

// Full-day scenarios execute tens of thousands of real requests. The host test
// reports their measured totals; per-request informational logs would drown out
// that evidence. Keep errors and all production routing/authentication intact.
console.info = () => undefined;

export default {
  async fetch(
    request: Request,
    bindings: { DB: D1Database },
  ): Promise<Response> {
    const now = () =>
      new Date(Number(request.headers.get("x-synthetic-clock")));
    const measured = measureD1(bindings.DB);
    const db = measured.database;
    const app = createApp({
      macAgentCredentialRepository: new D1MacAgentCredentialRepository(db, now),
      angelListMacAgentRepository: new D1AngelListMacAgentRepository(db, now),
      providerPortfolioAgentRepository: new D1ProviderPortfolioAgentRepository(
        db,
        now,
      ),
      providerBrowserSessionRepository: new D1ProviderBrowserSessionRepository(
        db,
        now,
      ),
    });
    const env: Env = {
      DB: db,
      ENVIRONMENT: "preview",
      MAC_AGENT_API_ORIGIN: "https://agents.keel.example.com",
      DOCUMENTS: {} as R2Bucket,
      INGESTION_QUEUE: {} as Queue,
    };
    const response = await app.fetch(request, env);
    const result = new Response(response.body, response);
    result.headers.set("x-synthetic-d1-cost", JSON.stringify(measured.cost));
    return result;
  },
};
