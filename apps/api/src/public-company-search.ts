import { z } from "zod";
import { canonicalizeCompanyWebsite } from "@keel/connectors";
import {
  IssuerSearchResultsSchema,
  issuerName,
} from "@keel/domain/public-company-links";

const SearchResponse = z.object({
  web: z
    .object({
      results: z
        .array(
          z.object({
            title: z.string().max(5_000),
            url: z.string().max(2_000),
            description: z.string().max(10_000).optional(),
          }),
        )
        .max(20),
    })
    .optional(),
});

/** One explicit search, no pagination, no candidate fetches, no inferred identity. */
export async function searchIssuerEvidence(
  companyName: string,
  key: string,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set(
    "q",
    `"${issuerName(companyName).slice(0, 400)}" issuer company legal name`,
  );
  url.searchParams.set("count", "5");
  url.searchParams.set("text_decorations", "false");
  const response = await fetcher(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok || response.body === null)
    throw new Error("website_search_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 256 * 1024)
        throw new Error("website_search_response_too_large");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const parsed = SearchResponse.parse(
    JSON.parse(new TextDecoder().decode(body)),
  );
  return IssuerSearchResultsSchema.parse(
    (parsed.web?.results ?? [])
      .flatMap((result) => {
        try {
          canonicalizeCompanyWebsite({
            companyId: "issuer-evidence",
            homepageUrl: result.url,
          });
          return [
            {
              title: result.title.slice(0, 500),
              url: result.url,
              description: (result.description ?? "").slice(0, 2_000),
            },
          ];
        } catch {
          return [];
        }
      })
      .slice(0, 5),
  );
}
