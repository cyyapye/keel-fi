import type { Page } from "@playwright/test";
import type { HoldingsPage } from "../packages/domain/src/holdings-page";

type HoldingsPageFixture = Omit<
  HoldingsPage,
  "version" | "shell" | "holdings"
> & {
  householdName: string;
  holdings: readonly HoldingsPage["holdings"][number][];
  pendingEvidenceCount?: number;
};

export function holdingsPageFixture(
  fixture: HoldingsPageFixture,
): HoldingsPage {
  return {
    version: 1,
    shell: {
      householdName: fixture.householdName,
      pendingEvidenceCount: fixture.pendingEvidenceCount ?? 0,
    },
    holdings: [...fixture.holdings],
    investmentHoldings: fixture.investmentHoldings,
    acceptedCashAccounts: fixture.acceptedCashAccounts,
    pendingImports: fixture.pendingImports,
  };
}

export async function routeHoldingsPage(
  page: Page,
  fixture: HoldingsPageFixture | (() => HoldingsPageFixture),
): Promise<void> {
  await page.route("**/api/holdings-page", async (route) => {
    const input = typeof fixture === "function" ? fixture() : fixture;
    await route.fulfill({ json: holdingsPageFixture(input) });
  });
}
