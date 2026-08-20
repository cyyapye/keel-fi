import {
  type Holding,
  type InvestmentConnectionStatus,
  type InvestmentConnectionsState,
  type PrivateExposureCompany,
  type PrivateExposureResolutionInput,
  type PrivateExposureReviewPosition,
  type PrivateExposureReviewState,
} from "@keel/domain";
import type {
  InvestmentExposureGroup,
  InvestmentExposurePosition,
} from "@keel/domain/exposure-read-model";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import type {
  InvestmentPositionConnection,
  InvestmentPositionContainer,
} from "@keel/domain/position-read-model";
import {
  Badge,
  Button,
  Input,
  NativeSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
  loadInvestmentHoldings,
  loadPrivateExposureReviews,
  syncDueInvestmentHoldings,
  syncInvestmentHoldings,
} from "./api";
import { formatCompactCurrency, formatDate } from "./format";
import { openPlaidLink } from "./plaid-link";

const INVESTMENT_LINK_TOKEN_STORAGE_KEY = "keel.investmentLinkToken";
const INVESTMENT_LINK_MODE_STORAGE_KEY = "keel.investmentLinkMode";
const INVESTMENT_ADD_MODE = "add";
const INVESTMENT_RECONNECT_PREFIX = "reconnect:";
const INVESTMENT_OAUTH_RECONNECT_MESSAGE =
  "Open this connection again to finish signing in.";
const AUTOMATIC_INVESTMENT_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1_000;

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

function hasDueInvestmentConnection(
  state: InvestmentConnectionsState,
): boolean {
  const syncedAfter = Date.now() - AUTOMATIC_INVESTMENT_SYNC_INTERVAL_MS;
  return state.connections.some(
    (connection) =>
      connection.status === "ready" &&
      connection.automaticUpdatesEnabled &&
      connection.latestImportId === null &&
      (connection.lastSyncedAt === null ||
        Date.parse(connection.lastSyncedAt) < syncedAfter),
  );
}

function exposurePositionValue(position: InvestmentExposurePosition): string {
  if (position.valueState === "reported" && position.valueMinor !== null) {
    return formatCompactCurrency(position.valueMinor, position.currency);
  }
  return position.valueState === "locked" ? "Locked" : "Not reported";
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
      formatCompactCurrency(valueMinor, currency),
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
  const waitingCount = status.latestAdjudication?.quarantinedCount ?? 0;
  if (status.status === "disconnected") {
    return (
      <div className="investment-institution__reconnect">
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
      </div>
    );
  }
  if (confirmDisconnect) {
    return (
      <div className="investment-institution__confirm" role="group">
        <p>Provider access will be removed. Reviewed history stays in Keel.</p>
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
      </div>
    );
  }
  return (
    <div className="investment-institution__actions">
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
          {isBusy || status.status === "syncing" ? "Checking…" : "Check now"}
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
    </div>
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
            <NativeSelect
              disabled={busy}
              onChange={(event) => setCompanyId(event.target.value)}
              value={companyId}
            >
              <option value="">Select a company</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.legalName} ·{" "}
                  {company.websiteHost ?? companyStatusLabel(company.status)}
                </option>
              ))}
            </NativeSelect>
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
      {error !== null && <p role="alert">{error}</p>}
      <div className="private-exposure-review__actions">
        <Button disabled={busy} onClick={onCancel} tone="quiet">
          Cancel
        </Button>
        <Button disabled={!canSubmit} tone="primary" type="submit">
          {busy ? "Assigning…" : "Assign company"}
        </Button>
      </div>
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
  openableHoldingIds,
  onBeginExposureReview,
  onApplyExactBatch,
  onCancelExposureReview,
  onOpenHolding,
  onLoadMoreExposures,
  onSubmitExposureReview,
  sortDirection,
  visibleExposureCount,
}: {
  data: InvestmentHoldingsView;
  exposureReviewBatchBusy: boolean;
  exposureReviewBatchError: string | null;
  exposureReviewBusyPositionId: string | null;
  exposureReviewError: string | null;
  exposureReviewPositionId: string | null;
  exposureReviewState: PrivateExposureReviewState | null;
  openableHoldingIds: ReadonlySet<string>;
  onBeginExposureReview: (positionId: string) => void;
  onApplyExactBatch: () => void;
  onCancelExposureReview: () => void;
  onOpenHolding: (holdingId: string) => void;
  onLoadMoreExposures: () => void;
  onSubmitExposureReview: (
    position: PrivateExposureReviewPosition,
    input: PrivateExposureResolutionInput,
  ) => void;
  sortDirection: ExposureSortDirection;
  visibleExposureCount: number;
}) {
  const holdingDetailAction = (holdingId: string, holdingName: string) =>
    openableHoldingIds.has(holdingId) ? (
      <button
        aria-label={`View ${holdingName} holding details`}
        className="position-row__action"
        data-holding-id={holdingId}
        onClick={() => onOpenHolding(holdingId)}
        type="button"
      >
        View details →
      </button>
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
  const canonicalUnallocated = data.exposureView.positions.filter(
    (position) =>
      position.hasUnknownAllocation ||
      (position.unallocatedValueMinor ?? 0) > 0 ||
      position.mappedExposureIds.length === 0,
  );
  const reviewPositionById = new Map(
    exposureReviewState?.positions.map((position) => [
      position.positionId,
      position,
    ]) ?? [],
  );
  const sortedExposureGroups = useMemo(
    () =>
      [...data.exposureView.exposures].sort((left, right) =>
        compareExposureGroups(left, right, sortDirection),
      ),
    [data.exposureView.exposures, sortDirection],
  );
  const totalExposureCount = sortedExposureGroups.length;
  const visibleCanonicalExposureGroups = sortedExposureGroups.slice(
    0,
    visibleExposureCount,
  );
  const hasMoreExposures = visibleExposureCount < totalExposureCount;
  const loadMoreRef = useRef<HTMLDivElement>(null);
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
    data.exposureView.exposures.length === 0 &&
    canonicalUnallocated.length === 0
  ) {
    return (
      <div className="investment-views__empty">
        <h3>No reviewed positions</h3>
        <p>Connect an investment institution or import a holding update.</p>
      </div>
    );
  }
  return (
    <div className="exposure-groups">
      {visibleCanonicalExposureGroups.map((group) => {
        const positions = group.contributions
          .map((contribution) =>
            data.exposureView.positions.find(
              (position) => position.id === contribution.positionId,
            ),
          )
          .filter(
            (position): position is InvestmentExposurePosition =>
              position !== undefined,
          )
          .sort((left, right) =>
            compareExposurePositions(left, right, sortDirection),
          );
        const positionCount = positions.length;
        return (
          <details className="exposure-group" key={group.exposure.id}>
            <summary>
              <span>
                <strong>{group.exposure.canonicalName}</strong>
                <small>
                  {positionCount}{" "}
                  {positionCount === 1 ? "position" : "positions"}
                  {group.exposure.exposureKind === "unresolved"
                    ? " · Unresolved"
                    : ""}
                </small>
              </span>
              <span className="exposure-group__totals">
                {exposureTotalsLabel(group.totals)}
              </span>
            </summary>
            <div className="exposure-group__positions">
              {positions.map((position) => (
                <article key={position.id}>
                  <span>
                    <strong>{position.legalVehicleName}</strong>
                    <small>{positionContext(position)}</small>
                  </span>
                  <span className="position-row__value">
                    {exposurePositionValue(position)}
                  </span>
                  <span>
                    {position.hasUnknownAllocation
                      ? "Allocation unknown"
                      : position.knownAllocationPpm === 1_000_000
                        ? "Full exposure"
                        : `${Math.floor(position.knownAllocationPpm / 10_000)}% allocated`}
                  </span>
                  {holdingDetailAction(position.id, position.legalVehicleName)}
                </article>
              ))}
            </div>
          </details>
        );
      })}
      {canonicalUnallocated.length > 0 && (
        <section className="unallocated-positions">
          <div>
            <p className="eyebrow">Not assigned to an exposure total</p>
            <h3>Unallocated or unresolved value</h3>
          </div>
          {(exposureReviewState?.exactBatch.positionCount ?? 0) > 0 && (
            <div className="private-exposure-exact-batch">
              <div>
                <p className="eyebrow">Exact company matches</p>
                <h4>
                  Resolve {exposureReviewState!.exactBatch.positionCount}{" "}
                  {exposureReviewState!.exactBatch.positionCount === 1
                    ? "position"
                    : "positions"}{" "}
                  at once
                </h4>
                <p>
                  Keel uses each holding’s company name—not the legal vehicle
                  name—and skips ambiguous rows. This will group the positions
                  under {exposureReviewState!.exactBatch.companyCount}{" "}
                  {exposureReviewState!.exactBatch.companyCount === 1
                    ? "company"
                    : "companies"}
                  .{" "}
                  {exposureReviewState!.exactBatch.newCompanyCount > 0
                    ? `It creates ${exposureReviewState!.exactBatch.newCompanyCount} reviewed ${exposureReviewState!.exactBatch.newCompanyCount === 1 ? "company" : "companies"}${
                        exposureReviewState!.exactBatch.existingCompanyCount > 0
                          ? ` and reuses ${exposureReviewState!.exactBatch.existingCompanyCount}`
                          : ""
                      }. `
                    : exposureReviewState!.exactBatch.existingCompanyCount > 0
                      ? `It reuses ${exposureReviewState!.exactBatch.existingCompanyCount} reviewed ${exposureReviewState!.exactBatch.existingCompanyCount === 1 ? "company" : "companies"}. `
                      : ""}
                  Legal positions and values stay unchanged.
                </p>
                {exposureReviewState!.exactBatch.excludedPositionCount > 0 && (
                  <p>
                    {exposureReviewState!.exactBatch.excludedPositionCount}{" "}
                    {exposureReviewState!.exactBatch.excludedPositionCount === 1
                      ? "other position remains"
                      : "other positions remain"}{" "}
                    for individual review.
                  </p>
                )}
                {exposureReviewBatchError !== null && (
                  <p
                    className="private-exposure-exact-batch__error"
                    role="alert"
                  >
                    {exposureReviewBatchError}
                  </p>
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
          {canonicalUnallocated.map((position) => {
            const reviewPosition = reviewPositionById.get(position.id) ?? null;
            const reviewOpen = exposureReviewPositionId === position.id;
            return (
              <Fragment key={position.id}>
                <article>
                  <span>
                    <strong>{position.legalVehicleName}</strong>
                    <small>{positionContext(position)}</small>
                  </span>
                  <span className="position-row__value">
                    {exposurePositionValue(position)}
                  </span>
                  <span className="unallocated-positions__status">
                    {position.hasUnknownAllocation
                      ? "Allocation unknown"
                      : position.mappedExposureIds.length === 0
                        ? "Exposure unresolved"
                        : formatCompactCurrency(
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
                  {holdingDetailAction(position.id, position.legalVehicleName)}
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
        </section>
      )}
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

export function InvestmentHoldings({
  holdings,
  onExposureResolved,
  onLoadMoreExposures,
  onOpenHolding,
  onReviewImport,
  visibleExposureCount,
}: {
  holdings: readonly Holding[];
  onExposureResolved: () => Promise<void>;
  onLoadMoreExposures: () => void;
  onOpenHolding: (holdingId: string) => void;
  onReviewImport: (importId: string) => void;
  visibleExposureCount: number;
}) {
  const [connectionState, setConnectionState] =
    useState<InvestmentConnectionsState | null>(null);
  const [data, setData] = useState<InvestmentHoldingsView | null>(null);
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
      setData(await loadInvestmentHoldings());
      setViewError(null);
    } catch {
      setViewError("Keel could not load the reviewed position view.");
    }
  }, []);

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
      Promise.all([
        reloadConnections(),
        reloadHoldings(),
        reloadExposureReviews(),
      ]),
    [reloadConnections, reloadExposureReviews, reloadHoldings],
  );

  useEffect(() => {
    let cancelled = false;
    const initial = window.setTimeout(() => {
      void reload().then(async ([initialConnections]) => {
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
          await reloadHoldings();
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
  }, [reload, reloadHoldings]);

  useEffect(() => {
    if (
      !connectionState?.connections.some(
        (connection) => connection.status === "syncing",
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => void reloadConnections(), 10_000);
    return () => window.clearInterval(timer);
  }, [connectionState, reloadConnections]);

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
        const nextView = await loadInvestmentHoldings();
        setData(nextView);
        setViewError(null);
      } catch {
        setViewError(
          "The institution update succeeded, but Keel could not refresh the reviewed position view.",
        );
      }
    },
    [onReviewImport],
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
        onExposureResolved(),
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
        onExposureResolved(),
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
    data?.positionView.connections.map((connection) => [
      connection.id,
      connection,
    ]) ?? [],
  );
  const orderedIds = [
    ...new Set([
      ...(connectionState?.connections.map((status) => status.connectionId) ??
        []),
      ...(data?.positionView.connections.map((connection) => connection.id) ??
        []),
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
  const addAvailable = data?.authorizationStatus === "available";
  const setupRequired =
    connectionState?.configured === false ||
    data?.authorizationStatus === "configuration_required";
  const positionCount =
    data?.positionView.connections.reduce(
      (total, connection) =>
        total +
        connection.containers.reduce(
          (containerTotal, container) =>
            containerTotal + container.positions.length,
          0,
        ),
      0,
    ) ?? 0;
  const exposureCount = data?.exposureView.exposures.length ?? 0;

  return (
    <>
      <section
        aria-labelledby="investment-institutions-title"
        className="investment-institutions"
      >
        <div className="investment-institutions__heading">
          <p className="eyebrow">Connections</p>
          <h2 id="investment-institutions-title">Brokerages</h2>
          <p>Robinhood, Fidelity, Schwab investing. Banking above.</p>
        </div>
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
          <p className="investment-institutions__checking" role="status">
            Checking investment institutions…
          </p>
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
                  <div className="investment-institution__heading">
                    <span>
                      <h3>{label}</h3>
                      <Badge tone={lifecycleTone(status)}>
                        {lifecycleLabel(status)}
                      </Badge>
                    </span>
                    <p className="investment-institution__summary">
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
                    </p>
                  </div>
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
          <p className="investment-institutions__notice" role="status">
            {notice}
          </p>
        )}
        {error !== null && (
          <p className="investment-institutions__error" role="alert">
            {error} Reviewed holdings were not changed.
          </p>
        )}
      </section>

      <section
        aria-labelledby="investment-views-title"
        className="investment-views"
      >
        <div className="investment-views__heading">
          <div>
            <p className="eyebrow">Reviewed ownership</p>
            <h2 id="investment-views-title">Exposures</h2>
            <p>
              Legal positions stay separate inside each exposure. Open one for
              ownership and source details.
            </p>
          </div>
          {data !== null && (
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
              <span className="investment-views__count">
                <strong>{exposureCount}</strong>{" "}
                {exposureCount === 1 ? "exposure" : "exposures"}
                <small>
                  {positionCount} legal{" "}
                  {positionCount === 1 ? "position" : "positions"}
                </small>
              </span>
            </div>
          )}
        </div>
        {exposureReviewNotice !== null && (
          <p className="private-exposure-review__notice" role="status">
            {exposureReviewNotice}
          </p>
        )}
        {exposureReviewLoadError !== null && (
          <div className="investment-views__error" role="alert">
            <p>
              {exposureReviewLoadError} Reviewed positions were not changed.
            </p>
            <Button
              onClick={() => void reloadExposureReviews()}
              tone="secondary"
            >
              Try again
            </Button>
          </div>
        )}
        {data === null && viewError === null ? (
          <p className="investment-views__loading" role="status">
            Loading reviewed exposures…
          </p>
        ) : (
          <>
            {viewError !== null && (
              <div className="investment-views__error" role="alert">
                <p>{viewError}</p>
                <Button onClick={() => void reload()} tone="secondary">
                  Try again
                </Button>
              </div>
            )}
            {data !== null && (
              <ExposureView
                data={data}
                exposureReviewBatchBusy={exposureReviewBatchBusy}
                exposureReviewBatchError={exposureReviewBatchError}
                exposureReviewBusyPositionId={exposureReviewBusyPositionId}
                exposureReviewError={exposureReviewError}
                exposureReviewPositionId={exposureReviewPositionId}
                exposureReviewState={exposureReviewState}
                openableHoldingIds={knownHoldingIds}
                onBeginExposureReview={beginExposureReview}
                onApplyExactBatch={() => void applyExactExposureBatch()}
                onCancelExposureReview={cancelExposureReview}
                onOpenHolding={onOpenHolding}
                onLoadMoreExposures={onLoadMoreExposures}
                onSubmitExposureReview={(position, input) =>
                  void submitExposureReview(position, input)
                }
                sortDirection={exposureSortDirection}
                visibleExposureCount={visibleExposureCount}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
