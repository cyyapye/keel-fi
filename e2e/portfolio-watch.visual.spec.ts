import { expect, test } from "@playwright/test";

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
        "Harbor Health Systems announced a synthetic $62 million Series C financing and described the proceeds as growth capital.",
      inference:
        "Keel's synthetic model uses the reported company-level financing signal to estimate a wider holding-value range. It does not treat the round headline as an administrator NAV.",
      sourceReliabilityPpm: 920_000,
      modelConfidencePpm: 610_000,
      valuationLowMinor: 93_000_000,
      valuationMiddleMinor: 118_000_000,
      valuationHighMinor: 142_000_000,
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

  await page.addStyleTag({
    content: `
      .topbar,
      .mobile-nav {
        visibility: hidden !important;
      }
    `,
  });

  await expect(page.locator(".watch-screen")).toHaveScreenshot(
    "portfolio-watch.png",
    {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.025,
      threshold: 0.25,
    },
  );
});
