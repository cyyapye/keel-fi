import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Holding } from "@keel/domain";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import {
  alphaHoldingsFrom,
  reconciledReviewedHistoryInvestmentHoldingsView,
} from "../../../e2e/investment-holdings-fixtures";
import { manualFundWithEstimate } from "../../../e2e/manual-holding-fixtures";
import {
  purchaseDetailProjection,
  purchaseDetailReceipt,
} from "../../../e2e/purchase-detail-fixtures";
import { InvestmentHoldings, type ExposureTab } from "./InvestmentHoldings";
import {
  gpRecord,
  latestHoldingGpMark,
  netInvestmentBreakdown,
} from "./holding-value";
import { reviewedInvestmentFromReceipt } from "@keel/domain/position-purchases";
import { followedCloseReviewPath } from "./holding-position-route";
import { SpvHoldingDetail } from "./SpvHoldingDetail";
import { SourceInventoryOutcome } from "./PublicSourceUpdate";

function renderExposures(
  data: InvestmentHoldingsView,
  holdings: Holding[],
  activeExposureTab: ExposureTab = "all",
) {
  return renderToStaticMarkup(
    <InvestmentHoldings
      market={{ reviews: null, error: "" }}
      acceptedCashAccounts={[]}
      activeExposureTab={activeExposureTab}
      data={data}
      holdings={holdings}
      mode="exposures"
      onExposureOpenChange={() => {}}
      onExposureResolved={() => Promise.resolve()}
      onExposureTabChange={() => {}}
      onLoadMoreExposures={() => {}}
      onLoadMorePositions={() => {}}
      onOpenHolding={() => {}}
      onReviewImport={() => {}}
      onShowSmallBalancesChange={() => {}}
      openExposureIds={
        new Set(data.exposureView.exposures.map((group) => group.exposure.id))
      }
      requestedExposure={null}
      showSmallBalances={true}
      searchMatches={null}
      searchQuery=""
      visibleExposureCount={20}
      visiblePositionCounts={new Map()}
    />,
  );
}

test("distinguishes removed holdings from unreported holdings still counted in source outcomes", () => {
  const render = (removedCount: number, preservedCount: number) =>
    renderToStaticMarkup(
      <SourceInventoryOutcome
        removedCount={removedCount}
        preservedCount={preservedCount}
        preservedObservedAt="2026-10-31T12:00:00.000Z"
      />,
    ).replace(/<[^>]+>/gu, "");

  // Different accounts in one report can have different inventory coverage.
  const mixed = render(2, 1);
  expect(mixed).toContain("2 unreported holdings removed from current totals.");
  expect(mixed).toContain(
    "1 unreported holding is still counted at its Oct 31, 2026 value.",
  );
  expect(mixed).not.toContain("Missing positions have not been removed");
  expect(render(1, 0)).toBe(
    "1 unreported holding removed from current totals.",
  );
  expect(render(0, 0)).toBe("");
  expect(render(0, 2)).toBe(
    "2 unreported holdings are still counted at their Oct 31, 2026 values.",
  );
});

test("renders a manual Fund estimate without treating contributed cash as basis or return", () => {
  const { current, view } = manualFundWithEstimate();
  expect(view.exposureView.positions[0]?.valueMinor).toBe(3_000_000);
  const markup = renderExposures(view, [current]);
  const rows = markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/gu) ?? [];
  const matching = rows.filter((row) => row.includes(current.positionName));
  expect(matching).toHaveLength(1);
  expect(matching[0]).toContain("$30,000");
  expect(matching[0]).not.toContain("Basis");
  expect(matching[0]).not.toContain("total return");
});

test("renders the singular position count and legal holding action for one reviewed investment", () => {
  const data = reconciledReviewedHistoryInvestmentHoldingsView(1);
  const markup = renderExposures(data, alphaHoldingsFrom(data));
  expect(markup).toContain("1 position<");
  expect(markup).toContain(
    'aria-label="View Demo Pharmacy SPV 01 holding details"',
  );
});

test("waits for company reviews before declaring the resolution queue empty", () => {
  const data = reconciledReviewedHistoryInvestmentHoldingsView(1);
  const markup = renderExposures(data, alphaHoldingsFrom(data), "resolution");
  expect(markup).toContain("Loading positions needing resolution");
  expect(markup).not.toContain("No positions need resolution");
});

test("keeps fees paid separately out of the contributed capital breakdown", () => {
  const capital = reviewedInvestmentFromReceipt(purchaseDetailReceipt())!;
  const text = netInvestmentBreakdown({
    ...capital,
    cashPaidMinor: 105_000,
    additionalPaidFeesMinor: 5_000,
    upfrontDeductionsMinor: 10_000,
    returnedCapitalMinor: undefined,
  });
  expect(text).toBe("$1,000.00 paid in · $100.00 upfront deductions");
});

test("an edit link for a followed close opens the exposure's source choice", () => {
  const receipt = purchaseDetailReceipt();
  const basis = { key: "issuer-original", unitsPerOriginal: 1 };
  receipt.details.lots[0]!.quantityDetails = {
    status: "confirmed",
    derivation: "Synthetic statement",
    evidence: null,
    shareBasis: basis,
  };
  receipt.publicClose = {
    id: "synthetic-close",
    exposureId: "cedar",
    ticker: "CEDR",
    venue: "XNAS",
    shareClass: "Preferred",
    shareBasis: basis,
    date: "2026-10-04",
    priceMicros: 50_000_000,
    sourceUrl: "https://example.test/close",
  };
  const { holdings } = purchaseDetailProjection(receipt);
  const holding = holdings[0]!;
  expect(followedCloseReviewPath(holding)).toBe("/holdings?valuation=cedar");
  const markup = renderToStaticMarkup(
    <SpvHoldingDetail
      holding={holding}
      valuationRequested
      onValuationRouteClose={() => {}}
      onAccepted={() => Promise.resolve()}
    />,
  );
  expect(markup).toContain('href="/holdings?valuation=cedar"');
  expect(markup).not.toContain("Position total · $");
});

test("keeps a news valuation out of the latest GP mark", () => {
  const receipt = purchaseDetailReceipt();
  delete receipt.details.valuation;
  const holding = purchaseDetailProjection(receipt).holdings[0]!;
  holding.positionValueContext!.acceptedAdjustment = {
    id: "adjustment",
    positionId: holding.id,
    snapshotId: "snapshot",
    priorValueState: "reported",
    priorValueMinor: 1688000,
    valueMinor: 2000000,
    currency: "USD",
    effectiveDate: "2026-10-03",
    sourceKind: "news_article",
    sourceLabel: "Synthetic news",
    sourceUrl: null,
    commentary: "Updated estimate",
    acceptedAt: "2026-10-04T00:00:00Z",
  };
  expect(gpRecord(holding).sourceLabel).toBe("Synthetic news");
  expect(latestHoldingGpMark(holding)).toMatchObject({
    unit: "position",
    value: 1688000,
    source: "Synthetic GP",
  });
  holding.purchaseContext!.reportedValueMinor = null;
  expect(latestHoldingGpMark(holding)).toBeNull();
  receipt.details.valuation = purchaseDetailReceipt().details.valuation;
  holding.purchaseContext!.receipt!.details.valuation =
    receipt.details.valuation;
  holding.positionValueContext!.acceptedAdjustment.sourceKind = "gp_update";
  expect(
    latestHoldingGpMark(holding, {
      priceDate: "2026-10-01",
      priceMicros: 50000000,
      sourceLabel: "Synthetic price",
    }),
  ).toMatchObject({ unit: "position", value: 2000000, date: "2026-10-03" });
  const current = holding.purchaseContext!;
  current.sourceObservedOn = "2026-10-20";
  current.reportedValueMinor = 3000000;
  const savedRecord = current.receipt!.details.valuation!.records[0]!;
  savedRecord.origin = "judgment";
  savedRecord.effectiveDate = "2026-10-21";
  savedRecord.priceDate = "2026-10-21";
  expect(latestHoldingGpMark(holding)).toMatchObject({
    value: 2000000,
    date: "2026-10-03",
  });
});

test("withholds returns from holding and exposure summaries when refund inclusion is unknown", () => {
  function summaries(inclusion: "excluded" | "unknown") {
    const receipt = purchaseDetailReceipt();
    receipt.details.lots[0]!.capitalReturn!.reportedDistributions = inclusion;
    const { holdings, investmentHoldings } = purchaseDetailProjection(receipt);
    const detail = renderToStaticMarkup(
      <SpvHoldingDetail
        valuationRequested={false}
        onValuationRouteClose={() => undefined}
        holding={holdings[0]!}
        onAccepted={() => Promise.resolve()}
      />,
    );
    const positionSummary = detail.match(
      /<section\b[^>]*aria-label="Position summary"[^>]*>([\s\S]*?)<\/section>/u,
    )?.[1];
    expect(positionSummary).toContain("$16,880.00");
    const exposure = renderExposures(investmentHoldings, holdings);
    expect(exposure).toContain("Demo Cedar AI");
    return {
      detail: positionSummary!.replace(/<[^>]+>/gu, ""),
      exposure: exposure.replace(/<[^>]+>/gu, ""),
    };
  }

  const known = summaries("excluded");
  expect(known.detail).toContain("+100.00%");
  expect(known.detail).toContain("+85.99%");
  expect(known.exposure).toContain("+100%");

  const unknown = summaries("unknown");
  expect(unknown.detail).not.toContain("%");
  expect(unknown.exposure).not.toContain("%");
});
