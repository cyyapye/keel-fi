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
