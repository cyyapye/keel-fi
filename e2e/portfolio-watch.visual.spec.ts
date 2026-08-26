import { expect, test } from "@playwright/test";

import { navigateToScreen } from "./navigation";

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

test("keeps Portfolio Watch visually sparse and decision-oriented", async ({
  page,
}, testInfo) => {
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
  await page.route("**/api/watch/scan", async (route) => {
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
  await expect(page.locator(".watch-screen")).toContainText(
    "A signal never changes a holding on its own; a value changes only after you review and apply it.",
  );
  const checkButton = page.locator(".watch-control-panel .button");
  await expect(checkButton).toHaveText("Check now");
  await expect(page.getByTestId("portfolio-watch-control")).toContainText(
    "Keel finds company sources and sends new evidence to review. Company financing terms do not determine what your position is worth.",
  );
  await expect(page.getByTestId("watch-target-watch_harbor")).toContainText(
    "Monitoring active · Checked Aug 2, 2026",
  );
  await expect(page.getByTestId("watch-target-watch_lattice")).toContainText(
    "Temporarily unavailable · Will retry",
  );
  await expect(page.getByTestId("watch-target-watch_northstar")).toContainText(
    "No verified public source yet",
  );
  await checkButton.click();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic Series C financing announcement",
    }),
  ).toBeVisible();
  await expect(checkButton).toBeEnabled();
  await expect(checkButton).toHaveText("Check now");
  await expect(page.getByText("Source checks started.")).toBeVisible();
  await expect(page.getByText("Reported financing")).toBeVisible();
  await expect(page.getByText("Series C · Equity")).toBeVisible();
  await expect(page.getByText("USD 62M")).toBeVisible();
  await expect(
    page.getByText("USD 310M · post-money company valuation"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Source wording: “announced a US$62 million Series C financing at a US$310 million post-money company valuation”",
    ),
  ).toBeVisible();
  const meaningSection = page.getByText("What it means").locator("..");
  await expect(meaningSection).toBeVisible();
  await expect(meaningSection).toContainText("Classification confidence 61.0%");
  await expect(page.getByText(/Retained parsing context/)).toHaveCount(0);
  await expect(page.getByText("Estimated range")).toHaveCount(0);
  await page.getByTestId("portfolio-watch-data-profile").evaluate((element) => {
    element.textContent = "Demo sources in this preview";
  });

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

  await expect(watchScreen).toHaveScreenshot("portfolio-watch.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.025,
    threshold: 0.25,
  });
});

test("keeps a financing review focused on reported company terms", async ({
  page,
}, testInfo) => {
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
  await expect(page.getByRole("heading", { name: "Scenarios" })).toBeVisible();

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
});

test("reconciles financing reports before creating a version-safe proposal", async ({
  page,
}, testInfo) => {
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
  const harborReportingUrl = "https://reporting.example/harbor-health-series-d";
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

  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Evidence/);

  const groups = page.locator(".signal-reconciliation-group");
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText("Review 1 · Harbor Health Systems");
  await expect(groups.nth(0)).toContainText("Terms conflict");
  await expect(groups.nth(0)).toContainText("Report 1 · Conflicts");
  await expect(groups.nth(0)).toContainText("Report 2 · Conflicts");
  await expect(groups.nth(1)).toContainText("Review 2 · Northstar Robotics");
  await expect(groups.nth(1)).toContainText("Corroborated");
  await expect(groups.nth(1)).toContainText("Report 1 · Corroborates");
  await expect(groups.nth(1)).toContainText("Report 2 · Corroborates");
  await expect(groups.nth(1)).toContainText("Report 3 · Superseded");
  await expect(groups.nth(1)).toContainText("Draft a separate scenario update");
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
});

test("keeps conflicting financing amounts unchosen and reviewable", async ({
  page,
}, testInfo) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const liveAlpha = (await alphaResponse.json()) as Record<string, unknown>;
  const sourceUrl =
    "https://newsroom.harbor-health.example/updates/conflicting-financing";
  const sourceExcerpt =
    "Harbor Health Systems announced USD 40 million in financing and a separate USD 15 million investment.";
  const alphaFixture = {
    ...liveAlpha,
    evidenceInbox: [
      {
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
        sourceUrl,
        sourceExcerpt,
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
      },
    ],
    portfolioWatch: { ...portfolioWatchFixture, observations: [] },
  };

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Evidence/);

  const card = page
    .locator(".evidence-card")
    .filter({ hasText: "Synthetic financing amounts need source review" });
  await expect(card.getByText("Series C")).toBeVisible();
  await expect(
    card.getByText(`Source wording: “${sourceExcerpt}”`),
  ).toBeVisible();
  await expect(
    card.getByText("Check source wording: multiple funding amounts"),
  ).toBeVisible();
  await expect(card.getByText(/USD 40M|USD 15M/)).toHaveCount(0);
  await expect(
    card.getByRole("link", { name: "Open official source" }),
  ).toHaveAttribute("href", sourceUrl);
  await expect(card.getByText("Holding impact")).toBeVisible();
});

test("keeps the legacy estimated range when financing facts are absent", async ({
  page,
}, testInfo) => {
  const alphaResponse = await page.request.get("/api/alpha");
  expect(alphaResponse.ok()).toBe(true);
  const liveAlpha = (await alphaResponse.json()) as Record<string, unknown>;
  const [observation] = portfolioWatchFixture.observations;
  const alphaFixture = {
    ...liveAlpha,
    evidenceInbox: [],
    portfolioWatch: {
      ...portfolioWatchFixture,
      observations: [{ ...observation, financingFacts: null }],
    },
  };

  await page.route("**/api/alpha", async (route) => {
    await route.fulfill({ json: alphaFixture });
  });
  await page.goto("/");
  const mobile = testInfo.project.name === "mobile-chromium";
  await navigateToScreen(page, mobile, /Watch/);

  await expect(page.getByText("Estimated range")).toBeVisible();
  await expect(page.getByText("$930k – $1.4M")).toBeVisible();
  await expect(page.getByText("Reported financing")).toHaveCount(0);
});
