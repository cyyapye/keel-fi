import { build } from "esbuild";
import {
  Miniflare,
  Response as RuntimeResponse,
  type Request as RuntimeRequest,
  Log,
  LogLevel,
} from "miniflare";
import { expect, it } from "vitest";

it("runs issuer lookup in Workers and rejects redirects before following them", async () => {
  const bundled = await build({
    stdin: {
      contents: `import { searchIssuerEvidence } from "./apps/api/src/public-company-search";
        import { recommendPublicCompany } from "./packages/domain/src/public-company-links";
        export default {async fetch() {
          try {
            const issuer = "Demo Orbital Technologies Corp. - Ordinary Shares";
            const sources = await searchIssuerEvidence(issuer);
            return Response.json(recommendPublicCompany(issuer,
              [{id:"demo", name:"Demo Orbit", aliases:[], websiteHost:null}], sources));
          } catch { return new Response("lookup failed", {status:502}); }
        }};`,
      resolveDir: process.cwd(),
    },
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
  let redirect = false;
  const requests: string[] = [];
  const runtime = new Miniflare({
    modules: true,
    script: bundled.outputFiles[0]!.text,
    compatibilityDate: "2026-07-28",
    compatibilityFlags: ["global_fetch_strictly_public", "nodejs_compat"],
    log: new Log(LogLevel.NONE),
    outboundService(request: RuntimeRequest) {
      requests.push(request.url);
      return redirect
        ? new RuntimeResponse(null, {
            status: 302,
            headers: { Location: "https://unexpected.example/" },
          })
        : RuntimeResponse.json({
            success: 1,
            search: [
              {
                id: "Q123456789",
                label: "Demo Orbit",
                match: {
                  type: "alias",
                  text: "Demo Orbital Technologies Corp.",
                },
              },
            ],
          });
    },
  });
  try {
    const result = await runtime.dispatchFetch(
      "https://synthetic-runtime.invalid/",
    );
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      status: "recommended",
      companyId: "demo",
    });
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!).origin).toBe("https://www.wikidata.org");
    redirect = true;
    const failed = await runtime.dispatchFetch(
      "https://synthetic-runtime.invalid/",
    );
    expect(failed.status).toBe(502);
    expect(requests).toHaveLength(2);
    expect(
      requests.every(
        (url) => new URL(url).origin === "https://www.wikidata.org",
      ),
    ).toBe(true);
  } finally {
    await runtime.dispose();
  }
});
