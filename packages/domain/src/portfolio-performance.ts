import type { InvestmentExposurePosition } from "./exposure-read-model";
import type { InvestmentHoldingsView } from "./investment-holdings-view";
import { estimateProceedsAfterCarry } from "./investment-details";
import { calculatePositionPerformance } from "./position-economics";
import { effectivePositionValuation } from "./position-purchases";

export type PortfolioReturn = {
  eligibleCount: number;
  totalCount: number;
  estimatedCount: number;
  basisMinor: number;
  valueMinor: number;
  distributionsMinor: number;
  gainMinor: number;
  returnPpm: number | null;
};

export type PortfolioMultiple = {
  eligibleCount: number;
  totalCount: number;
  estimatedCount: number;
  paidInMinor: number;
  valueMinor: number;
  distributionsMinor: number;
  multiplePpm: number | null;
};

export type PortfolioPerformance = {
  holdingReturn: PortfolioReturn;
  privateTvpi: PortfolioMultiple;
  privateDpi: PortfolioMultiple;
};

function integer(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result))
    throw new Error("Portfolio performance exceeds safe integer limits.");
  return result;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0
    ? integer((BigInt(numerator) * 1_000_000n) / BigInt(denominator))
    : null;
}

function add(left: number, right: number): number {
  return integer(BigInt(left) + BigInt(right));
}

function isPrivate(position: InvestmentExposurePosition): boolean {
  return (
    position.isPrivateCompanyPosition ||
    position.positionKind === "spv_interest" ||
    (position.positionKind === "fund_interest" && position.ticker === null)
  );
}

function emptyMultiple(): PortfolioMultiple {
  return {
    eligibleCount: 0,
    totalCount: 0,
    estimatedCount: 0,
    paidInMinor: 0,
    valueMinor: 0,
    distributionsMinor: 0,
    multiplePpm: null,
  };
}

/**
 * Current accepted holdings only, in one currency. These are ratios of summed
 * amounts, never averages of holding returns or a time-weighted account return.
 * Iterate legal positions once; exposure mappings must not multiply capital.
 * No extra reads: both inputs come from the existing holdings projection.
 */
export function calculatePortfolioPerformance(
  holdings: InvestmentHoldingsView,
  currency: string,
): PortfolioPerformance {
  const records = new Map(
    holdings.positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => [position.id, position] as const),
      ),
    ),
  );
  const holdingReturn: PortfolioReturn = {
    eligibleCount: 0,
    totalCount: 0,
    estimatedCount: 0,
    basisMinor: 0,
    valueMinor: 0,
    distributionsMinor: 0,
    gainMinor: 0,
    returnPpm: null,
  };
  const privateTvpi = emptyMultiple();
  const privateDpi = emptyMultiple();

  for (const position of holdings.exposureView.positions) {
    if (
      position.currency !== currency ||
      position.instrumentType.trim().toLowerCase() === "cash"
    )
      continue;
    holdingReturn.totalCount += 1;
    const privatePosition = isPrivate(position);
    if (privatePosition) {
      privateTvpi.totalCount += 1;
      privateDpi.totalCount += 1;
    }
    const record = records.get(position.id);
    const investment = position.reviewedInvestment;
    const reviewed =
      investment &&
      (investment.appliesUntilSuperseded ||
        investment.snapshotId === position.snapshotId)
        ? investment
        : undefined;
    const supportedValue =
      position.valueState === "reported" &&
      position.valueMinor !== null &&
      position.valueSource !== "invested_amount";
    let valueMinor = supportedValue ? position.valueMinor : null;
    let estimated =
      position.valueSource === "share_price_estimate" ||
      position.valueSource === "portfolio_watch_estimate";

    if (privatePosition) {
      const selected = effectivePositionValuation(
        record?.purchaseReceipt,
        position.snapshotId,
      );
      const review = reviewed?.terms.reportedValueReview;
      const carryStatus =
        selected?.valueMinor === valueMinor
          ? selected.carryStatus
          : position.valueSource === "provider" &&
              review?.valueMinor === valueMinor &&
              review?.sourceSnapshotId ===
                (record?.linkedReportedValue?.snapshotId ?? position.snapshotId)
            ? review.carryStatus
            : "unknown";
      const carryCash =
        reviewed?.cashPaidMinor == null
          ? null
          : BigInt(reviewed.cashPaidMinor) -
            BigInt(reviewed.additionalPaidFeesMinor ?? 0) -
            BigInt(reviewed.returnedCapitalMinor ?? 0);
      const afterCarry = estimateProceedsAfterCarry({
        valueMinor,
        carryStatus,
        cashPaidMinor:
          carryCash !== null && carryCash >= 0n ? integer(carryCash) : null,
        netCapitalMinor:
          reviewed?.netCapitalMinor ??
          reviewed?.estimatedNetCapitalMinor ??
          null,
        carryPpm: reviewed?.terms.carryPpm ?? null,
        carryBasis: reviewed?.terms.carryBasis ?? "unknown",
      });
      valueMinor = afterCarry?.proceedsMinor ?? null;
      estimated ||= afterCarry !== null && !afterCarry.alreadyAfterCarry;

      // Paid-in capital includes reviewed paid fees and is NOT net invested.
      // Refunds remain cash returned in this basis. Add only refunds the source
      // explicitly excludes; a refund already reported must not be counted twice.
      if (
        reviewed?.cashPaidMinor != null &&
        reviewed.cashPaidMinor > 0 &&
        !reviewed.returnedCapitalReconciliationPending &&
        (reviewed.includedReturnedCapitalMinor ?? 0) <=
          position.realizedValueMinor
      ) {
        const distributions = add(
          position.realizedValueMinor,
          reviewed.additionalReturnedCapitalMinor ?? 0,
        );
        privateDpi.eligibleCount += 1;
        privateDpi.paidInMinor = add(
          privateDpi.paidInMinor,
          reviewed.cashPaidMinor,
        );
        privateDpi.distributionsMinor = add(
          privateDpi.distributionsMinor,
          distributions,
        );
        if (valueMinor !== null) {
          privateTvpi.eligibleCount += 1;
          privateTvpi.estimatedCount += estimated ? 1 : 0;
          privateTvpi.paidInMinor = add(
            privateTvpi.paidInMinor,
            reviewed.cashPaidMinor,
          );
          privateTvpi.valueMinor = add(privateTvpi.valueMinor, valueMinor);
          privateTvpi.distributionsMinor = add(
            privateTvpi.distributionsMinor,
            distributions,
          );
        }
      }
    }

    const performance = calculatePositionPerformance({
      currentValueMinor: valueMinor,
      currentValueReported: valueMinor !== null,
      realizedValueMinor: position.realizedValueMinor,
      providerCostBasisMinor: position.providerCostBasisMinor,
      fundedMinor: position.investedMinor,
      economicsContext: privatePosition
        ? {
            reviewedInvestment: investment,
            snapshotId: position.snapshotId,
            currency,
            committedMinor: position.committedMinor,
            fundedMinor: position.investedMinor,
            acceptedTerms: position.acceptedEconomicsTerms ?? null,
            reportedTerms: position.reportedEconomicsTerms ?? null,
          }
        : null,
      allowFundedAmountEstimate: false,
    });
    if (
      performance.totalReturnPpm !== null &&
      performance.costBasisMinor !== null &&
      performance.totalValueMinor !== null &&
      performance.totalGainMinor !== null &&
      valueMinor !== null
    ) {
      holdingReturn.eligibleCount += 1;
      holdingReturn.estimatedCount +=
        estimated || performance.costBasisSource === "reviewed_spv_estimate"
          ? 1
          : 0;
      holdingReturn.basisMinor = add(
        holdingReturn.basisMinor,
        performance.costBasisMinor,
      );
      holdingReturn.valueMinor = add(holdingReturn.valueMinor, valueMinor);
      holdingReturn.distributionsMinor = add(
        holdingReturn.distributionsMinor,
        integer(BigInt(performance.totalValueMinor) - BigInt(valueMinor)),
      );
      holdingReturn.gainMinor = add(
        holdingReturn.gainMinor,
        performance.totalGainMinor,
      );
    }
  }

  holdingReturn.returnPpm = ratio(
    holdingReturn.gainMinor,
    holdingReturn.basisMinor,
  );
  privateTvpi.multiplePpm = ratio(
    add(privateTvpi.valueMinor, privateTvpi.distributionsMinor),
    privateTvpi.paidInMinor,
  );
  privateDpi.multiplePpm = ratio(
    privateDpi.distributionsMinor,
    privateDpi.paidInMinor,
  );
  return { holdingReturn, privateTvpi, privateDpi };
}
