import type { Holding } from "@keel/domain";

export function positionPerformanceValuation(
  holding: Pick<
    Holding,
    | "positionValueContext"
    | "shareValueEstimate"
    | "administratorNavMinor"
    | "purchaseContext"
  >,
): { valueMinor: number; effectiveDate: string | null } | null {
  const selected =
    holding.positionValueContext?.acceptedAdjustment ??
    holding.shareValueEstimate ??
    (holding.administratorNavMinor !== null
      ? {
          valueMinor: holding.administratorNavMinor,
          effectiveDate: holding.purchaseContext?.sourceObservedOn ?? null,
        }
      : null) ??
    holding.positionValueContext?.projectedEstimate ??
    null;
  return selected === null
    ? null
    : {
        valueMinor: selected.valueMinor,
        effectiveDate: selected.effectiveDate,
      };
}
