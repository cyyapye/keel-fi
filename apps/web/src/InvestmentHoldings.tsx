import { netInvestmentBreakdown } from "./holding-value";
import {
  followedCloseReviewPath,
  holdingPositionPath,
} from "./holding-position-route";
import type { ExposureDrilldown } from "./PortfolioSnapshot";
import { MarketReviewLink } from "./MarketCloseReview";
import type { useMarketReviews } from "./use-market-reviews";
import { CashHoldingsView } from "./CashHoldings";
import {
  PublicSourceUpdate,
  SourceInventoryOutcome,
} from "./PublicSourceUpdate";
import {
  addMinorUnits,
  PARTS_PER_MILLION,
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
import {
  holdingsExposureGroups,
  type HoldingExposureGroup,
  type InvestmentExposurePosition,
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
  ButtonLink,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  EmptyState,
  FormMessage,
  Input,
  Notice,
  RecordGroup,
  RecordRow,
  SectionHeader,
  SearchHighlight,
  SearchSelect,
  Stat,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
} from "@keel/ui";
import {
  Fragment,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
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
  formatSharePrice,
  formatCompactCurrency,
  formatMoney,
  formatCurrency,
  formatDate,
  formatRoundedCompactCurrency,
} from "./format";
import { useBoundedPolling } from "./use-bounded-polling";
import { openPlaidLink } from "./plaid-link";
import {
  HOLDINGS_POSITION_PAGE_SIZE,
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
    ready: "Connected",
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

function formatCurrencyTotals(
  reportedByCurrency: ReadonlyMap<string, number>,
  unavailableCount: number,
  emptyLabel = "Value unavailable",
  unavailableUnit = "value",
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
          `${unavailableCount} ${unavailableUnit}${unavailableCount === 1 ? "" : "s"} unavailable`,
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
  if (connection === null) return "Value unavailable";
  const values = new Map<string, number>();
  let missing = 0;
  for (const position of connection.containers.flatMap(
    (container) => container.positions,
  )) {
    const value = position.snapshot.unrealizedValue;
    if (value.state !== "reported" || value.minor === null) {
      missing++;
      continue;
    }
    const currency = position.snapshot.currency;
    values.set(currency, addMinorUnits(values.get(currency) ?? 0, value.minor));
  }
  const label = [...values]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) =>
      currency === "USD" ? formatMoney(value) : formatCurrency(value, currency),
    )
    .join(" · ");
  return label
    ? `${missing > 0 ? "Known value " : ""}${label}`
    : "Value unavailable";
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

function isDirectPublicExposure(
  group: HoldingExposureGroup,
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
  group: HoldingExposureGroup,
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
        label: `${formatHoldingCurrency(priceMinor, latest[0]!.currency)}/share`,
        observedAt: latestObservedAt,
      };
}

function exposureValueSourceLabel(
  position: InvestmentExposurePosition,
  holding?: Holding,
): string | null {
  if (
    position.valueSourceLabel === "Closing-price estimate" ||
    position.valueSourceLabel === "My estimate" ||
    position.valueSourceLabel?.startsWith("Proxy estimate")
  )
    return position.valueSourceLabel;
  if (position.valueSourceLabel?.startsWith("At cost"))
    return position.valueSourceLabel;
  if (position.valueSource === "reviewed_adjustment") {
    const receipt = holding?.purchaseContext?.receipt;
    const selected = receipt?.details.valuation;
    const gpMark =
      selected?.selected?.method === "total" &&
      receipt?.snapshotId === position.snapshotId &&
      selected.records.some(
        (r) => r.id === selected.selected?.recordId && r.origin === "gp",
      );
    return gpMark ? "GP mark" : "Reviewed mark";
  }
  if (position.valueSource === "invested_amount") {
    return "At cost · Invested amount";
  }
  if (position.valueSource === "share_price_estimate")
    return position.shareValueEstimate?.proxy
      ? "Estimated value · proxy"
      : "Share price estimate";
  if (position.valueSource === "portfolio_watch_estimate") {
    return "Portfolio Watch estimate";
  }
  return null;
}

function exposurePositionValueCaption(
  position: InvestmentExposurePosition,
  sourceLabel: string | null,
): string | null {
  let caption = sourceLabel;
  if (position.valueSource === "portfolio_watch_estimate") {
    caption = "Watch estimate";
  } else if (sourceLabel === "Share price estimate") {
    caption = "Share estimate";
  } else if (
    sourceLabel?.startsWith("Proxy estimate") ||
    sourceLabel === "Estimated value · proxy"
  ) {
    caption = "Proxy estimate";
  }
  return caption;
}

function isExposureEstimate(position: InvestmentExposurePosition): boolean {
  return (
    position.valueSource === "portfolio_watch_estimate" ||
    position.valueSource === "share_price_estimate" ||
    position.valueSourceLabel === "My estimate" ||
    position.valueSourceLabel?.startsWith("Proxy estimate") === true
  );
}

function exposurePositionPerformance(position: InvestmentExposurePosition) {
  return calculatePositionPerformance({
    currentValueMinor: position.valueMinor,
    valuationDate: position.valueEffectiveDate ?? null,
    currentValueReported:
      position.valueState === "reported" &&
      position.valueSource !== "invested_amount",
    realizedValueMinor: position.realizedValueMinor,
    providerCostBasisMinor: position.providerCostBasisMinor,
    fundedMinor: position.investedMinor,
    economicsContext:
      position.positionKind === "spv_interest" &&
      position.committedMinor !== null &&
      position.investedMinor !== null &&
      (position.committedMinor > 0 || position.reviewedInvestment !== undefined)
        ? {
            reviewedInvestment: position.reviewedInvestment,
            snapshotId: position.snapshotId,
            currency: position.currency,
            committedMinor: position.committedMinor,
            fundedMinor: position.investedMinor,
            acceptedTerms: position.acceptedEconomicsTerms ?? null,
            reportedTerms: position.reportedEconomicsTerms ?? null,
          }
        : null,
    allowFundedAmountEstimate:
      position.manualContext == null &&
      (position.isPrivateCompanyPosition ||
        position.positionKind === "spv_interest" ||
        position.positionKind === "fund_interest"),
  });
}

function signedRoundedReturnLabel(valuePpm: number): string {
  const wholePercent = Math.floor((Math.abs(valuePpm) + 5_000) / 10_000);
  if (wholePercent === 0) {
    return "0%";
  }
  return `${valuePpm > 0 ? "+" : "−"}${wholePercent}%`;
}

function exposurePerformanceLabel(
  group: HoldingExposureGroup,
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
    if (
      position === undefined ||
      contribution.allocationPpm !== PARTS_PER_MILLION
    ) {
      return sharePriceLabel;
    }
    const performance = exposurePositionPerformance(position);
    if (performance.costBasisMinor === null) {
      return sharePriceLabel;
    }
    currencies.add(position.currency);
    allocatedBases.push(performance.costBasisMinor);
    if (
      performance.totalValueMinor === null ||
      performance.totalReturnPpm === null
    ) {
      returnAvailable = false;
    } else {
      allocatedValues.push(performance.totalValueMinor);
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
  const basisAndPriceLabel = [`Basis\u00a0${basisLabel}`, sharePriceLabel]
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
  return `${basisAndPriceLabel} · ${signedRoundedReturnLabel(returnPpm)}\u00a0total return`;
}

function exactHoldingCurrency(value: number, currency: string) {
  return (
    currency === "USD" ? formatMoney(value) : formatCurrency(value, currency)
  ).replace(/\.00$/u, "");
}

function exposureTotalsLabel(
  totals: InvestmentHoldingsView["exposureView"]["exposures"][number]["totals"],
): string | null {
  const reportedByCurrency = new Map(
    totals
      .filter((total) => total.knownValuePositionCount > 0)
      .map((total) => [total.currency, total.allocatedValueMinor]),
  );
  if (reportedByCurrency.size === 0) {
    return null;
  }
  const reported = [...reportedByCurrency.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, valueMinor]) =>
      exactHoldingCurrency(valueMinor, currency),
    );
  return reported.join(" · ");
}

function exposureGrandTotal(data: InvestmentHoldingsView) {
  const groups = holdingsExposureGroups(data.exposureView);
  const positions = data.exposureView.positions.filter(
    (position) => !isCashPosition(position),
  );
  const reportedByCurrency = new Map<string, number>();
  for (const position of positions) {
    if (position.valueMinor === null) continue;
    reportedByCurrency.set(
      position.currency,
      addMinorUnits(
        reportedByCurrency.get(position.currency) ?? 0,
        position.valueMinor,
      ),
    );
  }
  const hasIncompleteCoverage = positions.some((p) => p.valueMinor === null);
  const value =
    [...reportedByCurrency]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, minor]) => exactHoldingCurrency(minor, currency))
      .join(" · ") || (hasIncompleteCoverage ? null : "$0");
  const exposureCount = groups.length;
  const positionCount = positions.length;
  const detail = `${exposureCount} ${exposureCount === 1 ? "exposure" : "exposures"} · ${positionCount} ${positionCount === 1 ? "position" : "positions"}`;
  return {
    value,
    label: hasIncompleteCoverage ? "Known total" : "Total",
    detail,
  };
}

function exposureDisplayName(
  group: HoldingExposureGroup,
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

type SortableValue = {
  currency: string;
  valueMinor: number;
};

function exposureSortValue(group: HoldingExposureGroup): SortableValue | null {
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
  left: HoldingExposureGroup,
  right: HoldingExposureGroup,
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
  acceptedEmpty = false,
}: {
  connection: InvestmentPositionConnection | null;
  acceptedEmpty?: boolean;
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
              {acceptedEmpty && container.positions.length === 0
                ? formatMoney(0)
                : investmentPositionTotalsLabel(container.positions)}
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
  decisionOpen,
  decisionSaving,
  readbackPending,
  management = false,
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
  decisionOpen: boolean;
  decisionSaving: boolean;
  readbackPending: boolean;
  management?: boolean;
}) {
  const isBusy = busy?.connectionId === status.connectionId || decisionSaving;
  const isDisabled = isBusy || readbackPending;
  const isAdding = busy?.action === "add" || busy?.action === "exchange";
  const isRetryableFailure = isRetryableInvestmentCheckFailure(status);
  const waitingCount = status.latestAdjudication?.quarantinedCount ?? 0;
  if (management && status.status === "disconnected") return null;
  if (management && !confirmDisconnect)
    return (
      <ActionGroup className="investment-institution__actions" wrap>
        {status.status !== "paused" &&
          !(
            status.status === "needs_attention" &&
            status.errorCode === "connection_invalid"
          ) && (
            <Button
              disabled={isDisabled || status.status === "syncing"}
              onClick={() => onAction("pause")}
              tone="quiet"
            >
              Pause
            </Button>
          )}
        <Button
          disabled={isDisabled || status.status === "syncing"}
          onClick={onConfirmDisconnect}
          tone="quiet"
        >
          Disconnect
        </Button>
      </ActionGroup>
    );
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
            disabled={busy !== null || decisionSaving || readbackPending}
            onClick={onConnectAgain}
            tone="primary"
          >
            {isAdding ? "Opening…" : "Connect again"}
          </Button>
        )}
      </ActionGroup>
    );
  }
  if (confirmDisconnect && management) {
    return (
      <ActionGroup
        className="investment-institution__confirm"
        layout="split"
        mobileLayout="stack"
        role="group"
      >
        <p>Provider access will be removed. Reviewed history stays in Keel.</p>
        <ActionGroup align="end" mobileLayout="grid">
          <Button
            disabled={isDisabled}
            onClick={onCancelDisconnect}
            tone="quiet"
          >
            Keep connected
          </Button>
          <Button
            disabled={isDisabled}
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
          disabled={isDisabled}
          tone={decisionOpen ? "quiet" : "primary"}
        >
          {decisionOpen
            ? "Hide decision"
            : `Resolve ${waitingCount} ${waitingCount === 1 ? "decision" : "decisions"}`}
        </Button>
      )}
      {status.status === "needs_attention" &&
      status.errorCode === "connection_invalid" ? (
        <Button
          disabled={isDisabled}
          onClick={() => onAction("reconnect")}
          tone="primary"
        >
          {isBusy ? "Opening…" : "Reconnect"}
        </Button>
      ) : status.status === "paused" ? (
        <Button
          disabled={isDisabled}
          onClick={() => onAction("resume")}
          tone="primary"
        >
          {isBusy ? "Resuming…" : "Resume updates"}
        </Button>
      ) : (
        <Button
          disabled={isDisabled || status.status === "syncing"}
          onClick={() => onAction("check")}
          tone="secondary"
        >
          {decisionSaving
            ? "Updating…"
            : isBusy || status.status === "syncing"
              ? "Checking…"
              : isRetryableFailure
                ? "Try now"
                : "Check now"}
        </Button>
      )}
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
    searchText: company.aliases?.join(" ") ?? "",
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
            <SearchSelect
              label="Company"
              searchLabel="Search companies"
              placeholder="Select a company"
              disabled={busy}
              items={companyOptions}
              onChange={setCompanyId}
              value={companyId}
            />
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

type HoldingsMarket = Pick<
  ReturnType<typeof useMarketReviews>,
  "reviews" | "error"
>;

export type ExposureTab = "all" | "resolution";

function ExposureView({
  market,
  activeTab,
  data,
  exposureReviewBatchBusy,
  exposureReviewBatchError,
  exposureReviewBusyPositionId,
  exposureReviewError,
  exposureReviewPositionId,
  exposureReviewState,
  openExposureIds,
  openableHoldingIds,
  holdings,
  onBeginExposureReview,
  onApplyExactBatch,
  onCancelExposureReview,
  onExposureOpenChange,
  onOpenHolding,
  onLoadMoreExposures,
  onLoadMorePositions,
  onSortChange,
  onSubmitExposureReview,
  onTabChange,
  requestedExposure,
  resolutionFeedback,
  sortDirection,
  searchMatches,
  searchQuery,
  visibleExposureCount,
  visiblePositionCounts,
}: {
  activeTab: ExposureTab;
  market: HoldingsMarket;
  data: InvestmentHoldingsView;
  exposureReviewBatchBusy: boolean;
  exposureReviewBatchError: string | null;
  exposureReviewBusyPositionId: string | null;
  exposureReviewError: string | null;
  exposureReviewPositionId: string | null;
  exposureReviewState: PrivateExposureReviewState | null;
  openExposureIds: ReadonlySet<string>;
  openableHoldingIds: ReadonlySet<string>;
  holdings: readonly Holding[];
  onBeginExposureReview: (positionId: string) => void;
  onApplyExactBatch: () => void;
  onCancelExposureReview: () => void;
  onExposureOpenChange: (exposureId: string, open: boolean) => void;
  onOpenHolding: (
    holdingId: string,
    editValuation?: boolean,
    action?: HTMLElement,
  ) => void;
  onLoadMoreExposures: () => void;
  onLoadMorePositions: (exposureId: string) => void;
  onSortChange: () => void;
  onSubmitExposureReview: (
    position: PrivateExposureReviewPosition,
    input: PrivateExposureResolutionInput,
  ) => void;
  onTabChange: (tab: ExposureTab) => void;
  requestedExposure: ExposureDrilldown | null;
  resolutionFeedback: ReactNode;
  sortDirection: ExposureSortDirection;
  searchMatches: HoldingsSearchMatches | null;
  searchQuery: string;
  visibleExposureCount: number;
  visiblePositionCounts: ReadonlyMap<string, number>;
}) {
  const marketByExposure = new Map(
    market.reviews?.map((r) => [r.exposureId, r]),
  );
  const openPosition = (
    event: MouseEvent<HTMLAnchorElement>,
    id: string,
    editValuation = false,
  ) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;
    event.preventDefault();
    onOpenHolding(id, editValuation, event.currentTarget);
  };
  const holdingDetailAction = (
    holdingId: string,
    label: string,
    title?: string,
  ) =>
    openableHoldingIds.has(holdingId) ? (
      <TextLink
        aria-label={label}
        className="position-row__action"
        data-holding-id={holdingId}
        href={holdingPositionPath(holdingId)}
        title={title}
        onClick={(event: MouseEvent<HTMLAnchorElement>) =>
          openPosition(event, holdingId)
        }
      >
        <DisclosureIndicator />
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
  const reviewPositionById = new Map(
    exposureReviewState?.positions.map((p) => [p.positionId, p]) ?? [],
  );
  const canonicalUnallocated = data.exposureView.positions.filter(
    (p) =>
      !isCashPosition(p) &&
      (p.valueMinor === null || reviewPositionById.has(p.id)) &&
      (searchMatches === null || searchMatches.positionIds.has(p.id)),
  );
  const holdingById = useMemo(
    () => new Map(holdings.map((h) => [h.id, h])),
    [holdings],
  );
  const sortedExposureGroups = useMemo(
    () =>
      holdingsExposureGroups(data.exposureView).sort((left, right) =>
        compareExposureGroups(left, right, sortDirection),
      ),
    [data.exposureView, sortDirection],
  );
  function valuationLink(position: InvestmentExposurePosition) {
    const holding = holdingById.get(position.id);
    if (!holding?.purchaseContext) return null;
    const closePath = followedCloseReviewPath(holding);
    if (closePath)
      return (
        <ButtonLink tone="quiet" href={closePath}>
          Change source
        </ButtonLink>
      );
    return (
      <ButtonLink
        tone="quiet"
        className="position-valuation-trigger"
        href={holdingPositionPath(position.id, true)}
        data-holding-id={position.id}
        data-valuation-link=""
        onClick={(event) => openPosition(event, position.id, true)}
      >
        {position.valueMinor === null ? "Add valuation" : "Change valuation"}
      </ButtonLink>
    );
  }
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
  const requestedExposureId = requestedExposure?.exposureId ?? null;
  const landOnGroup = requestedExposure?.focusTarget === "group";
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
  const targetExposureId = requestedExposureGroup?.exposure.id ?? null;
  useEffect(() => {
    if (targetExposureId === null || activeTab !== "all") {
      return;
    }
    onExposureOpenChange(targetExposureId, true);
    const frame = window.requestAnimationFrame(() => {
      const group = exposureGroupsRef.current?.querySelector<HTMLElement>(
        `[data-exposure-id="${CSS.escape(targetExposureId)}"]`,
      );
      // Full-page arrivals land on the named group. Tab reaches its disclosure.
      const target = landOnGroup
        ? group
        : group?.querySelector<HTMLElement>(
            '[data-slot="collapsible-trigger"]',
          );
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, landOnGroup, onExposureOpenChange, targetExposureId]);
  useEffect(() => {
    const target = loadMoreRef.current;
    if (
      activeTab !== "all" ||
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
  }, [activeTab, hasMoreExposures, onLoadMoreExposures, visibleExposureCount]);
  const allEmpty = matchingExposureGroups.length === 0 && (
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
      {canonicalUnallocated.length > 0
        ? "See positions awaiting allocation or company assignment in Needs resolution."
        : searchMatches === null
          ? "Connect an investment institution or import a holding update."
          : "Try another name, ticker, or source."}
    </EmptyState>
  );
  const resolutionContent =
    canonicalUnallocated.length > 0 ? (
      <div className="exposure-groups unallocated-positions">
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
                {exposureReviewState!.exactBatch.excludedPositionCount > 0 && (
                  <p>
                    {exposureReviewState!.exactBatch.excludedPositionCount}{" "}
                    {exposureReviewState!.exactBatch.excludedPositionCount === 1
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
          const legalNameTooltip =
            positionName === position.legalVehicleName
              ? undefined
              : position.legalVehicleName;
          const accountContext = position.containerLabel
            .toLocaleLowerCase()
            .includes(position.institutionLabel.toLocaleLowerCase())
            ? position.containerLabel
            : positionContext(position);
          const company = holdingById.get(position.id)?.exposureName;
          const context =
            reviewPosition === null &&
            position.isPrivateCompanyPosition &&
            company &&
            company !== positionName
              ? company
              : accountContext;
          const accountInTitle = position.ticker !== null && accountContext;
          const valuingPosition =
            position.valueMinor === null &&
            !!holdingById.get(position.id)?.purchaseContext &&
            reviewPosition === null;
          const valuation =
            position.valueMinor === null ? valuationLink(position) : null;
          const status =
            reviewPosition !== null
              ? "Company unresolved"
              : "Awaiting valuation";
          return (
            <Fragment key={position.id}>
              <article
                className={`exposure-row unallocated-positions__row${
                  (reviewPosition === null || reviewOpen) &&
                  !holdingById.get(position.id)?.purchaseContext
                    ? " position-row--detail"
                    : ""
                }`}
              >
                <span className="exposure-group__identity">
                  <strong title={legalNameTooltip}>
                    <SearchHighlight query={searchQuery}>
                      {positionName}
                    </SearchHighlight>
                    {accountInTitle && (
                      <span className="unallocated-positions__account">
                        {" · "}
                        <SearchHighlight query={searchQuery}>
                          {accountInTitle}
                        </SearchHighlight>
                      </span>
                    )}
                  </strong>
                  <small>
                    {(!valuingPosition || !context || accountInTitle) && (
                      <span className="unallocated-positions__status">
                        {status}
                      </span>
                    )}
                    {!accountInTitle && context && (
                      <>
                        {!valuingPosition && " · "}
                        <SearchHighlight query={searchQuery}>
                          {context}
                        </SearchHighlight>
                      </>
                    )}
                  </small>
                </span>
                <span
                  className="exposure-group__value"
                  hidden={valuingPosition}
                >
                  {position.valueMinor !== null &&
                    exactHoldingCurrency(
                      position.valueMinor,
                      position.currency,
                    )}
                </span>
                {valuation}
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
                {(!holdingById.get(position.id)?.purchaseContext ||
                  position.valueMinor !== null) &&
                  holdingDetailAction(
                    position.id,
                    `View ${positionName} holding details`,
                    legalNameTooltip,
                  )}
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
      </div>
    ) : exposureReviewState === null ? null : (
      <EmptyState
        className="investment-views__empty"
        compact
        headingAs="h3"
        icon={null}
        title={
          searchMatches === null
            ? "No positions need resolution"
            : "No matching positions"
        }
      >
        {searchMatches === null ? null : "Try another name, ticker, or source."}
      </EmptyState>
    );
  const allContent = (
    <div className="exposure-groups" ref={exposureGroupsRef}>
      {sortedExposureGroups.length > 1 && (
        <div className="investment-views__controls">
          <Button
            aria-label={`Sort exposures and positions by value, ${sortDirection === "descending" ? "highest first" : "lowest first"}. Switch to ${sortDirection === "descending" ? "lowest first" : "highest first"}.`}
            className="exposure-sort"
            onClick={onSortChange}
            title={`Switch to ${sortDirection === "descending" ? "lowest value first" : "highest value first"}`}
            tone="plain"
          >
            Value{" "}
            <span aria-hidden="true">
              {sortDirection === "descending" ? "↓" : "↑"}
            </span>
          </Button>
        </div>
      )}
      <RecordGroup aria-label="Company exposures" layout="disclosures">
        {visibleCanonicalExposureGroups.map((group) => {
          const contributionsByPosition = new Map<
            string,
            HoldingExposureGroup["contributions"]
          >();
          for (const contribution of group.contributions) {
            const slices = contributionsByPosition.get(contribution.positionId);
            if (slices) slices.push(contribution);
            else
              contributionsByPosition.set(contribution.positionId, [
                contribution,
              ]);
          }
          const rowValues = new Map<string, SortableValue | null>();
          for (const [id, slices] of contributionsByPosition) {
            const amount = slices.some((c) => c.allocatedValueMinor === null)
              ? null
              : slices.reduce(
                  (sum, c) => addMinorUnits(sum, c.allocatedValueMinor!),
                  0,
                );
            rowValues.set(
              id,
              amount === null
                ? null
                : { currency: slices[0]!.currency, valueMinor: amount },
            );
          }
          const positions = [...contributionsByPosition.keys()]
            .map((id) => positionById.get(id))
            .filter((p): p is InvestmentExposurePosition => p !== undefined)
            .sort(
              (left, right) =>
                compareSortableValues(
                  rowValues.get(left.id) ?? null,
                  rowValues.get(right.id) ?? null,
                  sortDirection,
                ) ||
                left.legalVehicleName.localeCompare(right.legalVehicleName),
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
          const estimateCount = positions.filter(isExposureEstimate).length;
          const currentSharePrice = exposureSharePricePresentation(
            group,
            positions,
          );
          const isOpen =
            searchMatches !== null || openExposureIds.has(group.exposure.id);
          const unavailableValueCount = group.totals.reduce(
            (count, total) => count + total.unknownValuePositionCount,
            0,
          );
          const marketReview = marketByExposure.get(group.exposure.id);
          const followsClosingPrice =
            positions.length > 0 &&
            positions.every(
              (position) =>
                position.valueSourceLabel === "Closing-price estimate",
            );
          const isLandingGroup =
            landOnGroup && group.exposure.id === requestedExposureId;
          const valueLabel = exposureTotalsLabel(group.totals);
          const onlyPosition =
            positions.length === 1 ? positions[0] : undefined;
          const heldAtVehicle = group.exposure.exposureKind === "position";
          const fraction =
            group.contributions.length === 1
              ? group.contributions[0]!.allocationPpm
              : null;
          const fractional = fraction !== null && fraction < PARTS_PER_MILLION;
          const allocationDetail =
            fractional && onlyPosition
              ? heldAtVehicle
                ? onlyPosition.positionKind === "fund_interest"
                  ? "Remaining fund value"
                  : "Remaining position value"
                : `Through ${positionDisplayName(onlyPosition)} · ${fraction / 10000}%`
              : heldAtVehicle && onlyPosition?.ticker
                ? onlyPosition.legalVehicleName
                : null;
          const performanceLabel = exposurePerformanceLabel(
            group,
            positions,
            isOpen ? null : (currentSharePrice?.label ?? null),
          );
          const singleMatch =
            matchingPositions.length === 1 ? matchingPositions[0] : undefined;
          const changeValuation =
            singleMatch?.valueMinor != null &&
            !(marketReview?.choice === "follow" && followsClosingPrice)
              ? valuationLink(singleMatch)
              : null;
          const singleSource =
            onlyPosition &&
            exposureValueSourceLabel(
              onlyPosition,
              holdingById.get(onlyPosition.id),
            );
          const summaryMetaLabel = [
            followsClosingPrice ? "Before carry" : null,
            estimateCount > 0
              ? `${estimateCount} ${estimateCount === 1 ? "estimate" : "estimates"}`
              : null,
            onlyPosition?.valueSource === "invested_amount" ||
            singleSource === "GP mark"
              ? (singleSource ?? null)
              : performanceLabel,
          ]
            .filter((label): label is string => label !== null)
            .join(" · ");
          return (
            <Collapsible
              className="exposure-group"
              role="listitem"
              aria-label={isLandingGroup ? displayName : undefined}
              tabIndex={isLandingGroup ? -1 : undefined}
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
                  !landOnGroup && group.exposure.id === requestedExposureId
                    ? "true"
                    : undefined
                }
                className="exposure-row exposure-group__summary"
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
                    {allocationDetail ??
                      (matchingPositions.length < positionCount
                        ? `${matchingPositions.length} matching ${matchingPositions.length === 1 ? "position" : "positions"} · ${positionCount} total`
                        : `${positionCount} ${positionCount === 1 ? "position" : "positions"}`)}
                    {valueLabel === null && " · Outside total"}
                    {group.exposure.exposureKind === "unresolved"
                      ? " · Unresolved"
                      : ""}
                  </small>
                </span>
                <span className="exposure-group__totals">
                  {valueLabel === null ? (
                    <span className="exposure-group__value exposure-group__value--excluded">
                      Awaiting valuation
                    </span>
                  ) : (
                    <span className="exposure-group__value">
                      {valueLabel}
                      {unavailableValueCount > 0 && (
                        <small className="exposure-group__value-label">
                          {unavailableValueCount}{" "}
                          {unavailableValueCount === 1 ? "value" : "values"}{" "}
                          awaiting valuation
                        </small>
                      )}
                    </span>
                  )}
                  {unavailableValueCount === 0 &&
                    summaryMetaLabel.length > 0 && (
                      <small
                        className={`exposure-group__performance${
                          currentSharePrice !== null || followsClosingPrice
                            ? " exposure-group__market-meta"
                            : ""
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
              {marketReview && marketReview.choice === null && (
                <ActionGroup wrap>
                  <MarketReviewLink review={marketReview} />
                  <small>
                    First public close · {marketReview.positions.length}{" "}
                    eligible{" "}
                    {marketReview.positions.length === 1
                      ? "position"
                      : "positions"}
                  </small>
                </ActionGroup>
              )}
              <CollapsibleContent>
                <div className="exposure-group__positions">
                  {marketReview && marketReview.choice !== null && (
                    <ActionGroup wrap>
                      {marketReview.choice === "follow" && (
                        <span className="exposure-group__quote">
                          {formatSharePrice(marketReview.quote.priceMicros)}
                          /share · {formatDate(marketReview.quote.date)}
                        </span>
                      )}
                      <MarketReviewLink
                        review={marketReview}
                        compact={marketReview.choice === "follow"}
                      />
                    </ActionGroup>
                  )}
                  {currentSharePrice !== null && (
                    <p className="exposure-group__quote">
                      {currentSharePrice.label} ·{" "}
                      {formatDate(currentSharePrice.observedAt)}
                    </p>
                  )}
                  <RecordGroup
                    className="holding-position-rows"
                    aria-label={`${displayName} positions`}
                  >
                    {matchingPositions
                      .slice(0, positionLimit)
                      .map((position) => {
                        const positionName = positionDisplayName(position);
                        const context = positionContext(position);
                        const accountTitle =
                          position.ticker !== null && context != null;
                        const rowTitle = accountTitle
                          ? position.containerLabel
                              .toLocaleLowerCase()
                              .includes(
                                position.institutionLabel.toLocaleLowerCase(),
                              )
                            ? position.containerLabel
                            : `${position.institutionLabel} · ${position.containerLabel}`
                          : positionName;
                        const rowDetail = accountTitle
                          ? positionName === displayName
                            ? null
                            : positionName
                          : context == null
                            ? null
                            : position.containerLabel;
                        const valueSourceLabel = exposureValueSourceLabel(
                          position,
                          holdingById.get(position.id),
                        );
                        const slices = contributionsByPosition.get(
                          position.id,
                        )!;
                        const attributed =
                          rowValues.get(position.id)?.valueMinor ?? null;
                        const allShares = slices.reduce(
                          (n, c) => n + (c.allocationPpm ?? 0),
                          0,
                        );
                        const caption =
                          allShares < PARTS_PER_MILLION
                            ? onlyPosition
                              ? null
                              : `${allShares / 10000}% of ${position.positionKind === "fund_interest" ? "fund" : "position"} value`
                            : exposurePositionValueCaption(
                                position,
                                valueSourceLabel,
                              );
                        const addValuation =
                          attributed === null && position.valueMinor === null
                            ? valuationLink(position)
                            : null;
                        const valuationTooltip =
                          valueSourceLabel === null
                            ? undefined
                            : position.valueEffectiveDate === null
                              ? `${valueSourceLabel} · Mark date unknown`
                              : `${valueSourceLabel} as of ${formatDate(position.valueEffectiveDate ?? position.observedAt)}`;
                        return (
                          <RecordRow
                            key={position.id}
                            className={
                              addValuation
                                ? "position-row--valuation"
                                : "position-row--detail"
                            }
                            title={
                              <SearchHighlight query={searchQuery}>
                                {rowTitle}
                              </SearchHighlight>
                            }
                            detail={
                              rowDetail && (
                                <SearchHighlight query={searchQuery}>
                                  {rowDetail}
                                </SearchHighlight>
                              )
                            }
                            value={
                              addValuation ? (
                                addValuation
                              ) : (
                                <span
                                  className={
                                    attributed === null
                                      ? "position-row__value position-row__value--awaiting"
                                      : "position-row__value"
                                  }
                                  title={valuationTooltip}
                                >
                                  {attributed === null
                                    ? "Awaiting valuation"
                                    : exactHoldingCurrency(
                                        attributed,
                                        position.currency,
                                      )}
                                  {caption !== null && <small>{caption}</small>}
                                </span>
                              )
                            }
                            action={holdingDetailAction(
                              position.id,
                              `View ${positionName} holding details${accountTitle ? ` in ${rowTitle}` : ""}`,
                              valuationTooltip,
                            )}
                          />
                        );
                      })}
                  </RecordGroup>
                  {fractional && onlyPosition?.valueMinor != null && (
                    <p className="holding-metadata">
                      {fraction / 10_000}% of the{" "}
                      {exactHoldingCurrency(
                        onlyPosition.valueMinor,
                        onlyPosition.currency,
                      )}{" "}
                      position in {positionDisplayName(onlyPosition)}.
                    </p>
                  )}
                  {onlyPosition?.valueSourceLabel ===
                    "At cost · Net invested" &&
                    onlyPosition.reviewedInvestment && (
                      <p className="holding-metadata">
                        {netInvestmentBreakdown(
                          onlyPosition.reviewedInvestment,
                        )}
                      </p>
                    )}
                  {changeValuation && (
                    <div className="exposure-valuation-action">
                      {changeValuation}
                    </div>
                  )}
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
      </RecordGroup>
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
  return (
    <Tabs
      className="investment-views__tabs"
      onValueChange={(next: unknown) => {
        if (next === "all" || next === "resolution") onTabChange(next);
      }}
      value={activeTab}
    >
      <TabsList aria-label="Exposure views" variant="line">
        <TabsTrigger value="all">All exposures</TabsTrigger>
        <TabsTrigger value="resolution">
          Needs resolution
          {exposureReviewState !== null && canonicalUnallocated.length > 0
            ? ` (${canonicalUnallocated.length})`
            : ""}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="all">
        {market.error && <Notice tone="error">{market.error}</Notice>}
        {allEmpty || allContent}
      </TabsContent>
      <TabsContent
        keepMounted={exposureReviewPositionId !== null}
        value="resolution"
      >
        {resolutionFeedback}
        {resolutionContent}
      </TabsContent>
    </Tabs>
  );
}

export function InvestmentHoldings({
  market,
  activeExposureTab,
  acceptedCashAccounts,
  onAddHolding,
  data,
  holdings,
  mode,
  onExposureOpenChange,
  onExposureResolved,
  onExposureTabChange,
  onLoadMoreExposures,
  onLoadMorePositions,
  onOpenHolding,
  onShowSmallBalancesChange,
  openExposureIds,
  requestedExposure,
  showSmallBalances,
  searchMatches,
  searchQuery,
  visibleExposureCount,
  visiblePositionCounts,
}: {
  activeExposureTab: ExposureTab;
  market: HoldingsMarket;
  acceptedCashAccounts: readonly AcceptedCashAccount[];
  onAddHolding?: () => void;
  data: InvestmentHoldingsView;
  holdings: readonly Holding[];
  mode: "exposures" | "sources";
  onExposureOpenChange: (exposureId: string, open: boolean) => void;
  onExposureResolved: () => Promise<void>;
  onExposureTabChange: (tab: ExposureTab) => void;
  onLoadMoreExposures: () => void;
  onLoadMorePositions: (exposureId: string) => void;
  onOpenHolding: (
    holdingId: string,
    editValuation?: boolean,
    action?: HTMLElement,
  ) => void;
  onReviewImport: (importId: string) => void;
  onShowSmallBalancesChange: (open: boolean) => void;
  openExposureIds: ReadonlySet<string>;
  requestedExposure: ExposureDrilldown | null;
  showSmallBalances: boolean;
  searchMatches: HoldingsSearchMatches | null;
  searchQuery: string;
  visibleExposureCount: number;
  visiblePositionCounts: ReadonlyMap<string, number>;
}) {
  const [connectionState, setConnectionState] =
    useState<InvestmentConnectionsState | null>(null);
  const [busy, setBusy] = useState<BusyAction | null>(null);
  const [sourceDecisionSaving, setSourceDecisionSaving] = useState(false);
  const [sourceReadbackPending, setSourceReadbackPending] = useState(false);
  const [openSourceActivity, setOpenSourceActivity] = useState<{
    id: string;
    decisions: boolean;
    activity?: boolean;
  } | null>(null);
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
      setExposureReviewState(null);
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
        setOpenSourceActivity({ id: next.connectionId, decisions: true });
      } else if ((next.latestAdjudication?.autoAppliedCount ?? 0) > 0) {
        const applied = next.latestAdjudication?.autoAppliedCount ?? 0;
        setNotice(
          `${next.institutionLabel}: ${applied} clear ${applied === 1 ? "position was" : "positions were"} applied.`,
        );
      } else {
        setNotice(`${next.institutionLabel} was checked. No changes found.`);
      }
      try {
        await reloadHoldings();
      } catch {
        setViewError(
          "The institution update succeeded, but Keel could not refresh the reviewed position view.",
        );
      }
    },
    [reloadHoldings],
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
  const exposureTotal = exposureGrandTotal(data);
  if (mode === "sources") {
    return (
      <section
        aria-labelledby="investment-institutions-title"
        className="investment-institutions"
      >
        <SectionHeader
          className="investment-institutions__heading"
          description="Clear updates happen automatically. Missing holdings are removed only after a verified complete account report."
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
              const lastComplete =
                status?.acceptedInventoryAt ??
                latestCompleteObservation(connection);
              const pendingCount =
                status?.latestAdjudication?.quarantinedCount ??
                (status?.latestImportId === null ||
                status?.latestImportId === undefined
                  ? 0
                  : 1);
              const accountCount = connection?.containers.length ?? 0;
              const acceptedEmpty =
                status?.acceptedInventoryEmpty === true &&
                !connection?.containers.some(
                  (account) => account.positions.length > 0,
                );
              const summaryPending =
                sourceReadbackPending &&
                openSourceActivity?.id === connectionId;
              const renderInstitutionActions = (management: boolean) => {
                if (status === null) return null;
                return (
                  <InstitutionActions
                    management={management}
                    busy={busy}
                    decisionSaving={sourceDecisionSaving}
                    readbackPending={sourceReadbackPending}
                    decisionOpen={
                      openSourceActivity?.id === connectionId &&
                      openSourceActivity.decisions
                    }
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
                    onReviewImport={() =>
                      setOpenSourceActivity((current) =>
                        current?.id === connectionId && current.decisions
                          ? null
                          : { id: connectionId, decisions: true },
                      )
                    }
                    status={status}
                  />
                );
              };
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
                          {status !== null && status.status !== "ready" && (
                            <Badge tone={lifecycleTone(status)}>
                              {lifecycleLabel(status)}
                            </Badge>
                          )}
                        </span>
                        <small className="investment-institution__summary">
                          {status?.status === "disconnected"
                            ? accountCount === 0
                              ? "No current accounts"
                              : `${accountCount} reviewed ${accountCount === 1 ? "account" : "accounts"}`
                            : `${accountCount} ${accountCount === 1 ? "account" : "accounts"}`}
                          {lastComplete === null
                            ? ""
                            : ` · ${status?.latestAdjudication?.inventoryAccepted === false ? "Last accepted report" : "Latest report"} ${formatDate(lastComplete)}`}
                          {status?.lastSyncedAt === null ||
                          status?.lastSyncedAt === undefined
                            ? ""
                            : ` · Checked ${formatDate(status.lastSyncedAt)}`}
                        </small>
                      </span>
                      <span className="investment-institution__summary-action">
                        <span className="investment-institution__accepted-value">
                          <strong className="investment-institution__value">
                            {summaryPending
                              ? "Refresh pending"
                              : acceptedEmpty
                                ? formatMoney(0)
                                : investmentConnectionTotalsLabel(connection)}
                          </strong>
                          <small>Accepted holdings</small>
                        </span>
                        <DisclosureIndicator />
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <InvestmentAccountRows
                        connection={connection}
                        acceptedEmpty={acceptedEmpty}
                      />
                      {renderInstitutionActions(true)}
                    </CollapsibleContent>
                  </Collapsible>
                  {status?.latestAdjudication && (
                    <div className="investment-institution__outcome">
                      <p>
                        <strong>
                          {summaryPending ? (
                            "Decision saved. Latest accepted holdings not loaded yet."
                          ) : (
                            <>
                              {status.latestAdjudication.reportReused
                                ? "No changes in the latest report."
                                : status.latestAdjudication.inventoryAccepted
                                  ? status.latestAdjudication
                                      .automaticChangeCount === 0
                                    ? "Holdings are current. No new changes."
                                    : `${status.latestAdjudication.automaticChangeCount ?? status.latestAdjudication.autoAppliedCount} ${(status.latestAdjudication.automaticChangeCount ?? status.latestAdjudication.autoAppliedCount) === 1 ? "change" : "changes"} applied automatically.`
                                  : status.latestAdjudication.autoAppliedCount >
                                      0
                                    ? `${status.latestAdjudication.autoAppliedCount} positions updated automatically.`
                                    : "Latest report checked."}{" "}
                              {pendingCount === 0
                                ? "No decisions needed."
                                : `${pendingCount} ${pendingCount === 1 ? "decision needs" : "decisions need"} you.`}
                            </>
                          )}
                        </strong>
                      </p>
                      {!summaryPending && (
                        <SourceInventoryOutcome
                          removedCount={
                            status.latestAdjudication.closedPositionCount
                          }
                          preservedCount={
                            status.latestAdjudication.preservedPositionCount
                          }
                          preservedObservedAt={
                            status.latestAdjudication.preservedObservedAt
                          }
                        />
                      )}
                      <TextLink
                        onClick={() =>
                          setOpenSourceActivity((current) =>
                            current?.id === connectionId
                              ? { ...current, activity: !current.activity }
                              : {
                                  id: connectionId,
                                  decisions: false,
                                  activity: true,
                                },
                          )
                        }
                        disabled={sourceDecisionSaving || sourceReadbackPending}
                        aria-expanded={
                          openSourceActivity?.id === connectionId &&
                          !!openSourceActivity.activity
                        }
                        aria-controls={`source-activity-${status.latestAdjudication.importId}`}
                      >
                        {openSourceActivity?.id === connectionId &&
                        openSourceActivity.activity
                          ? "Hide activity"
                          : "View activity"}
                      </TextLink>
                    </div>
                  )}
                  {renderInstitutionActions(false)}
                  {openSourceActivity?.id === connectionId &&
                    status?.latestAdjudication && (
                      <PublicSourceUpdate
                        key={`${status.latestImportId ?? status.latestAdjudication.importId}:${openSourceActivity.decisions}`}
                        onSavingChange={setSourceDecisionSaving}
                        onReadbackPendingChange={setSourceReadbackPending}
                        showOutcome={false}
                        showDecisions={openSourceActivity.decisions}
                        activityOpen={openSourceActivity.activity ?? false}
                        importId={
                          status.latestImportId ??
                          status.latestAdjudication.importId
                        }
                        onSaved={async () => {
                          const [connections] = await Promise.all([
                            reloadConnections(),
                            onExposureResolved(),
                          ]);
                          if (connections === null)
                            throw new Error(
                              "Accepted source summary is unavailable.",
                            );
                        }}
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
        {error !== null && !sourceReadbackPending && (
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
        icon={null}
        title="No matching holdings"
      >
        Try another name, ticker, or source, or clear your search.
      </EmptyState>
    );
  }

  if (
    searchMatches === null &&
    holdings.length === 0 &&
    acceptedCashAccounts.length === 0 &&
    data.exposureView.positions.length === 0
  ) {
    return (
      <section className="investment-views">
        <EmptyState
          actions={
            <ActionGroup>
              {onAddHolding && (
                <Button data-add-holding onClick={onAddHolding} tone="primary">
                  Add holding
                </Button>
              )}
              <TextLink href="/holdings/sources">Manage sources</TextLink>
            </ActionGroup>
          }
          className="holding-welcome"
          headingAs="h3"
          icon={null}
          title="Your holdings, in one place"
        >
          Add an investment you own, connect an account, or import a statement.
        </EmptyState>
      </section>
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
          className="investment-views__heading"
          headingProps={{ id: "investment-views-title" }}
          title="Exposures"
          trailingStat={
            <Stat
              as="div"
              className="investment-views__total"
              detail={exposureTotal.detail}
              label={exposureTotal.label}
              value={
                exposureTotal.value ?? (
                  <>
                    <span aria-hidden="true">—</span>
                    <span className="visually-hidden">No amounts included</span>
                  </>
                )
              }
            />
          }
        />
        {viewError !== null && (
          <Notice className="investment-views__error" tone="error">
            <p>{viewError}</p>
            <Button onClick={() => void reload()} tone="secondary">
              Try again
            </Button>
          </Notice>
        )}
        <ExposureView
          market={market}
          holdings={holdings}
          activeTab={activeExposureTab}
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
          onSortChange={() =>
            setExposureSortDirection((current) =>
              current === "descending" ? "ascending" : "descending",
            )
          }
          onSubmitExposureReview={(position, input) =>
            void submitExposureReview(position, input)
          }
          onTabChange={onExposureTabChange}
          requestedExposure={requestedExposure}
          resolutionFeedback={
            <>
              {exposureReviewNotice !== null && (
                <FormMessage
                  className="private-exposure-review__notice"
                  tone="success"
                >
                  {exposureReviewNotice}
                </FormMessage>
              )}
              {exposureReviewState === null &&
                exposureReviewLoadError === null && (
                  <p role="status">Loading positions needing resolution…</p>
                )}
              {exposureReviewLoadError !== null && (
                <Notice className="investment-views__error" tone="error">
                  <p>
                    {exposureReviewLoadError} Reviewed positions were not
                    changed.
                  </p>
                  <Button
                    onClick={() => void reloadExposureReviews()}
                    tone="secondary"
                  >
                    Try again
                  </Button>
                </Notice>
              )}
            </>
          }
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
