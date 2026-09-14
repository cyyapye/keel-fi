import {
  addMinorUnits,
  multiplyMinorByScalePpm,
  type AcceptedCashAccount,
  type Holding,
  type InvestmentConnectionStatus,
  type InvestmentConnectionsState,
  type PrivateExposureCompany,
  type PrivateExposureResolutionInput,
  type PrivateExposureReviewPosition,
  type PrivateExposureReviewState,
} from "@keel/domain";
import { calculatePositionPerformance } from "@keel/domain/position-economics";
import type {
  InvestmentExposureGroup,
  InvestmentExposurePosition,
} from "@keel/domain/exposure-read-model";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import type {
  InvestmentPositionConnection,
  InvestmentPositionContainer,
  InvestmentPositionRecord,
} from "@keel/domain/position-read-model";
import {
  ActionGroup,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  EmptyState,
  FormMessage,
  Input,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SectionHeader,
  SearchHighlight,
  Stat,
  TextLink,
} from "@keel/ui";
import {
  Fragment,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyPrivateExposureExactBatch,
  assignPrivateCompanyExposure,
  changeInvestmentConnectionLifecycle,
  createInvestmentLinkToken,
  createInvestmentReconnectLinkToken,
  disconnectInvestmentConnection,
  exchangeInvestmentPublicToken,
  loadInvestmentConnections,
  loadPrivateExposureReviews,
  syncDueInvestmentHoldings,
  syncInvestmentHoldings,
} from "./api";
import {
  formatCompactCurrency,
  formatDate,
  formatMagnitudeRoundedCurrency,
  formatRoundedCompactCurrency,
} from "./format";
import { useBoundedPolling } from "./use-bounded-polling";
import { openPlaidLink } from "./plaid-link";
import {
  HOLDINGS_POSITION_PAGE_SIZE,
  isCashExposure,
  isCashPosition,
  type HoldingsSearchMatches,
} from "./collection-search";

const INVESTMENT_LINK_TOKEN_STORAGE_KEY = "keel.investmentLinkToken";
const INVESTMENT_LINK_MODE_STORAGE_KEY = "keel.investmentLinkMode";
const INVESTMENT_ADD_MODE = "add";
const INVESTMENT_RECONNECT_PREFIX = "reconnect:";
const INVESTMENT_OAUTH_RECONNECT_MESSAGE =
  "Open this connection again to finish signing in.";
const AUTOMATIC_INVESTMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const SMALL_CASH_BALANCE_MINOR = 10_000;
const PUBLIC_EQUITY_INSTRUMENT_TYPES = new Set([
  "common stock",
  "common_stock",
  "equity",
  "etf",
  "mutual fund",
  "mutual_fund",
  "stock",
]);

type ConnectionAction =
  | "add"
  | "check"
  | "disconnect"
  | "exchange"
  | "pause"
  | "reconnect"
  | "resume";

type BusyAction = {
  action: ConnectionAction;
  connectionId: string | null;
};

function initialInvestmentError(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const returningFromOauth = new URLSearchParams(window.location.search).has(
    "oauth_state_id",
  );
  return returningFromOauth &&
    window.sessionStorage.getItem(INVESTMENT_LINK_MODE_STORAGE_KEY) !== null &&
    window.sessionStorage.getItem(INVESTMENT_LINK_TOKEN_STORAGE_KEY) === null
    ? INVESTMENT_OAUTH_RECONNECT_MESSAGE
    : null;
}

function clearStoredLink() {
  window.sessionStorage.removeItem(INVESTMENT_LINK_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(INVESTMENT_LINK_MODE_STORAGE_KEY);
}

function isRetryableInvestmentCheckFailure(
  status: InvestmentConnectionStatus | null,
): boolean {
  return (
    status?.status === "needs_attention" &&
    status.errorCode === "unexpected_failure"
  );
}

function hasDueInvestmentConnection(
  state: InvestmentConnectionsState,
): boolean {
  const syncedAfter = Date.now() - AUTOMATIC_INVESTMENT_SYNC_INTERVAL_MS;
  return state.connections.some(
    (connection) =>
      (connection.status === "ready" ||
        isRetryableInvestmentCheckFailure(connection)) &&
      connection.automaticUpdatesEnabled &&
      connection.latestImportId === null &&
      (connection.lastSyncedAt === null ||
        Date.parse(connection.lastSyncedAt) < syncedAfter),
  );
}

function lifecycleLabel(status: InvestmentConnectionStatus | null): string {
  if (status === null) {
    return "Imported source";
  }
  return {
    disconnected: "Disconnected",
    paused: "Paused",
    ready: "Up to date",
    syncing: "Checking",
    needs_attention:
      status.errorCode === "connection_invalid"
        ? "Reconnect needed"
        : status.errorCode === "unexpected_failure"
          ? "Check failed"
          : "Needs attention",
  }[status.status];
}

function lifecycleTone(
  status: InvestmentConnectionStatus | null,
): "neutral" | "warning" | "negative" | "positive" {
  if (status === null || status.status === "disconnected") {
    return "neutral";
  }
  if (status.status === "ready") {
    return "positive";
  }
  return status.status === "needs_attention" ? "negative" : "warning";
}

function latestCompleteObservation(
  connection: InvestmentPositionConnection | null,
): string | null {
  const observations =
    connection?.containers
      .map((container) => container.coverage)
      .filter(
        (
          coverage,
        ): coverage is NonNullable<InvestmentPositionContainer["coverage"]> =>
          coverage?.completeness === "complete",
      )
      .map((coverage) => coverage.observedAt) ?? [];
  return (
    observations.sort((left, right) => right.localeCompare(left))[0] ?? null
  );
}

function formatHoldingCurrency(minorUnits: number, currency: string): string {
  const formatted = formatCompactCurrency(minorUnits, currency);
  return currency.toUpperCase() === "USD"
    ? formatted.replace(/^USD /u, "$")
    : formatted;
}

function formatRoundedHoldingCurrency(
  minorUnits: number,
  currency: string,
  roundingMajorUnits: number,
): string {
  const formatted = formatRoundedCompactCurrency(
    minorUnits,
    currency,
    roundingMajorUnits,
  );
  return currency.toUpperCase() === "USD"
    ? formatted.replace(/^USD /u, "$")
    : formatted;
}

function formatMagnitudeRoundedHoldingCurrency(
  minorUnits: number,
  currency: string,
): string {
  const formatted = formatMagnitudeRoundedCurrency(minorUnits, currency);
  return currency.toUpperCase() === "USD"
    ? formatted.replace(/^USD /u, "$")
    : formatted;
}

function formatCurrencyTotals(
  reportedByCurrency: ReadonlyMap<string, number>,
  unavailableCount: number,
  emptyLabel = "Value unavailable",
): string {
  if (reportedByCurrency.size === 0) {
    return emptyLabel;
  }
  const reported = [...reportedByCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, valueMinor]) =>
      formatHoldingCurrency(valueMinor, currency),
    );
  return [
    ...reported,
    ...(unavailableCount === 0
      ? []
      : [
          `${unavailableCount} value${unavailableCount === 1 ? "" : "s"} unavailable`,
        ]),
  ].join(" · ");
}

function investmentPositionTotalsLabel(
  positions: readonly InvestmentPositionRecord[],
): string {
  const reportedByCurrency = new Map<string, number>();
  let unavailableCount = 0;
  for (const position of positions) {
    const value = position.snapshot.netValue;
    if (value.state !== "reported" || value.minor === null) {
      unavailableCount += 1;
      continue;
    }
    const currency = position.snapshot.currency;
    reportedByCurrency.set(
      currency,
      addMinorUnits(reportedByCurrency.get(currency) ?? 0, value.minor),
    );
  }
  return formatCurrencyTotals(
    reportedByCurrency,
    unavailableCount,
    positions.length === 0 ? "No reviewed value" : "Value unavailable",
  );
}

function investmentConnectionTotalsLabel(
  connection: InvestmentPositionConnection | null,
): string {
  return connection === null
    ? "Value unavailable"
    : investmentPositionTotalsLabel(
        connection.containers.flatMap((container) => container.positions),
      );
}

function exposurePositionValue(position: InvestmentExposurePosition): string {
  if (position.valueState === "reported" && position.valueMinor !== null) {
    return isCashPosition(position)
      ? formatHoldingCurrency(position.valueMinor, position.currency)
      : formatRoundedHoldingCurrency(
          position.valueMinor,
          position.currency,
          1_000,
        );
  }
  return position.valueState === "locked" ? "Locked" : "Not reported";
}

function isDirectPublicPosition(position: InvestmentExposurePosition): boolean {
  return (
    position.positionKind === "direct" &&
    position.ticker !== null &&
    PUBLIC_EQUITY_INSTRUMENT_TYPES.has(
      position.instrumentType.trim().toLowerCase(),
    )
  );
}

type SharePriceObservation = {
  currency: string;
  observedAt: string;
  quantityMicros: number;
  ticker: string;
  valueMinor: number;
};

type SharePricePresentation = {
  label: string;
  observedAt: string;
};

function sharePriceMinor(
  valueMinor: bigint,
  quantityMicros: bigint,
): number | null {
  if (quantityMicros <= 0n) {
    return null;
  }
  const rounded =
    (valueMinor * 1_000_000n + quantityMicros / 2n) / quantityMicros;
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

function positionSharePriceObservation(
  position: InvestmentExposurePosition,
): SharePriceObservation | null {
  if (
    !isDirectPublicPosition(position) ||
    position.valueSource !== "provider" ||
    position.valueState !== "reported" ||
    position.valueMinor === null ||
    position.quantityMicros === null ||
    position.quantityMicros <= 0 ||
    position.hasUnknownAllocation ||
    position.knownAllocationPpm !== 1_000_000 ||
    position.mappings.length !== 1 ||
    position.mappings[0]?.relationshipKind !== "direct"
  ) {
    return null;
  }
  return {
    currency: position.currency,
    observedAt: position.observedAt,
    quantityMicros: position.quantityMicros,
    ticker: position.ticker!,
    valueMinor: position.valueMinor,
  };
}

function sharePricePresentation(
  observation: SharePriceObservation,
): SharePricePresentation | null {
  const priceMinor = sharePriceMinor(
    BigInt(observation.valueMinor),
    BigInt(observation.quantityMicros),
  );
  return priceMinor === null
    ? null
    : {
        label: formatHoldingCurrency(priceMinor, observation.currency),
        observedAt: observation.observedAt,
      };
}

function positionSharePricePresentation(
  position: InvestmentExposurePosition,
): SharePricePresentation | null {
  const observation = positionSharePriceObservation(position);
  return observation === null ? null : sharePricePresentation(observation);
}

function isDirectPublicExposure(
  group: InvestmentExposureGroup,
  positions: readonly InvestmentExposurePosition[],
): boolean {
  return (
    group.exposure.exposureKind === "public_instrument" &&
    positions.length > 0 &&
    positions.every(isDirectPublicPosition) &&
    group.contributions.every(
      (contribution) =>
        contribution.relationshipKind === "direct" &&
        contribution.allocationPpm === 1_000_000,
    )
  );
}

function exposureSharePricePresentation(
  group: InvestmentExposureGroup,
  positions: readonly InvestmentExposurePosition[],
): SharePricePresentation | null {
  if (!isDirectPublicExposure(group, positions)) {
    return null;
  }
  const observations = positions.map(positionSharePriceObservation);
  if (observations.some((observation) => observation === null)) {
    return null;
  }
  const accepted = observations.filter(
    (observation): observation is SharePriceObservation => observation !== null,
  );
  if (
    new Set(accepted.map((observation) => observation.currency)).size !== 1 ||
    new Set(accepted.map((observation) => observation.ticker)).size !== 1
  ) {
    return null;
  }
  const latestObservedAt = accepted.reduce(
    (latest, observation) =>
      observation.observedAt > latest ? observation.observedAt : latest,
    accepted[0]!.observedAt,
  );
  const latest = accepted.filter(
    (observation) => observation.observedAt === latestObservedAt,
  );
  const totalValueMinor = latest.reduce(
    (sum, observation) => sum + BigInt(observation.valueMinor),
    0n,
  );
  const totalQuantityMicros = latest.reduce(
    (sum, observation) => sum + BigInt(observation.quantityMicros),
    0n,
  );
  const priceMinor = sharePriceMinor(totalValueMinor, totalQuantityMicros);
  return priceMinor === null
    ? null
    : {
        label: formatHoldingCurrency(priceMinor, latest[0]!.currency),
        observedAt: latestObservedAt,
      };
}

function exposureValueSourceLabel(
  position: InvestmentExposurePosition,
): string | null {
  if (position.valueSource === "reviewed_adjustment") {
    return "Reviewed mark";
  }
  if (position.valueSource === "invested_amount") {
    return "Invested amount estimate";
  }
  if (position.valueSource === "portfolio_watch_estimate") {
    return "Portfolio Watch estimate";
  }
  return null;
}

function exposurePositionPerformance(position: InvestmentExposurePosition) {
  return calculatePositionPerformance({
    currentValueMinor: position.valueMinor,
    currentValueReported:
      position.valueState === "reported" &&
      position.valueSource !== "invested_amount",
    realizedValueMinor: position.realizedValueMinor,
    providerCostBasisMinor: position.providerCostBasisMinor,
    fundedMinor: position.investedMinor,
    economicsContext:
      position.positionKind === "spv_interest" && position.committedMinor > 0
        ? {
            snapshotId: position.snapshotId,
            currency: position.currency,
            committedMinor: position.committedMinor,
            fundedMinor: position.investedMinor,
            acceptedTerms: position.acceptedEconomicsTerms ?? null,
            reportedTerms: position.reportedEconomicsTerms ?? null,
          }
        : null,
    allowFundedAmountEstimate:
      position.isPrivateCompanyPosition ||
      position.positionKind === "spv_interest" ||
      position.positionKind === "fund_interest",
  });
}

function signedRoundedReturnLabel(valuePpm: number): string {
  const wholePercent = Math.floor((Math.abs(valuePpm) + 5_000) / 10_000);
  if (wholePercent === 0) {
    return "0%";
  }
  return `${valuePpm > 0 ? "+" : "−"}${wholePercent}%`;
}

function positionEconomicsLabel(
  position: InvestmentExposurePosition,
  sharePriceLabel: string | null,
): string | null {
  const performance = exposurePositionPerformance(position);
  const labels: string[] = [];
  if (performance.costBasisMinor !== null) {
    const basisLabel = formatRoundedHoldingCurrency(
      performance.costBasisMinor,
      position.currency,
      1_000,
    );
    labels.push(basisLabel);
  }
  if (sharePriceLabel !== null) {
    labels.push(sharePriceLabel);
  }
  if (performance.totalReturnPpm !== null) {
    labels.push(signedRoundedReturnLabel(performance.totalReturnPpm));
  }
  return labels.length === 0 ? null : labels.join(" · ");
}

function exposurePerformanceLabel(
  group: InvestmentExposureGroup,
  positions: readonly InvestmentExposurePosition[],
  sharePriceLabel: string | null,
): string | null {
  if (group.contributions.length === 0) {
    return sharePriceLabel;
  }
  const positionById = new Map(
    positions.map((position) => [position.id, position]),
  );
  const currencies = new Set<string>();
  const allocatedBases: number[] = [];
  const allocatedValues: number[] = [];
  let returnAvailable = true;

  for (const contribution of group.contributions) {
    const position = positionById.get(contribution.positionId);
    if (position === undefined || contribution.allocationPpm === null) {
      return sharePriceLabel;
    }
    const performance = exposurePositionPerformance(position);
    if (performance.costBasisMinor === null) {
      return sharePriceLabel;
    }
    currencies.add(position.currency);
    allocatedBases.push(
      multiplyMinorByScalePpm(
        performance.costBasisMinor,
        contribution.allocationPpm,
      ),
    );
    if (performance.totalValueMinor === null) {
      returnAvailable = false;
    } else {
      allocatedValues.push(
        multiplyMinorByScalePpm(
          performance.totalValueMinor,
          contribution.allocationPpm,
        ),
      );
    }
  }
  if (currencies.size !== 1) {
    return sharePriceLabel;
  }
  const currency = [...currencies][0]!;
  const basisMinor = allocatedBases.reduce(
    (total, value) => addMinorUnits(total, value),
    0,
  );
  const basisLabel = formatRoundedHoldingCurrency(basisMinor, currency, 1_000);
  const basisAndPriceLabel = [basisLabel, sharePriceLabel]
    .filter((label): label is string => label !== null)
    .join(" · ");
  if (!returnAvailable || allocatedValues.length !== allocatedBases.length) {
    return basisAndPriceLabel;
  }
  const totalValueMinor = allocatedValues.reduce(
    (total, value) => addMinorUnits(total, value),
    0,
  );
  if (basisMinor === 0) {
    return basisAndPriceLabel;
  }
  const gainMinor = BigInt(totalValueMinor) - BigInt(basisMinor);
  const returnPpm = Number((gainMinor * 1_000_000n) / BigInt(basisMinor));
  if (!Number.isSafeInteger(returnPpm)) {
    return basisAndPriceLabel;
  }
  return `${basisAndPriceLabel} · ${signedRoundedReturnLabel(returnPpm)}`;
}

function companyExposureGroups(data: InvestmentHoldingsView) {
  return data.exposureView.exposures.filter((group) => !isCashExposure(group));
}

function exposureTotalsLabel(
  totals: InvestmentHoldingsView["exposureView"]["exposures"][number]["totals"],
): string {
  const reportedByCurrency = new Map(
    totals
      .filter((total) => total.knownValuePositionCount > 0)
      .map((total) => [total.currency, total.allocatedValueMinor]),
  );
  const unavailableCount = totals.reduce(
    (count, total) => count + total.unknownValuePositionCount,
    0,
  );
  if (reportedByCurrency.size === 0) {
    return "Value unavailable";
  }
  const reported = [...reportedByCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, valueMinor]) =>
      formatMagnitudeRoundedHoldingCurrency(valueMinor, currency),
    );
  return [
    ...reported,
    ...(unavailableCount === 0
      ? []
      : [
          `${unavailableCount} value${unavailableCount === 1 ? "" : "s"} unavailable`,
        ]),
  ].join(" · ");
}

function exposureGrandTotalLabel(data: InvestmentHoldingsView): string {
  const reportedByCurrency = new Map<string, number>();
  for (const group of companyExposureGroups(data)) {
    for (const total of group.totals) {
      if (total.knownValuePositionCount === 0) {
        continue;
      }
      reportedByCurrency.set(
        total.currency,
        addMinorUnits(
          reportedByCurrency.get(total.currency) ?? 0,
          total.allocatedValueMinor,
        ),
      );
    }
  }
  const unavailableCount = data.exposureView.positions.filter(
    (position) =>
      !isCashPosition(position) &&
      (position.valueState !== "reported" || position.hasUnknownAllocation),
  ).length;
  return formatCurrencyTotals(
    reportedByCurrency,
    unavailableCount,
    companyExposureGroups(data).length === 0
      ? formatHoldingCurrency(0, "USD")
      : "Value unavailable",
  );
}

function exposureDisplayName(
  group: InvestmentExposureGroup,
  positions: readonly InvestmentExposurePosition[],
): string {
  if (
    group.exposure.exposureKind !== "public_instrument" ||
    group.contributions.some(
      (contribution) => contribution.relationshipKind !== "direct",
    )
  ) {
    return group.exposure.canonicalName;
  }
  const tickers = new Set(
    positions.flatMap((position) =>
      position.ticker === null ? [] : [position.ticker],
    ),
  );
  return tickers.size === 1
    ? ([...tickers][0] ?? group.exposure.canonicalName)
    : group.exposure.canonicalName;
}

function positionDisplayName(position: InvestmentExposurePosition): string {
  return position.ticker ?? position.legalVehicleName;
}

type ExposureSortDirection = "ascending" | "descending";

const EXPOSURE_SORT_OPTIONS = [
  { label: "Highest first", value: "descending" },
  { label: "Lowest first", value: "ascending" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: ExposureSortDirection;
}>;

type SortableValue = {
  currency: string;
  valueMinor: number;
};

function exposureSortValue(
  group: InvestmentExposureGroup,
): SortableValue | null {
  const reportedTotals = group.totals.filter(
    (total) => total.knownValuePositionCount > 0,
  );
  return reportedTotals.length === 1
    ? {
        currency: reportedTotals[0]!.currency,
        valueMinor: reportedTotals[0]!.allocatedValueMinor,
      }
    : null;
}

function positionSortValue(
  position: InvestmentExposurePosition,
): SortableValue | null {
  return position.valueState === "reported" && position.valueMinor !== null
    ? { currency: position.currency, valueMinor: position.valueMinor }
    : null;
}

function compareSortableValues(
  left: SortableValue | null,
  right: SortableValue | null,
  direction: ExposureSortDirection,
): number {
  if (left === null) {
    return right === null ? 0 : 1;
  }
  if (right === null) {
    return -1;
  }
  const currencyOrder = left.currency.localeCompare(right.currency);
  if (currencyOrder !== 0) {
    return currencyOrder;
  }
  return direction === "ascending"
    ? left.valueMinor - right.valueMinor
    : right.valueMinor - left.valueMinor;
}

function compareExposureGroups(
  left: InvestmentExposureGroup,
  right: InvestmentExposureGroup,
  direction: ExposureSortDirection,
): number {
  const valueOrder = compareSortableValues(
    exposureSortValue(left),
    exposureSortValue(right),
    direction,
  );
  return valueOrder !== 0
    ? valueOrder
    : left.exposure.canonicalName.localeCompare(right.exposure.canonicalName);
}

function compareExposurePositions(
  left: InvestmentExposurePosition,
  right: InvestmentExposurePosition,
  direction: ExposureSortDirection,
): number {
  const valueOrder = compareSortableValues(
    positionSortValue(left),
    positionSortValue(right),
    direction,
  );
  return valueOrder !== 0
    ? valueOrder
    : left.legalVehicleName.localeCompare(right.legalVehicleName);
}

function accountKindLabel(kind: InvestmentPositionContainer["kind"]): string {
  return {
    brokerage: "Brokerage",
    ira: "IRA",
    retirement: "Retirement",
    trust: "Trust",
    entity: "Entity",
    unresolved: "Unresolved account",
    other: "Other account",
  }[kind];
}

function coverageLabel(
  coverage: NonNullable<InvestmentPositionContainer["coverage"]>,
): string {
  const completeness = {
    complete: "Complete",
    partial: "Partial",
    unavailable: "Unavailable",
    malformed: "Needs attention",
    failed: "Check failed",
    ambiguous: "Needs review",
  }[coverage.completeness];
  return `${completeness} · ${coverage.freshness === "stale" ? "stale since" : "as of"} ${formatDate(coverage.observedAt)}`;
}

function InvestmentAccountRows({
  connection,
}: {
  connection: InvestmentPositionConnection | null;
}) {
  if (connection === null || connection.containers.length === 0) {
    return (
      <EmptyState
        className="investment-institution__empty"
        compact
        headingAs="h4"
        icon={null}
        title="No reviewed accounts yet."
      />
    );
  }
  return (
    <div className="investment-institution__accounts">
      {connection.containers.map((container) => (
        <div className="investment-institution__account" key={container.id}>
          <span>
            <strong>{container.label}</strong>
            <small>
              {accountKindLabel(container.kind)} · {container.positions.length}{" "}
              {container.positions.length === 1 ? "position" : "positions"}
            </small>
          </span>
          <span className="investment-institution__account-value">
            <strong>
              {investmentPositionTotalsLabel(container.positions)}
            </strong>
            <small>
              {container.coverage === null
                ? "Not checked"
                : coverageLabel(container.coverage)}
            </small>
          </span>
        </div>
      ))}
    </div>
  );
}

function InstitutionActions({
  busy,
  confirmDisconnect,
  newConnectionsAvailable,
  onAction,
  onCancelDisconnect,
  onConnectAgain,
  onConfirmDisconnect,
  onReviewImport,
  status,
}: {
  busy: BusyAction | null;
  confirmDisconnect: boolean;
  newConnectionsAvailable: boolean;
  onAction: (action: ConnectionAction) => void;
  onCancelDisconnect: () => void;
  onConnectAgain: () => void;
  onConfirmDisconnect: () => void;
  onReviewImport: (importId: string) => void;
  status: InvestmentConnectionStatus;
}) {
  const isBusy = busy?.connectionId === status.connectionId;
  const isAdding = busy?.action === "add" || busy?.action === "exchange";
  const isRetryableFailure = isRetryableInvestmentCheckFailure(status);
  const waitingCount = status.latestAdjudication?.quarantinedCount ?? 0;
  if (status.status === "disconnected") {
    return (
      <ActionGroup
        className="investment-institution__reconnect"
        layout="split"
        mobileLayout="stack"
      >
        <p>
          This Plaid connection ended. Reviewed positions and planning history
          remain available.
        </p>
        {newConnectionsAvailable && (
          <Button
            disabled={busy !== null}
            onClick={onConnectAgain}
            tone="primary"
          >
            {isAdding ? "Opening…" : "Connect again"}
          </Button>
        )}
      </ActionGroup>
    );
  }
  if (confirmDisconnect) {
    return (
      <ActionGroup
        className="investment-institution__confirm"
        layout="split"
        mobileLayout="stack"
        role="group"
      >
        <p>Provider access will be removed. Reviewed history stays in Keel.</p>
        <ActionGroup align="end" mobileLayout="grid">
          <Button disabled={isBusy} onClick={onCancelDisconnect} tone="quiet">
            Keep connected
          </Button>
          <Button
            disabled={isBusy}
            onClick={() => onAction("disconnect")}
            tone="danger"
          >
            {isBusy ? "Disconnecting…" : "Disconnect"}
          </Button>
        </ActionGroup>
      </ActionGroup>
    );
  }
  return (
    <ActionGroup
      align="end"
      className="investment-institution__actions"
      mobileLayout="grid"
      wrap
    >
      {isRetryableFailure && (
        <p className="investment-institution__retry-note">
          We’ll try again later.
        </p>
      )}
      {status.latestImportId !== null && waitingCount > 0 && (
        <Button
          onClick={() => onReviewImport(status.latestImportId!)}
          tone="primary"
        >
          Review {waitingCount === 1 ? "item" : `${waitingCount} items`}
        </Button>
      )}
      {status.status === "needs_attention" &&
      status.errorCode === "connection_invalid" ? (
        <Button
          disabled={isBusy}
          onClick={() => onAction("reconnect")}
          tone="primary"
        >
          {isBusy ? "Opening…" : "Reconnect"}
        </Button>
      ) : status.status === "paused" ? (
        <Button
          disabled={isBusy}
          onClick={() => onAction("resume")}
          tone="primary"
        >
          {isBusy ? "Resuming…" : "Resume updates"}
        </Button>
      ) : waitingCount === 0 ? (
        <Button
          disabled={isBusy || status.status === "syncing"}
          onClick={() => onAction("check")}
          tone="secondary"
        >
          {isBusy || status.status === "syncing"
            ? "Checking…"
            : isRetryableFailure
              ? "Try now"
              : "Check now"}
        </Button>
      ) : null}
      {status.status !== "paused" &&
        !(
          status.status === "needs_attention" &&
          status.errorCode === "connection_invalid"
        ) && (
          <Button
            disabled={isBusy || status.status === "syncing"}
            onClick={() => onAction("pause")}
            tone="quiet"
          >
            Pause
          </Button>
        )}
      <Button
        disabled={isBusy || status.status === "syncing"}
        onClick={onConfirmDisconnect}
        tone="quiet"
      >
        Disconnect
      </Button>
    </ActionGroup>
  );
}

function companyStatusLabel(status: PrivateExposureCompany["status"]): string {
  return {
    active: "Active",
    exited: "Exited",
    written_off: "Written off",
  }[status];
}

function PrivateExposureAssignmentForm({
  busy,
  companies,
  error,
  onCancel,
  onSubmit,
  position,
}: {
  busy: boolean;
  companies: readonly PrivateExposureCompany[];
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: PrivateExposureResolutionInput) => void;
  position: PrivateExposureReviewPosition;
}) {
  const [mode, setMode] = useState<"existing" | "new">(
    companies.length > 0 ? "existing" : "new",
  );
  const [companyId, setCompanyId] = useState("");
  const [legalName, setLegalName] = useState(
    position.reportedExposureName ?? "",
  );
  const [websiteHost, setWebsiteHost] = useState("");
  const companyOptions = companies.map((company) => ({
    label: `${company.legalName} · ${
      company.websiteHost ?? companyStatusLabel(company.status)
    }`,
    value: company.id,
  }));
  const canSubmit =
    !busy &&
    (mode === "existing" ? companyId.length > 0 : legalName.trim().length > 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    onSubmit({
      expectedSnapshotId: position.snapshotId,
      company:
        mode === "existing"
          ? { mode, companyId }
          : {
              mode,
              legalName: legalName.trim(),
              websiteHost:
                websiteHost.trim().length === 0 ? null : websiteHost.trim(),
            },
    });
  };

  return (
    <form
      aria-label={"Assign " + position.legalVehicleName + " exposure"}
      className="private-exposure-review"
      onSubmit={submit}
    >
      <div className="private-exposure-review__heading">
        <div>
          <p className="eyebrow">Exposure review</p>
          <h4>Choose the underlying company</h4>
        </div>
        <p>
          {position.reportedExposureName === null
            ? "The import did not name a company."
            : "Reported as " + position.reportedExposureName + "."}{" "}
          The legal position and value stay unchanged.
        </p>
      </div>
      <fieldset>
        <legend>Company identity</legend>
        {companies.length > 0 && (
          <label className="private-exposure-review__choice">
            <Input
              checked={mode === "existing"}
              disabled={busy}
              name={"company-mode-" + position.positionId}
              onChange={() => setMode("existing")}
              type="radio"
            />
            Choose a reviewed company
          </label>
        )}
        {mode === "existing" && companies.length > 0 && (
          <label>
            Company
            <Select
              disabled={busy}
              items={companyOptions}
              onValueChange={(value) =>
                setCompanyId(typeof value === "string" ? value : "")
              }
              value={companyId.length === 0 ? null : companyId}
            >
              <SelectTrigger aria-label="Company">
                <SelectValue placeholder="Select a company" />
              </SelectTrigger>
              <SelectContent>
                {companyOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <label className="private-exposure-review__choice">
          <Input
            checked={mode === "new"}
            disabled={busy}
            name={"company-mode-" + position.positionId}
            onChange={() => setMode("new")}
            type="radio"
          />
          Create a reviewed company
        </label>
        {mode === "new" && (
          <div className="private-exposure-review__new-company">
            <label>
              Company name
              <Input
                disabled={busy}
                maxLength={1_000}
                onChange={(event) => setLegalName(event.target.value)}
                required
                value={legalName}
              />
            </label>
            <label>
              Website domain <small>Optional</small>
              <Input
                autoCapitalize="none"
                disabled={busy}
                maxLength={253}
                onChange={(event) => setWebsiteHost(event.target.value)}
                placeholder="company.example"
                spellCheck={false}
                value={websiteHost}
              />
            </label>
          </div>
        )}
      </fieldset>
      {error !== null && <FormMessage tone="error">{error}</FormMessage>}
      <ActionGroup
        align="end"
        className="private-exposure-review__actions"
        mobileLayout="grid"
      >
        <Button disabled={busy} onClick={onCancel} tone="quiet">
          Cancel
        </Button>
        <Button disabled={!canSubmit} tone="primary" type="submit">
          {busy ? "Assigning…" : "Assign company"}
        </Button>
      </ActionGroup>
    </form>
  );
}

function ExposureView({
  data,
  exposureReviewBatchBusy,
  exposureReviewBatchError,
  exposureReviewBusyPositionId,
  exposureReviewError,
  exposureReviewPositionId,
  exposureReviewState,
  openExposureIds,
  openableHoldingIds,
  onBeginExposureReview,
  onApplyExactBatch,
  onCancelExposureReview,
  onExposureOpenChange,
  onOpenHolding,
  onLoadMoreExposures,
  onLoadMorePositions,
  onSubmitExposureReview,
  requestedExposureId,
  sortDirection,
  searchMatches,
  searchQuery,
  visibleExposureCount,
  visiblePositionCounts,
}: {
  data: InvestmentHoldingsView;
  exposureReviewBatchBusy: boolean;
  exposureReviewBatchError: string | null;
  exposureReviewBusyPositionId: string | null;
  exposureReviewError: string | null;
  exposureReviewPositionId: string | null;
  exposureReviewState: PrivateExposureReviewState | null;
  openExposureIds: ReadonlySet<string>;
  openableHoldingIds: ReadonlySet<string>;
  onBeginExposureReview: (positionId: string) => void;
  onApplyExactBatch: () => void;
  onCancelExposureReview: () => void;
  onExposureOpenChange: (exposureId: string, open: boolean) => void;
  onOpenHolding: (holdingId: string) => void;
  onLoadMoreExposures: () => void;
  onLoadMorePositions: (exposureId: string) => void;
  onSubmitExposureReview: (
    position: PrivateExposureReviewPosition,
    input: PrivateExposureResolutionInput,
  ) => void;
  requestedExposureId: string | null;
  sortDirection: ExposureSortDirection;
  searchMatches: HoldingsSearchMatches | null;
  searchQuery: string;
  visibleExposureCount: number;
  visiblePositionCounts: ReadonlyMap<string, number>;
}) {
  const holdingDetailAction = (holdingId: string, holdingName: string) =>
    openableHoldingIds.has(holdingId) ? (
      <TextLink
        aria-label={`View ${holdingName} holding details`}
        className="position-row__action"
        data-holding-id={holdingId}
        onClick={() => onOpenHolding(holdingId)}
      >
        View details
      </TextLink>
    ) : null;
  const positionContextById = new Map(
    data.positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => [
          position.id,
          connection.purpose === "reviewed_history"
            ? connection.adapterType === "plaid-investments"
              ? container.label
              : null
            : `${connection.institutionLabel} · ${container.label}`,
        ]),
      ),
    ),
  );
  const positionContext = (position: InvestmentExposurePosition) =>
    positionContextById.has(position.id)
      ? positionContextById.get(position.id)
      : `${position.institutionLabel} · ${position.containerLabel}`;
  const positionById = useMemo(
    () =>
      new Map(
        data.exposureView.positions.map((position) => [position.id, position]),
      ),
    [data],
  );
  const canonicalUnallocated = data.exposureView.positions.filter(
    (position) =>
      !isCashPosition(position) &&
      (searchMatches === null || searchMatches.positionIds.has(position.id)) &&
      (position.hasUnknownAllocation ||
        (position.unallocatedValueMinor ?? 0) > 0 ||
        position.mappedExposureIds.length === 0),
  );
  const reviewPositionById = new Map(
    exposureReviewState?.positions.map((position) => [
      position.positionId,
      position,
    ]) ?? [],
  );
  const sortedExposureGroups = useMemo(
    () =>
      companyExposureGroups(data).sort((left, right) =>
        compareExposureGroups(left, right, sortDirection),
      ),
    [data, sortDirection],
  );
  const matchingExposureGroups =
    searchMatches === null
      ? sortedExposureGroups
      : sortedExposureGroups.filter((group) =>
          searchMatches.exposurePositions.has(group.exposure.id),
        );
  const totalExposureCount = matchingExposureGroups.length;
  const paginatedExposureGroups = matchingExposureGroups.slice(
    0,
    visibleExposureCount,
  );
  const requestedExposureGroup =
    requestedExposureId === null
      ? undefined
      : matchingExposureGroups.find(
          (group) => group.exposure.id === requestedExposureId,
        );
  const visibleCanonicalExposureGroups =
    requestedExposureGroup === undefined ||
    paginatedExposureGroups.some(
      (group) => group.exposure.id === requestedExposureGroup.exposure.id,
    )
      ? paginatedExposureGroups
      : [
          requestedExposureGroup,
          ...paginatedExposureGroups.slice(
            0,
            Math.max(visibleExposureCount - 1, 0),
          ),
        ];
  const hasMoreExposures = visibleExposureCount < totalExposureCount;
  const unallocatedLimit =
    visiblePositionCounts.get("unallocated") ?? HOLDINGS_POSITION_PAGE_SIZE;
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const exposureGroupsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (requestedExposureId === null) {
      return;
    }
    onExposureOpenChange(requestedExposureId, true);
    const frame = window.requestAnimationFrame(() => {
      const target = exposureGroupsRef.current?.querySelector<HTMLElement>(
        `[data-exposure-id="${CSS.escape(requestedExposureId)}"] [data-slot="collapsible-trigger"]`,
      );
      if (target === undefined || target === null) {
        return;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    data,
    onExposureOpenChange,
    requestedExposureId,
    sortDirection,
    visibleExposureCount,
  ]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (
      target === null ||
      !hasMoreExposures ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          onLoadMoreExposures();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMoreExposures, onLoadMoreExposures, visibleExposureCount]);
  if (
    matchingExposureGroups.length === 0 &&
    canonicalUnallocated.length === 0
  ) {
    return (
      <EmptyState
        className="investment-views__empty"
        compact
        headingAs="h3"
        icon={null}
        title={
          searchMatches === null
            ? "No company exposures"
            : "No matching exposures"
        }
      >
        {searchMatches === null
          ? "Connect an investment institution or import a holding update."
          : "Try another name, ticker, or source."}
      </EmptyState>
    );
  }
  return (
    <div className="exposure-groups" ref={exposureGroupsRef}>
      {canonicalUnallocated.length > 0 && (
        <section className="unallocated-positions">
          <div className="unallocated-positions__heading">
            <p className="eyebrow">Needs attention</p>
            <h3>Resolve positions</h3>
            <p>
              These positions stay outside exposure totals until their company
              or allocation is clear.
            </p>
          </div>
          {searchMatches === null &&
            (exposureReviewState?.exactBatch.positionCount ?? 0) > 0 && (
              <div className="private-exposure-exact-batch">
                <div>
                  <p className="eyebrow">Exact company matches</p>
                  <h4>
                    {exposureReviewState!.exactBatch.positionCount} exact{" "}
                    {exposureReviewState!.exactBatch.positionCount === 1
                      ? "match is"
                      : "matches are"}{" "}
                    ready
                  </h4>
                  <p>
                    Assign these positions to{" "}
                    {exposureReviewState!.exactBatch.companyCount}{" "}
                    {exposureReviewState!.exactBatch.companyCount === 1
                      ? "company"
                      : "companies"}
                    . Legal positions and values stay unchanged.
                  </p>
                  {exposureReviewState!.exactBatch.excludedPositionCount >
                    0 && (
                    <p>
                      {exposureReviewState!.exactBatch.excludedPositionCount}{" "}
                      {exposureReviewState!.exactBatch.excludedPositionCount ===
                      1
                        ? "other position needs"
                        : "other positions need"}{" "}
                      individual review.
                    </p>
                  )}
                  {exposureReviewBatchError !== null && (
                    <FormMessage
                      className="private-exposure-exact-batch__error"
                      tone="error"
                    >
                      {exposureReviewBatchError}
                    </FormMessage>
                  )}
                </div>
                <Button
                  disabled={
                    exposureReviewBatchBusy ||
                    exposureReviewBusyPositionId !== null
                  }
                  onClick={onApplyExactBatch}
                  tone="primary"
                >
                  {exposureReviewBatchBusy
                    ? "Assigning…"
                    : `Assign ${exposureReviewState!.exactBatch.positionCount} exact ${exposureReviewState!.exactBatch.positionCount === 1 ? "match" : "matches"}`}
                </Button>
              </div>
            )}
          {canonicalUnallocated.slice(0, unallocatedLimit).map((position) => {
            const reviewPosition = reviewPositionById.get(position.id) ?? null;
            const reviewOpen = exposureReviewPositionId === position.id;
            const positionName = positionDisplayName(position);
            const valueSourceLabel = exposureValueSourceLabel(position);
            const economicsLabel = positionEconomicsLabel(position, null);
            return (
              <Fragment key={position.id}>
                <article>
                  <span>
                    <strong
                      title={
                        positionName === position.legalVehicleName
                          ? undefined
                          : position.legalVehicleName
                      }
                    >
                      <SearchHighlight query={searchQuery}>
                        {positionName}
                      </SearchHighlight>
                    </strong>
                    <small>
                      <SearchHighlight query={searchQuery}>
                        {positionContext(position) ?? ""}
                      </SearchHighlight>
                    </small>
                  </span>
                  <span className="position-row__value">
                    {exposurePositionValue(position)}
                    {valueSourceLabel !== null && (
                      <small>{valueSourceLabel}</small>
                    )}
                    {economicsLabel !== null && <small>{economicsLabel}</small>}
                  </span>
                  <span className="unallocated-positions__status">
                    {position.hasUnknownAllocation
                      ? "Allocation unknown"
                      : position.mappedExposureIds.length === 0
                        ? "Company unresolved"
                        : formatHoldingCurrency(
                            position.unallocatedValueMinor ?? 0,
                            position.currency,
                          )}
                    {reviewPosition !== null && !reviewOpen && (
                      <Button
                        aria-label={
                          "Choose company for " + position.legalVehicleName
                        }
                        className="private-exposure-review__open"
                        disabled={exposureReviewBatchBusy}
                        onClick={() => onBeginExposureReview(position.id)}
                        tone="secondary"
                      >
                        Choose company
                      </Button>
                    )}
                  </span>
                  {holdingDetailAction(position.id, positionName)}
                </article>
                {reviewPosition !== null && reviewOpen && (
                  <PrivateExposureAssignmentForm
                    busy={exposureReviewBusyPositionId === position.id}
                    companies={exposureReviewState?.companies ?? []}
                    error={exposureReviewError}
                    key={position.id}
                    onCancel={onCancelExposureReview}
                    onSubmit={(input) =>
                      onSubmitExposureReview(reviewPosition, input)
                    }
                    position={reviewPosition}
                  />
                )}
              </Fragment>
            );
          })}
          {canonicalUnallocated.length > unallocatedLimit && (
            <div className="exposure-pagination">
              <span>
                Showing {unallocatedLimit} of {canonicalUnallocated.length}{" "}
                unresolved positions
              </span>
              <Button
                onClick={() => onLoadMorePositions("unallocated")}
                tone="secondary"
              >
                Load more unresolved positions
              </Button>
            </div>
          )}
        </section>
      )}
      {visibleCanonicalExposureGroups.map((group) => {
        const positions = group.contributions
          .map((contribution) => positionById.get(contribution.positionId))
          .filter(
            (position): position is InvestmentExposurePosition =>
              position !== undefined,
          )
          .sort((left, right) =>
            compareExposurePositions(left, right, sortDirection),
          );
        const positionCount = positions.length;
        const matchingPositions =
          searchMatches === null
            ? positions
            : positions.filter((position) =>
                searchMatches.exposurePositions
                  .get(group.exposure.id)
                  ?.has(position.id),
              );
        const positionLimit =
          visiblePositionCounts.get(group.exposure.id) ??
          HOLDINGS_POSITION_PAGE_SIZE;
        const displayName = exposureDisplayName(group, positions);
        const investedEstimateCount = positions.filter(
          (position) =>
            position.valueSource === "invested_amount" ||
            position.valueSource === "portfolio_watch_estimate",
        ).length;
        const currentSharePrice = exposureSharePricePresentation(
          group,
          positions,
        );
        const performanceLabel = exposurePerformanceLabel(
          group,
          positions,
          currentSharePrice?.label ?? null,
        );
        const summaryMetaLabel = [
          investedEstimateCount > 0
            ? `${investedEstimateCount} ${
                investedEstimateCount === 1 ? "estimate" : "estimates"
              }`
            : null,
          performanceLabel,
        ]
          .filter((label): label is string => label !== null)
          .join(" · ");
        return (
          <Collapsible
            className="exposure-group"
            data-exposure-id={group.exposure.id}
            key={`${searchMatches === null ? "browse" : searchQuery}:${group.exposure.id}`}
            onOpenChange={(open) =>
              onExposureOpenChange(group.exposure.id, open)
            }
            defaultOpen={searchMatches !== null}
            open={
              searchMatches === null
                ? openExposureIds.has(group.exposure.id)
                : undefined
            }
          >
            <CollapsibleTrigger
              aria-current={
                group.exposure.id === requestedExposureId ? "true" : undefined
              }
              className="exposure-group__summary"
            >
              <span className="exposure-group__identity">
                <strong
                  title={
                    displayName === group.exposure.canonicalName
                      ? undefined
                      : group.exposure.canonicalName
                  }
                >
                  <SearchHighlight query={searchQuery}>
                    {displayName}
                  </SearchHighlight>
                </strong>
                <small>
                  {searchMatches !== null &&
                    displayName !== group.exposure.canonicalName && (
                      <>
                        <SearchHighlight query={searchQuery}>
                          {group.exposure.canonicalName}
                        </SearchHighlight>{" "}
                        ·{" "}
                      </>
                    )}
                  {matchingPositions.length < positionCount
                    ? `${matchingPositions.length} matching ${matchingPositions.length === 1 ? "position" : "positions"} · ${positionCount} total`
                    : `${positionCount} ${positionCount === 1 ? "position" : "positions"}`}
                  {group.exposure.exposureKind === "unresolved"
                    ? " · Unresolved"
                    : ""}
                </small>
              </span>
              <span className="exposure-group__totals">
                <span className="exposure-group__value">
                  {exposureTotalsLabel(group.totals)}
                </span>
                {summaryMetaLabel.length > 0 && (
                  <small
                    className={`exposure-group__performance${
                      currentSharePrice === null
                        ? ""
                        : " exposure-group__market-meta"
                    }`}
                    title={
                      currentSharePrice === null
                        ? undefined
                        : `Share price as of ${formatDate(currentSharePrice.observedAt)}`
                    }
                  >
                    {summaryMetaLabel}
                  </small>
                )}
              </span>
              <DisclosureIndicator className="exposure-group__indicator" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="exposure-group__positions">
                {matchingPositions.slice(0, positionLimit).map((position) => {
                  const positionName = positionDisplayName(position);
                  const valueSourceLabel = exposureValueSourceLabel(position);
                  const currentSharePrice =
                    positionSharePricePresentation(position);
                  const economicsLabel = positionEconomicsLabel(
                    position,
                    currentSharePrice?.label ?? null,
                  );
                  const allocationLabel = position.hasUnknownAllocation
                    ? "Allocation unknown"
                    : position.knownAllocationPpm === 1_000_000
                      ? null
                      : `${Math.floor(position.knownAllocationPpm / 10_000)}% allocated`;
                  return (
                    <article key={position.id}>
                      <span>
                        <strong
                          title={
                            positionName === position.legalVehicleName
                              ? undefined
                              : position.legalVehicleName
                          }
                        >
                          <SearchHighlight query={searchQuery}>
                            {positionName}
                          </SearchHighlight>
                        </strong>
                        <small>
                          <SearchHighlight query={searchQuery}>
                            {positionContext(position) ?? ""}
                          </SearchHighlight>
                        </small>
                      </span>
                      <span
                        className="position-row__value"
                        title={
                          valueSourceLabel !== null
                            ? `${valueSourceLabel} as of ${formatDate(position.valueEffectiveDate ?? position.observedAt)}`
                            : undefined
                        }
                      >
                        {exposurePositionValue(position)}
                        {valueSourceLabel !== null &&
                          economicsLabel === null && (
                            <small>{valueSourceLabel}</small>
                          )}
                        {economicsLabel !== null && (
                          <small
                            className={
                              currentSharePrice === null
                                ? undefined
                                : "position-row__market-meta"
                            }
                            title={
                              currentSharePrice === null
                                ? undefined
                                : `Share price as of ${formatDate(currentSharePrice.observedAt)}`
                            }
                          >
                            {economicsLabel}
                          </small>
                        )}
                        {allocationLabel !== null && (
                          <small className="position-row__allocation">
                            {allocationLabel}
                          </small>
                        )}
                      </span>
                      {holdingDetailAction(position.id, positionName)}
                    </article>
                  );
                })}
                {matchingPositions.length > positionLimit && (
                  <div className="exposure-pagination">
                    <span>
                      Showing {positionLimit} of {matchingPositions.length}{" "}
                      positions
                    </span>
                    <Button
                      onClick={() => onLoadMorePositions(group.exposure.id)}
                      tone="secondary"
                    >
                      Load more {displayName} positions
                    </Button>
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {hasMoreExposures && (
        <div className="exposure-pagination" ref={loadMoreRef}>
          <span>
            Showing {Math.min(visibleExposureCount, totalExposureCount)} of{" "}
            {totalExposureCount} exposures
          </span>
          <Button onClick={onLoadMoreExposures} tone="secondary">
            Load more exposures
          </Button>
        </div>
      )}
    </div>
  );
}

function CashHoldingsView({
  accounts,
  data,
  error,
  onShowSmallBalancesChange,
  onOpenHolding,
  openableHoldingIds,
  showSmallBalances,
  searchMatches,
  searchQuery,
  visibleCount,
  onLoadMore,
}: {
  accounts: readonly AcceptedCashAccount[];
  data: InvestmentHoldingsView;
  error: string | null;
  onShowSmallBalancesChange: (open: boolean) => void;
  onOpenHolding: (holdingId: string) => void;
  openableHoldingIds: ReadonlySet<string>;
  showSmallBalances: boolean;
  searchMatches: HoldingsSearchMatches | null;
  searchQuery: string;
  visibleCount: number;
  onLoadMore: () => void;
}) {
  const bankAccounts = accounts;
  const brokeragePositions = data.exposureView.positions.filter(isCashPosition);
  if (
    bankAccounts.length === 0 &&
    brokeragePositions.length === 0 &&
    error === null
  ) {
    return null;
  }

  const totals = new Map<string, number>();
  let unavailableCount = 0;
  for (const account of bankAccounts) {
    if (account.valueMinor === null) {
      unavailableCount += 1;
    } else {
      totals.set(
        "USD",
        addMinorUnits(totals.get("USD") ?? 0, account.valueMinor),
      );
    }
  }
  for (const position of brokeragePositions) {
    if (position.valueMinor === null || position.valueState !== "reported") {
      unavailableCount += 1;
    } else {
      totals.set(
        position.currency,
        addMinorUnits(totals.get(position.currency) ?? 0, position.valueMinor),
      );
    }
  }
  const isSmallBankAccount = (account: (typeof bankAccounts)[number]) =>
    account.valueMinor !== null &&
    account.valueMinor < SMALL_CASH_BALANCE_MINOR;
  const isSmallBrokeragePosition = (
    position: (typeof brokeragePositions)[number],
  ) =>
    position.currency === "USD" &&
    position.valueState === "reported" &&
    position.valueMinor !== null &&
    position.valueMinor < SMALL_CASH_BALANCE_MINOR;
  const smallBalanceCount =
    searchMatches !== null
      ? 0
      : bankAccounts.filter(isSmallBankAccount).length +
        brokeragePositions.filter(isSmallBrokeragePosition).length;
  const regularBankAccounts = bankAccounts.filter((account) =>
    searchMatches === null
      ? !isSmallBankAccount(account)
      : searchMatches.accountIds.has(account.id),
  );
  const smallBankAccounts = bankAccounts.filter(isSmallBankAccount);
  const regularBrokeragePositions = brokeragePositions.filter((position) =>
    searchMatches === null
      ? !isSmallBrokeragePosition(position)
      : searchMatches.positionIds.has(position.id),
  );
  const smallBrokeragePositions = brokeragePositions.filter(
    isSmallBrokeragePosition,
  );
  const bankAccountRow = (account: (typeof bankAccounts)[number]) => (
    <article key={account.id}>
      <span>
        <strong>
          <SearchHighlight query={searchQuery}>
            {account.accountLabel}
          </SearchHighlight>
        </strong>
        <small>
          <SearchHighlight query={searchQuery}>
            {account.institutionLabel}
          </SearchHighlight>{" "}
          · Bank cash · As of {formatDate(account.observedAt)}
        </small>
      </span>
      <strong>
        {account.valueMinor === null
          ? "Not reported"
          : formatHoldingCurrency(account.valueMinor, "USD")}
      </strong>
    </article>
  );
  const brokeragePositionRow = (
    position: (typeof brokeragePositions)[number],
  ) => (
    <article key={position.id}>
      <span>
        <strong>
          <SearchHighlight query={searchQuery}>
            {positionDisplayName(position)}
          </SearchHighlight>
        </strong>
        <small>
          <SearchHighlight
            query={searchQuery}
          >{`${position.institutionLabel} · ${position.containerLabel}`}</SearchHighlight>{" "}
          · As of {formatDate(position.observedAt)}
        </small>
      </span>
      <strong>{exposurePositionValue(position)}</strong>
      {openableHoldingIds.has(position.id) && (
        <TextLink
          aria-label={`View ${positionDisplayName(position)} holding details`}
          className="position-row__action"
          data-holding-id={position.id}
          onClick={() => onOpenHolding(position.id)}
        >
          View details
        </TextLink>
      )}
    </article>
  );

  if (
    searchMatches !== null &&
    regularBankAccounts.length + regularBrokeragePositions.length === 0
  )
    return null;
  const regularCount =
    regularBankAccounts.length + regularBrokeragePositions.length;

  return (
    <section aria-labelledby="cash-holdings-title" className="cash-holdings">
      <SectionHeader
        action={
          <Stat
            as="span"
            className="cash-holdings__total"
            detail={`${bankAccounts.length} bank ${
              bankAccounts.length === 1 ? "account" : "accounts"
            } · ${brokeragePositions.length} brokerage ${
              brokeragePositions.length === 1 ? "position" : "positions"
            }`}
            detailAs="span"
            label="Total cash"
            labelAs="small"
            value={formatCurrencyTotals(totals, unavailableCount)}
          />
        }
        className="cash-holdings__heading"
        description="Bank balances and brokerage cash stay separate from company exposures."
        descriptionPlacement="title-group"
        eyebrow="Reviewed liquidity"
        headingProps={{ id: "cash-holdings-title" }}
        title="Cash"
      />
      {error !== null && <p className="cash-holdings__error">{error}</p>}
      {(bankAccounts.length > 0 || brokeragePositions.length > 0) && (
        <Collapsible
          onOpenChange={onShowSmallBalancesChange}
          open={showSmallBalances}
        >
          <div className="cash-holdings__rows">
            {regularBankAccounts.slice(0, visibleCount).map(bankAccountRow)}
            {regularBrokeragePositions
              .slice(0, Math.max(visibleCount - regularBankAccounts.length, 0))
              .map(brokeragePositionRow)}
          </div>
          {regularCount > visibleCount && (
            <div className="exposure-pagination">
              <span>
                Showing {visibleCount} of {regularCount} cash balances
              </span>
              <Button onClick={onLoadMore} tone="secondary">
                Load more cash balances
              </Button>
            </div>
          )}
          {smallBalanceCount > 0 && (
            <>
              <div className="cash-holdings__disclosure">
                <CollapsibleTrigger className="keel-link">
                  <span>
                    {showSmallBalances
                      ? "Hide balances under $100"
                      : `Show ${smallBalanceCount} ${smallBalanceCount === 1 ? "balance" : "balances"} under $100`}
                  </span>
                  <DisclosureIndicator />
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="cash-holdings__rows cash-holdings__small-balances">
                  {smallBankAccounts.slice(0, visibleCount).map(bankAccountRow)}
                  {smallBrokeragePositions
                    .slice(
                      0,
                      Math.max(visibleCount - smallBankAccounts.length, 0),
                    )
                    .map(brokeragePositionRow)}
                </div>
                {smallBalanceCount > visibleCount && (
                  <div className="exposure-pagination">
                    <span>
                      Showing {visibleCount} of {smallBalanceCount} small
                      balances
                    </span>
                    <Button onClick={onLoadMore} tone="secondary">
                      Load more small balances
                    </Button>
                  </div>
                )}
              </CollapsibleContent>
            </>
          )}
        </Collapsible>
      )}
    </section>
  );
}

export function InvestmentHoldings({
  acceptedCashAccounts,
  data,
  holdings,
  mode,
  onExposureOpenChange,
  onExposureResolved,
  onLoadMoreExposures,
  onLoadMorePositions,
  onOpenHolding,
  onReviewImport,
  onShowSmallBalancesChange,
  openExposureIds,
  requestedExposureId,
  showSmallBalances,
  searchMatches,
  searchQuery,
  visibleExposureCount,
  visiblePositionCounts,
}: {
  acceptedCashAccounts: readonly AcceptedCashAccount[];
  data: InvestmentHoldingsView;
  holdings: readonly Holding[];
  mode: "exposures" | "sources";
  onExposureOpenChange: (exposureId: string, open: boolean) => void;
  onExposureResolved: () => Promise<void>;
  onLoadMoreExposures: () => void;
  onLoadMorePositions: (exposureId: string) => void;
  onOpenHolding: (holdingId: string) => void;
  onReviewImport: (importId: string) => void;
  onShowSmallBalancesChange: (open: boolean) => void;
  openExposureIds: ReadonlySet<string>;
  requestedExposureId: string | null;
  showSmallBalances: boolean;
  searchMatches: HoldingsSearchMatches | null;
  searchQuery: string;
  visibleExposureCount: number;
  visiblePositionCounts: ReadonlyMap<string, number>;
}) {
  const [connectionState, setConnectionState] =
    useState<InvestmentConnectionsState | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [confirmDisconnectId, setConfirmDisconnectId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(initialInvestmentError);
  const [viewError, setViewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [exposureReviewState, setExposureReviewState] =
    useState<PrivateExposureReviewState | null>(null);
  const [exposureReviewPositionId, setExposureReviewPositionId] = useState<
    string | null
  >(null);
  const [exposureReviewBusyPositionId, setExposureReviewBusyPositionId] =
    useState<string | null>(null);
  const [exposureReviewBatchBusy, setExposureReviewBatchBusy] = useState(false);
  const [exposureReviewBatchError, setExposureReviewBatchError] = useState<
    string | null
  >(null);
  const [exposureReviewError, setExposureReviewError] = useState<string | null>(
    null,
  );
  const [exposureReviewLoadError, setExposureReviewLoadError] = useState<
    string | null
  >(null);
  const [exposureReviewNotice, setExposureReviewNotice] = useState<
    string | null
  >(null);
  const [exposureSortDirection, setExposureSortDirection] =
    useState<ExposureSortDirection>("descending");
  const oauthStarted = useRef(false);
  const knownHoldingIds = useMemo(
    () => new Set(holdings.map((holding) => holding.id)),
    [holdings],
  );
  const reloadConnections = useCallback(async () => {
    try {
      const next = await loadInvestmentConnections();
      setConnectionState(next);
      setError((current) =>
        current === INVESTMENT_OAUTH_RECONNECT_MESSAGE ? current : null,
      );
      return next;
    } catch {
      setError("Keel could not check investment institutions right now.");
      return null;
    }
  }, []);

  const reloadHoldings = useCallback(async () => {
    try {
      await onExposureResolved();
      setViewError(null);
    } catch {
      setViewError("Keel could not load the reviewed position view.");
    }
  }, [onExposureResolved]);
  const reloadHoldingsRef = useRef(reloadHoldings);

  useEffect(() => {
    reloadHoldingsRef.current = reloadHoldings;
  }, [reloadHoldings]);

  const reloadExposureReviews = useCallback(async () => {
    try {
      setExposureReviewState(await loadPrivateExposureReviews());
      setExposureReviewLoadError(null);
    } catch {
      setExposureReviewLoadError(
        "Keel could not load company choices for unresolved exposures.",
      );
    }
  }, []);

  const reload = useCallback(
    () =>
      mode === "sources"
        ? Promise.all([reloadConnections(), reloadHoldings()])
        : Promise.all([reloadHoldings(), reloadExposureReviews()]),
    [mode, reloadConnections, reloadExposureReviews, reloadHoldings],
  );

  useEffect(() => {
    let cancelled = false;
    const initial = window.setTimeout(() => {
      void reloadConnections().then(async (initialConnections) => {
        if (
          cancelled ||
          initialConnections === null ||
          !initialConnections.configured ||
          !hasDueInvestmentConnection(initialConnections)
        ) {
          return;
        }
        try {
          const next = await syncDueInvestmentHoldings();
          if (cancelled) {
            return;
          }
          setConnectionState(next);
          await reloadHoldingsRef.current();
        } catch {
          if (!cancelled) {
            setError("Keel could not run the due brokerage check.");
          }
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
    };
  }, [reloadConnections]);

  useEffect(() => {
    if (mode !== "exposures") {
      return;
    }
    const load = () => void reloadExposureReviews();
    if ("requestIdleCallback" in window) {
      const idle = window.requestIdleCallback(load, { timeout: 1_000 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = globalThis.setTimeout(load, 50);
    return () => globalThis.clearTimeout(timer);
  }, [mode, reloadExposureReviews]);

  useBoundedPolling({
    active:
      mode === "sources" &&
      (connectionState?.connections.some(
        (connection) => connection.status === "syncing",
      ) ??
        false),
    identity: "investment-status",
    intervalMs: 10_000,
    check: async () => {
      const next = await reloadConnections();
      if (next === null) throw new Error("Status unavailable");
      return next.connections.some(
        (connection) => connection.status === "syncing",
      );
    },
    onError: () => undefined,
    onTimeout: () =>
      setError("Automatic checks paused. Reload this page to check progress."),
  });

  const acceptStatus = useCallback(
    async (next: InvestmentConnectionStatus) => {
      setConnectionState((current) => ({
        version: 1,
        configured: true,
        connections: [
          next,
          ...(current?.connections.filter(
            (connection) => connection.connectionId !== next.connectionId,
          ) ?? []),
        ],
        errorCode: null,
      }));
      if (
        next.latestImportId !== null &&
        (next.latestAdjudication?.quarantinedCount ?? 0) > 0
      ) {
        onReviewImport(next.latestImportId);
      } else if ((next.latestAdjudication?.autoAppliedCount ?? 0) > 0) {
        const applied = next.latestAdjudication?.autoAppliedCount ?? 0;
        setNotice(
          `${next.institutionLabel}: ${applied} clear ${applied === 1 ? "position was" : "positions were"} applied.`,
        );
      } else {
        setNotice(`${next.institutionLabel} is up to date. No changes found.`);
      }
      try {
        await reloadHoldings();
      } catch {
        setViewError(
          "The institution update succeeded, but Keel could not refresh the reviewed position view.",
        );
      }
    },
    [onReviewImport, reloadHoldings],
  );

  const exchangeToken = useCallback(
    async (publicToken: string | null) => {
      if (publicToken === null || publicToken.length === 0) {
        setBusy(null);
        setError("The institution did not return a connection token.");
        return;
      }
      setBusy({ action: "exchange", connectionId: null });
      try {
        const next = await exchangeInvestmentPublicToken(publicToken);
        clearStoredLink();
        if (window.location.search.length > 0) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        await acceptStatus(next);
      } catch {
        setError(
          "The investment institution could not be connected. Holdings were not changed.",
        );
      } finally {
        setBusy(null);
      }
    },
    [acceptStatus],
  );

  const finishReconnect = useCallback(
    async (connectionId: string) => {
      setBusy({ action: "reconnect", connectionId });
      try {
        clearStoredLink();
        if (window.location.search.length > 0) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        await acceptStatus(await syncInvestmentHoldings(connectionId));
      } catch {
        setError("The investment institution could not be reconnected.");
      } finally {
        setBusy(null);
      }
    },
    [acceptStatus],
  );

  const openLinkForMode = useCallback(
    async (linkToken: string, mode: string, receivedRedirectUri?: string) => {
      await openPlaidLink({
        linkToken,
        onExit: () => setBusy(null),
        onSuccess: (publicToken) => {
          if (mode.startsWith(INVESTMENT_RECONNECT_PREFIX)) {
            void finishReconnect(
              mode.slice(INVESTMENT_RECONNECT_PREFIX.length),
            );
          } else {
            void exchangeToken(publicToken);
          }
        },
        ...(receivedRedirectUri === undefined ? {} : { receivedRedirectUri }),
      });
    },
    [exchangeToken, finishReconnect],
  );

  useEffect(() => {
    if (
      oauthStarted.current ||
      !new URLSearchParams(window.location.search).has("oauth_state_id")
    ) {
      return;
    }
    const linkToken = window.sessionStorage.getItem(
      INVESTMENT_LINK_TOKEN_STORAGE_KEY,
    );
    const mode = window.sessionStorage.getItem(
      INVESTMENT_LINK_MODE_STORAGE_KEY,
    );
    if (linkToken === null || mode === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (oauthStarted.current) {
        return;
      }
      oauthStarted.current = true;
      setBusy({
        action: mode === INVESTMENT_ADD_MODE ? "add" : "reconnect",
        connectionId: mode.startsWith(INVESTMENT_RECONNECT_PREFIX)
          ? mode.slice(INVESTMENT_RECONNECT_PREFIX.length)
          : null,
      });
      void openLinkForMode(linkToken, mode, window.location.href).catch(() => {
        setBusy(null);
        setError("The investment institution could not be reopened.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openLinkForMode]);

  const addInstitution = async () => {
    setBusy({ action: "add", connectionId: null });
    setError(null);
    setNotice(null);
    try {
      const result = await createInvestmentLinkToken();
      window.sessionStorage.setItem(
        INVESTMENT_LINK_TOKEN_STORAGE_KEY,
        result.linkToken,
      );
      window.sessionStorage.setItem(
        INVESTMENT_LINK_MODE_STORAGE_KEY,
        INVESTMENT_ADD_MODE,
      );
      await openLinkForMode(result.linkToken, INVESTMENT_ADD_MODE);
    } catch (linkError) {
      setBusy(null);
      setError(
        linkError instanceof Error
          ? linkError.message
          : "The investment institution could not be opened.",
      );
    }
  };

  const runConnectionAction = async (
    status: InvestmentConnectionStatus,
    action: ConnectionAction,
  ) => {
    const connectionId = status.connectionId;
    setBusy({ action, connectionId });
    setError(null);
    setNotice(null);
    try {
      if (action === "reconnect") {
        const result = await createInvestmentReconnectLinkToken(connectionId);
        const mode = `${INVESTMENT_RECONNECT_PREFIX}${connectionId}`;
        window.sessionStorage.setItem(
          INVESTMENT_LINK_TOKEN_STORAGE_KEY,
          result.linkToken,
        );
        window.sessionStorage.setItem(INVESTMENT_LINK_MODE_STORAGE_KEY, mode);
        await openLinkForMode(result.linkToken, mode);
        return;
      }
      if (action === "disconnect") {
        await acceptStatus(await disconnectInvestmentConnection(connectionId));
        setConfirmDisconnectId(null);
        setNotice(
          `${status.institutionLabel} disconnected. Reviewed history remains visible.`,
        );
        return;
      }
      if (action === "pause" || action === "resume") {
        await acceptStatus(
          await changeInvestmentConnectionLifecycle(connectionId, action),
        );
        setNotice(
          action === "pause"
            ? `${status.institutionLabel} updates are paused.`
            : `${status.institutionLabel} updates resumed.`,
        );
        return;
      }
      await acceptStatus(await syncInvestmentHoldings(connectionId));
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : `${status.institutionLabel} could not be updated.`,
      );
    } finally {
      if (action !== "reconnect") {
        setBusy(null);
      }
    }
  };

  const beginExposureReview = (positionId: string) => {
    if (exposureReviewBatchBusy) {
      return;
    }
    setExposureReviewPositionId(positionId);
    setExposureReviewError(null);
    setExposureReviewNotice(null);
  };

  const cancelExposureReview = () => {
    if (exposureReviewBusyPositionId !== null) {
      return;
    }
    setExposureReviewPositionId(null);
    setExposureReviewError(null);
  };

  const submitExposureReview = async (
    position: PrivateExposureReviewPosition,
    input: PrivateExposureResolutionInput,
  ) => {
    setExposureReviewBusyPositionId(position.positionId);
    setExposureReviewError(null);
    setExposureReviewNotice(null);
    try {
      const result = await assignPrivateCompanyExposure(
        position.positionId,
        input,
      );
      setExposureReviewPositionId(null);
      setExposureReviewNotice(
        position.legalVehicleName +
          " now groups under " +
          result.companyName +
          ". The legal position is unchanged.",
      );
      const refreshes = await Promise.allSettled([
        reloadHoldings(),
        reloadExposureReviews(),
      ]);
      if (refreshes.some((refresh) => refresh.status === "rejected")) {
        setExposureReviewLoadError(
          "The company assignment was saved, but the latest view could not be loaded.",
        );
      }
    } catch (reviewError) {
      setExposureReviewError(
        reviewError instanceof Error
          ? reviewError.message
          : "Keel could not assign this exposure.",
      );
    } finally {
      setExposureReviewBusyPositionId(null);
    }
  };

  const applyExactExposureBatch = async () => {
    if (
      exposureReviewState === null ||
      exposureReviewState.exactBatch.positionCount === 0 ||
      exposureReviewBatchBusy
    ) {
      return;
    }
    setExposureReviewBatchBusy(true);
    setExposureReviewBatchError(null);
    setExposureReviewNotice(null);
    setExposureReviewPositionId(null);
    try {
      const result = await applyPrivateExposureExactBatch({
        expectedRevision: exposureReviewState.exactBatch.revision,
      });
      setExposureReviewNotice(
        `${result.assignedPositionCount} ${
          result.assignedPositionCount === 1
            ? "position now groups"
            : "positions now group"
        } under ${result.companyCount} ${
          result.companyCount === 1 ? "company" : "companies"
        }. Legal positions and values stayed unchanged.${
          result.remainingPositionCount > 0
            ? ` ${result.remainingPositionCount} ${result.remainingPositionCount === 1 ? "position remains" : "positions remain"} for individual review.`
            : ""
        }`,
      );
      const refreshes = await Promise.allSettled([
        reloadHoldings(),
        reloadExposureReviews(),
      ]);
      if (refreshes.some((refresh) => refresh.status === "rejected")) {
        setExposureReviewLoadError(
          "The exact company assignments were saved, but the latest view could not be loaded.",
        );
      }
    } catch (batchError) {
      setExposureReviewBatchError(
        batchError instanceof Error
          ? batchError.message
          : "Keel could not assign the exact company matches.",
      );
      await reloadExposureReviews();
    } finally {
      setExposureReviewBatchBusy(false);
    }
  };

  const statusById = new Map(
    connectionState?.connections.map((status) => [
      status.connectionId,
      status,
    ]) ?? [],
  );
  const currentInstitutionKeys = new Set(
    connectionState?.connections.flatMap((status) =>
      status.status === "disconnected" ? [] : [status.institutionKey],
    ) ?? [],
  );
  const currentInstitutionLabels = new Set(
    connectionState?.connections.flatMap((status) =>
      status.status === "disconnected" ? [] : [status.institutionLabel],
    ) ?? [],
  );
  const positionConnectionById = new Map(
    data.positionView.connections.map((connection) => [
      connection.id,
      connection,
    ]),
  );
  const orderedIds = [
    ...new Set([
      ...(connectionState?.connections.map((status) => status.connectionId) ??
        []),
      ...data.positionView.connections.map((connection) => connection.id),
    ]),
  ];
  const visibleConnectionIds = orderedIds.filter((connectionId) => {
    const connection = positionConnectionById.get(connectionId) ?? null;
    const status = statusById.get(connectionId) ?? null;
    return (
      (connection === null || connection.adapterType === "plaid-investments") &&
      connection?.purpose !== "reviewed_history" &&
      !(
        status?.status === "disconnected" &&
        (currentInstitutionKeys.has(status.institutionKey) ||
          ((connection?.containers.length ?? 0) === 0 &&
            currentInstitutionLabels.has(status.institutionLabel)))
      )
    );
  });
  const addAvailable = data.authorizationStatus === "available";
  const setupRequired =
    connectionState?.configured === false ||
    data.authorizationStatus === "configuration_required";
  const positionCount = data.positionView.connections.reduce(
    (total, connection) =>
      total +
      connection.containers.reduce(
        (containerTotal, container) =>
          containerTotal +
          container.positions.filter(
            (position) =>
              position.snapshot.instrumentType.trim().toLowerCase() !== "cash",
          ).length,
        0,
      ),
    0,
  );
  const exposureCount = companyExposureGroups(data).length;
  const investedEstimateCount = data.exposureView.positions.filter(
    (position) =>
      !isCashPosition(position) && position.valueSource === "invested_amount",
  ).length;

  if (mode === "sources") {
    return (
      <section
        aria-labelledby="investment-institutions-title"
        className="investment-institutions"
      >
        <SectionHeader
          className="investment-institutions__heading"
          description="Robinhood, Fidelity, Schwab investing. Banking above."
          eyebrow="Connections"
          headingProps={{ id: "investment-institutions-title" }}
          title="Brokerages"
        />
        <div className="investment-institutions__add">
          {addAvailable ? (
            <Button
              disabled={busy !== null}
              onClick={() => void addInstitution()}
              tone="primary"
            >
              {busy?.action === "add" || busy?.action === "exchange"
                ? "Opening…"
                : "Add brokerage"}
            </Button>
          ) : (
            <p>
              {setupRequired
                ? "Investment updates need deployment setup."
                : "New brokerage connections are disabled in this deployment."}
            </p>
          )}
        </div>
        {connectionState === null && error === null ? (
          <FormMessage className="investment-institutions__checking">
            Checking investment institutions…
          </FormMessage>
        ) : visibleConnectionIds.length === 0 ? null : (
          <div className="investment-institution-list">
            {visibleConnectionIds.map((connectionId) => {
              const status = statusById.get(connectionId) ?? null;
              const connection =
                positionConnectionById.get(connectionId) ?? null;
              const label =
                status?.institutionLabel ??
                connection?.institutionLabel ??
                "Investment source";
              const lastComplete = latestCompleteObservation(connection);
              const pendingCount =
                status?.latestAdjudication?.quarantinedCount ??
                (status?.latestImportId === null ||
                status?.latestImportId === undefined
                  ? 0
                  : 1);
              const accountCount = connection?.containers.length ?? 0;
              return (
                <article className="investment-institution" key={connectionId}>
                  <Collapsible
                    className="investment-institution__details"
                    defaultOpen={status !== null && status.status !== "ready"}
                  >
                    <CollapsibleTrigger className="investment-institution__trigger">
                      <span className="investment-institution__heading">
                        <span>
                          <h3>{label}</h3>
                          <Badge tone={lifecycleTone(status)}>
                            {lifecycleLabel(status)}
                          </Badge>
                        </span>
                        <small className="investment-institution__summary">
                          {status?.status === "disconnected"
                            ? accountCount === 0
                              ? "No current accounts"
                              : `${accountCount} reviewed ${accountCount === 1 ? "account" : "accounts"}`
                            : `${accountCount} ${accountCount === 1 ? "account" : "accounts"}`}
                          {lastComplete === null
                            ? ""
                            : ` · Data as of ${formatDate(lastComplete)}`}
                          {status?.lastSyncedAt === null ||
                          status?.lastSyncedAt === undefined
                            ? ""
                            : ` · Checked ${formatDate(status.lastSyncedAt)}`}
                          {pendingCount > 0
                            ? ` · ${pendingCount} waiting for review`
                            : ""}
                        </small>
                      </span>
                      <span className="investment-institution__summary-action">
                        <strong className="investment-institution__value">
                          {investmentConnectionTotalsLabel(connection)}
                        </strong>
                        <DisclosureIndicator />
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <InvestmentAccountRows connection={connection} />
                    </CollapsibleContent>
                  </Collapsible>
                  {status !== null && (
                    <InstitutionActions
                      busy={busy}
                      confirmDisconnect={confirmDisconnectId === connectionId}
                      newConnectionsAvailable={addAvailable}
                      onAction={(action) =>
                        void runConnectionAction(status, action)
                      }
                      onCancelDisconnect={() => setConfirmDisconnectId(null)}
                      onConnectAgain={() => void addInstitution()}
                      onConfirmDisconnect={() =>
                        setConfirmDisconnectId(connectionId)
                      }
                      onReviewImport={onReviewImport}
                      status={status}
                    />
                  )}
                </article>
              );
            })}
          </div>
        )}
        {notice !== null && (
          <FormMessage
            className="investment-institutions__notice"
            tone="success"
          >
            {notice}
          </FormMessage>
        )}
        {error !== null && (
          <FormMessage className="investment-institutions__error" tone="error">
            {error} Reviewed holdings were not changed.
          </FormMessage>
        )}
      </section>
    );
  }

  if (searchMatches?.resultLabel === "0 results") {
    return (
      <EmptyState
        className="holdings-search-empty"
        compact
        title="No matching holdings"
      >
        Try another name, ticker, or source, or clear your search.
      </EmptyState>
    );
  }

  return (
    <>
      <CashHoldingsView
        accounts={acceptedCashAccounts}
        data={data}
        error={null}
        onShowSmallBalancesChange={onShowSmallBalancesChange}
        onOpenHolding={onOpenHolding}
        openableHoldingIds={knownHoldingIds}
        showSmallBalances={showSmallBalances}
        searchMatches={searchMatches}
        searchQuery={searchQuery}
        visibleCount={
          visiblePositionCounts.get("cash") ?? HOLDINGS_POSITION_PAGE_SIZE
        }
        onLoadMore={() => onLoadMorePositions("cash")}
      />
      <section
        aria-labelledby="investment-views-title"
        className="investment-views"
      >
        <SectionHeader
          action={
            <div className="investment-views__controls">
              {exposureCount > 1 && (
                <div className="exposure-sort">
                  <span>Sort by value</span>
                  <Select
                    items={EXPOSURE_SORT_OPTIONS}
                    onValueChange={(value) => {
                      if (value === "ascending" || value === "descending") {
                        setExposureSortDirection(value);
                      }
                    }}
                    value={exposureSortDirection}
                  >
                    <SelectTrigger aria-label="Sort exposures and positions by value">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPOSURE_SORT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Stat
                as="span"
                className="investment-views__total"
                detail={`${exposureCount} ${
                  exposureCount === 1 ? "exposure" : "exposures"
                } · ${positionCount} legal ${
                  positionCount === 1 ? "position" : "positions"
                }${
                  investedEstimateCount === 0
                    ? ""
                    : ` · ${investedEstimateCount} invested ${
                        investedEstimateCount === 1 ? "estimate" : "estimates"
                      }`
                }`}
                detailAs="span"
                label="Total exposure"
                labelAs="small"
                value={exposureGrandTotalLabel(data)}
              />
            </div>
          }
          className="investment-views__heading"
          description="Legal positions stay separate inside each exposure. Open one for ownership and source details."
          descriptionPlacement="title-group"
          eyebrow="Reviewed ownership"
          headingProps={{ id: "investment-views-title" }}
          title="Exposures"
        />
        {exposureReviewNotice !== null && (
          <FormMessage
            className="private-exposure-review__notice"
            tone="success"
          >
            {exposureReviewNotice}
          </FormMessage>
        )}
        {exposureReviewLoadError !== null && (
          <Notice className="investment-views__error" tone="error">
            <p>
              {exposureReviewLoadError} Reviewed positions were not changed.
            </p>
            <Button
              onClick={() => void reloadExposureReviews()}
              tone="secondary"
            >
              Try again
            </Button>
          </Notice>
        )}
        {viewError !== null && (
          <Notice className="investment-views__error" tone="error">
            <p>{viewError}</p>
            <Button onClick={() => void reload()} tone="secondary">
              Try again
            </Button>
          </Notice>
        )}
        <ExposureView
          data={data}
          exposureReviewBatchBusy={exposureReviewBatchBusy}
          exposureReviewBatchError={exposureReviewBatchError}
          exposureReviewBusyPositionId={exposureReviewBusyPositionId}
          exposureReviewError={exposureReviewError}
          exposureReviewPositionId={exposureReviewPositionId}
          exposureReviewState={exposureReviewState}
          openExposureIds={openExposureIds}
          openableHoldingIds={knownHoldingIds}
          onBeginExposureReview={beginExposureReview}
          onApplyExactBatch={() => void applyExactExposureBatch()}
          onCancelExposureReview={cancelExposureReview}
          onExposureOpenChange={onExposureOpenChange}
          onOpenHolding={onOpenHolding}
          onLoadMoreExposures={onLoadMoreExposures}
          onLoadMorePositions={onLoadMorePositions}
          onSubmitExposureReview={(position, input) =>
            void submitExposureReview(position, input)
          }
          requestedExposureId={requestedExposureId}
          sortDirection={exposureSortDirection}
          visibleExposureCount={visibleExposureCount}
          visiblePositionCounts={visiblePositionCounts}
          searchMatches={searchMatches}
          searchQuery={searchQuery}
        />
      </section>
    </>
  );
}
