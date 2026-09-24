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

const IdentitySearchResponse = z.object({
  success: z.literal(1),
  search: z
    .array(
      z.object({
        id: z.string().regex(/^Q[1-9][0-9]*$/u),
        label: z.string().min(1).max(500),
        description: z.string().max(2_000).optional(),
        match: z.object({
          type: z.enum(["label", "alias"]),
          text: z.string().min(1).max(1_000),
        }),
      }),
    )
    .max(5),
});

/** One explicit search, no pagination, no candidate fetches, no inferred identity. */
export async function searchIssuerEvidence(
  companyName: string,
  key?: string,
  fetcher: typeof fetch = fetch,
) {
  // The default path must work in a deployment with no optional search secret.
  const url = new URL(
    key
      ? "https://api.search.brave.com/res/v1/web/search"
      : "https://www.wikidata.org/w/api.php",
  );
  if (key) {
    url.searchParams.set(
      "q",
      `"${issuerName(companyName).slice(0, 400)}" issuer company legal name`,
    );
    url.searchParams.set("count", "5");
    url.searchParams.set("text_decorations", "false");
  } else {
    for (const [name, value] of Object.entries({
      action: "wbsearchentities",
      search: issuerName(companyName).slice(0, 400),
      language: "en",
      uselang: "en",
      type: "item",
      limit: "5",
      format: "json",
    }))
      url.searchParams.set(name, value);
  }
  const response = await fetcher(url, {
    headers: key
      ? { Accept: "application/json", "X-Subscription-Token": key }
      : {
          Accept: "application/json",
          "User-Agent":
            "KeelIssuerReview/1.0 (https://github.com/cyyapye/keel-fi)",
        },
    redirect: "manual",
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
  const json: unknown = JSON.parse(new TextDecoder().decode(body));
  if (!key) {
    const parsed = IdentitySearchResponse.parse(json);
    return IssuerSearchResultsSchema.parse(
      parsed.search.map((entity) => ({
        title: entity.label,
        url: `https://www.wikidata.org/wiki/${entity.id}`,
        description: entity.description ?? "",
        identityNames: [entity.label, entity.match.text],
      })),
    );
  }
  const parsed = SearchResponse.parse(json);
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
