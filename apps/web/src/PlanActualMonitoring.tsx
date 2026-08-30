import {
  type PlanActualActionItem,
  type PlanActualMonitoringState,
} from "@keel/domain/plan-actual-monitoring";
import {
  ActionGroup,
  Badge,
  Button,
  DataItem,
  DataList,
  FormMessage,
} from "@keel/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadPlanActualMonitoring, snoozePlanActualMonitoring } from "./api";
import { formatCompactMoney, formatDate } from "./format";

type MonitoringRoute = "holdings" | "obligations" | "scenarios";

const metricLabels: Record<PlanActualActionItem["metric"], string> = {
  cash: "Cash",
  debt: "Debt",
  burn: "Burn",
  runway: "Runway",
};

const coverageLabels: Record<
  PlanActualMonitoringState["coverage"]["cash"],
  string
> = {
  not_configured: "Not connected",
  pending_review: "Review needed",
  missing: "Missing",
  stale: "Needs refresh",
  current: "Current",
};

function ActionValues({ item }: { item: PlanActualActionItem }) {
  if (item.plannedMonths !== null && item.actualMonths !== null) {
    return (
      <DataList className="plan-monitoring__values">
        <DataItem label="Saved plan" value={`${item.plannedMonths} months`} />
        <DataItem
          label="Reviewed actual"
          value={`${item.actualMonths} months`}
        />
      </DataList>
    );
  }
  if (item.plannedValueMinor === null && item.actualValueMinor === null) {
    return null;
  }
  return (
    <DataList className="plan-monitoring__values">
      {item.plannedValueMinor !== null && (
        <DataItem
          label="Saved plan"
          value={formatCompactMoney(item.plannedValueMinor)}
        />
      )}
      {item.actualValueMinor !== null && (
        <DataItem
          label="Reviewed actual"
          value={formatCompactMoney(item.actualValueMinor)}
        />
      )}
      {item.differenceMinor !== null && (
        <DataItem
          label="Difference"
          value={formatCompactMoney(item.differenceMinor)}
        />
      )}
    </DataList>
  );
}

function headingFor(state: PlanActualMonitoringState): string {
  if (state.status === "needs_action") {
    return `${state.actionItems.length} ${state.actionItems.length === 1 ? "decision" : "decisions"} to review`;
  }
  if (state.status === "deferred") {
    return "Nothing needs review today";
  }
  if (state.status === "clear") {
    return "Reviewed actuals are within the plan guardrails";
  }
  return "Monitoring is ready for connected actuals";
}

function copyFor(state: PlanActualMonitoringState): string {
  if (state.status === "needs_action") {
    return "Review the changes that matter. Nothing here changes your saved plan or forecast.";
  }
  if (state.status === "deferred") {
    return `${state.deferredItems.length} ${state.deferredItems.length === 1 ? "decision is" : "decisions are"} set aside for later review. New reviewed facts will bring an item back sooner.`;
  }
  if (state.status === "clear") {
    return "Current reviewed cash, debt, burn, and runway do not cross a monitoring threshold.";
  }
  return "Review cash, debt, and observed burn to complete the runway comparison. Keel will not fill missing values or change the plan.";
}

export function PlanActualMonitoring({
  onNavigate,
}: {
  onNavigate: (route: MonitoringRoute) => void;
}) {
  const [state, setState] = useState<PlanActualMonitoringState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<PlanActualActionItem["key"] | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const nextState = await loadPlanActualMonitoring(signal);
      setState(nextState);
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Plan versus actual monitoring could not load.",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void load(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const reviewLater = async (item: PlanActualActionItem) => {
    setBusyKey(item.key);
    setNotice(null);
    try {
      const nextState = await snoozePlanActualMonitoring({
        itemKey: item.key,
        sourceRevision: item.sourceRevision,
      });
      setState(nextState);
      setNotice("Moved to review later for 7 days.");
      window.requestAnimationFrame(() => headingRef.current?.focus());
    } catch (caught) {
      setNotice(
        caught instanceof Error
          ? caught.message
          : "This decision could not be moved to later review.",
      );
    } finally {
      setBusyKey(null);
    }
  };

  if (state === null && error === null) {
    return (
      <section
        aria-busy="true"
        aria-label="Plan versus actual monitoring"
        className="plan-monitoring plan-monitoring--loading"
      >
        <p className="eyebrow">Plan vs actual</p>
        <h2>Checking reviewed actuals…</h2>
      </section>
    );
  }

  if (state === null) {
    return (
      <section className="plan-monitoring plan-monitoring--error">
        <p className="eyebrow">Plan vs actual</p>
        <h2>Monitoring could not load</h2>
        <FormMessage className="plan-monitoring__copy" tone="error">
          {error}
        </FormMessage>
        <Button onClick={() => void load()}>Try again</Button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="plan-monitoring-heading"
      className={`plan-monitoring plan-monitoring--${state.status}`}
      data-status={state.status}
    >
      <header className="plan-monitoring__header">
        <div>
          <p className="eyebrow">Plan vs actual</p>
          <h2 id="plan-monitoring-heading" ref={headingRef} tabIndex={-1}>
            {headingFor(state)}
          </h2>
          <p className="plan-monitoring__copy">{copyFor(state)}</p>
        </div>
        <Badge
          tone={
            state.status === "needs_action"
              ? "accent"
              : state.status === "clear"
                ? "positive"
                : "neutral"
          }
        >
          {state.status === "needs_action"
            ? "Review"
            : state.status === "deferred"
              ? "Later"
              : state.status === "clear"
                ? "Current"
                : "Limited"}
        </Badge>
      </header>

      <DataList
        aria-label="Monitoring coverage"
        className="plan-monitoring__coverage"
      >
        {(["cash", "debt", "burn"] as const).map((metric) => (
          <DataItem
            key={metric}
            label={metricLabels[metric]}
            value={coverageLabels[state.coverage[metric]]}
          />
        ))}
        <DataItem
          label="Runway"
          value={
            state.coverage.runway === "available" ? "Available" : "Limited"
          }
        />
      </DataList>

      {state.actionItems.length > 0 && (
        <ol aria-label="Monitoring decisions" className="plan-monitoring__list">
          {state.actionItems.map((item) => (
            <li key={item.key}>
              <article className="plan-monitoring__item">
                <div className="plan-monitoring__item-copy">
                  <span>{metricLabels[item.metric]}</span>
                  <h3>{item.title}</h3>
                  <p>{item.reason}</p>
                  {item.observedAt !== null && (
                    <small>Observed {formatDate(item.observedAt)}</small>
                  )}
                </div>
                <ActionValues item={item} />
                <ActionGroup
                  className="plan-monitoring__actions"
                  layout="stack"
                >
                  <Button onClick={() => onNavigate(item.route)} tone="primary">
                    {item.nextAction}
                  </Button>
                  <Button
                    disabled={busyKey !== null}
                    onClick={() => void reviewLater(item)}
                    tone="quiet"
                  >
                    {busyKey === item.key ? "Saving…" : "Review in 7 days"}
                  </Button>
                </ActionGroup>
              </article>
            </li>
          ))}
        </ol>
      )}

      {state.deferredItems.length > 0 && (
        <ul
          aria-label="Deferred decisions"
          className="plan-monitoring__deferred"
        >
          {state.deferredItems.map((item) => (
            <li key={item.key}>
              <span>{metricLabels[item.metric]}</span>
              <strong>{item.title}</strong>
              <small>
                Review after{" "}
                {formatDate(item.cooldownUntil ?? state.evaluatedAt)}
              </small>
            </li>
          ))}
        </ul>
      )}

      {notice !== null && (
        <FormMessage className="plan-monitoring__notice" tone="success">
          {notice}
        </FormMessage>
      )}
    </section>
  );
}
