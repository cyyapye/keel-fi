import { expect, test } from "vitest";
import type { PublicSourceObservation } from "@keel/domain";
import { watchUpdatesForReview } from "./portfolio-watch-format";

test("prioritizes decisions and searches the entire Watch history before paging", () => {
  const observations: PublicSourceObservation[] = Array.from(
    { length: 125 },
    (_, index) => ({
      id: String(index),
      companyId: String(index),
      companyName:
        index === 124 ? "Distant Synthetic Company" : "Synthetic Company",
      evidenceEventId: `event-${index}`,
      evidenceStatus: index >= 122 ? "pending_review" : "accepted",
      readAt: index === 122 ? "2026-08-01T12:00:00Z" : null,
      sourceClass: "official_company",
      sourceUrl: "https://company.example/news",
      sourceTitle: "Company update",
      publishedAt: "2026-07-01T12:00:00Z",
      retrievedAt:
        index === 124
          ? "2026-07-01T06:02:00-07:00"
          : index >= 122
            ? "2026-07-01T12:00:00Z"
            : "2026-08-02T12:00:00Z",
      observedFact: "Company published an update",
      inference: "No valuation proposed",
      sourceReliabilityPpm: 800_000,
      modelConfidencePpm: 700_000,
      valuationLowMinor: null,
      valuationMiddleMinor: null,
      valuationHighMinor: null,
      financingFacts: null,
      limitations: "Synthetic report",
    }),
  );
  const decisions = new Set(["122", "123", "124"]);
  const updates = watchUpdatesForReview(observations, "", decisions);
  expect(updates).toHaveLength(125);
  expect(updates.slice(0, 3).map((item) => item.observation.id)).toEqual([
    "124",
    "123",
    "122",
  ]);
  const [match] = watchUpdatesForReview(observations, "  DISTANT  ", decisions);
  expect(match).toMatchObject({
    observation: { id: "124" },
    needsReview: true,
    unread: true,
  });
  decisions.delete("124");
  expect(watchUpdatesForReview(observations, "distant", decisions)).toEqual([
    { observation: observations[124], needsReview: false, unread: true },
  ]);
});
