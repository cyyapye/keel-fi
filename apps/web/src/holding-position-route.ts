import type { Holding } from "@keel/domain";
import { publicClosingValuation } from "@keel/domain/position-purchases";

export function followedCloseReviewPath(holding: Holding): string | null {
  const receipt = holding.purchaseContext?.receipt;
  const quote = receipt?.publicClose;
  return receipt && quote && publicClosingValuation(receipt, quote)
    ? `/holdings?valuation=${encodeURIComponent(quote.exposureId)}&scope=active`
    : null;
}

export type HoldingPositionRoute = { id: string; editValuation: boolean };

export function holdingPositionPath(id: string, editValuation = false) {
  const search = new URLSearchParams({ position: id });
  if (editValuation) search.set("edit", "valuation");
  return `/holdings?${search}`;
}

export function parseHoldingPosition(
  search: URLSearchParams,
): HoldingPositionRoute | null {
  const id = search.get("position");
  if (!id?.trim() || id.length > 200) return null;
  return { id, editValuation: search.get("edit") === "valuation" };
}
