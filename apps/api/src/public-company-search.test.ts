import { describe, expect, it, vi } from "vitest";
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
