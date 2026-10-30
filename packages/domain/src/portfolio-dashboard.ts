import type { PortfolioBaselineState } from "./index";
import type {
  InvestmentExposureGroup,
  InvestmentExposurePosition,
} from "./exposure-read-model";
import { companyExposureGroups } from "./exposure-read-model";
import type { InvestmentHoldingsView } from "./investment-holdings-view";
import {
  calculatePortfolioPerformance,
  type PortfolioPerformance,
} from "./portfolio-performance";

const PARTS_PER_MILLION = 1_000_000n;

export type PortfolioDashboardExposure = {
  id: string;
  name: string;
  valueMinor: number;
  positionCount: number;
};

export type PortfolioDashboardLiquiditySegment = {
  key: "cash" | "public_market" | "private_paper" | "other_liquid";
  label: string;
  valueMinor: number;
};

export type PortfolioDashboardMover = {
  id: string;
  name: string;
  currentValueMinor: number;
  priorValueMinor: number;
  changeMinor: number;
  changePpm: number | null;
  positionCount: number;
};

export type PortfolioDashboardSnapshot = {
  asOf: string;
  currency: string;
  knownPortfolioValueMinor: number;
  knownExposureValueMinor: number;
  topFiveConcentrationPpm: number;
  unknownValueCount: number;
  otherCurrencyCount: number;
  performance: PortfolioPerformance;
  topExposures: readonly PortfolioDashboardExposure[];
  liquidity: readonly PortfolioDashboardLiquiditySegment[];
  moversUp: readonly PortfolioDashboardMover[];
  moversDown: readonly PortfolioDashboardMover[];
};

function safeNumber(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} exceeds safe integer limits.`);
  }
  return result;
}

function sumMinor(values: readonly number[], label: string): number {
  return safeNumber(
    values.reduce((total, value) => total + BigInt(value), 0n),
    label,
  );
}

function subtractMinor(left: number, right: number, label: string): number {
  return safeNumber(BigInt(left) - BigInt(right), label);
}

function scaleMinor(valueMinor: number, allocationPpm: number): number {
  return safeNumber(
    (BigInt(valueMinor) * BigInt(allocationPpm)) / PARTS_PER_MILLION,
    "Allocated comparison value",
  );
}

function ratioPpm(numerator: number, denominator: number): number {
  if (denominator === 0) {
    return 0;
  }
  return safeNumber(
    (BigInt(numerator) * PARTS_PER_MILLION) / BigInt(denominator),
    "Portfolio ratio",
  );
}

function signedRatioPpm(numerator: number, denominator: number): number | null {
  if (denominator === 0) {
    return null;
  }
  return safeNumber(
    (BigInt(numerator) * PARTS_PER_MILLION) / BigInt(denominator),
    "Portfolio change ratio",
  );
}

function isCashPosition(position: InvestmentExposurePosition): boolean {
  return position.instrumentType.trim().toLowerCase() === "cash";
}

function isCashExposure(group: InvestmentExposureGroup): boolean {
  return group.contributions.some((contribution) =>
    contribution.decisionReference.startsWith("cash-currency-v1:"),
  );
}

function displayCurrency(view: InvestmentHoldingsView): string {
  const currencies = new Set(
    companyExposureGroups(view.exposureView).flatMap((group) =>
      group.totals
        .filter((total) => total.knownValuePositionCount > 0)
        .map((total) => total.currency),
    ),
  );
  if (currencies.has("USD")) {
    return "USD";
  }
  return (
    [...currencies].sort((left, right) => left.localeCompare(right))[0] ?? "USD"
  );
}

function exposureRows(
  view: InvestmentHoldingsView,
  currency: string,
): PortfolioDashboardExposure[] {
  return companyExposureGroups(view.exposureView)
    .filter((group) => !isCashExposure(group))
    .flatMap((group): PortfolioDashboardExposure[] => {
      const total = group.totals.find((item) => item.currency === currency);
      if (total === undefined || total.knownValuePositionCount === 0) {
        return [];
      }
      return [
        {
          id: group.exposure.id,
          name: group.exposure.canonicalName,
          valueMinor: total.allocatedValueMinor,
          positionCount: new Set(
            group.contributions.map((contribution) => contribution.positionId),
          ).size,
        },
      ];
    })
    .sort(
      (left, right) =>
        right.valueMinor - left.valueMinor ||
        left.name.localeCompare(right.name),
    );
}

function liquiditySegments(
  baseline: PortfolioBaselineState,
): PortfolioDashboardLiquiditySegment[] {
  const brokerageCashMinor = sumMinor(
    baseline.positions
      .filter(
        (position) =>
          position.isCashPosition &&
          position.valueState === "reported" &&
          position.valueMinor !== null,
      )
      .map((position) => position.valueMinor ?? 0),
    "Brokerage cash total",
  );
  const bankCashMinor = sumMinor(
    baseline.cashAccounts
      .filter(
        (account) =>
          account.valueState === "reported" && account.valueMinor !== null,
      )
      .map((account) => account.valueMinor ?? 0),
    "Bank cash total",
  );
  const publicMarketMinor = sumMinor(
    baseline.positions
      .filter(
        (position) =>
          !position.isCashPosition &&
          position.classification === "public_market" &&
          position.valueState === "reported" &&
          position.valueMinor !== null,
      )
      .map((position) => position.valueMinor ?? 0),
    "Public-market total",
  );
  const privatePaperMinor = sumMinor(
    baseline.positions
      .filter(
        (position) =>
          !position.isCashPosition &&
          position.classification === "private_paper" &&
          position.valueState === "reported" &&
          position.valueMinor !== null,
      )
      .map((position) => position.valueMinor ?? 0),
    "Private-paper total",
  );
  const otherLiquidMinor =
    baseline.latestBaseline?.otherFiEligibleLiquidMinor ??
    baseline.suggestedOtherFiEligibleLiquidMinor;

  return [
    {
      key: "cash",
      label: "Cash",
      valueMinor: sumMinor([bankCashMinor, brokerageCashMinor], "Total cash"),
    },
    {
      key: "public_market",
      label: "Public market",
      valueMinor: publicMarketMinor,
    },
    {
      key: "private_paper",
      label: "Private paper",
      valueMinor: privatePaperMinor,
    },
    ...(otherLiquidMinor === 0
      ? []
      : [
          {
            key: "other_liquid" as const,
            label: "Other liquid",
            valueMinor: otherLiquidMinor,
          },
        ]),
  ];
}

function exposureMovers(
  view: InvestmentHoldingsView,
  currency: string,
): PortfolioDashboardMover[] {
  const positionById = new Map(
    view.exposureView.positions.map((position) => [position.id, position]),
  );

  return companyExposureGroups(view.exposureView)
    .filter((group) => !isCashExposure(group))
    .flatMap((group): PortfolioDashboardMover[] => {
      if (
        group.contributions.length === 0 ||
        group.contributions.some(
          (contribution) => contribution.currency !== currency,
        )
      ) {
        return [];
      }

      const currentValues: number[] = [];
      const priorValues: number[] = [];
      const positionIds = new Set<string>();
      for (const contribution of group.contributions) {
        const position = positionById.get(contribution.positionId);
        if (
          position === undefined ||
          contribution.valueState !== "reported" ||
          contribution.allocatedValueMinor === null ||
          contribution.allocationPpm === null ||
          position.priorValueState !== "reported" ||
          position.priorValueMinor == null ||
          position.priorValueObservedAt == null
        ) {
          return [];
        }
        currentValues.push(contribution.allocatedValueMinor);
        priorValues.push(
          scaleMinor(position.priorValueMinor, contribution.allocationPpm),
        );
        positionIds.add(position.id);
      }

      const currentValueMinor = sumMinor(
        currentValues,
        "Current exposure comparison value",
      );
      const priorValueMinor = sumMinor(
        priorValues,
        "Prior exposure comparison value",
      );
      const changeMinor = subtractMinor(
        currentValueMinor,
        priorValueMinor,
        "Exposure value change",
      );
      if (changeMinor === 0) {
        return [];
      }
      return [
        {
          id: group.exposure.id,
          name: group.exposure.canonicalName,
          currentValueMinor,
          priorValueMinor,
          changeMinor,
          changePpm: signedRatioPpm(changeMinor, priorValueMinor),
          positionCount: positionIds.size,
        },
      ];
    });
}

export function createPortfolioDashboardSnapshot(
  holdings: InvestmentHoldingsView,
  baseline: PortfolioBaselineState,
): PortfolioDashboardSnapshot {
  const currency = displayCurrency(holdings);
  const exposures = exposureRows(holdings, currency);
  const knownExposureValueMinor = sumMinor(
    exposures.map((exposure) => exposure.valueMinor),
    "Known mapped exposure total",
  );
  const topFiveValueMinor = sumMinor(
    exposures.slice(0, 5).map((exposure) => exposure.valueMinor),
    "Top-five exposure total",
  );
  const liquidity = liquiditySegments(baseline);
  const movers = exposureMovers(holdings, currency);
  const cashPositionIds = new Set(
    holdings.exposureView.positions
      .filter(isCashPosition)
      .map((position) => position.id),
  );
  const unknownInvestmentCount = holdings.exposureView.positions.filter(
    (position) =>
      !cashPositionIds.has(position.id) && position.valueState !== "reported",
  ).length;
  const unknownCashCount = baseline.positions.filter(
    (position) => position.isCashPosition && position.valueState !== "reported",
  ).length;
  const unknownBankCashCount = baseline.cashAccounts.filter(
    (account) => account.valueState !== "reported",
  ).length;
  const otherCurrencies = new Set(
    companyExposureGroups(holdings.exposureView).flatMap((group) =>
      group.totals
        .filter(
          (total) =>
            total.currency !== currency && total.knownValuePositionCount > 0,
        )
        .map((total) => total.currency),
    ),
  );

  return {
    asOf: holdings.exposureView.asOf,
    currency,
    knownPortfolioValueMinor: sumMinor(
      liquidity.map((segment) => segment.valueMinor),
      "Known portfolio total",
    ),
    knownExposureValueMinor,
    topFiveConcentrationPpm:
      knownExposureValueMinor === 0
        ? 0
        : ratioPpm(topFiveValueMinor, knownExposureValueMinor),
    unknownValueCount:
      unknownInvestmentCount + unknownCashCount + unknownBankCashCount,
    otherCurrencyCount: otherCurrencies.size,
    performance: calculatePortfolioPerformance(holdings, currency),
    topExposures: exposures.slice(0, 10),
    liquidity,
    moversUp: movers
      .filter((mover) => mover.changeMinor > 0)
      .sort(
        (left, right) =>
          right.changeMinor - left.changeMinor ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 5),
    moversDown: movers
      .filter((mover) => mover.changeMinor < 0)
      .sort(
        (left, right) =>
          left.changeMinor - right.changeMinor ||
          left.name.localeCompare(right.name),
      )
      .slice(0, 5),
  };
}
