import type { Holding } from "@keel/domain";
import { purchaseShares } from "@keel/domain/position-purchases";

/** Use the accepted acquisitions' own share basis, including for proxy-priced positions. */
export function positionShareSummary(
  context: Holding["purchaseContext"],
  followsSource: boolean,
) {
  const receipt = context?.receipt;
  if (!receipt || !receipt.details.coversPosition) return null;
  const { details } = receipt;
  if (
    !followsSource &&
    (details.investmentSnapshotId ?? receipt.snapshotId) !== context.snapshotId
  )
    return null;
  const first = details.lots[0];
  if (!first) return null;
  const latestDistribution = details.distributionReview?.events
    .filter((event) => event.kind === "in_kind")
    .map((event) => event.receivedOn)
    .sort()
    .at(-1);
  let quantity = 0n;
  let estimated = false;
  let asOf = first.sharesAsOf;
  for (const lot of details.lots) {
    const shares = purchaseShares(lot);
    if (
      !shares ||
      (latestDistribution &&
        (!lot.sharesAsOf || lot.sharesAsOf < latestDistribution))
    )
      return null;
    if (
      details.lots.length > 1 &&
      (!lot.shareClass ||
        lot.shareClass !== first.shareClass ||
        lot.quantityDetails?.shareBasis.key !==
          first.quantityDetails?.shareBasis.key ||
        lot.quantityDetails?.shareBasis.unitsPerOriginal !==
          first.quantityDetails?.shareBasis.unitsPerOriginal)
    )
      return null;
    estimated ||= shares.derived || lot.quantityDetails?.status === "estimated";
    quantity += BigInt(shares.quantityMicros);
    if (lot.sharesAsOf !== asOf) asOf = null;
  }
  return quantity <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { quantityMicros: Number(quantity), estimated, asOf }
    : null;
}
