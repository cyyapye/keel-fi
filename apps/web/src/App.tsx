import type { AlphaData, EvidenceInboxItem, Scenario } from "@keel/domain";
import { Badge, Button, MetricCard, Panel } from "@keel/ui";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { loadAlphaData, submitEvidenceReview } from "./api";
import { formatCompactMoney, formatDate, formatProbability } from "./format";

type Screen = "dashboard" | "holdings" | "evidence" | "scenarios" | "history";

const navigation: readonly {
  id: Screen;
  label: string;
  shortLabel: string;
  icon: string;
}[] = [
  {
    id: "dashboard",
    label: "Decision Dashboard",
    shortLabel: "Decide",
    icon: "⌁",
  },
  { id: "holdings", label: "Holdings", shortLabel: "Holdings", icon: "◇" },
  {
    id: "evidence",
    label: "Evidence Inbox",
    shortLabel: "Evidence",
    icon: "≡",
  },
  { id: "scenarios", label: "Scenarios", shortLabel: "Scenarios", icon: "∿" },
  {
    id: "history",
    label: "Forecast History",
    shortLabel: "History",
    icon: "↺",
  },
];

function pageHeading(screen: Screen) {
  return navigation.find((item) => item.id === screen)?.label ?? "Keel";
}

function SourceBadge({
  status,
}: {
  status: "verified" | "review_due" | "proposed";
}) {
  if (status === "verified") {
    return <Badge tone="positive">Verified</Badge>;
  }
  if (status === "review_due") {
    return <Badge tone="warning">Review due</Badge>;
  }
  return <Badge tone="accent">Proposed</Badge>;
}

function EmptyState({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="empty-state">
      <span>◎</span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

function LiquidityChart({
  compact = false,
  scenario,
}: {
  compact?: boolean;
  scenario: Scenario;
}) {
  const width = 680;
  const height = compact ? 210 : 280;
  const padding = { top: 24, right: 22, bottom: 42, left: 24 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maximum =
    Math.max(...scenario.liquidityCurve.map((point) => point.p75Minor), 1) || 1;

  const xAt = (index: number) =>
    scenario.liquidityCurve.length <= 1
      ? padding.left
      : padding.left +
        Math.floor((index * plotWidth) / (scenario.liquidityCurve.length - 1));
  const yAt = (value: number) =>
    padding.top +
    plotHeight -
    Number((BigInt(value) * BigInt(plotHeight)) / BigInt(maximum));
  const line = (field: "p25Minor" | "p50Minor" | "p75Minor") =>
    scenario.liquidityCurve
      .map((point, index) => `${xAt(index)},${yAt(point[field])}`)
      .join(" ");
  const areaTop = scenario.liquidityCurve
    .map((point, index) => `${xAt(index)},${yAt(point.p75Minor)}`)
    .join(" ");
  const areaBottom = [...scenario.liquidityCurve]
    .reverse()
    .map(
      (point, reverseIndex) =>
        `${xAt(scenario.liquidityCurve.length - reverseIndex - 1)},${yAt(
          point.p25Minor,
        )}`,
    )
    .join(" ");

  return (
    <div className="chart-wrap">
      <svg
        aria-label={`${scenario.name} cumulative liquidity curve`}
        className="liquidity-chart"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 1, 2, 3].map((tick) => {
          const y = padding.top + Math.floor((tick * plotHeight) / 3);
          return (
            <line
              className="chart-grid"
              key={tick}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
            />
          );
        })}
        <polygon className="chart-range" points={`${areaTop} ${areaBottom}`} />
        <polyline
          className="chart-line chart-line--p25"
          points={line("p25Minor")}
        />
        <polyline
          className="chart-line chart-line--p75"
          points={line("p75Minor")}
        />
        <polyline
          className="chart-line chart-line--p50"
          points={line("p50Minor")}
        />
        {scenario.liquidityCurve.map((point, index) => (
          <g key={point.year}>
            <circle
              className="chart-dot"
              cx={xAt(index)}
              cy={yAt(point.p50Minor)}
              r="4"
            />
            <text
              className="chart-label"
              textAnchor="middle"
              x={xAt(index)}
              y={height - 14}
            >
              {point.year}
            </text>
          </g>
        ))}
      </svg>
      <div className="chart-legend" aria-hidden="true">
        <span>
          <i className="legend-line legend-line--p25" /> P25
        </span>
        <span>
          <i className="legend-line legend-line--p50" /> P50
        </span>
        <span>
          <i className="legend-line legend-line--p75" /> P75
        </span>
        <span>
          <i className="legend-range" /> Range
        </span>
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: AlphaData }) {
  const scenario =
    data.scenarios.find((item) => item.name === "FI Underwriting") ??
    data.scenarios[0];
  const dashboard = data.dashboard;
  const fiProgressPpm =
    dashboard.fiTargetMinor === 0
      ? 0
      : Number(
          (BigInt(dashboard.fiEligibleLiquidMinor) * 1_000_000n) /
            BigInt(dashboard.fiTargetMinor),
        );
  const ringStyle = {
    "--probability": `${Math.floor(
      dashboard.probabilityCrossingFiPpm / 10_000,
    )}%`,
  } as CSSProperties;

  return (
    <div className="screen-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">Decision posture · {dashboard.asOfDate}</p>
          <h1>
            Keep optionality.
            <br />
            Underwrite the real.
          </h1>
          <p className="hero__copy">
            Private value is tracked. Only timing-adjusted liquidity earns a
            place in this plan.
          </p>
        </div>
        <div className="hero__runway">
          <span>Protected runway</span>
          <strong>{dashboard.protectedRunwayMonths}</strong>
          <small>months at current burn</small>
          <div className="runway-ticks" aria-hidden="true">
            {Array.from({ length: 12 }, (_, index) => (
              <i className={index < 9 ? "active" : ""} key={index} />
            ))}
          </div>
        </div>
      </section>

      <div className="metrics-grid">
        <MetricCard
          detail="Eligible today"
          label="FI-eligible liquid"
          tone="dark"
          value={formatCompactMoney(dashboard.fiEligibleLiquidMinor)}
        />
        <MetricCard
          detail="Personal operating cost"
          label="Household burn"
          value={`${formatCompactMoney(
            dashboard.householdBurnMonthlyMinor,
          )} / mo`}
        />
        <MetricCard
          detail="Protected separately"
          label="Business burn"
          value={`${formatCompactMoney(
            dashboard.businessBurnMonthlyMinor,
          )} / mo`}
        />
        <MetricCard
          detail={`${formatProbability(fiProgressPpm)} funded`}
          label="FI target"
          tone="accent"
          value={formatCompactMoney(dashboard.fiTargetMinor)}
        />
      </div>

      <div className="dashboard-grid">
        <Panel
          action={<Badge tone="neutral">FI Underwriting</Badge>}
          className="liquidity-panel"
          eyebrow="Five-year outlook"
          title="Cumulative usable liquidity"
        >
          {scenario === undefined ? (
            <EmptyState title="No forecast curve">
              Create a forecast snapshot.
            </EmptyState>
          ) : (
            <>
              <div className="chart-kpis">
                <div>
                  <span>P25</span>
                  <strong>
                    {formatCompactMoney(dashboard.p25FiveYearLiquidityMinor)}
                  </strong>
                </div>
                <div>
                  <span>P50</span>
                  <strong>
                    {formatCompactMoney(dashboard.p50FiveYearLiquidityMinor)}
                  </strong>
                </div>
              </div>
              <LiquidityChart compact scenario={scenario} />
            </>
          )}
        </Panel>

        <Panel
          className="fi-panel"
          eyebrow="Decision signal"
          title="Financial independence"
        >
          <div className="probability-ring" style={ringStyle}>
            <div>
              <strong>
                {formatProbability(dashboard.probabilityCrossingFiPpm)}
              </strong>
              <span>crossing probability</span>
            </div>
          </div>
          <div className="fi-gap">
            <span>Current gap</span>
            <strong>{formatCompactMoney(dashboard.fiGapMinor)}</strong>
          </div>
          <p className="panel-note">
            Probability uses the immutable FI snapshot. Paper marks are excluded
            until a timing path is underwritten.
          </p>
        </Panel>
      </div>

      <Panel
        action={<span className="panel-link">Review inputs →</span>}
        eyebrow="Operating posture"
        title="What the model says now"
      >
        <div className="decision-list">
          <article>
            <span className="decision-index">01</span>
            <div>
              <h3>Runway is protected</h3>
              <p>
                Current liquid assets fund more than three years of combined
                household and business burn after the protected floor.
              </p>
            </div>
            <Badge tone="positive">Healthy</Badge>
          </article>
          <article>
            <span className="decision-index">02</span>
            <div>
              <h3>FI is not yet funded</h3>
              <p>
                The gap remains material without private-company distributions.
                Avoid treating conditional value as spendable capital.
              </p>
            </div>
            <Badge tone="warning">Watch</Badge>
          </article>
          <article>
            <span className="decision-index">03</span>
            <div>
              <h3>Evidence needs review</h3>
              <p>
                {
                  data.evidenceInbox.filter(
                    (item) => item.status === "pending_review",
                  ).length
                }{" "}
                proposed events can change the next forecast snapshot.
              </p>
            </div>
            <Badge tone="accent">Action</Badge>
          </article>
        </div>
      </Panel>
    </div>
  );
}

function Holdings({ data }: { data: AlphaData }) {
  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Portfolio evidence</p>
          <h1>Holdings</h1>
          <p>
            Five distinct value lenses. No mark implies an exit, and no exit
            implies usable liquidity.
          </p>
        </div>
        <Badge tone="neutral">{data.holdings.length} synthetic lots</Badge>
      </div>

      <Panel className="table-panel">
        <div className="holdings-table-wrap">
          <table className="data-table holdings-table">
            <thead>
              <tr>
                <th>Company / lot</th>
                <th>Admin NAV</th>
                <th>External mark</th>
                <th>FI underwriting</th>
                <th>Scenario value</th>
                <th>Usable now</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((holding) => (
                <tr key={holding.id}>
                  <td data-label="Company / lot">
                    <strong>{holding.companyName}</strong>
                    <span>
                      {holding.accountName} · {holding.lotLabel}
                    </span>
                  </td>
                  <td data-label="Admin NAV">
                    {formatCompactMoney(holding.administratorNavMinor)}
                  </td>
                  <td data-label="External mark">
                    {formatCompactMoney(holding.externalMarkMinor)}
                  </td>
                  <td data-label="FI underwriting">
                    <strong>
                      {formatCompactMoney(holding.underwritingValueMinor)}
                    </strong>
                  </td>
                  <td data-label="Scenario value">
                    {formatCompactMoney(holding.scenarioValueMinor)}
                  </td>
                  <td data-label="Usable now">
                    {formatCompactMoney(holding.usableLiquidityMinor)}
                  </td>
                  <td data-label="Source">
                    <SourceBadge status={holding.sourceStatus} />
                    <span className="source-meta">
                      {formatDate(holding.effectiveDate)} ·{" "}
                      {formatProbability(holding.confidencePpm)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="definition-grid">
        {[
          ["Administrator NAV", "The administrator's current reported value."],
          ["External mark", "The latest observed third-party economic mark."],
          [
            "FI underwriting",
            "The conservative value allowed into FI planning.",
          ],
          ["Scenario value", "The thesis-weighted conditional economic value."],
          [
            "Usable liquidity",
            "Capital currently available for actual decisions.",
          ],
        ].map(([title, copy], index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function EvidenceCard({
  busy,
  item,
  onReview,
}: {
  busy: boolean;
  item: EvidenceInboxItem;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
}) {
  const pending = item.status === "pending_review";
  return (
    <article className="evidence-card">
      <header>
        <div className="evidence-icon">E</div>
        <div>
          <p className="eyebrow">
            {item.companyName} · {item.eventType.replaceAll("_", " ")}
          </p>
          <h2>{item.headline}</h2>
        </div>
        <Badge tone={pending ? "accent" : "neutral"}>
          {item.status.replaceAll("_", " ")}
        </Badge>
      </header>
      <div className="evidence-body">
        <div className="evidence-sources">
          <span>Supporting source</span>
          {item.sources.map((source) => (
            <strong key={source}>▣ {source}</strong>
          ))}
          <small>
            Effective {formatDate(item.effectiveDate)} · Retrieved{" "}
            {formatDate(item.detectedAt)}
          </small>
        </div>
        <div className="proposed-change">
          <span>Proposed change</span>
          <div>
            <del>{item.priorValue}</del>
            <i>→</i>
            <ins>{item.replacementValue}</ins>
          </div>
          <small>
            {formatProbability(item.confidencePpm)} source confidence
          </small>
        </div>
        <div className="forecast-impact">
          <span>Estimated P50 impact</span>
          <strong>
            {item.forecastImpactMinor >= 0 ? "+" : ""}
            {formatCompactMoney(item.forecastImpactMinor)}
          </strong>
          <small>Applied only after a new snapshot is created</small>
        </div>
      </div>
      <footer>
        <p>
          A review records the decision and preserves both values. It does not
          silently rewrite a holding.
        </p>
        <div>
          <Button
            disabled={!pending || busy}
            onClick={() => onReview(item.id, "rejected")}
            tone="quiet"
          >
            Reject
          </Button>
          <Button
            disabled={!pending || busy}
            onClick={() => onReview(item.id, "scenario_only")}
          >
            Scenario only
          </Button>
          <Button
            disabled={!pending || busy}
            onClick={() => onReview(item.id, "accepted")}
            tone="primary"
          >
            Accept evidence
          </Button>
        </div>
      </footer>
    </article>
  );
}

function EvidenceInbox({
  busyEvent,
  data,
  error,
  onReview,
}: {
  busyEvent: string | null;
  data: AlphaData;
  error: string | null;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
}) {
  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Human review boundary</p>
          <h1>Evidence Inbox</h1>
          <p>
            External signals become proposals. You decide what enters the
            accepted record or a scenario.
          </p>
        </div>
        <Badge tone="accent">
          {
            data.evidenceInbox.filter(
              (item) => item.status === "pending_review",
            ).length
          }{" "}
          pending
        </Badge>
      </div>
      {error !== null && <div className="inline-error">{error}</div>}
      <div className="evidence-list">
        {data.evidenceInbox.map((item) => (
          <EvidenceCard
            busy={busyEvent === item.id}
            item={item}
            key={item.id}
            onReview={onReview}
          />
        ))}
      </div>
    </div>
  );
}

function Scenarios({ data }: { data: AlphaData }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, number>>({});
  const selected =
    data.scenarios.find((scenario) => scenario.id === selectedId) ??
    data.scenarios.find((scenario) => scenario.name === "FI Underwriting") ??
    data.scenarios[0];

  if (selected === undefined) {
    return (
      <EmptyState title="No scenarios">Seed the synthetic database.</EmptyState>
    );
  }

  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Versioned assumptions</p>
          <h1>Scenarios</h1>
          <p>
            Conditional economic value stays separate from timing-adjusted,
            decision-usable liquidity.
          </p>
        </div>
        <Badge tone={selected.isSandbox ? "accent" : "neutral"}>
          {selected.isSandbox ? "Editable sandbox" : "Saved snapshot"}
        </Badge>
      </div>

      <div className="scenario-tabs" role="tablist">
        {data.scenarios.map((scenario) => (
          <button
            aria-selected={scenario.id === selected.id}
            className={scenario.id === selected.id ? "active" : ""}
            key={scenario.id}
            onClick={() => setSelectedId(scenario.id)}
            role="tab"
            type="button"
          >
            {scenario.name}
          </button>
        ))}
      </div>

      <div className="scenario-summary">
        <div>
          <p>{selected.description}</p>
          <span>Current immutable forecast output</span>
        </div>
        <article>
          <span>Conditional value</span>
          <strong>{formatCompactMoney(selected.conditionalValueMinor)}</strong>
          <small>Economic outcome if conditions resolve</small>
        </article>
        <i aria-hidden="true">≠</i>
        <article className="usable">
          <span>Timing-adjusted liquidity</span>
          <strong>
            {formatCompactMoney(selected.timingAdjustedLiquidityMinor)}
          </strong>
          <small>Probability and timing adjusted</small>
        </article>
      </div>

      <div className="scenario-grid">
        <Panel eyebrow="Annual distribution" title="Cumulative liquidity curve">
          <LiquidityChart scenario={selected} />
          <div className="zero-probabilities">
            {selected.liquidityCurve.map((point) => (
              <span key={point.year}>
                <b>{point.year}</b>
                {formatProbability(point.probabilityZeroPpm)} chance of zero
              </span>
            ))}
          </div>
        </Panel>
        <Panel
          action={<Badge tone="warning">Draft only</Badge>}
          eyebrow="Assumption editor"
          title="Working values"
        >
          <div className="assumption-list">
            {selected.assumptions.map((assumption) => {
              const value = draftValues[assumption.id] ?? assumption.value;
              const isProbability = assumption.unit === "ppm";
              return (
                <label key={assumption.id}>
                  <span>
                    <strong>{assumption.label}</strong>
                    <b>
                      {isProbability
                        ? formatProbability(value)
                        : `${value} ${assumption.unit}`}
                    </b>
                  </span>
                  <input
                    max={isProbability ? 1_000_000 : 60}
                    min="0"
                    onChange={(event) =>
                      setDraftValues((current) => ({
                        ...current,
                        [assumption.id]: Number(event.target.value),
                      }))
                    }
                    step={isProbability ? 10_000 : 1}
                    type="range"
                    value={value}
                  />
                  <small>{assumption.provenance}</small>
                </label>
              );
            })}
          </div>
          <div className="draft-note">
            <span>◇</span>
            Editing creates a working draft only. Saving must create a new
            immutable forecast snapshot.
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ForecastHistory({ data }: { data: AlphaData }) {
  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Append-only record</p>
          <h1>Forecast History</h1>
          <p>
            Every version is retained with its trigger, author, and attributed
            change.
          </p>
        </div>
        <Badge tone="positive">Immutable</Badge>
      </div>

      <Panel className="history-panel">
        <div className="history-list">
          {data.forecastHistory.map((item, index) => {
            const delta =
              item.priorP50Minor === null
                ? null
                : item.p50Minor - item.priorP50Minor;
            return (
              <article key={item.id}>
                <div className="history-rail">
                  <span>{data.forecastHistory.length - index}</span>
                  <i />
                </div>
                <div className="history-content">
                  <header>
                    <div>
                      <Badge tone="neutral">{item.scenarioName}</Badge>
                      <h2>
                        Version {item.version} · {item.trigger}
                      </h2>
                    </div>
                    <time>{formatDate(item.createdAt)}</time>
                  </header>
                  <p>{item.attributedChange}</p>
                  <div className="history-comparison">
                    <span>
                      Prior P50
                      <b>
                        {item.priorP50Minor === null
                          ? "Baseline"
                          : formatCompactMoney(item.priorP50Minor)}
                      </b>
                    </span>
                    <span className="arrow">→</span>
                    <span>
                      New P50
                      <b>{formatCompactMoney(item.p50Minor)}</b>
                    </span>
                    {delta !== null && (
                      <Badge tone={delta >= 0 ? "positive" : "warning"}>
                        {delta >= 0 ? "+" : ""}
                        {formatCompactMoney(delta)}
                      </Badge>
                    )}
                  </div>
                  <small>Created by {item.createdBy}</small>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function Shell({
  activeScreen,
  children,
  data,
  onNavigate,
}: {
  activeScreen: Screen;
  children: ReactNode;
  data: AlphaData;
  onNavigate: (screen: Screen) => void;
}) {
  const pending = data.evidenceInbox.filter(
    (item) => item.status === "pending_review",
  ).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>Keel</strong>
            <small>Private alpha</small>
          </div>
        </div>
        <nav aria-label="Primary navigation">
          {navigation.map((item) => (
            <button
              aria-current={activeScreen === item.id ? "page" : undefined}
              className={activeScreen === item.id ? "active" : ""}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <i>{item.icon}</i>
              <span>{item.label}</span>
              {item.id === "evidence" && pending > 0 && <b>{pending}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="user-avatar">DO</div>
          <div>
            <strong>Demo Operator</strong>
            <span>{data.dashboard.householdName}</span>
          </div>
          <i>•••</i>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <span>Keel /</span> {pageHeading(activeScreen)}
          </div>
          <div className="topbar__right">
            <span className="secure-status">
              <i /> Private · Access protected
            </span>
            <button aria-label="Notifications" type="button">
              ◌{pending > 0 && <i />}
            </button>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {navigation.map((item) => (
          <button
            aria-current={activeScreen === item.id ? "page" : undefined}
            className={activeScreen === item.id ? "active" : ""}
            key={item.id}
            onClick={() => onNavigate(item.id)}
            type="button"
          >
            <i>{item.icon}</i>
            <span>{item.shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="loading-shell">
      <div className="loading-brand">Keel</div>
      <div className="loading-card">
        <span className="loader" />
        <h1>Loading the decision record</h1>
        <p>Retrieving the database-backed synthetic household.</p>
      </div>
    </div>
  );
}

export function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>("dashboard");
  const [data, setData] = useState<AlphaData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadAlphaData(controller.signal)
      .then(setData)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The Keel data contract could not be loaded.",
          );
        }
      });
    return () => controller.abort();
  }, []);

  const content = useMemo(() => {
    if (data === null) {
      return null;
    }
    switch (activeScreen) {
      case "dashboard":
        return <Dashboard data={data} />;
      case "holdings":
        return <Holdings data={data} />;
      case "evidence":
        return (
          <EvidenceInbox
            busyEvent={busyEvent}
            data={data}
            error={reviewError}
            onReview={(eventId, decision) => {
              setBusyEvent(eventId);
              setReviewError(null);
              void submitEvidenceReview(eventId, decision)
                .then(() =>
                  setData((current) =>
                    current === null
                      ? current
                      : {
                          ...current,
                          evidenceInbox: current.evidenceInbox.map((item) =>
                            item.id === eventId
                              ? { ...item, status: decision }
                              : item,
                          ),
                        },
                  ),
                )
                .catch((error: unknown) =>
                  setReviewError(
                    error instanceof Error
                      ? error.message
                      : "The evidence decision could not be recorded.",
                  ),
                )
                .finally(() => setBusyEvent(null));
            }}
          />
        );
      case "scenarios":
        return <Scenarios data={data} />;
      case "history":
        return <ForecastHistory data={data} />;
    }
  }, [activeScreen, busyEvent, data, reviewError]);

  if (data === null && loadError === null) {
    return <LoadingShell />;
  }

  if (data === null) {
    return (
      <div className="fatal-error">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <strong>Keel</strong>
        </div>
        <EmptyState title="The decision record is unavailable">
          {loadError}. Confirm the local D1 migration and seed have run, then
          reload.
        </EmptyState>
      </div>
    );
  }

  return (
    <Shell activeScreen={activeScreen} data={data} onNavigate={setActiveScreen}>
      {content}
    </Shell>
  );
}
