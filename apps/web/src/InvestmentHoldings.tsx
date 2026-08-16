import type {
  Holding,
  InvestmentConnectionStatus,
  InvestmentConnectionsState,
} from "@keel/domain";
import type { InvestmentExposurePosition } from "@keel/domain/exposure-read-model";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import type {
  InvestmentCoverageCompleteness,
  InvestmentPositionConnection,
  InvestmentPositionContainer,
  InvestmentPositionRecord,
} from "@keel/domain/position-read-model";
import { Badge, Button } from "@keel/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  changeInvestmentConnectionLifecycle,
  createInvestmentLinkToken,
  createInvestmentReconnectLinkToken,
  disconnectInvestmentConnection,
  exchangeInvestmentPublicToken,
  loadInvestmentConnections,
  loadInvestmentHoldings,
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

type ViewMode = "positions" | "exposures";

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

function coverageLabel(completeness: InvestmentCoverageCompleteness): string {
  return {
    complete: "Complete",
    partial: "Partial",
    unavailable: "Unavailable",
    malformed: "Unsupported response",
    failed: "Check failed",
    ambiguous: "Needs review",
  }[completeness];
}

function coverageTone(
  completeness: InvestmentCoverageCompleteness,
): "neutral" | "warning" | "negative" {
  return completeness === "complete"
    ? "neutral"
    : completeness === "failed" || completeness === "malformed"
      ? "negative"
      : "warning";
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

function positionValue(position: InvestmentPositionRecord): string {
  const value = position.snapshot.netValue;
  if (value.state === "reported" && value.minor !== null) {
    return formatCompactCurrency(value.minor, position.snapshot.currency);
  }
  return value.state === "locked" ? "Locked" : "Not reported";
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
  const reported = totals.filter((total) => total.knownValuePositionCount > 0);
  if (reported.length === 0) {
    return "Value unavailable";
  }
  return reported
    .map((total) =>
      formatCompactCurrency(total.allocatedValueMinor, total.currency),
    )
    .join(" · ");
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

function InvestmentAccountRows({
  connection,
}: {
  connection: InvestmentPositionConnection | null;
}) {
  if (connection === null || connection.containers.length === 0) {
    return (
      <p className="investment-institution__empty">No accounts recorded yet.</p>
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
          {container.coverage === null ? (
            <span className="investment-institution__coverage">
              Not checked
            </span>
          ) : (
            <span className="investment-institution__coverage">
              <Badge tone={coverageTone(container.coverage.completeness)}>
                {coverageLabel(container.coverage.completeness)}
              </Badge>
              <small>
                {container.coverage.freshness === "stale" ? "Stale · " : ""}
                {formatDate(container.coverage.observedAt)}
              </small>
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function InstitutionActions({
  busy,
  confirmDisconnect,
  onAction,
  onCancelDisconnect,
  onConfirmDisconnect,
  onReviewImport,
  status,
}: {
  busy: BusyAction | null;
  confirmDisconnect: boolean;
  onAction: (action: ConnectionAction) => void;
  onCancelDisconnect: () => void;
  onConfirmDisconnect: () => void;
  onReviewImport: (importId: string) => void;
  status: InvestmentConnectionStatus;
}) {
  const isBusy = busy?.connectionId === status.connectionId;
  const waitingCount = status.latestAdjudication?.quarantinedCount ?? 0;
  if (status.status === "disconnected") {
    return (
      <p className="investment-institution__history">
        Reviewed positions and planning history remain available.
      </p>
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
      ) : (
        <Button
          disabled={isBusy || status.status === "syncing"}
          onClick={() => onAction("check")}
          tone="secondary"
        >
          {isBusy || status.status === "syncing" ? "Checking…" : "Check now"}
        </Button>
      )}
      {status.status !== "paused" && (
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

function PositionViews({
  data,
  openableHoldingIds,
  onOpenHolding,
  view,
}: {
  data: InvestmentHoldingsView;
  openableHoldingIds: ReadonlySet<string>;
  onOpenHolding: (holdingId: string) => void;
  view: ViewMode;
}) {
  if (view === "positions") {
    const positionCount = data.positionView.connections.reduce(
      (connectionTotal, connection) =>
        connectionTotal +
        connection.containers.reduce(
          (containerTotal, container) =>
            containerTotal + container.positions.length,
          0,
        ),
      0,
    );
    if (positionCount === 0) {
      return (
        <div className="investment-views__empty">
          <h3>No reviewed positions</h3>
          <p>Connect an investment institution or import a holding update.</p>
        </div>
      );
    }
    return (
      <div className="position-groups" role="tabpanel">
        {data.positionView.connections.map((connection) =>
          connection.containers.map((container) => (
            <section
              aria-labelledby={`position-account-${container.id}`}
              className="position-group"
              key={container.id}
            >
              <div className="position-group__heading">
                <div>
                  <p>{connection.institutionLabel}</p>
                  <h3 id={`position-account-${container.id}`}>
                    {container.label}
                  </h3>
                </div>
                <span>
                  {accountKindLabel(container.kind)}
                  {container.coverage === null
                    ? " · Not checked"
                    : ` · ${coverageLabel(container.coverage.completeness)}`}
                </span>
              </div>
              {container.positions.length === 0 ? (
                <p className="position-group__empty">
                  The latest complete observation reported no positions.
                </p>
              ) : (
                <div className="position-list">
                  {container.positions.map((position) => (
                    <article className="position-row" key={position.id}>
                      <div className="position-row__identity">
                        <strong>{position.legalVehicleName}</strong>
                        {position.reportedExposureName !== null &&
                          position.reportedExposureName !==
                            position.legalVehicleName && (
                            <small>
                              Exposure: {position.reportedExposureName}
                            </small>
                          )}
                      </div>
                      <span>
                        <small>Value</small>
                        <strong>{positionValue(position)}</strong>
                      </span>
                      <span>
                        <small>Observed</small>
                        {formatDate(position.snapshot.observedAt)}
                        {position.source.freshness === "stale" && (
                          <em>Stale</em>
                        )}
                      </span>
                      {openableHoldingIds.has(position.id) && (
                        <button
                          aria-label={`View ${position.reportedExposureName ?? position.legalVehicleName} holding details`}
                          className="position-row__action"
                          data-holding-id={position.id}
                          onClick={() => onOpenHolding(position.id)}
                          type="button"
                        >
                          View details →
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </section>
          )),
        )}
      </div>
    );
  }

  const unallocated = data.exposureView.positions.filter(
    (position) =>
      position.hasUnknownAllocation ||
      (position.unallocatedValueMinor ?? 0) > 0 ||
      position.mappedExposureIds.length === 0,
  );
  if (data.exposureView.exposures.length === 0 && unallocated.length === 0) {
    return (
      <div className="investment-views__empty" role="tabpanel">
        <h3>No resolved exposures</h3>
        <p>
          Reviewed positions stay visible while exposure resolution is pending.
        </p>
      </div>
    );
  }
  return (
    <div className="exposure-groups" role="tabpanel">
      {data.exposureView.exposures.map((group) => {
        const positions = group.contributions
          .map((contribution) =>
            data.exposureView.positions.find(
              (position) => position.id === contribution.positionId,
            ),
          )
          .filter(
            (position): position is InvestmentExposurePosition =>
              position !== undefined,
          );
        return (
          <details className="exposure-group" key={group.exposure.id}>
            <summary>
              <span>
                <strong>{group.exposure.canonicalName}</strong>
                <small>
                  {positions.length}{" "}
                  {positions.length === 1 ? "position" : "positions"}
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
                    <small>
                      {position.institutionLabel} · {position.containerLabel}
                    </small>
                  </span>
                  <span>{exposurePositionValue(position)}</span>
                  <span>
                    {position.hasUnknownAllocation
                      ? "Allocation unknown"
                      : position.knownAllocationPpm === 1_000_000
                        ? "Full exposure"
                        : `${Math.floor(position.knownAllocationPpm / 10_000)}% allocated`}
                  </span>
                </article>
              ))}
            </div>
          </details>
        );
      })}
      {unallocated.length > 0 && (
        <section className="unallocated-positions">
          <div>
            <p className="eyebrow">Not assigned to an exposure total</p>
            <h3>Unallocated or unresolved value</h3>
          </div>
          {unallocated.map((position) => (
            <article key={position.id}>
              <span>
                <strong>{position.legalVehicleName}</strong>
                <small>
                  {position.institutionLabel} · {position.containerLabel}
                </small>
              </span>
              <span>{exposurePositionValue(position)}</span>
              <span>
                {position.hasUnknownAllocation
                  ? "Allocation unknown"
                  : position.mappedExposureIds.length === 0
                    ? "Exposure unresolved"
                    : formatCompactCurrency(
                        position.unallocatedValueMinor ?? 0,
                        position.currency,
                      )}
              </span>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function holdingKindLabel(kind: Holding["positionKind"]): string {
  return {
    direct: "Direct holding",
    spv_interest: "SPV interest",
    fund_interest: "Fund interest",
  }[kind];
}

function holdingStatusLabel(status: Holding["sourceStatus"]): string {
  return {
    verified: "Reviewed",
    review_due: "Review due",
    proposed: "Proposed",
  }[status];
}

function CompanyHoldingRecords({
  holdings,
  onOpenHolding,
}: {
  holdings: readonly Holding[];
  onOpenHolding: (holdingId: string) => void;
}) {
  if (holdings.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby="company-holdings-title"
      className="company-holdings"
    >
      <div className="company-holdings__heading">
        <div>
          <p className="eyebrow">Company evidence</p>
          <h2 id="company-holdings-title">Company holdings</h2>
          <p>
            Company evidence and planning values stay separate from
            connected-account positions.
          </p>
        </div>
        <span>
          <strong>{holdings.length}</strong>{" "}
          {holdings.length === 1 ? "record" : "records"}
        </span>
      </div>
      <div className="company-holdings__list">
        {holdings.map((holding) => {
          const primaryName = holding.exposureName ?? holding.positionName;
          return (
            <article key={holding.id}>
              <div>
                <strong>{primaryName}</strong>
                <small>
                  {holdingKindLabel(holding.positionKind)} ·{" "}
                  {holding.ownerLabel}
                </small>
                {holding.positionName !== primaryName && (
                  <small>Legal position: {holding.positionName}</small>
                )}
              </div>
              <span>
                <strong>{holdingStatusLabel(holding.sourceStatus)}</strong>
                <small>
                  Evidence dated {formatDate(holding.effectiveDate)}
                </small>
              </span>
              <button
                aria-label={`View ${primaryName} holding details`}
                className="company-holdings__action"
                data-holding-id={holding.id}
                onClick={() => onOpenHolding(holding.id)}
                type="button"
              >
                View details →
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function InvestmentHoldings({
  holdings,
  onOpenHolding,
  onReviewImport,
}: {
  holdings: readonly Holding[];
  onOpenHolding: (holdingId: string) => void;
  onReviewImport: (importId: string) => void;
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
  const [view, setView] = useState<ViewMode>("positions");
  const oauthStarted = useRef(false);
  const knownHoldingIds = useMemo(
    () => new Set(holdings.map((holding) => holding.id)),
    [holdings],
  );
  const canonicalPositionIds = useMemo(
    () =>
      new Set(
        data?.positionView.connections.flatMap((connection) =>
          connection.containers.flatMap((container) =>
            container.positions.map((position) => position.id),
          ),
        ) ?? [],
      ),
    [data],
  );
  const companyHoldingRecords = useMemo(
    () =>
      data === null && viewError === null
        ? []
        : holdings.filter((holding) => !canonicalPositionIds.has(holding.id)),
    [canonicalPositionIds, data, holdings, viewError],
  );

  const reloadConnections = useCallback(async () => {
    try {
      setConnectionState(await loadInvestmentConnections());
      setError((current) =>
        current === INVESTMENT_OAUTH_RECONNECT_MESSAGE ? current : null,
      );
    } catch {
      setError("Keel could not check investment institutions right now.");
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

  const reload = useCallback(
    () => Promise.all([reloadConnections(), reloadHoldings()]),
    [reloadConnections, reloadHoldings],
  );

  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => void reloadConnections(), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [reload, reloadConnections]);

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

  const statusById = new Map(
    connectionState?.connections.map((status) => [
      status.connectionId,
      status,
    ]) ?? [],
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

  return (
    <>
      <section
        aria-labelledby="investment-institutions-title"
        className="investment-institutions"
      >
        <div className="investment-institutions__heading">
          <p className="eyebrow">Investment institutions</p>
          <h2 id="investment-institutions-title">Accounts and updates</h2>
          <p>
            Brokerage and retirement accounts stay separate. Add banking cash
            accounts in the section above.
          </p>
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
                : "Add investment institution"}
            </Button>
          ) : (
            <p>
              {setupRequired
                ? "Investment updates need deployment setup."
                : "New institutions need approved provider coverage and pricing."}
            </p>
          )}
        </div>
        {connectionState === null && error === null ? (
          <p className="investment-institutions__checking" role="status">
            Checking investment institutions…
          </p>
        ) : orderedIds.length === 0 ? (
          <div className="investment-institutions__empty">
            <h3>No investment institution connected</h3>
            <p>Reviewed imports remain available below.</p>
          </div>
        ) : (
          <div className="investment-institution-list">
            {orderedIds.map((connectionId) => {
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
              return (
                <article className="investment-institution" key={connectionId}>
                  <div className="investment-institution__heading">
                    <span>
                      <h3>{label}</h3>
                      <Badge tone={lifecycleTone(status)}>
                        {lifecycleLabel(status)}
                      </Badge>
                    </span>
                    <div className="investment-institution__meta">
                      <span>
                        <small>Last complete</small>
                        {lastComplete === null
                          ? "Not yet"
                          : formatDate(lastComplete)}
                      </span>
                      <span>
                        <small>Waiting for review</small>
                        {pendingCount}
                      </span>
                    </div>
                  </div>
                  <InvestmentAccountRows connection={connection} />
                  {status !== null && (
                    <InstitutionActions
                      busy={busy}
                      confirmDisconnect={confirmDisconnectId === connectionId}
                      onAction={(action) =>
                        void runConnectionAction(status, action)
                      }
                      onCancelDisconnect={() => setConfirmDisconnectId(null)}
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
            <h2 id="investment-views-title">Positions and exposures</h2>
            <p>
              Positions show what is legally held. Exposures group shared
              economic risk without merging accounts or value.
            </p>
          </div>
          <span>
            <strong>{positionCount}</strong>{" "}
            {positionCount === 1 ? "position" : "positions"}
          </span>
        </div>
        <div
          aria-label="Holdings view"
          className="investment-view-tabs"
          role="tablist"
        >
          <button
            aria-selected={view === "positions"}
            className={view === "positions" ? "active" : ""}
            onClick={() => setView("positions")}
            role="tab"
            type="button"
          >
            Positions
          </button>
          <button
            aria-selected={view === "exposures"}
            className={view === "exposures" ? "active" : ""}
            onClick={() => setView("exposures")}
            role="tab"
            type="button"
          >
            Exposures
          </button>
        </div>
        {data === null && viewError === null ? (
          <p className="investment-views__loading" role="status">
            Loading reviewed positions…
          </p>
        ) : viewError !== null || data === null ? (
          <div className="investment-views__error" role="alert">
            <p>{viewError ?? "Reviewed positions are unavailable."}</p>
            <Button onClick={() => void reload()} tone="secondary">
              Try again
            </Button>
          </div>
        ) : (
          <PositionViews
            data={data}
            openableHoldingIds={knownHoldingIds}
            onOpenHolding={onOpenHolding}
            view={view}
          />
        )}
      </section>
      <CompanyHoldingRecords
        holdings={companyHoldingRecords}
        onOpenHolding={onOpenHolding}
      />
    </>
  );
}
