import { expect, test, type Page } from "@playwright/test";
import type {
  LegalEntityInventory,
  LegalEntitySourceSummary,
} from "../packages/domain/src/legal-entities";
import type { LegalDocumentScan } from "../packages/domain/src/provider-legal-documents";
import { emptyInvestmentHoldingsView } from "./investment-holdings-fixtures";
import { routeHoldingsPage } from "./holdings-page-fixtures";
import { routeInvestmentReview } from "./investment-review-fixtures";

function candidate(
  index: number,
  name: string,
  finding?: {
    reason: "encrypted" | "scan_limit" | "malware_signature";
    signature: string;
  },
  incomplete = false,
): LegalEntitySourceSummary {
  const sha256 = index.toString(16).repeat(64);
  const scan: LegalDocumentScan = {
    version: 1,
    outcome: "blocked",
    sha256,
    engineVersion: "1.5.3",
    databaseVersion: 28000,
    databaseUpdatedAt: "2026-09-01T12:00:00.000Z",
    scannedAt: "2026-09-01T12:00:00.000Z",
  };
  return {
    source: {
      kind: "holding_position",
      id: `position_demo_security_${index.toString()}`,
    },
    sourceDisplayName: name,
    sourceLabel: "Sydecar agreement",
    sourceAsOf: "2026-09-01",
    currentOwner: null,
    currentDecisionId: null,
    suggestedEntityType: null,
    relationship: "investment_vehicle",
    interestStatus: "current",
    financials: null,
    openedOn: null,
    legalEntityNameEvidence: {
      state: "unavailable",
      legalName: null,
      sourceField: null,
      problem: incomplete ? "scanner_unavailable" : "security_blocked",
      documents: [
        {
          id: `${index.toString().repeat(8)}-1111-4111-8111-111111111111`,
          fileName: `demo-${index.toString()}-agreement.pdf`,
          sha256,
          page: null,
          quote: null,
          provider: "sydecar",
          ...(incomplete
            ? {}
            : {
                scan:
                  finding === undefined
                    ? scan
                    : { ...scan, version: 2, findings: [finding] },
              }),
        },
      ],
    },
  };
}

async function setup(page: Page, candidates: LegalEntitySourceSummary[]) {
  const inventory: LegalEntityInventory = {
    version: 3,
    asOf: "2026-09-01T12:00:00.000Z",
    entities: [],
    candidates,
    excludedCandidates: [],
    exactBatch: {
      revision: "a".repeat(64),
      sourceCount: 0,
      entityCount: 0,
      existingEntityCount: 0,
      newEntityCount: 0,
      llcEntityCount: 0,
      limitedPartnershipEntityCount: 0,
      remainingCandidateCount: candidates.length,
    },
  };
  await page.clock.setFixedTime(new Date(inventory.asOf));
  await routeHoldingsPage(page, {
    householdName: "Demo Household",
    holdings: [],
    investmentHoldings: emptyInvestmentHoldingsView,
    acceptedCashAccounts: [],
    pendingImports: [],
  });
  await page.route("**/api/legal-entities", (route) =>
    route.fulfill({ json: inventory }),
  );
  for (const source of candidates) await routeInvestmentReview(page, source);
  const downloads: string[] = [];
  await page.route("**/api/legal-entity-documents/*", (route) => {
    downloads.push(route.request().url());
    return route.fulfill({ status: 423, json: { error: "Blocked" } });
  });
  await page.goto("/holdings");
  await page.getByRole("link", { name: "Legal entities", exact: true }).click();
  await expect(page).toHaveURL(/\/holdings\/entities$/u);
  await page.addStyleTag({
    content: ".topbar, .mobile-nav { visibility: hidden !important; }",
  });
  const rows = page.locator(".legal-entity-candidate");
  await expect(rows).toHaveCount(candidates.length);
  const workspace = page.locator(".entity-review");
  const open = async (name: string) => {
    if (await workspace.isVisible())
      await workspace
        .getByRole("button", { name: "Back to legal entities", exact: true })
        .click();
    await rows
      .filter({ has: page.getByRole("heading", { name, exact: true }) })
      .getByRole("button", { name: "View source options", exact: true })
      .click();
    await expect(
      workspace.getByRole("tabpanel", {
        name: "Documents",
        exact: true,
      }),
    ).toBeVisible();
    await expect(workspace.getByRole("article")).toHaveCount(1);
  };
  return { rows, workspace, open, downloads };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => document.documentElement.clientWidth),
  );
}

test("explains scan limits, encrypted content and threat matches without offering blocked downloads", async ({
  page,
}) => {
  const { workspace, open, downloads } = await setup(page, [
    candidate(1, "Demo Climate", {
      reason: "scan_limit",
      signature: "Heuristics.Limits.Exceeded.MaxFileSize",
    }),
    candidate(2, "Demo Robotics", {
      reason: "encrypted",
      signature: "Heuristics.Encrypted.PDF",
    }),
    candidate(3, "Demo Energy", {
      reason: "malware_signature",
      signature: "Win.Test.EICAR_HDB-1",
    }),
  ]);
  for (const [name, explanation, screenshot] of [
    [
      "Demo Climate",
      "This does not establish malware",
      "agreement-security-reasons.png",
    ],
    [
      "Demo Robotics",
      "Request an unencrypted copy",
      "agreement-security-encrypted.png",
    ],
    [
      "Demo Energy",
      "Keep this agreement blocked",
      "agreement-security-threat.png",
    ],
  ] as const) {
    await open(name);
    await expect(workspace).toContainText(explanation);
    await expect(
      workspace.getByRole("button", { name: /demo-\d-agreement\.pdf/u }),
    ).toHaveCount(0);
    await expect(
      workspace.getByRole("button", { name: "Recheck agreement" }),
    ).toHaveCount(1);
    await expect(
      workspace.getByRole("button", { name: "Review details" }),
    ).toHaveCount(0);
    await page.mouse.move(0, 0);
    await expect(workspace).toHaveScreenshot(screenshot, {
      animations: "disabled",
      caret: "hide",
    });
    await noOverflow(page);
  }
  expect(downloads).toEqual([]);
});

test("offers a targeted retry for legacy and incomplete checks, and explains a busy source", async ({
  page,
}) => {
  const { workspace, open, downloads } = await setup(page, [
    candidate(4, "Demo Legacy"),
    candidate(5, "Demo Scanner Setup", undefined, true),
  ]);
  const requests: unknown[] = [];
  let busy = true;
  await page.route("**/api/legal-entity-documents/*/recheck", (route) => {
    requests.push({
      method: route.request().method(),
      body: route.request().postDataJSON(),
    });
    return route.fulfill(
      busy
        ? {
            status: 409,
            json: {
              error:
                "A source update is already queued or running. Wait for it to finish, then recheck this agreement.",
            },
          }
        : {
            status: 202,
            json: {
              version: 1,
              provider: "sydecar",
              runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              status: "queued",
            },
          },
    );
  });
  await open("Demo Scanner Setup");
  await expect(workspace).toContainText("Security check incomplete");
  await expect(
    workspace.getByRole("button", { name: "Recheck agreement" }),
  ).toBeEnabled();
  await open("Demo Legacy");
  await expect(workspace).toContainText("Alert reason unavailable");
  await workspace.getByRole("button", { name: "Recheck agreement" }).click();
  await expect(workspace).toContainText("Wait for it to finish");
  busy = false;
  await workspace.getByRole("button", { name: "Recheck agreement" }).click();
  await expect(
    workspace.getByRole("button", { name: "Check queued" }),
  ).toBeDisabled();
  await expect(workspace).toContainText(
    "The agreement stays blocked until it passes",
  );
  await expect(
    workspace.getByRole("link", { name: "View source progress" }),
  ).toHaveAttribute("href", "/holdings/sources");
  expect(requests).toEqual([
    { method: "POST", body: { provider: "sydecar" } },
    { method: "POST", body: { provider: "sydecar" } },
  ]);
  expect(downloads).toEqual([]);
  await page.mouse.move(0, 0);
  await expect(workspace).toHaveScreenshot("agreement-security-recheck.png", {
    animations: "disabled",
    caret: "hide",
  });
  await noOverflow(page);
});
