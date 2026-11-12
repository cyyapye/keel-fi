import { expect, test as base } from "@playwright/test";

export { expect };
export type { Page, Request } from "@playwright/test";

export const test = base.extend({
  serviceWorkers: "block",
  context: async ({ context }, use) => {
    // These reads are global shell/background concerns for the isolated visual
    // files. Individual tests register later routes when the response is part
    // of the behavior under review; Playwright gives those routes precedence.
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      await route.abort("blockedbyclient");
      throw new Error(
        `Mocked browser test made an unhandled application API request: ${request.method()} ${url.pathname}${url.search}`,
      );
    });
    await context.route("**/api/legal-entities", (route) =>
      route.request().method() !== "GET"
        ? route.fallback()
        : route.fulfill({
            json: {
              version: 3,
              asOf: "2026-09-01T12:00:00.000Z",
              entities: [],
              candidates: [],
              excludedCandidates: [],
              exactBatch: {
                revision: "a".repeat(64),
                sourceCount: 0,
                entityCount: 0,
                existingEntityCount: 0,
                newEntityCount: 0,
                llcEntityCount: 0,
                limitedPartnershipEntityCount: 0,
                remainingCandidateCount: 0,
              },
            },
          }),
    );
    await context.route("**/api/v1/investment-reconciliation?*", (route) => {
      const positionId = new URL(route.request().url()).searchParams.get(
        "positionId",
      );
      return route.fulfill({
        json: {
          context: {
            readContextId: null,
            accountId: "container:synthetic-browser-account",
            positionId,
            capturedAt: null,
            providerUpdatedAt: null,
            quantityEffectiveOn: null,
            priceAsOf: null,
            holdingsSnapshotId: null,
            coverage: {
              status: "not_synced",
              requestedFrom: null,
              requestedThrough: null,
              lastSuccessfulSyncAt: null,
              missingPeriods: [],
              scope: "provider_reported_window",
            },
            lastAttemptStatus: "not_synced",
          },
          status: "not_synced",
          reason: "Investment history has not been captured for this account.",
          openingSnapshotId: null,
          closingSnapshotId: null,
          openingQuantityMicros: null,
          activityQuantityMicros: null,
          expectedQuantityMicros: null,
          reportedQuantityMicros: null,
          unexplainedQuantityMicros: null,
          cashStatus: "not_established",
          basisStatus: "broker_reported_not_reconstructed",
        },
      });
    });
    await context.route("**/api/automation/angellist/status", (route) =>
      route.request().method() !== "GET"
        ? route.fallback()
        : route.fulfill({
            json: {
              version: 1,
              status: "setup_required",
              interval: "daily",
              runStatus: null,
              lastSeenAt: null,
              lastCompletedAt: null,
              nextRunAt: null,
              latestImportId: null,
              errorCode: null,
            },
          }),
    );
    await context.route("**/api/plan-actual-monitoring", (route) =>
      route.request().method() !== "GET"
        ? route.fallback()
        : route.fulfill({
            json: {
              version: 1,
              policyVersion: "plan-actual-v1",
              evaluatedAt: "2026-09-01T12:00:00.000Z",
              sourceRevision: "a".repeat(64),
              planId: "synthetic-browser-plan",
              status: "limited",
              coverage: {
                cash: "not_configured",
                debt: "not_configured",
                burn: "not_configured",
                runway: "limited",
              },
              actionItems: [],
              deferredItems: [],
            },
          }),
    );
    await use(context);
  },
});
