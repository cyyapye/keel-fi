import type { PortfolioBaselineState } from "./index";

/** Decisions about inclusion survive ordinary changes in source values. */
export function portfolioBaselineReviewReasons(
  state: PortfolioBaselineState,
): string[] {
  const prior = state.latestBaseline;
  if (prior === null) {
    return ["Choose the holdings and cash entering your FI plan."];
  }
  const reasons: string[] = [];
  if (state.requiresDuplicateReview) {
    reasons.push("Resolve the possible overlap between holdings.");
  }
  const newCash =
    state.changes.cashAccounts.some((change) => change.previous === null) ||
    state.changes.positions.some(
      (change) => change.previous === null && change.current.isCashPosition,
    );
  if (state.requiresCashOverlapReview && newCash) {
    reasons.push(
      "Check whether newly linked cash is already included in cash held elsewhere.",
    );
  }
  if (
    state.changes.positions.some(
      (change) =>
        change.current.classification === "public_market" &&
        change.current.valueState !== "reported",
    ) ||
    state.changes.cashAccounts.some(
      (change) => change.current.valueState !== "reported",
    )
  ) {
    reasons.push("A value used by your FI plan is unavailable.");
  }
  const addedPositions = state.changes.positions.filter(
    (change) => change.previous === null,
  ).length;
  const addedCash = state.changes.cashAccounts.filter(
    (change) => change.previous === null,
  ).length;
  if (
    state.positions.length - addedPositions < prior.summary.positionCount ||
    state.cashAccounts.length - addedCash < prior.summary.cashAccountCount
  ) {
    reasons.push("Check which sources should remain in your FI plan.");
  }
  return reasons;
}
