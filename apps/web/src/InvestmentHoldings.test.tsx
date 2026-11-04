import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Holding } from "@keel/domain";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import {
  alphaHoldingsFrom,
  reconciledReviewedHistoryInvestmentHoldingsView,
} from "../../../e2e/investment-holdings-fixtures";
import { manualFundWithEstimate } from "../../../e2e/manual-holding-fixtures";
import { InvestmentHoldings } from "./InvestmentHoldings";

function renderExposures(data: InvestmentHoldingsView, holdings: Holding[]) {
  return renderToStaticMarkup(
    <InvestmentHoldings
      acceptedCashAccounts={[]}
      data={data}
      holdings={holdings}
      mode="exposures"
      onExposureOpenChange={() => {}}
      onExposureResolved={() => Promise.resolve()}
      onLoadMoreExposures={() => {}}
      onLoadMorePositions={() => {}}
      onOpenHolding={() => {}}
      onReviewImport={() => {}}
      onShowSmallBalancesChange={() => {}}
      openExposureIds={
        new Set(data.exposureView.exposures.map((group) => group.exposure.id))
      }
      requestedExposureId={null}
      showSmallBalances={true}
      searchMatches={null}
      searchQuery=""
      visibleExposureCount={20}
      visiblePositionCounts={new Map()}
    />,
  );
}

test("renders a manual Fund estimate without treating contributed cash as basis or return", () => {
  const { current, view } = manualFundWithEstimate();
  expect(view.exposureView.positions[0]?.valueMinor).toBe(3_000_000);
  const markup = renderExposures(view, [current]);
  const rows = markup.match(/<article\b[^>]*>[\s\S]*?<\/article>/gu) ?? [];
  const matching = rows.filter((row) => row.includes(current.positionName));
  expect(matching).toHaveLength(1);
  expect(matching[0]).toContain("$30k");
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
