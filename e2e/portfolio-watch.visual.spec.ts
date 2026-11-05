import {
  devices,
  expect,
  test,
  type Page,
  type TestInfo,
} from "@playwright/test";

import { PortfolioWatchActivitySchema } from "../packages/domain/src/portfolio-watch-activity";
import { navigateToScreen } from "./navigation";

const captureDesignReview = process.env.KEEL_CAPTURE_DESIGN_VARIANTS === "1";

const financingFactsFixture = {
  roundType: "series",
  roundLabel: "Series C",
  instrument: "equity",
  announcedAmount: {
    amountMinor: 6_200_000_000,
    currency: "USD",
    qualifier: "exact",
    evidenceText:
      "announced a US$62 million Series C financing at a US$310 million post-money company valuation",
  },
  companyValuation: {
    amountMinor: 31_000_000_000,
    currency: "USD",
    qualifier: "exact",
    basis: "post_money",
    evidenceText:
      "announced a US$62 million Series C financing at a US$310 million post-money company valuation",
  },
  ambiguities: [],
};

const portfolioWatchFixture = {
  targets: [
    {
      id: "watch_harbor",
      companyId: "co_harbor",
      companyName: "Harbor Health Systems",
      officialHost: "harbor-health.example",
      status: "active",
      coverageStatus: "active",
      lastCheckedAt: "2026-08-02T12:00:00.000Z",
      latestObservationAt: "2026-08-02T12:00:00.000Z",
    },
    {
      id: "watch_lattice",
      companyId: "co_lattice",
      companyName: "Lattice Grove Energy",
      officialHost: "lattice-grove.example",
      status: "active",
      coverageStatus: "degraded",
      lastCheckedAt: "2026-08-02T12:00:00.000Z",
      latestObservationAt: null,
    },
    {
      id: "watch_northstar",
      companyId: "co_northstar",
      companyName: "Northstar Robotics",
      officialHost: "northstar-robotics.example",
      status: "active",
      coverageStatus: "unavailable",
      lastCheckedAt: "2026-08-02T12:00:00.000Z",
      latestObservationAt: null,
    },
  ],
  observations: [
    {
      id: "obs_watch_harbor_series_c",
      companyId: "co_harbor",
      companyName: "Harbor Health Systems",
      evidenceEventId: "evt_watch_harbor_series_c",
      evidenceStatus: "pending_review",
      sourceClass: "official_company",
      sourceUrl:
        "https://newsroom.harbor-health.example/updates/series-c-financing",
      sourceTitle: "Synthetic Series C financing announcement",
      publishedAt: "2026-07-31T20:00:00.000Z",
      retrievedAt: "2026-08-02T12:00:00.000Z",
      observedFact:
        "announced a US$62 million Series C financing at a US$310 million post-money company valuation. Retained parsing context must not be rendered in full on the financing card.",
      inference:
        "This is a company-level public signal. It does not imply a holding value or liquidity outcome.",
      sourceReliabilityPpm: 920_000,
      modelConfidencePpm: 610_000,
      valuationLowMinor: 93_000_000,
      valuationMiddleMinor: 118_000_000,
      valuationHighMinor: 142_000_000,
      financingFacts: financingFactsFixture,
      limitations:
        "The public announcement does not disclose the SPV's exact ownership, security preferences, dilution, fees, carry, or settlement terms.",
    },
  ],
};

const ambiguousFinancingItem = {
  id: "evt_watch_harbor_conflicting_financing",
  companyName: "Harbor Health Systems",
  eventType: "financing_announced",
  headline: "Synthetic financing amounts need source review",
  detectedAt: "2026-08-02T12:00:00.000Z",
  effectiveDate: "2026-07-31",
  status: "pending_review",
  confidencePpm: 920_000,
  modelConfidencePpm: 610_000,
  sources: ["Official company website"],
  sourceUrl:
    "https://newsroom.harbor-health.example/updates/conflicting-financing",
  sourceExcerpt:
    "Harbor Health Systems announced USD 40 million in financing and a separate USD 15 million investment.",
  priorValue: "Not set",
  replacementValue: "Not set",
  forecastImpactMinor: 0,
  financingFacts: {
    roundType: "series",
    roundLabel: "Series C",
    instrument: "undisclosed",
    announcedAmount: null,
    companyValuation: null,
    ambiguities: ["multiple_funding_amounts"],
  },
  application: null,
};

const watchSourceFixture = {
  id: "source_harbor",
  targetId: "watch_harbor",
  url: "https://harbor-health.example/news",
  kind: "official_company_web",
  status: "active",
  lastAttemptAt: "2026-08-02T12:00:00.000Z",
  lastCompletedAt: "2026-08-02T12:00:00.000Z",
  lastSuccessAt: "2026-08-02T12:00:00.000Z",
  nextCheckAt: "2026-08-09T12:00:00.000Z",
  pendingState: null,
  outcome: "succeeded",
  errorCode: null,
  httpStatus: 200,
  signalCount: 1,
};
const watchActivityFixture = {
  asOf: "2026-08-02T12:00:00.000Z",
  summary: {
    companyCount: 3,
    companiesWithoutWebsite: 1,
    companiesWithVerifiedSources: 1,
    sourceCount: 3,
    unavailableCount: 1,
    neverCheckedCount: 0,
    lastSuccessAt: "2026-08-02T12:00:00.000Z",
    nextCheckAt: "2026-08-02T13:00:00.000Z",
  },
  companies: [
    {
      id: "watch_harbor",
      companyName: "Harbor Health Systems",
      officialHost: "harbor-health.example",
      sources: [
        watchSourceFixture,
        {
          ...watchSourceFixture,
          id: "source_harbor_feed",
          url: "https://harbor-health.example/feed.xml",
          kind: "official_rss",
          signalCount: 0,
        },
      ],
    },
    {
      id: "watch_lattice",
      companyName: "Lattice Grove Energy",
      officialHost: "lattice-grove.example",
      sources: [
        {
          ...watchSourceFixture,
          id: "source_lattice",
          targetId: "watch_lattice",
          url: "https://lattice-grove.example/news",
          status: "degraded",
          outcome: "failed",
          errorCode: "source_timeout",
          lastSuccessAt: "2026-07-26T12:00:00.000Z",
          nextCheckAt: "2026-08-02T13:00:00.000Z",
          signalCount: 0,
        },
      ],
    },
    {
      id: "watch_northstar",
      companyName: "Northstar Robotics",
      officialHost: null,
      sources: [],
    },
  ],
  matchingCompanyCount: 3,
  nextCursor: null,
  runs: [
    {
      id: "run_watch",
      trigger: "scheduled",
      requestedAt: "2026-08-02T11:59:00.000Z",
      startedAt: "2026-08-02T11:59:10.000Z",
      completedAt: "2026-08-02T12:00:00.000Z",
      deadlineAt: "2026-08-02T12:14:00.000Z",
      status: "partial",
      totalCount: 3,
      completedCount: 3,
      succeededCount: 2,
      failedCount: 1,
      skippedCount: 0,
      signalCount: 1,
    },
  ],
};

test.use({ timezoneId: "America/Los_Angeles" });
test.beforeEach(async ({ page }) => {
  await page.route("**/api/watch/activity**", async (route) => {
    await route.fulfill({ json: watchActivityFixture });
  });
});

async function checkFailedMonitoringLayout(page: Page, testInfo: TestInfo) {
  const alpha = await (await page.request.get("/api/alpha")).json();
  const readNews = {
    ...portfolioWatchFixture.observations[0]!,
    sourceTitle: "Harbor opens a new clinic",
    observedFact: "Harbor opens a new clinic",
    financingFacts: null,
    valuationLowMinor: null,
    valuationMiddleMinor: null,
    valuationHighMinor: null,
    readAt: "2026-08-02T12:30:00.000Z",
    readVersion: 1,
  };
  await page.route("**/api/alpha", (route) =>
    route.fulfill({
      json: {
        ...alpha,
        signalReconciliations: [],
        portfolioWatch: { ...portfolioWatchFixture, observations: [readNews] },
      },
    }),
  );
  const failed = PortfolioWatchActivitySchema.parse({
    ...watchActivityFixture,
    summary: {
      ...watchActivityFixture.summary,
      companiesWithVerifiedSources: 0,
      unavailableCount: 3,
      lastSuccessAt: "2026-08-01T12:00:00.000Z",
    },
    companies: watchActivityFixture.companies.map((company) => ({
      ...company,
      sources: company.sources.map((source) => ({
        ...source,
        outcome: "failed",
        errorCode: "source_timeout",
        httpStatus: null,
        signalCount: 0,
        lastSuccessAt: "2026-08-01T12:00:00.000Z",
      })),
    })),
    runs: [
      {
        ...watchActivityFixture.runs[0],
        status: "failed",
        succeededCount: 0,
        failedCount: 3,
        signalCount: 0,
      },
      {
        ...watchActivityFixture.runs[0]!,
        id: "run_prior_success",
        requestedAt: "2026-08-01T11:59:00.000Z",
        startedAt: "2026-08-01T11:59:10.000Z",
        completedAt: "2026-08-01T12:00:00.000Z",
        deadlineAt: "2026-08-01T12:14:00.000Z",
        status: "succeeded",
        succeededCount: 3,
        failedCount: 0,
        signalCount: 0,
      },
    ],
  });
  await page.route("**/api/watch/activity**", (route) =>
    route.fulfill({ json: failed }),
  );
  await page.goto("/watch");
  // Wait for the lazy page to mount before asserting its loaded-state layout.
  await page
    .getByRole("heading", { name: "Portfolio Watch", exact: true })
    .waitFor();
  const monitor = page.getByTestId("portfolio-watch-control");
  const empty = page
    .getByRole("heading", { name: "No unread updates", exact: true })
    .locator("..");
  const filters = page.getByRole("group", { name: "Filter updates" });
  await expect(
    monitor.getByText("Last check failed", { exact: true }),
  ).toBeVisible();
  await expect(
    monitor.getByRole("button", { name: "Check now", exact: true }),
  ).toBeEnabled();
  await expect(
    monitor.getByText("0 of 3 pages and feeds read · 3 unavailable"),
  ).toBeVisible();
  await expect(monitor).toContainText(
    "Last successful read Aug 1, 2026, 5:00 AM PDT",
  );
  await expect(monitor).toContainText("Last attempt Aug 2, 2026");
  await expect(monitor).not.toContainText("No new updates");
  await expect(
    empty.getByText("Previously read news is available under All updates."),
  ).toBeVisible();
  await expect(
    filters.getByRole("button", { name: "Unread (0)" }),
  ).toHaveAttribute("aria-pressed", "true");

  const viewport = page.viewportSize()!;
  for (const width of [320, viewport.width]) {
    await page.setViewportSize({ width, height: viewport.height });
    // These layout contracts remain required even when someone updates a screenshot.
    const insets = await monitor.evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.paddingTop, style.paddingBottom].map(Number.parseFloat);
    });
    for (const inset of insets) expect(inset).toBeGreaterThanOrEqual(16);
    // Status copy communicates the limitation; a frame adds no information.
    for (const side of ["top", "right", "bottom", "left"]) {
      await expect(monitor).toHaveCSS(`border-${side}-width`, "0px");
    }
    await expect(empty).toHaveCSS("text-align", "left");
    await expect(empty).toHaveCSS("padding", "0px");
    await expect(empty).toHaveCSS("min-height", "0px");
    await expect(empty.locator('[aria-hidden="true"]')).toHaveCount(0);
    const screenBounds = (await page.locator(".watch-screen").boundingBox())!;
    const statusBounds = (await monitor
      .getByText("Last check failed", { exact: true })
      .boundingBox())!;
    expect(statusBounds.x).toBeCloseTo(screenBounds.x, 0);
    for (const button of await filters.getByRole("button").all()) {
      await expect(button).toHaveCSS("text-decoration-line", "none");
      await expect(button).toHaveCSS("border-top-style", "solid");
      const bounds = (await button.boundingBox())!;
      expect(bounds.height).toBeGreaterThanOrEqual(width <= 620 ? 44 : 34);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(
        screenBounds.x + screenBounds.width + 1,
      );
    }
    const emptyBounds = (await empty.boundingBox())!;
    expect(emptyBounds.x).toBeCloseTo(screenBounds.x, 0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
  if (captureDesignReview) {
    await page.screenshot({
      path: testInfo.outputPath("review-empty-viewport.png"),
    });
    if (testInfo.project.name === "chromium") return failed.runs;
  }
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  await page.mouse.move(0, 0);
  await expect(page.locator(".watch-screen")).toHaveScreenshot(
    "portfolio-watch-empty-limited.png",
    { animations: "disabled" },
  );
  await filters
    .getByRole("button", { name: "All updates", exact: true })
    .click();
  await expect(
    page.getByRole("article", { name: readNews.sourceTitle, exact: true }),
  ).toBeVisible();
  await monitor.getByRole("button", { name: "View coverage & issues" }).click();
  await expect(
    page.getByRole("tab", { name: "Coverage", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  return failed.runs;
}

test(
  "keeps Portfolio Watch visually sparse and decision-oriented",
  { tag: captureDesignReview ? [] : "@desktop-only" },
  async ({ page }, testInfo) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const liveAlpha = (await alphaResponse.json()) as Record<string, unknown>;
    const alphaFixture = {
      ...liveAlpha,
      evidenceInbox: [],
      portfolioWatch: portfolioWatchFixture,
    };

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });
    await page.clock.install({ time: new Date("2026-08-02T12:00:00.000Z") });
    let checking = false;
    let completed = false;
    await page.route("**/api/watch/activity**", async (route) => {
      const state =
        !checking || completed
          ? watchActivityFixture
          : {
              ...watchActivityFixture,
              companies: watchActivityFixture.companies.map((company) => ({
                ...company,
                sources: company.sources.map((source) => ({
                  ...source,
                  pendingState: "queued",
                })),
              })),
              runs: [
                {
                  ...watchActivityFixture.runs[0],
                  id: "run_manual",
                  trigger: "manual",
                  status: "queued",
                  requestedAt: "2026-08-02T12:00:00.000Z",
                  startedAt: null,
                  completedAt: null,
                  deadlineAt: "2026-08-02T12:15:00.000Z",
                  completedCount: 0,
                  succeededCount: 0,
                  failedCount: 0,
                  signalCount: 0,
                },
              ],
            };
      await route.fulfill({
        json: route.request().url().includes("/progress?")
          ? {
              asOf: state.asOf,
              runs: state.runs,
              sources: state.companies.flatMap<unknown>(
                (company) => company.sources,
              ),
            }
          : state,
      });
    });
    await page.route("**/api/watch/scan", async (route) => {
      checking = true;
      await route.fulfill({
        json: {
          checkedAt: "2026-08-02T12:00:00.000Z",
          discoveredCount: 0,
          proposedCount: 0,
          queuedCount: 3,
        },
      });
    });
    await page.goto("/");
    const mobile = testInfo.project.name === "mobile-chromium";
    await navigateToScreen(page, mobile, /Watch/);
    const checkButton = page.getByRole("button", {
      name: "Check now",
      exact: true,
    });
    await expect(checkButton).toBeEnabled();
    await expect(page.locator(".watch-check-title")).toHaveText(
      "Monitoring limited",
    );
    await expect(page.getByTestId("portfolio-watch-control")).toContainText(
      "2 of 3 pages and feeds read",
    );
    if (captureDesignReview) {
      await page.screenshot({
        path: testInfo.outputPath("review-initial-viewport.png"),
      });
    }
    await checkButton.click();
    await expect(
      page.getByText("Waiting to check sources", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Checking…", exact: true }),
    ).toBeDisabled();
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    await page.mouse.move(0, 0);
    if (!mobile)
      await expect(page.locator(".watch-screen")).toHaveScreenshot(
        "portfolio-watch-running.png",
        { animations: "disabled" },
      );
    completed = true;
    await page.clock.fastForward(10_000);
    await expect(checkButton).toBeEnabled();
    await expect(page.getByTestId("portfolio-watch-control")).toContainText(
      "2 of 3 pages and feeds read",
    );
    await page.getByRole("tab", { name: "Coverage", exact: true }).click();
    await page.getByTestId("watch-target-watch_lattice").click();
    await expect(
      page.getByText("The site did not respond. Keel will retry."),
    ).toBeVisible();
    await expect(page.getByText(/Last successful read: Jul 26/)).toBeVisible();
    await expect(
      page.getByTestId("watch-target-watch_northstar"),
    ).toContainText("Official website not identified");
    if (captureDesignReview) {
      await page.locator(".watch-screen").screenshot({
        path: testInfo.outputPath("review-coverage.png"),
        animations: "disabled",
      });
      if (mobile) return;
    }
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    await page.mouse.move(0, 0);
    await expect(page.locator(".watch-screen")).toHaveScreenshot(
      "portfolio-watch.png",
      { animations: "disabled" },
    );
    await page
      .getByRole("button", { name: "Check history", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Scheduled check · Completed with unavailable sources",
      }),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Updates", exact: true }).click();
    await expect(page.getByText(/Found Aug 2, 2026/)).toBeVisible();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await expect(page.getByText("Reported financing")).toBeVisible();
    await expect(
      page.getByText("Series C · Equity", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("USD 62M", { exact: true })).toBeVisible();
    await expect(
      page.getByText("USD 310M · post-money company valuation", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Source wording: “announced a US$62 million Series C financing at a US$310 million post-money company valuation”",
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Classification confidence|Model confidence|Source reliability/,
      ),
    ).toHaveCount(0);
    await expect(page.getByText(/Retained parsing context/)).toHaveCount(0);
    await expect(page.getByText("Estimated range")).toHaveCount(0);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    await page.addStyleTag({
      content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
    });
    await page.mouse.move(0, 0);

    const watchScreen = page.locator(".watch-screen");
    const watchWidths = await watchScreen.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(watchWidths.scroll).toBeLessThanOrEqual(watchWidths.client);

    await expect(watchScreen).toHaveScreenshot("portfolio-watch-signals.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });
  },
);

test(
  "keeps empty, failed and timed-out checks distinct and restores saved history after reload",
  { tag: captureDesignReview ? [] : "@mobile-only" },
  async ({ page, isMobile }, testInfo) => {
    const priorRuns = await checkFailedMonitoringLayout(page, testInfo);
    if (!isMobile) return;
    let state = PortfolioWatchActivitySchema.parse({
      ...watchActivityFixture,
      asOf: "2026-08-02T12:00:30.000Z",
      summary: {
        ...watchActivityFixture.summary,
        lastSuccessAt: "2026-08-02T12:00:30.000Z",
        companiesWithVerifiedSources: 2,
        unavailableCount: 0,
      },
      companies: watchActivityFixture.companies.map((company) => ({
        ...company,
        sources: company.sources.map((source) => ({
          ...source,
          outcome: "succeeded",
          errorCode: null,
          httpStatus: 200,
          signalCount: 0,
          lastSuccessAt: "2026-08-02T12:00:00.000Z",
        })),
      })),
      runs: [
        {
          ...watchActivityFixture.runs[0]!,
          id: "run_recovery",
          requestedAt: "2026-08-02T12:00:01.000Z",
          startedAt: "2026-08-02T12:00:02.000Z",
          completedAt: "2026-08-02T12:00:30.000Z",
          deadlineAt: "2026-08-02T12:15:01.000Z",
          status: "succeeded",
          totalCount: 3,
          completedCount: 3,
          succeededCount: 3,
          failedCount: 0,
          signalCount: 0,
        },
        ...priorRuns,
      ],
    });
    await page.route("**/api/watch/activity**", async (route) =>
      route.fulfill({ json: PortfolioWatchActivitySchema.parse(state) }),
    );
    await page.reload();
    const summary = page.getByTestId("portfolio-watch-control");
    await expect(summary).toContainText("No new updates from those sources");
    // A successful check is not full portfolio coverage when companies lack sources.
    await expect(summary.locator(".watch-check-title")).toHaveText(
      "Monitoring limited",
    );
    await expect(summary).toContainText("Last attempt Aug 2, 2026");
    const failedRun = {
      ...state.runs[0]!,
      id: "run_failed",
      requestedAt: "2026-08-03T11:59:00.000Z",
      startedAt: "2026-08-03T11:59:10.000Z",
      completedAt: "2026-08-03T12:00:00.000Z",
      deadlineAt: "2026-08-03T12:14:00.000Z",
      status: "failed" as const,
      succeededCount: 0,
      failedCount: 3,
    };
    state = {
      ...state,
      asOf: "2026-08-04T12:15:00.000Z",
      summary: {
        ...state.summary,
        companiesWithVerifiedSources: 0,
        unavailableCount: 3,
        nextCheckAt: "2026-08-04T13:00:00.000Z",
      },
      companies: state.companies.map((company) => ({
        ...company,
        sources: company.sources.map((source) => ({
          ...source,
          outcome: "failed",
          errorCode: "check_timed_out",
          httpStatus: null,
          lastAttemptAt: "2026-08-04T11:59:10.000Z",
          lastCompletedAt: "2026-08-04T12:15:00.000Z",
          nextCheckAt: "2026-08-04T13:00:00.000Z",
        })),
      })),
      runs: [
        {
          ...failedRun,
          id: "run_timeout",
          requestedAt: "2026-08-04T11:59:00.000Z",
          startedAt: "2026-08-04T11:59:10.000Z",
          completedAt: "2026-08-04T12:15:00.000Z",
          deadlineAt: "2026-08-04T12:14:00.000Z",
          status: "timed_out",
          completedCount: 0,
          failedCount: 0,
        },
        failedRun,
        ...state.runs,
      ],
    };
    await page.reload();
    await expect(summary).toContainText("This check did not finish");
    await expect(summary.locator(".watch-check-title")).toHaveText(
      "Last check timed out",
    );
    await expect(summary).toContainText("Last attempt Aug 4, 2026");
    await expect(summary).toContainText("Last successful read Aug 2, 2026");
    await expect(summary).toHaveScreenshot("portfolio-watch-timeout.png");
    if (captureDesignReview) {
      await page.screenshot({
        path: testInfo.outputPath("review-timeout.png"),
      });
    }
    await expect(
      page.getByRole("button", { name: "Check now", exact: true }),
    ).toBeEnabled();
    await page.route("**/api/watch/scan", async (route) =>
      route.fulfill({
        json: {
          checkedAt: state.asOf,
          discoveredCount: 0,
          proposedCount: 0,
          queuedCount: 0,
        },
      }),
    );
    await page.getByRole("button", { name: "Check now", exact: true }).click();
    await expect(
      page.getByText(
        "No eligible sources were available to check. Open Coverage for details.",
      ),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Coverage", exact: true }).click();
    await page
      .getByRole("button", { name: "Check history", exact: true })
      .click();
    const history = page.locator(".watch-run-list article");
    await expect(history).toHaveCount(5);
    await expect(history.nth(0)).toContainText("Did not finish");
    await expect(history.nth(1)).toContainText(
      "0 of 3 pages and feeds read · 3 unavailable",
    );
    await expect(history.nth(1)).toContainText("Requested Aug 3, 2026");
    await expect(history.nth(2)).toContainText(
      "No new updates from those sources",
    );
    await expect(history.nth(2)).toContainText("Requested Aug 2, 2026");
    await expect(history.nth(3)).toContainText(
      "0 of 3 pages and feeds read · 3 unavailable",
    );
    await expect(history.nth(4)).toContainText("Requested Aug 1, 2026");
  },
);

test(
  "bounds the company list and recovers an activity read failure",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const companies = Array.from({ length: 120 }, (_, index) => ({
      id: `synthetic-company-${index}`,
      officialHost: `synthetic-company-${index}.example`,
      companyName:
        index === 0
          ? "SyntheticCompany".repeat(8)
          : `Synthetic company ${index + 1}`,
      sources: Array.from({ length: 50 }, (_, sourceIndex) => ({
        ...watchSourceFixture,
        id: `source-${index}-${sourceIndex}`,
        targetId: `synthetic-company-${index}`,
        url: `https://synthetic-company-${index}.example/source-${sourceIndex}`,
      })),
    }));
    let unavailable = true;
    let releaseOldSearch: (() => void) | undefined;
    let oldSearchSettled = false;
    await page.route("**/api/watch/activity**", async (route) => {
      if (unavailable)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic unavailable response" },
        });
      const params = new URL(route.request().url()).searchParams;
      const start = Number(params.get("cursor") ?? 0);
      const query = (params.get("q") ?? "").toLowerCase();
      const matching = companies.filter((company) =>
        company.companyName.toLowerCase().includes(query),
      );
      if (query === "syntheticcompany")
        await new Promise<void>((resolve) => {
          releaseOldSearch = resolve;
        });
      const response = route.fulfill({
        json: {
          ...watchActivityFixture,
          companies: matching.slice(start, start + 20),
          matchingCompanyCount: matching.length,
          summary: {
            ...watchActivityFixture.summary,
            companyCount: 120,
            sourceCount: 6000,
          },
          nextCursor: start + 20 < matching.length ? String(start + 20) : null,
        },
      });
      if (query === "syntheticcompany") {
        // Aborted requests may discard their mocked response entirely.
        await response.catch(() => undefined);
        oldSearchSettled = true;
      } else await response;
    });
    await page.goto("/watch");
    await expect(
      page.getByText("Couldn’t load source activity. Try again."),
    ).toBeVisible();
    unavailable = false;
    await page.getByRole("button", { name: "Refresh activity" }).click();
    await page.getByRole("tab", { name: "Coverage", exact: true }).click();
    await expect(page.locator(".watch-company-trigger")).toHaveCount(20);
    await expect(
      page.getByRole("heading", {
        name: "120 companies · 6000 pages and feeds",
      }),
    ).toBeVisible();
    await page.getByTestId("watch-target-synthetic-company-0").click();
    await expect(page.locator(".watch-source-detail")).toHaveCount(0);
    await page
      .getByRole("button", { name: "Pages and check details (50)" })
      .click();
    await expect(page.locator(".watch-source-detail")).toHaveCount(5);
    await page
      .getByRole("button", { name: "Show more pages", exact: true })
      .click();
    await expect(page.locator(".watch-source-detail")).toHaveCount(10);
    const viewport = page.viewportSize()!;
    for (const width of [viewport.width, devices["Pixel 7"].viewport.width]) {
      await page.setViewportSize({ width, height: viewport.height });
      const bounds = await page
        .locator(".watch-screen")
        .evaluate((element) => ({
          client: element.clientWidth,
          scroll: element.scrollWidth,
        }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
      expect(bounds.client).toBeLessThanOrEqual(width);
    }
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Next companies" }).click();
    await expect(
      page.getByTestId("watch-target-synthetic-company-20"),
    ).toBeVisible();
    await expect(
      page.getByTestId("watch-target-synthetic-company-0"),
    ).toHaveCount(0);
    await expect(page.locator(".watch-company-trigger")).toHaveCount(20);
    await page.getByRole("button", { name: "First companies" }).click();
    await expect(
      page.getByTestId("watch-target-synthetic-company-0"),
    ).toBeVisible();
    const search = page.getByRole("searchbox", { name: "Search companies" });
    await search.fill("SyntheticCompany");
    await expect.poll(() => releaseOldSearch !== undefined).toBe(true);
    await search.fill("COMPANY 120");
    await expect(
      page.getByTestId("watch-target-synthetic-company-119"),
    ).toBeVisible();
    await expect(page.locator(".watch-company-trigger")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "Next companies" }),
    ).toHaveCount(0);
    await expect(page.getByText(/1 company matches/)).toBeVisible();
    releaseOldSearch!();
    await expect.poll(() => oldSearchSettled).toBe(true);
    await expect(
      page.getByTestId("watch-target-synthetic-company-0"),
    ).toHaveCount(0);
    await search.fill("Missing synthetic company");
    await expect(
      page.getByRole("heading", { name: "No matching companies" }),
    ).toBeVisible();
    await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(page.locator(".watch-company-trigger")).toHaveCount(20);
    await search.press("Escape");
    await expect(
      page.getByRole("button", { name: "Check now", exact: true }),
    ).toBeEnabled();
    unavailable = true;
    await search.fill("company 120");
    await expect(
      page.getByText("Company search unavailable", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".watch-company-trigger")).toHaveCount(0);
    unavailable = false;
    await page
      .getByRole("button", { name: "Refresh activity", exact: true })
      .click();
    await expect(
      page.getByTestId("watch-target-synthetic-company-119"),
    ).toBeVisible();
  },
);

test(
  "keeps a financing review focused on reported company terms",
  { tag: "@mobile-only" },
  async ({ page }, testInfo) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const liveAlpha = (await alphaResponse.json()) as Record<string, unknown>;
    const alphaFixture = {
      ...liveAlpha,
      evidenceInbox: [
        {
          id: "evt_watch_harbor_series_c",
          companyName: "Harbor Health Systems",
          eventType: "financing_announced",
          headline: "Synthetic Series C company terms reported",
          detectedAt: "2026-08-02T12:00:00.000Z",
          effectiveDate: "2026-07-31",
          status: "pending_review",
          confidencePpm: 920_000,
          modelConfidencePpm: 610_000,
          sources: ["Official company website"],
          sourceUrl:
            "https://newsroom.harbor-health.example/updates/series-c-financing",
          sourceExcerpt:
            "announced a US$62 million Series C financing at a US$310 million post-money company valuation",
          priorValue: "Not set",
          replacementValue: "Not set",
          forecastImpactMinor: 0,
          financingFacts: financingFactsFixture,
          application: null,
        },
      ],
      portfolioWatch: {
        ...portfolioWatchFixture,
        observations: [],
      },
    };

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({ json: alphaFixture });
    });

    await page.goto("/");
    const mobile = testInfo.project.name === "mobile-chromium";
    await navigateToScreen(page, mobile, /Evidence/);

    const card = page
      .locator(".evidence-card")
      .filter({ hasText: "Synthetic Series C company terms reported" });
    await expect(card.getByText("Reported financing")).toBeVisible();
    await expect(card.getByText("Series C · Equity")).toBeVisible();
    await expect(card.getByText("USD 62M")).toBeVisible();
    await expect(
      card.getByText("USD 310M · post-money company valuation"),
    ).toBeVisible();
    await expect(
      card.getByText(
        "Source wording: “announced a US$62 million Series C financing at a US$310 million post-money company valuation”",
      ),
    ).toBeVisible();
    await expect(
      card.getByRole("link", { name: "Open official source" }),
    ).toHaveAttribute(
      "href",
      "https://newsroom.harbor-health.example/updates/series-c-financing",
    );
    await expect(
      card.getByRole("link", { name: "Open official source" }),
    ).toHaveAttribute("data-slot", "text-link");
    await expect(card.getByText("Holding impact")).toBeVisible();
    await expect(card.getByText("Not calculated")).toBeVisible();
    await expect(
      card.getByText("Company terms do not set this holding’s value."),
    ).toBeVisible();
    await expect(card.getByText("Proposed change")).toHaveCount(0);
    await expect(card.getByText("Estimated middle-outcome impact")).toHaveCount(
      0,
    );
    await expect(card.getByText("$0.00")).toHaveCount(0);
    await expect(
      card.getByRole("button", { name: "Scenario only" }),
    ).toBeVisible();

    await page.addStyleTag({
      content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
    });
    await page.mouse.move(0, 0);

    const evidenceScreen = page.locator(".evidence-screen");
    const evidenceWidths = await evidenceScreen.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(evidenceWidths.scroll).toBeLessThanOrEqual(evidenceWidths.client);

    await expect(evidenceScreen).toHaveScreenshot("financing-review.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });

    await card.getByRole("button", { name: "Accept evidence" }).click();
    await expect(
      card.getByText("Record Series C · Equity as reviewed company evidence."),
    ).toBeVisible();
    await expect(
      card.getByText("No holding mark or forecast changes."),
    ).toBeVisible();
    await card.getByRole("button", { name: "Cancel" }).click();

    await page.route("**/api/evidence/*/review", async (route) => {
      await route.fulfill({ status: 204 });
    });
    await card.getByRole("button", { name: "Scenario only" }).click();
    await expect(
      page.getByRole("heading", { name: "Scenarios" }),
    ).toBeVisible();

    const scenarioContext = page.locator(".scenario-context");
    await expect(scenarioContext).toContainText("Reported financing context");
    await expect(scenarioContext).toContainText(
      "Synthetic Series C company terms reported",
    );
    await expect(scenarioContext).toContainText(
      "Reported terms: Series C · Equity · USD 62M announced · USD 310M post-money company valuation.",
    );
    await expect(scenarioContext).toContainText(
      "Holding impact not calculated. No holding mark or forecast changes. Adjust assumptions below to model your view.",
    );
    await expect(scenarioContext).not.toContainText("Not set → Not set");
    await expect(scenarioContext).not.toContainText("$0.00");

    const scenarioContextWidths = await scenarioContext.evaluate((element) => ({
      client: element.clientWidth,
      scroll: element.scrollWidth,
    }));
    expect(scenarioContextWidths.scroll).toBeLessThanOrEqual(
      scenarioContextWidths.client,
    );
    const documentWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(documentWidths.scroll).toBeLessThanOrEqual(documentWidths.client);

    await expect(scenarioContext).toHaveScreenshot(
      "financing-scenario-context.png",
      {
        animations: "disabled",
        caret: "hide",
        maxDiffPixelRatio: 0.025,
        threshold: 0.25,
      },
    );
  },
);

test(
  "reconciles financing reports before creating a version-safe proposal",
  { tag: "@desktop-only" },
  async ({ page }) => {
    const alphaResponse = await page.request.get("/api/alpha");
    expect(alphaResponse.ok()).toBe(true);
    const liveAlpha = (await alphaResponse.json()) as Record<string, unknown>;
    const scenarios = liveAlpha.scenarios as Array<{
      id: string;
      isSandbox: boolean;
      latestSnapshotId: string | null;
      latestSnapshotVersion: number | null;
      name: string;
    }>;
    const sandbox = scenarios.find((scenario) => scenario.isSandbox);
    if (
      sandbox === undefined ||
      sandbox.latestSnapshotId === null ||
      sandbox.latestSnapshotVersion === null
    ) {
      throw new Error("The synthetic Sandbox scenario needs a saved snapshot.");
    }

    const harborOfficialFacts = {
      ...financingFactsFixture,
      roundLabel: "Series D",
      announcedAmount: {
        amountMinor: 8_000_000_000,
        currency: "USD",
        qualifier: "exact",
        evidenceText:
          "announced USD 80 million in Series D financing at a USD 400 million post-money company valuation",
      },
      companyValuation: {
        amountMinor: 40_000_000_000,
        currency: "USD",
        qualifier: "exact",
        basis: "post_money",
        evidenceText:
          "announced USD 80 million in Series D financing at a USD 400 million post-money company valuation",
      },
    };
    const harborReportingFacts = {
      ...harborOfficialFacts,
      announcedAmount: {
        amountMinor: 8_500_000_000,
        currency: "USD",
        qualifier: "exact",
        evidenceText:
          "reported USD 85 million in Series D financing at a USD 420 million post-money company valuation",
      },
      companyValuation: {
        amountMinor: 42_000_000_000,
        currency: "USD",
        qualifier: "exact",
        basis: "post_money",
        evidenceText:
          "reported USD 85 million in Series D financing at a USD 420 million post-money company valuation",
      },
    };
    const northstarRegulatoryFacts = {
      ...financingFactsFixture,
      announcedAmount: {
        ...financingFactsFixture.announcedAmount,
        evidenceText:
          "reported USD 62 million in Series C financing at a USD 310 million post-money company valuation",
      },
      companyValuation: {
        ...financingFactsFixture.companyValuation,
        evidenceText:
          "reported USD 62 million in Series C financing at a USD 310 million post-money company valuation",
      },
    };
    const northstarSupersededFacts = {
      ...financingFactsFixture,
      announcedAmount: {
        amountMinor: 5_500_000_000,
        currency: "USD",
        qualifier: "exact",
        evidenceText:
          "previously reported USD 55 million in Series C financing at a USD 280 million post-money company valuation",
      },
      companyValuation: {
        amountMinor: 28_000_000_000,
        currency: "USD",
        qualifier: "exact",
        basis: "post_money",
        evidenceText:
          "previously reported USD 55 million in Series C financing at a USD 280 million post-money company valuation",
      },
    };
    const harborOfficialUrl =
      "https://newsroom.harbor-health.example/updates/series-d-financing";
    const harborReportingUrl =
      "https://reporting.example/harbor-health-series-d";
    const northstarOfficialUrl =
      "https://northstar-robotics.example/news/series-c-financing";
    const northstarRegulatoryUrl = "https://filings.example/northstar-series-c";
    const evidenceInbox = [
      {
        id: "evt_harbor_series_d_official",
        companyName: "Harbor Health Systems",
        eventType: "financing_announced",
        headline: "Official Series D terms reported",
        detectedAt: "2026-08-08T10:00:00.000Z",
        effectiveDate: "2026-08-08",
        status: "pending_review",
        confidencePpm: 960_000,
        modelConfidencePpm: 910_000,
        sources: ["Official company website"],
        sourceUrl: harborOfficialUrl,
        sourceExcerpt: harborOfficialFacts.announcedAmount.evidenceText,
        priorValue: "Not set",
        replacementValue: "Not set",
        forecastImpactMinor: 0,
        financingFacts: harborOfficialFacts,
        application: null,
      },
      {
        id: "evt_harbor_series_d_reporting",
        companyName: "Harbor Health Systems",
        eventType: "financing_announced",
        headline: "Differing Series D terms reported",
        detectedAt: "2026-08-08T10:05:00.000Z",
        effectiveDate: "2026-08-08",
        status: "pending_review",
        confidencePpm: 840_000,
        modelConfidencePpm: 860_000,
        sources: ["Named reporting"],
        sourceUrl: harborReportingUrl,
        sourceExcerpt: harborReportingFacts.announcedAmount.evidenceText,
        priorValue: "Not set",
        replacementValue: "Not set",
        forecastImpactMinor: 0,
        financingFacts: harborReportingFacts,
        application: null,
      },
      {
        id: "evt_northstar_series_c_official",
        companyName: "Northstar Robotics",
        eventType: "financing_announced",
        headline: "Current official Series C terms",
        detectedAt: "2026-08-07T12:00:00.000Z",
        effectiveDate: "2026-08-07",
        status: "scenario_only",
        confidencePpm: 980_000,
        modelConfidencePpm: 940_000,
        sources: ["Official company website"],
        sourceUrl: northstarOfficialUrl,
        sourceExcerpt: financingFactsFixture.announcedAmount.evidenceText,
        priorValue: "Not set",
        replacementValue: "Not set",
        forecastImpactMinor: 0,
        financingFacts: financingFactsFixture,
        application: null,
      },
      {
        id: "evt_northstar_series_c_filing",
        companyName: "Northstar Robotics",
        eventType: "financing_announced",
        headline: "Matching Series C filing",
        detectedAt: "2026-08-07T12:05:00.000Z",
        effectiveDate: "2026-08-07",
        status: "accepted",
        confidencePpm: 990_000,
        modelConfidencePpm: 930_000,
        sources: ["Regulatory filing"],
        sourceUrl: northstarRegulatoryUrl,
        sourceExcerpt: northstarRegulatoryFacts.announcedAmount.evidenceText,
        priorValue: "Not set",
        replacementValue: "Not set",
        forecastImpactMinor: 0,
        financingFacts: northstarRegulatoryFacts,
        application: null,
      },
      {
        id: "evt_northstar_series_c_old",
        companyName: "Northstar Robotics",
        eventType: "financing_announced",
        headline: "Earlier official Series C report",
        detectedAt: "2026-08-01T12:00:00.000Z",
        effectiveDate: "2026-08-01",
        status: "accepted",
        confidencePpm: 980_000,
        modelConfidencePpm: 900_000,
        sources: ["Official company website"],
        sourceUrl: northstarOfficialUrl,
        sourceExcerpt: northstarSupersededFacts.announcedAmount.evidenceText,
        priorValue: "Not set",
        replacementValue: "Not set",
        forecastImpactMinor: 0,
        financingFacts: northstarSupersededFacts,
        application: null,
      },
    ];
    const harborRevision = "a".repeat(64);
    const northstarRevision = "b".repeat(64);
    const signalReconciliations = [
      {
        id: "co_harbor:series-d",
        revision: harborRevision,
        companyId: "co_harbor",
        companyName: "Harbor Health Systems",
        roundKey: "series-d",
        roundLabel: "Series D",
        status: "conflicting",
        reviewRank: 1,
        reviewReason: "Resolve the differing terms before drafting an update.",
        pendingReviewCount: 2,
        recommendedReviewEventIds: [
          "evt_harbor_series_d_official",
          "evt_harbor_series_d_reporting",
        ],
        canCreateProposal: false,
        proposedCompanyValuation: null,
        reports: [
          {
            observationId: "obs_harbor_series_d_official",
            evidenceEventId: "evt_harbor_series_d_official",
            sourceTitle: "Official Series D announcement",
            sourceUrl: harborOfficialUrl,
            sourceClass: "official_company",
            publishedAt: "2026-08-08T09:55:00.000Z",
            retrievedAt: "2026-08-08T10:00:00.000Z",
            evidenceStatus: "pending_review",
            sourceReliabilityPpm: 960_000,
            modelConfidencePpm: 910_000,
            relationship: "conflicting",
            reviewOrder: 1,
            financingFacts: harborOfficialFacts,
          },
          {
            observationId: "obs_harbor_series_d_reporting",
            evidenceEventId: "evt_harbor_series_d_reporting",
            sourceTitle: "Named Series D report",
            sourceUrl: harborReportingUrl,
            sourceClass: "reputable_reporting",
            publishedAt: "2026-08-08T10:01:00.000Z",
            retrievedAt: "2026-08-08T10:05:00.000Z",
            evidenceStatus: "pending_review",
            sourceReliabilityPpm: 840_000,
            modelConfidencePpm: 860_000,
            relationship: "conflicting",
            reviewOrder: 2,
            financingFacts: harborReportingFacts,
          },
        ],
      },
      {
        id: "co_northstar:series-c",
        revision: northstarRevision,
        companyId: "co_northstar",
        companyName: "Northstar Robotics",
        roundKey: "series-c",
        roundLabel: "Series C",
        status: "corroborated",
        reviewRank: 2,
        reviewReason:
          "Review the matching reports together, strongest source first.",
        pendingReviewCount: 0,
        recommendedReviewEventIds: [],
        canCreateProposal: true,
        proposedCompanyValuation: financingFactsFixture.companyValuation,
        reports: [
          {
            observationId: "obs_northstar_series_c_filing",
            evidenceEventId: "evt_northstar_series_c_filing",
            sourceTitle: "Series C filing",
            sourceUrl: northstarRegulatoryUrl,
            sourceClass: "regulatory_filing",
            publishedAt: "2026-08-07T12:01:00.000Z",
            retrievedAt: "2026-08-07T12:05:00.000Z",
            evidenceStatus: "accepted",
            sourceReliabilityPpm: 990_000,
            modelConfidencePpm: 930_000,
            relationship: "corroborating",
            reviewOrder: 1,
            financingFacts: northstarRegulatoryFacts,
          },
          {
            observationId: "obs_northstar_series_c_official",
            evidenceEventId: "evt_northstar_series_c_official",
            sourceTitle: "Official Series C announcement",
            sourceUrl: northstarOfficialUrl,
            sourceClass: "official_company",
            publishedAt: "2026-08-07T11:55:00.000Z",
            retrievedAt: "2026-08-07T12:00:00.000Z",
            evidenceStatus: "scenario_only",
            sourceReliabilityPpm: 980_000,
            modelConfidencePpm: 940_000,
            relationship: "corroborating",
            reviewOrder: 2,
            financingFacts: financingFactsFixture,
          },
          {
            observationId: "obs_northstar_series_c_old",
            evidenceEventId: "evt_northstar_series_c_old",
            sourceTitle: "Earlier official Series C report",
            sourceUrl: northstarOfficialUrl,
            sourceClass: "official_company",
            publishedAt: "2026-08-01T11:55:00.000Z",
            retrievedAt: "2026-08-01T12:00:00.000Z",
            evidenceStatus: "accepted",
            sourceReliabilityPpm: 980_000,
            modelConfidencePpm: 900_000,
            relationship: "superseded",
            reviewOrder: 3,
            financingFacts: northstarSupersededFacts,
          },
        ],
      },
    ];
    const proposal = {
      id: "proposal_northstar_series_c",
      groupId: "co_northstar:series-c",
      reconciliationRevision: northstarRevision,
      companyId: "co_northstar",
      companyName: "Northstar Robotics",
      scenarioId: sandbox.id,
      scenarioName: sandbox.name,
      baseForecastSnapshotId: sandbox.latestSnapshotId,
      baseForecastSnapshotVersion: sandbox.latestSnapshotVersion,
      evidenceEventIds: [
        "evt_northstar_series_c_filing",
        "evt_northstar_series_c_official",
      ],
      proposedCompanyValuation: financingFactsFixture.companyValuation,
      rationale:
        "Reviewed Northstar Robotics Series C reports; model the company valuation separately.",
      createdAt: "2026-08-08T12:00:00.000Z",
      createdBy: "Demo Operator",
      isCurrent: true,
    };
    let proposalSaved = false;
    const alphaFixture = {
      ...liveAlpha,
      evidenceInbox,
      portfolioWatch: { ...portfolioWatchFixture, observations: [] },
      signalReconciliations,
    };

    await page.route("**/api/alpha", async (route) => {
      await route.fulfill({
        json: {
          ...alphaFixture,
          signalUpdateProposals: proposalSaved ? [proposal] : [],
        },
      });
    });
    await page.route("**/api/signal-update-proposals", async (route) => {
      const requestBody = route.request().postDataJSON() as Record<
        string,
        unknown
      >;
      expect(requestBody).toMatchObject({
        groupId: "co_northstar:series-c",
        reconciliationRevision: northstarRevision,
        scenarioId: sandbox.id,
        baseForecastSnapshotId: sandbox.latestSnapshotId,
      });
      proposalSaved = true;
      await route.fulfill({ json: proposal, status: 201 });
    });

    await page.goto("/evidence");

    const groups = page.locator(".signal-reconciliation-group");
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toContainText(
      "Review 1 · Harbor Health Systems",
    );
    await expect(groups.nth(0)).toContainText("Terms conflict");
    await expect(groups.nth(0)).toContainText("Report 1 · Conflicts");
    await expect(groups.nth(0)).toContainText("Report 2 · Conflicts");
    await expect(groups.nth(1)).toContainText("Review 2 · Northstar Robotics");
    await expect(groups.nth(1)).toContainText("Corroborated");
    await expect(groups.nth(1)).toContainText("Report 1 · Corroborates");
    await expect(groups.nth(1)).toContainText("Report 2 · Corroborates");
    await expect(groups.nth(1)).toContainText("Report 3 · Superseded");
    await expect(groups.nth(1)).toContainText(
      "Draft a separate scenario update",
    );
    await expect(groups.nth(1)).toContainText(
      `${sandbox.name} v${sandbox.latestSnapshotVersion}`,
    );
    await expect(groups.nth(1)).toContainText(
      "Company valuation only. Holding value still needs ownership and security terms.",
    );

    await page.addStyleTag({
      content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
    });
    await page.mouse.move(0, 0);

    const evidenceScreen = page.locator(".evidence-screen");
    const documentWidths = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(documentWidths.scroll).toBeLessThanOrEqual(documentWidths.client);
    await expect(evidenceScreen).toHaveScreenshot("signal-reconciliation.png", {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    });

    await groups
      .nth(1)
      .getByRole("button", { name: "Create proposed update" })
      .click();
    await expect(groups.nth(1)).toContainText("Proposed update");
    await expect(groups.nth(1)).toContainText(
      "Nothing has changed in holdings or the scenario.",
    );
  },
);

test(
  "reads news independently of decisions, restores read state, and opens the selected evidence",
  { tag: "@mobile-only" },
  async ({ page }) => {
    // Includes cold navigation plus saved-state reloads in both Watch and Evidence Inbox.
    test.setTimeout(60_000);
    const alphaResponse = await test.step(
      "Load the saved dashboard",
      () => page.request.get("/api/alpha"),
      { timeout: 30_000 },
    );
    expect(alphaResponse.ok()).toBe(true);
    const alpha = await alphaResponse.json();
    const selected = alpha.evidenceInbox[0];
    const financing = {
      ...portfolioWatchFixture.observations[0]!,
      evidenceEventId: selected.id,
      readAt: null,
      readVersion: 0,
    };
    const news = {
      ...financing,
      id: "synthetic-news",
      evidenceEventId: "synthetic-news-event",
      financingFacts: null,
      valuationLowMinor: null,
      valuationMiddleMinor: null,
      valuationHighMinor: null,
      sourceTitle:
        "Harbor opens a new clinic and expands its regional care network with additional locations planned for next year",
      observedFact:
        "Harbor opens a new clinic and expands its regional care network with additional locations planned for next year",
      readAt: null as string | null,
    };
    const evidenceInbox = [...alpha.evidenceInbox];
    await page.route("**/api/alpha", (route) =>
      route.fulfill({
        json: {
          ...alpha,
          signalReconciliations: [],
          evidenceInbox,
          portfolioWatch: {
            ...portfolioWatchFixture,
            observations: [news, financing],
          },
        },
      }),
    );
    await page.route("**/api/watch/activity**", (route) =>
      route.fulfill({ json: watchActivityFixture }),
    );
    let fail = true;
    let evidenceWrites = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && /\/api\/evidence/.test(request.url()))
        evidenceWrites++;
    });
    await page.route(
      "**/api/watch/observations/synthetic-news/read",
      async (route) => {
        if (fail)
          return route.fulfill({
            status: 503,
            json: { error: "Couldn’t save read status. Try again." },
          });
        const body = route.request().postDataJSON();
        expect(body.expectedVersion).toBe(news.readVersion);
        news.readAt = body.read ? "2026-08-02T12:30:00.000Z" : null;
        news.readVersion++;
        await route.fulfill({
          json: {
            observationId: news.id,
            readAt: news.readAt,
            version: news.readVersion,
          },
        });
      },
    );
    await page.goto("/watch");
    await page
      .getByRole("heading", { name: "Portfolio Watch", exact: true })
      .waitFor();
    const row = page.getByRole("article", {
      name: news.sourceTitle,
      exact: true,
    });
    await expect(
      row.getByRole("link", { name: news.sourceTitle }),
    ).toHaveAttribute("href", news.sourceUrl);
    await expect(row.getByRole("button", { name: /Review/ })).toHaveCount(0);
    await expect(
      row.getByText(/Not estimated|Model confidence|Keel estimate/),
    ).toHaveCount(0);
    await page.addStyleTag({
      content: ".topbar, .mobile-nav { visibility: hidden !important; }",
    });
    await page.mouse.move(0, 0);
    await expect(page.locator(".watch-screen")).toHaveScreenshot(
      "portfolio-watch-news.png",
      { animations: "disabled" },
    );
    await row.getByRole("button", { name: "Mark read", exact: true }).click();
    await expect(
      row.getByText("Couldn’t save read status. Try again."),
    ).toBeVisible();
    await expect(row).toBeVisible();
    fail = false;
    await row.getByRole("button", { name: "Mark read", exact: true }).click();
    await expect(row).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Unread (1)", exact: true }),
    ).toBeVisible();
    await expect(row).toHaveCount(0);
    await page
      .getByRole("button", { name: "All updates", exact: true })
      .click();
    await expect(
      row.getByRole("button", { name: "Mark unread", exact: true }),
    ).toBeVisible();
    expect(evidenceWrites).toBe(0);
    await page
      .getByRole("button", { name: "Review decision", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/evidence\\?event=${encodeURIComponent(selected.id)}`),
    );
    await expect(page.locator(`[id="evidence-${selected.id}"]`)).toBeFocused();
    await test.step(
      "Show ambiguous financing without choosing an amount",
      async () => {
        evidenceInbox.push(ambiguousFinancingItem);
        await page.reload();
        await page.getByRole("heading", { name: "Evidence Inbox" }).waitFor();
        await expect(
          page.locator(`[id="evidence-${selected.id}"]`),
        ).toBeFocused();
        const card = page.locator(".evidence-card").filter({
          hasText: "Synthetic financing amounts need source review",
        });
        await expect(card.getByText("Series C")).toBeVisible();
        await expect(
          card.getByText(
            `Source wording: “${ambiguousFinancingItem.sourceExcerpt}”`,
          ),
        ).toBeVisible();
        await expect(
          card.getByText("Check source wording: multiple funding amounts"),
        ).toBeVisible();
        await expect(card.getByText(/USD 40M|USD 15M/)).toHaveCount(0);
        await expect(
          card.getByRole("link", { name: "Open official source" }),
        ).toHaveAttribute("href", ambiguousFinancingItem.sourceUrl);
        await expect(card.getByText("Holding impact")).toBeVisible();
      },
      { timeout: 30_000 },
    );
  },
);
