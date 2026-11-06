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
import { InvestmentHoldings } from "./InvestmentHoldings";
import { SpvHoldingDetail } from "./SpvHoldingDetail";

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

test("withholds returns from holding and exposure summaries when refund inclusion is unknown", () => {
  function summaries(inclusion: "excluded" | "unknown") {
    const receipt = purchaseDetailReceipt();
    receipt.details.lots[0]!.capitalReturn!.reportedDistributions = inclusion;
    const { holdings, investmentHoldings } = purchaseDetailProjection(receipt);
    const detail = renderToStaticMarkup(
      <SpvHoldingDetail
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
