import { resolve4, resolve6 } from "node:dns/promises";
import { z } from "zod";

import {
  fetchApprovedCompanySource,
  inspectApprovedCompanyDocument,
} from "../apps/api/src/portfolio-watch";
import { canonicalizeCompanyWebsite } from "../packages/connectors/src/index";
import type { FinancingAnnouncementFacts } from "../packages/domain/src/index";
import type { PortfolioWatchSourceRecord } from "../packages/database/src/portfolio-watch";

const ExpectedMoneyFactSchema = z
  .object({
    amountMinor: z.number().int().safe().nonnegative(),
    currency: z.string().regex(/^[A-Z]{3}$/u),
    qualifier: z
      .enum(["exact", "approximately", "at_least", "up_to"])
      .optional(),
  })
  .strict();

const ExpectedFinancingFactsSchema = z
  .object({
    roundType: z
      .enum([
        "pre_seed",
        "seed",
        "series",
        "growth",
        "strategic",
        "undisclosed",
      ])
      .nullable()
      .optional(),
    instrument: z
      .enum(["equity", "debt", "convertible", "mixed", "undisclosed"])
      .optional(),
    announcedAmount: ExpectedMoneyFactSchema.nullable().optional(),
    companyValuation: ExpectedMoneyFactSchema.extend({
      basis: z.enum(["pre_money", "post_money", "undisclosed"]).optional(),
    })
      .strict()
      .nullable()
      .optional(),
    ambiguities: z
      .array(
        z.enum([
          "currency_not_explicit",
          "multiple_funding_amounts",
          "multiple_valuations",
          "combined_tranches",
          "prior_round_reference",
        ]),
      )
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Expected financing facts must assert at least one field.",
  });

const LiveSourceInputSchema = z
  .array(
    z
      .object({
        companyName: z.string().trim().min(1).max(200),
        homepageUrl: z.url().max(2_048),
        expectedEventType: z
          .enum([
            "financing_announced",
            "acquisition_announced",
            "secondary_transaction_announced",
            "ipo_or_filing_announced",
            "shutdown_announced",
            "none",
            "coverage_gap",
          ])
          .optional(),
        expectedFinancingFacts: ExpectedFinancingFactsSchema.optional(),
      })
      .strict()
      .superRefine((input, context) => {
        if (
          input.expectedFinancingFacts !== undefined &&
          input.expectedEventType !== "financing_announced"
        ) {
          context.addIssue({
            code: "custom",
            path: ["expectedFinancingFacts"],
            message:
              "Expected financing facts require a financing_announced event.",
          });
        }
      }),
  )
  .min(1)
  .max(6);

async function resolveHost(host: string): Promise<readonly string[]> {
  const [ipv4, ipv6] = await Promise.all([
    resolve4(host).catch(() => []),
    resolve6(host).catch(() => []),
  ]);
  return [...ipv4, ...ipv6];
}

function sourceRecord(
  companyName: string,
  canonicalUrl: string,
  sourceKind: PortfolioWatchSourceRecord["sourceKind"] = "official_company_web",
): PortfolioWatchSourceRecord {
  const url = new URL(canonicalUrl);
  return {
    id: `runtime-source-${crypto.randomUUID()}`,
    householdId: "synthetic-live-household",
    watchTargetId: "synthetic-live-watch-target",
    companyId: "synthetic-live-company",
    companyName,
    approvedWebsiteHost: url.hostname,
    sourceKind,
    canonicalUrl: url.toString(),
    allowedOrigin: url.origin,
    allowedPathPrefix: url.pathname,
    status: "active",
    grade: {
      authorityPpm: 1_000_000,
      identityPpm: 1_000_000,
      securityPpm: 1_000_000,
      operationalPpm: 1_000_000,
    },
  };
}

function crawlPriority(urlValue: string): number {
  const path = new URL(urlValue).pathname.toLowerCase();
  if (/(?:sitemap|feed|rss|atom|\.xml)$/.test(path)) {
    return 0;
  }
  if (
    /(?:raise|series-|funding|financ|acqui|merger|ipo|public-offering|tender|employee-liquidity|secondary|shut|wind-down)/.test(
      path,
    )
  ) {
    return 1;
  }
  if (/\/(?:news|newsroom|press)\/.+/.test(path)) {
    return 2;
  }
  if (/\/(?:news|newsroom|press)\/?$/.test(path)) {
    return 3;
  }
  return 4;
}

function moneyFactMatches(
  actual:
    | FinancingAnnouncementFacts["announcedAmount"]
    | FinancingAnnouncementFacts["companyValuation"],
  expected: z.infer<typeof ExpectedMoneyFactSchema> | null | undefined,
): boolean {
  if (expected === undefined) {
    return true;
  }
  if (actual === null || expected === null) {
    return actual === expected;
  }
  return (
    actual.amountMinor === expected.amountMinor &&
    actual.currency === expected.currency &&
    (expected.qualifier === undefined ||
      actual.qualifier === expected.qualifier) &&
    (!("basis" in expected) ||
      expected.basis === undefined ||
      ("basis" in actual && actual.basis === expected.basis))
  );
}

function financingFactsMatch(
  actual: FinancingAnnouncementFacts,
  expected: z.infer<typeof ExpectedFinancingFactsSchema>,
): boolean {
  return (
    (expected.roundType === undefined ||
      actual.roundType === expected.roundType) &&
    (expected.instrument === undefined ||
      actual.instrument === expected.instrument) &&
    moneyFactMatches(actual.announcedAmount, expected.announcedAmount) &&
    moneyFactMatches(actual.companyValuation, expected.companyValuation) &&
    (expected.ambiguities === undefined ||
      [...actual.ambiguities].sort().join("|") ===
        [...expected.ambiguities].sort().join("|"))
  );
}

async function inspectCompany(
  input: z.infer<typeof LiveSourceInputSchema>[number],
) {
  const website = canonicalizeCompanyWebsite({
    companyId: "synthetic-live-company",
    homepageUrl: input.homepageUrl,
  });
  const pending: Array<{ source: PortfolioWatchSourceRecord; depth: number }> =
    [
      {
        source: sourceRecord(input.companyName, website.homepageUrl),
        depth: 0,
      },
    ];
  const visited = new Set<string>();
  const eventTypes = new Set<string>();
  const financingFacts: FinancingAnnouncementFacts[] = [];
  const failureReasons = new Map<string, number>();
  let fetchedCount = 0;
  let discoveredCount = 0;

  while (pending.length > 0 && visited.size < 30) {
    const item = pending.shift();
    if (item === undefined || visited.has(item.source.canonicalUrl)) {
      continue;
    }
    visited.add(item.source.canonicalUrl);
    const fetched = await fetchApprovedCompanySource(item.source, {
      resolveHost,
    });
    if (!fetched.ok) {
      failureReasons.set(
        fetched.reason,
        (failureReasons.get(fetched.reason) ?? 0) + 1,
      );
      continue;
    }
    fetchedCount += 1;
    const inspected = inspectApprovedCompanyDocument(
      item.source,
      fetched.text,
      fetched.contentType,
    );
    inspected.events.forEach((event) => {
      eventTypes.add(event.eventType);
      if (event.financingFacts !== null) {
        financingFacts.push(event.financingFacts);
      }
    });
    discoveredCount += inspected.candidates.length;

    if (item.depth < 3) {
      for (const candidate of inspected.candidates) {
        if (!visited.has(candidate.canonicalUrl)) {
          pending.push({
            source: sourceRecord(
              input.companyName,
              candidate.canonicalUrl,
              candidate.sourceKind,
            ),
            depth: item.depth + 1,
          });
        }
      }
      pending.sort(
        (left, right) =>
          crawlPriority(left.source.canonicalUrl) -
          crawlPriority(right.source.canonicalUrl),
      );
    }

    if (
      input.expectedEventType !== undefined &&
      input.expectedEventType !== "none" &&
      input.expectedEventType !== "coverage_gap" &&
      eventTypes.has(input.expectedEventType) &&
      (input.expectedFinancingFacts === undefined ||
        financingFacts.some((facts) =>
          financingFactsMatch(facts, input.expectedFinancingFacts!),
        ))
    ) {
      break;
    }
  }

  const expected = input.expectedEventType;
  const financingFactsMatched =
    input.expectedFinancingFacts === undefined
      ? null
      : financingFacts.some((facts) =>
          financingFactsMatch(facts, input.expectedFinancingFacts!),
        );
  const passed =
    expected === "coverage_gap"
      ? fetchedCount === 0 && failureReasons.size > 0
      : fetchedCount > 0 &&
        discoveredCount > 0 &&
        (expected === undefined
          ? eventTypes.size > 0
          : expected === "none"
            ? eventTypes.size === 0
            : eventTypes.has(expected)) &&
        financingFactsMatched !== false;
  return {
    fetchedCount,
    discoveredCount,
    eventTypes: [...eventTypes].sort(),
    financingFactsObservedCount: financingFacts.length,
    financingFactsMatched,
    failureReasons: Object.fromEntries(failureReasons),
    passed,
  };
}

const rawInputs = process.env.KEEL_LIVE_COMPANY_SOURCES_JSON;
if (rawInputs === undefined) {
  throw new Error(
    "Set KEEL_LIVE_COMPANY_SOURCES_JSON to a runtime-only JSON array of real public company homepages.",
  );
}

const inputs = LiveSourceInputSchema.parse(JSON.parse(rawInputs));
const results = [];
for (const input of inputs) {
  results.push(await inspectCompany(input));
}
console.info(JSON.stringify({ results }, null, 2));
if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
}
