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
import { SpvHoldingDetail } from "./SpvHoldingDetail";
import { SourceInventoryOutcome } from "./PublicSourceUpdate";

function renderExposures(
  data: InvestmentHoldingsView,
  holdings: Holding[],
  activeExposureTab: ExposureTab = "all",
) {
  return renderToStaticMarkup(
    <InvestmentHoldings
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
