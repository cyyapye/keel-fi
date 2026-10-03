import type { PositionLinkWorkspace } from "@keel/domain/position-links";
import { effectiveParticipation } from "@keel/domain/investment-review";

export function suggestPositionLink(
  workspace: PositionLinkWorkspace,
  positionId: string,
) {
  const linked = new Set(
    workspace.links
      .filter((link) => link.state === "linked")
      .flatMap((link) => [link.sourcePositionId, link.targetPositionId]),
  );
  const current = workspace.positions.find((p) => p.id === positionId);
  if (
    !current ||
    linked.has(current.id) ||
    current.kind !== "spv_interest" ||
    !current.ownershipContainerId ||
    !current.ownerLabel ||
    !current.openedOn ||
    !current.companyReview ||
    !current.reportedExposureName
  )
    return null;
  const matches = workspace.positions.filter(
    (p) =>
      p.id !== current.id &&
      !linked.has(p.id) &&
      p.kind === current.kind &&
      p.ownershipContainerId === current.ownershipContainerId &&
      p.legalVehicleName === current.legalVehicleName &&
      p.ownerLabel === current.ownerLabel &&
      p.openedOn === current.openedOn &&
      p.companyReview?.companyId === current.companyReview!.companyId &&
      p.snapshot.currency === current.snapshot.currency &&
      effectiveParticipation(p) === effectiveParticipation(current) &&
      p.reportedExposureName &&
      (p.reportedExposureName === current.reportedExposureName ||
        Date.parse(p.snapshot.observedAt) !==
          Date.parse(current.snapshot.observedAt)),
  );
  if (matches.length !== 1) return null;
  const other = matches[0]!;
  const reviewed = (p: typeof current) =>
    p.purchaseReceipt
      ? 3
      : p.acceptedEconomicsTerms
        ? 2
        : p.investmentReview
          ? 1
          : 0;
  // Preserve an existing reviewed record; otherwise keep the earlier source.
  const keepOther =
    reviewed(other) !== reviewed(current)
      ? reviewed(other) > reviewed(current)
      : Date.parse(other.snapshot.observedAt) <
        Date.parse(current.snapshot.observedAt);
  return {
    targetId: keepOther ? other.id : current.id,
    sourceId: keepOther ? current.id : other.id,
    relationship:
      other.reportedExposureName === current.reportedExposureName
        ? ("same_investment" as const)
        : ("company_renamed" as const),
  };
}
