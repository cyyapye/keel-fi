import { expect, test } from "@playwright/test";

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
  const navigation = page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Primary navigation",
  });

  await navigation.getByRole("button", { name: /Watch/ }).click();
  const checkButton = page.locator(".watch-control-panel .button");
  await expect(checkButton).toHaveText("Check now");
  await expect(page.getByTestId("portfolio-watch-control")).toContainText(
    "Keel automatically finds and checks company sources when you check.",
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
  const navigation = page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Primary navigation",
  });
  await navigation.getByRole("button", { name: /Evidence/ }).click();

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
    card.getByRole("link", { name: "Open official source ↗" }),
  ).toHaveAttribute(
    "href",
    "https://newsroom.harbor-health.example/updates/series-c-financing",
  );
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
  const navigation = page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Primary navigation",
  });
  await navigation.getByRole("button", { name: /Evidence/ }).click();

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
    card.getByRole("link", { name: "Open official source ↗" }),
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
  const navigation = page.getByRole("navigation", {
    name: mobile ? "Mobile navigation" : "Primary navigation",
  });
  await navigation.getByRole("button", { name: /Watch/ }).click();

  await expect(page.getByText("Estimated range")).toBeVisible();
  await expect(page.getByText("$930k – $1.4M")).toBeVisible();
  await expect(page.getByText("Reported financing")).toHaveCount(0);
});
