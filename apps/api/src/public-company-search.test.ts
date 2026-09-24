import { describe, expect, it, vi } from "vitest";
import { recommendPublicCompany } from "@keel/domain/public-company-links";
import { searchIssuerEvidence } from "./public-company-search";

describe("bounded issuer evidence lookup", () => {
  it("calls only the search endpoint and returns safe distinct unconfirmed hosts", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Synthetic Harbor",
                url: "https://harbor.example/about",
                description: "Synthetic company website",
              },
              { title: "Same site", url: "https://harbor.example/news" },
              { title: "Private address", url: "https://127.0.0.1/" },
              { title: "Unsafe protocol", url: "http://unsafe.example/" },
            ],
          },
        }),
      ),
    );
    const results = await searchIssuerEvidence(
      "Synthetic Harbor",
      "synthetic-key",
      fetcher,
    );
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      url: "https://harbor.example/about",
      description: "Synthetic company website",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    expect(url).toBeInstanceOf(URL);
    if (!(url instanceof URL)) throw new Error("Expected a URL request");
    expect(url.origin + url.pathname).toBe(
      "https://api.search.brave.com/res/v1/web/search",
    );
    expect(url.searchParams.get("count")).toBe("5");
    expect(options?.redirect).toBe("error");
  });
  it("recommends an exact public identity alias without a search credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: 1,
          search: [
            {
              id: "Q123456789",
              label: "Demo Orbit",
              description: "Synthetic aerospace company",
              match: { type: "alias", text: "Demo Orbital Technologies Corp." },
            },
          ],
        }),
      ),
    );
    const results = await searchIssuerEvidence(
      "Demo Orbital Technologies Corp. - Ordinary Shares - Class A",
      undefined,
      fetcher,
    );
    const companies = [
      { id: "demo", name: "Demo Orbit", aliases: [], websiteHost: null },
    ];
    expect(
      recommendPublicCompany(
        "Demo Orbital Technologies Corp. - Ordinary Shares - Class A",
        companies,
        results,
      ),
    ).toMatchObject({
      status: "recommended",
      companyId: "demo",
      sourceUrl: "https://www.wikidata.org/wiki/Q123456789",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, options] = fetcher.mock.calls[0]!;
    if (!(url instanceof URL)) throw new Error("Expected URL request");
    expect(url.href).toContain("https://www.wikidata.org/w/api.php?");
    expect(url.searchParams.get("search")).toBe(
      "Demo Orbital Technologies Corp.",
    );
    expect(new Headers(options?.headers).has("X-Subscription-Token")).toBe(
      false,
    );
    expect(options?.redirect).toBe("error");
    // Similar names, a forged source host, and duplicate target identities stay unresolved.
    expect(
      recommendPublicCompany("Demo Orbital Systems Corp.", companies, results)
        .status,
    ).toBe("no_match");
    expect(
      recommendPublicCompany(
        "Demo Orbital Technologies Corp.",
        companies,
        results.map((result) => ({
          ...result,
          url: "https://www.wikidata.org.attacker.test/wiki/Q123456789",
        })),
      ).status,
    ).toBe("no_match");
    expect(
      recommendPublicCompany(
        "Demo Orbital Technologies Corp.",
        [...companies, { ...companies[0]!, id: "other" }],
        results,
      ).status,
    ).toBe("ambiguous");
    expect(
      recommendPublicCompany(
        "Demo Orbital Technologies Corp. ETF",
        companies,
        results,
      ).status,
    ).toBe("no_match");
    for (const body of [
      { error: { code: "maxlag" } },
      {
        success: 1,
        search: [
          {
            id: "Q1",
            label: "Demo",
            match: { type: "description", text: "Demo" },
          },
        ],
      },
    ]) {
      await expect(
        searchIssuerEvidence(
          "Demo",
          undefined,
          vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(JSON.stringify(body))),
        ),
      ).rejects.toThrow();
    }
  });
  it("rejects provider failures, oversized and malformed responses", async () => {
    for (const response of [
      new Response("limited", { status: 429 }),
      new Response("x".repeat(262145)),
      new Response('{"web":{"results":"invalid"}}'),
    ]) {
      await expect(
        searchIssuerEvidence(
          "Synthetic Harbor",
          "synthetic-key",
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ),
      ).rejects.toThrow();
    }
  });
});
