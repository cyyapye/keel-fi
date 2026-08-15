import {
  addMinorUnits,
  createGoalPreview,
  createPortfolioBaselineImpact,
  projectScenario,
  type AlphaData,
  type AngelListAutomationOverview,
  type AngelListMacAgentInterval,
  type AngelListMacAgentOverview,
  type AngelListSignInRefresh,
  type EvidenceInboxItem,
  type Goal,
  type GoalDraftInput,
  type Holding,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportPreview,
  type HoldingImportRowPreview,
  type HoldingImportSummary,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineState,
  type PublicSourceObservation,
  type RobinhoodSyncStatus,
  type Scenario,
  type ScenarioDraftInput,
  type SignalReconciliationGroup,
  type SignalUpdateProposal,
} from "@keel/domain";
import { Badge, Button, MetricCard, Panel } from "@keel/ui";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyAcceptedEvidence,
  applyHoldingImport,
  cancelAngelListSignInRefresh,
  confirmPortfolioBaseline,
  configureAngelListMacAgent,
  createRobinhoodLinkToken,
  createSignalUpdateProposal as submitSignalUpdateProposal,
  getAngelListSignInRefresh,
  exchangeRobinhoodPublicToken,
  listPendingHoldingImports,
  loadAngelListAutomationOverview,
  loadAlphaData,
  loadHoldingImport,
  loadLegacyAngelListAutomationOverview,
  loadPortfolioBaseline,
  loadRobinhoodSyncStatus,
  previewAngelListHoldingImport,
  requestAngelListUpdate,
  saveGoalVersion,
  saveScenarioVersion,
  scanPortfolioWatch,
  startAngelListSignInRefresh,
  submitAngelListHandoffInput,
  submitAngelListMagicLink,
  submitEvidenceReview,
  syncRobinhoodHoldings,
} from "./api";
import {
  formatCompactCurrency,
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatProbability,
} from "./format";
import { openRobinhoodLink } from "./plaid-link";
import { PlanInputsEditor } from "./PlanInputsEditor";

type Screen =
  | "dashboard"
  | "goals"
  | "holdings"
  | "watch"
  | "evidence"
  | "scenarios"
  | "history";

const isRealCompanyAcceptanceProfile =
  import.meta.env.VITE_KEEL_ACCEPTANCE_PROFILE === "real-company";

const navigation: readonly {
  id: Screen;
  label: string;
  icon: string;
}[] = [
  {
    id: "dashboard",
    label: "Overview",
    icon: "01",
  },
  { id: "goals", label: "Goals", icon: "02" },
  { id: "holdings", label: "Holdings", icon: "03" },
  {
    id: "watch",
    label: "Portfolio Watch",
    icon: "04",
  },
  {
    id: "evidence",
    label: "Evidence Inbox",
    icon: "05",
  },
  { id: "scenarios", label: "Scenarios", icon: "06" },
  {
    id: "history",
    label: "Forecast History",
    icon: "07",
  },
];

function pageHeading(screen: Screen) {
  return navigation.find((item) => item.id === screen)?.label ?? "Keel";
}

type AppRoute = {
  screen: Screen;
  holdingImportId: string | null;
};

function routeFromLocation(): AppRoute {
  const importMatch = window.location.pathname.match(
    /^\/holdings\/imports\/([^/]+)\/?$/,
  );
  if (importMatch?.[1] !== undefined) {
    try {
      return {
        screen: "holdings",
        holdingImportId: decodeURIComponent(importMatch[1]),
      };
    } catch {
      return { screen: "holdings", holdingImportId: null };
    }
  }
  const screen = navigation.find(
    (item) => window.location.pathname === `/${item.id}`,
  )?.id;
  return {
    screen: screen ?? "dashboard",
    holdingImportId: null,
  };
}

function pathForScreen(screen: Screen): string {
  return screen === "dashboard" ? "/" : `/${screen}`;
}

function KeelMark() {
  return (
    <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
      <path d="M10 2h12l8 8v12l-8 8H10l-8-8V10Z" />
      <path d="M16 6v19M7 12h18M8 18l8 7 8-7" />
    </svg>
  );
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

type GoalUnit = GoalDraftInput["targetUnit"];

function latestGoalVersion(goal: Goal) {
  const version = goal.versions[0];
  if (version === undefined) {
    throw new Error("A goal must have at least one saved version.");
  }
  return version;
}

function formatGoalValue(value: number, unit: GoalUnit): string {
  if (unit === "minor_units") {
    return formatCompactMoney(value);
  }
  if (unit === "ppm") {
    return formatProbability(value);
  }
  return `${new Intl.NumberFormat("en-US").format(value)} ${
    unit === "months" ? "months" : ""
  }`.trim();
}

function formatScenarioAssumptionValue(
  assumption: Scenario["assumptions"][number],
  value: number,
): string {
  if (assumption.unit === "ppm") {
    return formatProbability(value);
  }
  if (assumption.unit === "minor_units") {
    return formatCompactMoney(value);
  }
  return `${value} ${assumption.unit}`;
}

function moneyInputValue(minorUnits: number | null): string {
  if (minorUnits === null) {
    return "";
  }
  const dollars = BigInt(minorUnits) / 100n;
  const cents = BigInt(minorUnits) % 100n;
  return cents === 0n
    ? dollars.toString()
    : `${dollars}.${cents.toString().padStart(2, "0")}`;
}

function parseMoneyInput(value: string): number | null {
  const normalized = value.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) {
    return null;
  }
  const [whole = "0", decimal = ""] = normalized.split(".");
  const minor = BigInt(whole) * 100n + BigInt(decimal.padEnd(2, "0"));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(minor);
}

function parseGoalInteger(value: string, unit: GoalUnit): number | null {
  if (value.trim() === "") {
    return null;
  }
  if (unit === "minor_units") {
    return parseMoneyInput(value);
  }
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function LiquidityChart({
  compact = false,
  scenario,
}: {
  compact?: boolean;
  scenario: Scenario;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const width = 680;
  const height = compact ? 230 : 300;
  const padding = { top: 34, right: 18, bottom: 44, left: 62 };
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
  const activePoint =
    activeIndex === null ? undefined : scenario.liquidityCurve[activeIndex];
  const activeX = activeIndex === null ? 0 : xAt(activeIndex);
  const tooltipWidth = 164;
  const tooltipHeight = 76;
  const tooltipX = Math.min(
    Math.max(activeX - tooltipWidth / 2, padding.left),
    width - padding.right - tooltipWidth,
  );
  const tooltipY =
    activePoint === undefined
      ? 0
      : Math.max(2, yAt(activePoint.p75Minor) - tooltipHeight - 10);

  return (
    <div className="chart-wrap">
      <svg
        aria-label={`${scenario.name} cumulative liquidity curve`}
        className="liquidity-chart"
        role="group"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 1, 2, 3].map((tick) => {
          const y = padding.top + Math.floor((tick * plotHeight) / 3);
          const value = Number(
            (BigInt(maximum) * BigInt(3 - tick)) / BigInt(3),
          );
          return (
            <g key={tick}>
              <line
                className="chart-grid"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
              <text
                className="chart-axis-label"
                textAnchor="end"
                x={padding.left - 10}
                y={y + 3}
              >
                {formatCompactMoney(value)}
              </text>
            </g>
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
              aria-label={`${point.year} liquidity range: Lower, 25th percentile, ${formatCompactMoney(
                point.p25Minor,
              )}; Middle, 50th percentile, ${formatCompactMoney(
                point.p50Minor,
              )}; Higher, 75th percentile, ${formatCompactMoney(
                point.p75Minor,
              )}`}
              aria-pressed={activeIndex === index}
              className="chart-hit chart-point"
              cx={xAt(index)}
              cy={yAt(point.p50Minor)}
              onBlur={() => setActiveIndex(null)}
              onClick={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              r="13"
              role="button"
              tabIndex={0}
            />
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
        {activePoint !== undefined && (
          <g
            aria-hidden="true"
            className="chart-tooltip"
            transform={`translate(${tooltipX} ${tooltipY})`}
          >
            <rect height={tooltipHeight} width={tooltipWidth} />
            <text className="chart-tooltip__year" x="12" y="17">
              {activePoint.year}
            </text>
            <text x="12" y="35">
              Lower {formatCompactMoney(activePoint.p25Minor)}
            </text>
            <text x="12" y="51">
              Middle {formatCompactMoney(activePoint.p50Minor)}
            </text>
            <text x="12" y="67">
              Higher {formatCompactMoney(activePoint.p75Minor)}
            </text>
          </g>
        )}
      </svg>
      <p className="chart-instruction">
        Hover, tap, or focus a year to inspect its range.
      </p>
      <div className="chart-legend" aria-hidden="true">
        <span>
          <i className="legend-line legend-line--p25" /> Lower
        </span>
        <span>
          <i className="legend-line legend-line--p50" /> Middle
        </span>
        <span>
          <i className="legend-line legend-line--p75" /> Higher
        </span>
        <span>
          <i className="legend-range" /> Range
        </span>
      </div>
    </div>
  );
}

function Dashboard({
  data,
  onNavigate,
}: {
  data: AlphaData;
  onNavigate: (screen: Screen) => void;
}) {
  const scenario =
    data.scenarios.find((item) => item.name === "FI Underwriting") ??
    data.scenarios[0];
  const dashboard = data.dashboard;
  const primaryGoal =
    data.goals.find((goal) => goal.isPrimary) ?? data.goals[0];
  if (primaryGoal === undefined) {
    return (
      <EmptyState title="No planning goal">
        Create a goal before using the overview.
      </EmptyState>
    );
  }
  const primaryVersion = latestGoalVersion(primaryGoal);
  const primaryForecast = primaryVersion.forecast;
  const target = primaryVersion.targetValueInteger;
  const progressPpm =
    target === null
      ? 0
      : target === 0
        ? 1_000_000
        : Math.min(
            Number(
              (BigInt(primaryVersion.currentValueInteger) * 1_000_000n) /
                BigInt(target),
            ),
            1_000_000,
          );
  const signalPpm = primaryForecast.successProbabilityPpm ?? progressPpm;
  const ringStyle = {
    "--probability": `${Math.floor(signalPpm / 10_000)}%`,
  } as CSSProperties;
  const secondaryGoals = data.goals.filter((goal) => !goal.isPrimary);
  const targetMet =
    target !== null && primaryVersion.currentValueInteger >= target;
  const pendingEvidence = data.evidenceInbox.filter(
    (item) => item.status === "pending_review",
  ).length;

  return (
    <div className="screen-stack">
      <section className="hero">
        <div>
          <p className="eyebrow">
            Primary goal · saved plan v{primaryVersion.version}
          </p>
          <h1>{primaryVersion.name}</h1>
          <p className="hero__copy">
            {primaryVersion.metricLabel}:{" "}
            {formatGoalValue(
              primaryVersion.currentValueInteger,
              primaryVersion.targetUnit,
            )}
            {target === null
              ? ". Add a target when it becomes useful."
              : ` of ${formatGoalValue(target, primaryVersion.targetUnit)}${
                  primaryVersion.targetDate === null
                    ? "."
                    : ` by ${formatDate(primaryVersion.targetDate)}.`
                }`}
          </p>
          <Button
            className="hero__action"
            onClick={() => onNavigate("goals")}
            tone="quiet"
          >
            Edit this goal →
          </Button>
        </div>
        <div className="hero__runway">
          <span>Current measure</span>
          <strong>
            {formatGoalValue(
              primaryVersion.currentValueInteger,
              primaryVersion.targetUnit,
            )}
          </strong>
          <small>
            {target === null
              ? "No target set"
              : `${formatProbability(progressPpm)} of target`}
          </small>
        </div>
      </section>

      <div className="metrics-grid">
        <MetricCard
          actionLabel="Edit goal"
          detail={primaryVersion.metricLabel}
          label="Primary goal now"
          onClick={() => onNavigate("goals")}
          tone="dark"
          value={formatGoalValue(
            primaryVersion.currentValueInteger,
            primaryVersion.targetUnit,
          )}
        />
        <MetricCard
          actionLabel="Edit goal"
          detail={
            primaryVersion.targetDate === null
              ? "No target date"
              : `By ${formatDate(primaryVersion.targetDate)}`
          }
          label="Goal target"
          onClick={() => onNavigate("goals")}
          value={
            target === null
              ? "Not set"
              : formatGoalValue(target, primaryVersion.targetUnit)
          }
        />
        <MetricCard
          actionLabel="View plan inputs"
          detail="Guardrail, not the goal"
          label="Protected runway"
          onClick={() => onNavigate("scenarios")}
          value={`${dashboard.protectedRunwayMonths} months`}
        />
        <MetricCard
          actionLabel="View holdings"
          detail="Decision-usable today"
          label="FI-eligible liquid"
          onClick={() => onNavigate("holdings")}
          tone="accent"
          value={formatCompactMoney(dashboard.fiEligibleLiquidMinor)}
        />
      </div>

      {secondaryGoals.length > 0 && (
        <section className="secondary-goals">
          <header>
            <div>
              <p className="eyebrow">Other goals</p>
              <h2>Tracked alongside the primary goal</h2>
            </div>
            <Button onClick={() => onNavigate("goals")} tone="quiet">
              Manage goals →
            </Button>
          </header>
          <div>
            {secondaryGoals.map((goal) => {
              const version = latestGoalVersion(goal);
              return (
                <button
                  key={goal.id}
                  onClick={() => onNavigate("goals")}
                  type="button"
                >
                  <span>{version.name}</span>
                  <strong>
                    {formatGoalValue(
                      version.currentValueInteger,
                      version.targetUnit,
                    )}
                  </strong>
                  <small>
                    {version.targetValueInteger === null
                      ? "No target set"
                      : `of ${formatGoalValue(
                          version.targetValueInteger,
                          version.targetUnit,
                        )}`}
                  </small>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="dashboard-grid">
        <Panel
          action={<Badge tone="neutral">Portfolio outlook</Badge>}
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
                  <span title="25th percentile">Lower</span>
                  <strong>
                    {formatCompactMoney(dashboard.p25FiveYearLiquidityMinor)}
                  </strong>
                </div>
                <div>
                  <span title="50th percentile">Middle</span>
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
          eyebrow="Goal signal"
          title={primaryVersion.name}
        >
          <div className="probability-ring" style={ringStyle}>
            <div>
              <strong>{formatProbability(signalPpm)}</strong>
              <span>
                {primaryForecast.successProbabilityPpm === null
                  ? "current progress"
                  : "estimated success"}
              </span>
            </div>
          </div>
          <div className="fi-gap">
            <span>{targetMet ? "Target status" : "Current gap"}</span>
            <strong>
              {target === null
                ? "No target"
                : targetMet
                  ? "Met"
                  : formatGoalValue(
                      target - primaryVersion.currentValueInteger,
                      primaryVersion.targetUnit,
                    )}
            </strong>
          </div>
          <p className="panel-note">
            {primaryForecast.modelStatus === "modeled"
              ? `This estimate is tied to saved plan v${primaryVersion.version}. Private-paper values stay excluded until their timing is modeled.`
              : "Current progress is saved. Add scenario inputs before treating this goal as a forecast."}
          </p>
        </Panel>
      </div>

      <Panel
        action={
          <Button onClick={() => onNavigate("goals")} tone="quiet">
            Review goal →
          </Button>
        }
        eyebrow="Current readout"
        title="What the saved plan says"
      >
        <div className="decision-list">
          <article>
            <span className="decision-index">01</span>
            <div>
              <h3>
                {target === null
                  ? "This goal needs a target"
                  : targetMet
                    ? "The current target is met"
                    : "The goal is still in progress"}
              </h3>
              <p>
                {target === null
                  ? "Add an amount or threshold when one would make the goal easier to evaluate."
                  : `${formatProbability(progressPpm)} of the current target is covered by the saved baseline.`}
              </p>
            </div>
            <Badge tone={targetMet ? "positive" : "warning"}>
              {targetMet ? "Met" : "Track"}
            </Badge>
          </article>
          <article>
            <span className="decision-index">02</span>
            <div>
              <h3>Runway remains a separate guardrail</h3>
              <p>
                The accepted cash-flow plan protects{" "}
                {dashboard.protectedRunwayMonths} months after the cash floor.
                It supports the goal; it does not define every goal.
              </p>
            </div>
            <Badge tone="positive">Healthy</Badge>
          </article>
          <article>
            <span className="decision-index">03</span>
            <div>
              <h3>Evidence needs review</h3>
              <p>
                {pendingEvidence} proposed events can change the next saved
                forecast.
              </p>
            </div>
            <Badge tone="accent">Action</Badge>
          </article>
        </div>
      </Panel>
    </div>
  );
}

type GoalFormState = {
  templateKey: GoalDraftInput["templateKey"];
  name: string;
  metricKey: string;
  metricLabel: string;
  targetValue: string;
  targetUnit: GoalUnit;
  targetDate: string;
  currentValue: string;
  makePrimary: boolean;
  changeNote: string;
};

const templateLabels: Record<GoalDraftInput["templateKey"], string> = {
  financial_independence: "Financial independence",
  cash_runway: "Cash runway",
  major_purchase: "Major purchase",
  custom: "Custom",
};

function goalFormFromTemplate(
  data: AlphaData,
  templateKey: GoalDraftInput["templateKey"],
): GoalFormState {
  if (templateKey === "financial_independence") {
    return {
      templateKey,
      name: "Financial independence",
      metricKey: "fi_eligible_liquid",
      metricLabel: "FI-eligible liquid assets",
      targetValue: moneyInputValue(data.dashboard.fiTargetMinor),
      targetUnit: "minor_units",
      targetDate: "",
      currentValue: moneyInputValue(data.dashboard.fiEligibleLiquidMinor),
      makePrimary: false,
      changeNote: "Created from the financial independence template",
    };
  }
  if (templateKey === "cash_runway") {
    return {
      templateKey,
      name: "Protect cash runway",
      metricKey: "protected_runway_months",
      metricLabel: "Months of protected runway",
      targetValue: "36",
      targetUnit: "months",
      targetDate: "",
      currentValue: String(data.dashboard.protectedRunwayMonths),
      makePrimary: false,
      changeNote: "Created from the cash runway template",
    };
  }
  if (templateKey === "major_purchase") {
    return {
      templateKey,
      name: "Major purchase",
      metricKey: "purchase_fund",
      metricLabel: "Amount set aside",
      targetValue: "",
      targetUnit: "minor_units",
      targetDate: "",
      currentValue: "0",
      makePrimary: false,
      changeNote: "Created from the major purchase template",
    };
  }
  return {
    templateKey,
    name: "Custom goal",
    metricKey: "custom_measure",
    metricLabel: "Progress measure",
    targetValue: "",
    targetUnit: "count",
    targetDate: "",
    currentValue: "0",
    makePrimary: false,
    changeNote: "Created as a custom goal",
  };
}

function goalFormFromGoal(goal: Goal): GoalFormState {
  const version = latestGoalVersion(goal);
  return {
    templateKey: goal.templateKey,
    name: version.name,
    metricKey: version.metricKey,
    metricLabel: version.metricLabel,
    targetValue:
      version.targetUnit === "minor_units"
        ? moneyInputValue(version.targetValueInteger)
        : (version.targetValueInteger?.toString() ?? ""),
    targetUnit: version.targetUnit,
    targetDate: version.targetDate ?? "",
    currentValue:
      version.targetUnit === "minor_units"
        ? moneyInputValue(version.currentValueInteger)
        : String(version.currentValueInteger),
    makePrimary: goal.isPrimary,
    changeNote: "Updated goal inputs",
  };
}

function Goals({
  data,
  onSave,
}: {
  data: AlphaData;
  onSave: (input: GoalDraftInput) => Promise<void>;
}) {
  const initialGoal =
    data.goals.find((goal) => goal.isPrimary) ?? data.goals[0];
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
    initialGoal?.id ?? null,
  );
  const [form, setForm] = useState<GoalFormState>(() =>
    initialGoal === undefined
      ? goalFormFromTemplate(data, "financial_independence")
      : goalFormFromGoal(initialGoal),
  );
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const selectedGoal =
    data.goals.find((goal) => goal.id === selectedGoalId) ?? null;
  const parsedCurrent = parseGoalInteger(form.currentValue, form.targetUnit);
  const parsedTarget =
    form.targetValue.trim() === ""
      ? null
      : parseGoalInteger(form.targetValue, form.targetUnit);
  const previewInput = useMemo<GoalDraftInput | null>(
    () =>
      parsedCurrent === null ||
      (form.targetValue.trim() !== "" && parsedTarget === null)
        ? null
        : {
            goalId: selectedGoalId ?? undefined,
            templateKey: form.templateKey,
            name: form.name,
            metricKey: form.metricKey,
            metricLabel: form.metricLabel,
            targetValueInteger: parsedTarget,
            targetUnit: form.targetUnit,
            targetDate: form.targetDate === "" ? null : form.targetDate,
            currentValueInteger: parsedCurrent,
            makePrimary: form.makePrimary,
            changeNote: form.changeNote.trim() || "Live preview",
          },
    [
      form.changeNote,
      form.makePrimary,
      form.metricKey,
      form.metricLabel,
      form.name,
      form.targetDate,
      form.targetUnit,
      form.targetValue,
      form.templateKey,
      parsedCurrent,
      parsedTarget,
      selectedGoalId,
    ],
  );
  const preview = useMemo(() => {
    if (previewInput === null) {
      return null;
    }
    try {
      return createGoalPreview(previewInput, {
        p25FiveYearLiquidityMinor: data.dashboard.p25FiveYearLiquidityMinor,
        p50FiveYearLiquidityMinor: data.dashboard.p50FiveYearLiquidityMinor,
        p75FiveYearLiquidityMinor: data.dashboard.p75FiveYearLiquidityMinor,
        horizonDate: data.dashboard.forecastHorizonDate,
      });
    } catch {
      return null;
    }
  }, [
    data.dashboard.forecastHorizonDate,
    data.dashboard.p25FiveYearLiquidityMinor,
    data.dashboard.p50FiveYearLiquidityMinor,
    data.dashboard.p75FiveYearLiquidityMinor,
    previewInput,
  ]);

  const updateForm = <Key extends keyof GoalFormState>(
    key: Key,
    value: GoalFormState[Key],
  ) => {
    setSaveState("idle");
    setSaveMessage(null);
    setForm((current) => ({ ...current, [key]: value }));
  };

  const chooseGoal = (goal: Goal) => {
    setSelectedGoalId(goal.id);
    setForm(goalFormFromGoal(goal));
    setSaveState("idle");
    setSaveMessage(null);
  };

  const chooseTemplate = (templateKey: GoalDraftInput["templateKey"]) => {
    setSelectedGoalId(null);
    setForm(goalFormFromTemplate(data, templateKey));
    setSaveState("idle");
    setSaveMessage(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (previewInput === null || preview === null) {
      setSaveState("error");
      setSaveMessage("Check the goal values and required fields.");
      return;
    }
    if (form.changeNote.trim() === "") {
      setSaveState("error");
      setSaveMessage("Describe what changed before saving.");
      return;
    }
    const versionBeforeSave =
      selectedGoal === null ? 0 : latestGoalVersion(selectedGoal).version;
    setSaveState("saving");
    setSaveMessage(null);
    void onSave({ ...previewInput, changeNote: form.changeNote.trim() })
      .then(() => {
        setSaveState("saved");
        setSaveMessage(
          `Saved as version ${versionBeforeSave + 1} with a matching forecast snapshot.`,
        );
      })
      .catch((error: unknown) => {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? error.message
            : "The goal could not be saved.",
        );
      });
  };

  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Editable planning record</p>
          <h1>Goals</h1>
          <p>
            Keep several goals, choose one primary goal, and save changes as new
            versions. Prior versions stay available.
          </p>
        </div>
        <Badge tone="neutral">{data.goals.length} active goals</Badge>
      </div>

      <div className="goal-workspace">
        <aside className="goal-list" aria-label="Saved goals">
          <div className="goal-list__header">
            <p className="eyebrow">Saved goals</p>
            <Button onClick={() => chooseTemplate("custom")} tone="quiet">
              New goal +
            </Button>
          </div>
          {data.goals.map((goal) => {
            const version = latestGoalVersion(goal);
            return (
              <button
                aria-current={selectedGoalId === goal.id ? "true" : undefined}
                className={selectedGoalId === goal.id ? "active" : ""}
                key={goal.id}
                onClick={() => chooseGoal(goal)}
                type="button"
              >
                <span>
                  {goal.isPrimary
                    ? "Primary"
                    : templateLabels[goal.templateKey]}
                </span>
                <strong>{version.name}</strong>
                <small>
                  v{version.version} ·{" "}
                  {formatGoalValue(
                    version.currentValueInteger,
                    version.targetUnit,
                  )}
                </small>
              </button>
            );
          })}
        </aside>

        <div className="goal-main">
          <section className="goal-templates">
            <p className="eyebrow">
              {selectedGoal === null
                ? "Start from a template"
                : "Goal template"}
            </p>
            <div>
              {(
                Object.keys(templateLabels) as GoalDraftInput["templateKey"][]
              ).map((templateKey) => (
                <button
                  aria-pressed={form.templateKey === templateKey}
                  className={form.templateKey === templateKey ? "active" : ""}
                  disabled={selectedGoal !== null}
                  key={templateKey}
                  onClick={() => chooseTemplate(templateKey)}
                  type="button"
                >
                  {templateLabels[templateKey]}
                </button>
              ))}
            </div>
          </section>

          <div className="goal-edit-grid">
            <form className="goal-form" onSubmit={submit}>
              <div className="goal-form__heading">
                <div>
                  <p className="eyebrow">
                    {selectedGoal === null
                      ? "New draft"
                      : `Editing v${latestGoalVersion(selectedGoal).version}`}
                  </p>
                  <h2>
                    {selectedGoal === null
                      ? "Define the goal"
                      : "Create a new version"}
                  </h2>
                </div>
                {selectedGoal?.isPrimary === true && (
                  <Badge tone="positive">Primary</Badge>
                )}
              </div>

              <div className="goal-form__fields">
                <label className="field field--wide">
                  <span>Goal name</span>
                  <input
                    maxLength={120}
                    onChange={(event) => updateForm("name", event.target.value)}
                    required
                    value={form.name}
                  />
                </label>
                <label className="field field--wide">
                  <span>How success is measured</span>
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      updateForm("metricLabel", event.target.value)
                    }
                    required
                    value={form.metricLabel}
                  />
                </label>
                <label className="field">
                  <span>Unit</span>
                  <select
                    disabled={form.templateKey !== "custom"}
                    onChange={(event) =>
                      updateForm("targetUnit", event.target.value as GoalUnit)
                    }
                    value={form.targetUnit}
                  >
                    <option value="minor_units">USD</option>
                    <option value="months">Months</option>
                    <option value="count">Count</option>
                    <option value="ppm">Percentage</option>
                  </select>
                </label>
                <label className="field">
                  <span>Current value</span>
                  <div className="field__value">
                    {form.targetUnit === "minor_units" && <i>$</i>}
                    <input
                      inputMode="decimal"
                      onChange={(event) =>
                        updateForm("currentValue", event.target.value)
                      }
                      required
                      value={form.currentValue}
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Target value · optional</span>
                  <div className="field__value">
                    {form.targetUnit === "minor_units" && <i>$</i>}
                    <input
                      inputMode="decimal"
                      onChange={(event) =>
                        updateForm("targetValue", event.target.value)
                      }
                      value={form.targetValue}
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Target date · optional</span>
                  <input
                    onChange={(event) =>
                      updateForm("targetDate", event.target.value)
                    }
                    type="date"
                    value={form.targetDate}
                  />
                </label>
                <label className="field field--wide">
                  <span>What changed</span>
                  <input
                    maxLength={500}
                    onChange={(event) =>
                      updateForm("changeNote", event.target.value)
                    }
                    required
                    value={form.changeNote}
                  />
                </label>
              </div>

              <label className="primary-toggle">
                <input
                  checked={form.makePrimary}
                  disabled={selectedGoal?.isPrimary === true}
                  onChange={(event) =>
                    updateForm("makePrimary", event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Make this the primary goal</strong>
                  <small>The Overview will lead with this goal.</small>
                </span>
              </label>

              {saveMessage !== null && (
                <p
                  className={
                    saveState === "error"
                      ? "form-message error"
                      : "form-message"
                  }
                  role={saveState === "error" ? "alert" : "status"}
                >
                  {saveMessage}
                </p>
              )}
              <div className="goal-form__actions">
                <Button
                  disabled={saveState === "saving"}
                  tone="primary"
                  type="submit"
                >
                  {saveState === "saving"
                    ? "Saving…"
                    : selectedGoal === null
                      ? "Save new goal"
                      : "Save new version"}
                </Button>
                <span>Goal version and forecast snapshot save together.</span>
              </div>
            </form>

            <aside className="goal-preview" aria-live="polite">
              <p className="eyebrow">Live preview</p>
              {preview === null ? (
                <EmptyState title="Preview unavailable">
                  Enter a valid current value and complete the required fields.
                </EmptyState>
              ) : (
                <>
                  <h2>{form.name || "Untitled goal"}</h2>
                  <div className="goal-preview__measure">
                    <span>{form.metricLabel || "Progress measure"}</span>
                    <strong>
                      {formatGoalValue(
                        preview.currentValueInteger,
                        form.targetUnit,
                      )}
                    </strong>
                    <small>
                      {preview.targetValueInteger === null
                        ? "No target set"
                        : `${formatProbability(
                            preview.progressPpm ?? 0,
                          )} of ${formatGoalValue(
                            preview.targetValueInteger,
                            form.targetUnit,
                          )}`}
                    </small>
                  </div>
                  {preview.modelStatus === "modeled" ? (
                    <>
                      <div className="goal-preview__outcomes">
                        {[
                          ["Lower", preview.lowerValueInteger],
                          ["Middle", preview.middleValueInteger],
                          ["Higher", preview.higherValueInteger],
                        ].map(([label, value]) => (
                          <span key={label}>
                            {label}
                            <b>
                              {typeof value === "number"
                                ? formatGoalValue(value, form.targetUnit)
                                : "—"}
                            </b>
                          </span>
                        ))}
                      </div>
                      <div className="goal-preview__signal">
                        <span>Estimated success</span>
                        <strong>
                          {preview.successProbabilityPpm === null
                            ? "Target needed"
                            : formatProbability(preview.successProbabilityPpm)}
                        </strong>
                      </div>
                    </>
                  ) : (
                    <div className="goal-preview__notice">
                      <strong>Forecast not configured</strong>
                      <span>
                        Progress can be saved now. A projected range needs
                        scenario inputs for this goal.
                      </span>
                    </div>
                  )}
                  <p className="panel-note">{preview.methodology}</p>
                </>
              )}
            </aside>
          </div>

          {selectedGoal !== null && (
            <section className="goal-version-history">
              <p className="eyebrow">Version history</p>
              <h2>Prior decisions stay visible</h2>
              <div>
                {selectedGoal.versions.map((version) => (
                  <article key={version.id}>
                    <span>v{version.version}</span>
                    <div>
                      <strong>{version.changeNote}</strong>
                      <small>
                        {formatDate(version.createdAt)} · {version.createdBy}
                      </small>
                    </div>
                    <Badge
                      tone={
                        version.forecast.modelStatus === "modeled"
                          ? "positive"
                          : "neutral"
                      }
                    >
                      {version.forecast.modelStatus === "modeled"
                        ? "Modeled"
                        : "Progress only"}
                    </Badge>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

const HOLDING_IMPORT_PAGE_SIZE = 10;

function holdingValueLabel(value: number | null): string {
  return value === null ? "Not set" : formatCompactMoney(value);
}

function administratorValueLabel(holding: Holding): string {
  if (holding.administratorNavState === "locked") {
    return holding.sourceLabel === "AngelList export"
      ? "Locked by AngelList"
      : `Locked by ${holding.sourceLabel}`;
  }
  return holdingValueLabel(holding.administratorNavMinor);
}

function isRobinhoodHolding(holding: Holding): boolean {
  return holding.sourceLabel === "Robinhood via Plaid";
}

function holdingPrimaryName(holding: Holding): string {
  return holding.exposureName ?? holding.positionName;
}

function holdingKindLabel(holding: Holding): string {
  return {
    direct: "Direct holding",
    spv_interest: "SPV interest",
    fund_interest: "Fund interest",
  }[holding.positionKind];
}

function holdingLegalPositionLabel(holding: Holding): string {
  if (holding.positionKind === "direct") {
    return "Direct position";
  }
  return holding.positionKind === "spv_interest"
    ? "Legal SPV"
    : "Legal fund position";
}

function importAdministratorValueLabel(
  row: HoldingImportRowPreview,
  provider: HoldingImportPreview["provider"],
): string {
  if (row.administratorNavState === "locked") {
    return "Locked by AngelList";
  }
  if (row.administratorNavState === "not_reported") {
    return provider === "robinhood" ? "Not available" : "Not reported";
  }
  return holdingValueLabel(row.administratorNavMinor);
}

function formatQuantityMicros(value: number | null): string {
  if (value === null) {
    return "Not reported";
  }
  const micros = BigInt(value);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/u, "");
  return fraction.length === 0
    ? whole.toLocaleString("en-US")
    : `${whole.toLocaleString("en-US")}.${fraction}`;
}

function importActionLabel(action: HoldingImportRowPreview["action"]): string {
  return {
    create_position: "New",
    append_snapshot: "Matched",
    no_change: "No changes",
    needs_attention: "Needs attention",
  }[action];
}

function importDecisionForRow(
  row: HoldingImportRowPreview,
  provider: HoldingImportPreview["provider"],
): HoldingImportApplyInput["decisions"][number] {
  if (row.action === "needs_attention") {
    return {
      rowId: row.id,
      decision: "rejected",
      rationale: "Excluded because the imported position needs attention.",
    };
  }
  return {
    rowId: row.id,
    decision: "accepted",
    rationale:
      row.action === "no_change"
        ? "Reviewed; no accepted holding change was required."
        : `Accepted during the ${provider === "robinhood" ? "Robinhood" : "AngelList"} holdings import review.`,
  };
}

function ImportResult({ row }: { row: HoldingImportRowPreview }) {
  const label =
    row.adjudicationStatus === "auto_applied"
      ? "Applied automatically"
      : row.adjudicationStatus === "quarantined"
        ? "Isolated"
        : importActionLabel(row.action);
  return (
    <div className={`import-result import-result--${row.action}`}>
      {row.adjudicationStatus === "quarantined" ||
      row.action === "needs_attention" ? (
        <Badge tone="warning">{label}</Badge>
      ) : (
        <strong>{label}</strong>
      )}
      {row.issues.length > 0 && <small>{row.issues.join(" · ")}</small>}
    </div>
  );
}

function HoldingImportWorkspace({
  initialPreview = null,
  onApply,
  onClose,
  onPreview,
}: {
  initialPreview?: HoldingImportPreview | null;
  onApply: (
    importId: string,
    input: HoldingImportApplyInput,
  ) => Promise<HoldingImportApplyResult>;
  onClose: () => void;
  onPreview: (file: File) => Promise<HoldingImportPreview>;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<HoldingImportPreview | null>(
    initialPreview,
  );
  const [applyResult, setApplyResult] =
    useState<HoldingImportApplyResult | null>(null);
  const [working, setWorking] = useState<"idle" | "previewing" | "applying">(
    "idle",
  );
  const [confirming, setConfirming] = useState(false);
  const [currencyConfirmed, setCurrencyConfirmed] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const provider = preview?.provider ?? "angellist";
  const providerName = provider === "robinhood" ? "Robinhood" : "AngelList";
  const isRobinhood = provider === "robinhood";

  useEffect(() => {
    workspaceHeadingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (confirming) {
      confirmationHeadingRef.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (error !== null || applyResult !== null) {
      messageRef.current?.focus();
    }
  }, [applyResult, error]);

  const resetFile = () => {
    setSelectedFile(null);
    setPreview(null);
    setApplyResult(null);
    setConfirming(false);
    setCurrencyConfirmed(false);
    setError(null);
    setPage(0);
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = "";
    }
    window.requestAnimationFrame(() => fileInputRef.current?.focus());
  };

  const requestPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selectedFile === null) {
      setError("Choose an AngelList investments CSV export to continue.");
      return;
    }
    setWorking("previewing");
    setError(null);
    void onPreview(selectedFile)
      .then((nextPreview) => {
        setPreview(nextPreview);
        setPage(0);
        window.requestAnimationFrame(() =>
          workspaceHeadingRef.current?.focus(),
        );
      })
      .catch((previewError: unknown) => {
        setError(
          previewError instanceof Error
            ? previewError.message
            : "This file could not be reviewed. Choose an AngelList investments CSV export.",
        );
      })
      .finally(() => setWorking("idle"));
  };

  const applyPreview = () => {
    if (preview === null || !currencyConfirmed) {
      return;
    }
    setWorking("applying");
    setError(null);
    void onApply(preview.id, {
      currency: "USD",
      decisions: preview.rows
        .filter((row) => row.adjudicationStatus === "pending_review")
        .map((row) => importDecisionForRow(row, preview.provider)),
    })
      .then((result) => {
        setApplyResult(result);
        setConfirming(false);
      })
      .catch((applyError: unknown) => {
        setError(
          applyError instanceof Error
            ? applyError.message
            : `Nothing changed. The ${providerName} import could not be applied.`,
        );
      })
      .finally(() => setWorking("idle"));
  };

  if (applyResult !== null && preview !== null) {
    const changedCount = applyResult.createdCount + applyResult.updatedCount;
    return (
      <section
        aria-labelledby="holding-import-success-title"
        className="holding-import-workspace"
      >
        <div
          className="import-message import-message--success"
          ref={messageRef}
          role="status"
          tabIndex={-1}
        >
          <p className="eyebrow">
            {isRobinhood ? "Automatic update" : "Import reviewed"}
          </p>
          <h2 id="holding-import-success-title">
            {changedCount === 0
              ? "No holdings changed"
              : `${changedCount} ${changedCount === 1 ? "change" : "changes"} applied`}
          </h2>
          {isRobinhood ? (
            <p>
              Reviewed {preview.summary.rowCount} Robinhood positions.{" "}
              {preview.summary.administratorValueCount} market values were
              recorded from this snapshot.
            </p>
          ) : (
            <p>
              Reviewed {preview.summary.rowCount} AngelList positions.{" "}
              {preview.summary.administratorValueCount} administrator values
              were available; {applyResult.lockedValueCount} locked values
              remain unavailable.
            </p>
          )}
          {applyResult.rejectedCount > 0 && (
            <small>
              {applyResult.rejectedCount}{" "}
              {applyResult.rejectedCount === 1
                ? "position was"
                : "positions were"}{" "}
              excluded because they need attention.
            </small>
          )}
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </div>
      </section>
    );
  }

  if (preview === null) {
    return (
      <section
        aria-busy={working === "previewing"}
        aria-labelledby="holding-import-title"
        className="holding-import-workspace"
      >
        <div className="import-heading">
          <p className="eyebrow">AngelList CSV</p>
          <h2 id="holding-import-title" ref={workspaceHeadingRef} tabIndex={-1}>
            Import from AngelList
          </h2>
          <p id="holding-import-boundary">
            Choose your AngelList investments CSV export. Nothing changes until
            you review it.
          </p>
        </div>
        <form className="import-upload" onSubmit={requestPreview}>
          <label className="field" htmlFor="angellist-import-file">
            <span>AngelList CSV export</span>
            <input
              accept=".csv,text/csv"
              aria-describedby={`holding-import-boundary${error === null ? "" : " holding-import-error"}`}
              aria-invalid={error === null ? undefined : true}
              disabled={working !== "idle"}
              id="angellist-import-file"
              onChange={(event) => {
                setSelectedFile(event.currentTarget.files?.[0] ?? null);
                setCurrencyConfirmed(false);
                setError(null);
              }}
              ref={fileInputRef}
              type="file"
            />
          </label>
          {error !== null && (
            <div
              className="inline-error"
              id="holding-import-error"
              ref={messageRef}
              role="alert"
              tabIndex={-1}
            >
              {error}
            </div>
          )}
          <div className="import-actions">
            <Button
              disabled={working !== "idle"}
              onClick={onClose}
              tone="quiet"
            >
              Cancel
            </Button>
            <Button disabled={working !== "idle"} tone="primary" type="submit">
              {working === "previewing" ? "Reading…" : "Review file"}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  if (isRobinhood && preview.status === "quarantined") {
    const exceptionRows = preview.rows.filter(
      (row) => row.adjudicationStatus === "quarantined",
    );
    return (
      <section
        aria-labelledby="holding-import-exceptions-title"
        className="holding-import-workspace"
      >
        <div className="import-heading">
          <p className="eyebrow">Robinhood exceptions</p>
          <h2
            id="holding-import-exceptions-title"
            ref={workspaceHeadingRef}
            tabIndex={-1}
          >
            Uncertain records stayed unchanged
          </h2>
          <p>
            Keel applied {preview.summary.autoAppliedCount} clear{" "}
            {preview.summary.autoAppliedCount === 1 ? "position" : "positions"}.
            The exceptions below were isolated from your accepted holdings.
          </p>
        </div>

        <div aria-label="Automatic review summary" className="import-summary">
          <div>
            <strong>{preview.summary.autoAppliedCount}</strong>
            <span>Applied</span>
          </div>
          <div>
            <strong>{preview.summary.quarantinedCount}</strong>
            <span>Exceptions</span>
          </div>
          <div>
            <strong>{preview.summary.preservedPositionCount}</strong>
            <span>Prior positions kept</span>
          </div>
        </div>

        {preview.summary.preservedPositionCount > 0 && (
          <p className="import-attention" role="status">
            Robinhood did not report {preview.summary.preservedPositionCount}{" "}
            prior{" "}
            {preview.summary.preservedPositionCount === 1
              ? "position"
              : "positions"}
            . Keel kept the last accepted values and did not infer sales.
          </p>
        )}

        {exceptionRows.length > 0 && (
          <Panel className="table-panel import-table-panel">
            <div className="holdings-table-wrap">
              <table className="data-table import-table">
                <caption className="visually-hidden">
                  Isolated Robinhood positions
                </caption>
                <thead>
                  <tr>
                    <th>Security</th>
                    <th>Account</th>
                    <th>Shares</th>
                    <th>Market value</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {exceptionRows.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Security">
                        <strong>{row.exposureName}</strong>
                        <span>{row.ticker ?? "Ticker not reported"}</span>
                      </td>
                      <td data-label="Account">{row.ownerLabel}</td>
                      <td data-label="Shares">
                        {formatQuantityMicros(row.quantityMicros)}
                      </td>
                      <td data-label="Market value">
                        {importAdministratorValueLabel(row, preview.provider)}
                      </td>
                      <td data-label="Result">
                        <ImportResult row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <div className="import-actions">
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </div>
      </section>
    );
  }

  if (isRobinhood && preview.status === "pending_review") {
    return (
      <section
        aria-labelledby="holding-import-checking-title"
        className="holding-import-workspace"
      >
        <div className="import-heading">
          <p className="eyebrow">Robinhood update</p>
          <h2
            id="holding-import-checking-title"
            ref={workspaceHeadingRef}
            tabIndex={-1}
          >
            Automatic review is still running
          </h2>
          <p>
            Your accepted holdings have not been changed by this update yet.
          </p>
        </div>
        <div className="import-actions">
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </div>
      </section>
    );
  }

  if (preview.status === "applied") {
    return (
      <section
        aria-labelledby="holding-import-reviewed-title"
        className="holding-import-workspace"
      >
        <div className="import-heading">
          <p className="eyebrow">Import reviewed</p>
          <h2
            id="holding-import-reviewed-title"
            ref={workspaceHeadingRef}
            tabIndex={-1}
          >
            This {providerName} update is already recorded
          </h2>
          <p>
            {isRobinhood ? (
              <>
                Keel applied {preview.summary.autoAppliedCount} clear positions
                from the {formatDate(preview.observedAt)} snapshot.
              </>
            ) : (
              <>
                Reviewed {preview.summary.rowCount} positions from the export
                dated {formatDate(preview.observedAt)}.
              </>
            )}
          </p>
        </div>
        <div className="import-actions">
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </div>
      </section>
    );
  }

  const pageCount = Math.max(
    1,
    Math.ceil(preview.rows.length / HOLDING_IMPORT_PAGE_SIZE),
  );
  const pageStart = page * HOLDING_IMPORT_PAGE_SIZE;
  const visibleRows = preview.rows.slice(
    pageStart,
    pageStart + HOLDING_IMPORT_PAGE_SIZE,
  );
  const pageEnd = Math.min(
    pageStart + HOLDING_IMPORT_PAGE_SIZE,
    preview.rows.length,
  );
  const changeCount = preview.summary.createCount + preview.summary.updateCount;
  const readyCount =
    preview.summary.rowCount - preview.summary.needsAttentionCount;
  const primaryActionLabel = `Apply ${readyCount} ${readyCount === 1 ? "position" : "positions"}`;

  return (
    <section
      aria-busy={working === "applying"}
      aria-labelledby="holding-import-title"
      className="holding-import-workspace"
    >
      <div className="import-heading">
        <p className="eyebrow">
          {isRobinhood ? "Robinhood sync" : "AngelList CSV"}
        </p>
        <h2 id="holding-import-title" ref={workspaceHeadingRef} tabIndex={-1}>
          Review {providerName} import
        </h2>
        {isRobinhood ? (
          <p>
            Snapshot dated {formatDate(preview.observedAt)}. Positions missing
            from this snapshot are not treated as sales.
          </p>
        ) : (
          <p>
            Export dated {formatDate(preview.observedAt)}. Locked values stay
            unavailable; Keel will not treat them as zero.
          </p>
        )}
      </div>

      <div aria-label="Import summary" className="import-summary">
        <div>
          <strong>{preview.summary.rowCount}</strong>
          <span>Positions</span>
        </div>
        <div>
          <strong>{preview.summary.administratorValueCount}</strong>
          <span>{isRobinhood ? "Market values" : "Administrator values"}</span>
        </div>
        <div>
          <strong>
            {isRobinhood
              ? preview.summary.needsAttentionCount
              : preview.summary.lockedValueCount}
          </strong>
          <span>{isRobinhood ? "Need attention" : "Locked values"}</span>
        </div>
      </div>

      {preview.summary.needsAttentionCount > 0 && (
        <p className="import-attention" role="status">
          {preview.summary.needsAttentionCount}{" "}
          {preview.summary.needsAttentionCount === 1
            ? "position needs"
            : "positions need"}{" "}
          attention and will not be applied.
        </p>
      )}

      {error !== null && (
        <div
          className="inline-error"
          ref={messageRef}
          role="alert"
          tabIndex={-1}
        >
          {error} Nothing changed. Try again.
        </div>
      )}

      <Panel className="table-panel import-table-panel">
        <div className="holdings-table-wrap">
          <table className="data-table import-table">
            <caption className="visually-hidden">
              {providerName} positions ready for review
            </caption>
            <thead>
              {isRobinhood ? (
                <tr>
                  <th>Security</th>
                  <th>Account</th>
                  <th>Shares</th>
                  <th>Cost basis</th>
                  <th>Market value</th>
                  <th>Import result</th>
                </tr>
              ) : (
                <tr>
                  <th>Investment / legal position</th>
                  <th>Entity</th>
                  <th>Status</th>
                  <th>Invested</th>
                  <th>Realized</th>
                  <th>Admin value</th>
                  <th>Import result</th>
                </tr>
              )}
            </thead>
            <tbody>
              {visibleRows.map((row) =>
                isRobinhood ? (
                  <tr key={row.id}>
                    <td data-label="Security">
                      <strong>{row.exposureName}</strong>
                      <span>{row.ticker ?? "Ticker not reported"}</span>
                    </td>
                    <td data-label="Account">{row.ownerLabel}</td>
                    <td data-label="Shares">
                      {formatQuantityMicros(row.quantityMicros)}
                    </td>
                    <td data-label="Cost basis">
                      {holdingValueLabel(row.costBasisMinor)}
                    </td>
                    <td data-label="Market value">
                      {importAdministratorValueLabel(row, preview.provider)}
                    </td>
                    <td data-label="Import result">
                      <ImportResult row={row} />
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id}>
                    <td data-label="Investment / legal position">
                      <strong>{row.exposureName}</strong>
                      <span>Legal position: {row.positionName}</span>
                    </td>
                    <td data-label="Entity">{row.ownerLabel}</td>
                    <td data-label="Status">
                      <strong>{row.providerStatus}</strong>
                      <span className="source-meta">
                        Invested {formatDate(row.investedOn)}
                      </span>
                    </td>
                    <td data-label="Invested">
                      {formatCompactMoney(row.investedMinor)}
                    </td>
                    <td data-label="Realized">
                      {formatCompactMoney(row.realizedValueMinor)}
                    </td>
                    <td
                      className={
                        row.administratorNavState === "locked"
                          ? "import-value--locked"
                          : undefined
                      }
                      data-label="Admin value"
                    >
                      {importAdministratorValueLabel(row, preview.provider)}
                    </td>
                    <td data-label="Import result">
                      <ImportResult row={row} />
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <nav aria-label="Import preview pages" className="import-pagination">
        <span>
          {pageStart + 1}–{pageEnd} of {preview.rows.length}
        </span>
        <div>
          <Button
            aria-label="Previous import preview page"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            tone="quiet"
          >
            Previous
          </Button>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <Button
            aria-label="Next import preview page"
            disabled={page + 1 >= pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
            tone="quiet"
          >
            Next
          </Button>
        </div>
      </nav>

      <label className="import-currency-confirmation">
        <input
          checked={currencyConfirmed}
          onChange={(event) =>
            setCurrencyConfirmed(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>
          I confirm the {isRobinhood ? "Robinhood" : "export’s"} $ values are
          USD.
        </span>
      </label>

      {confirming ? (
        <div
          aria-labelledby="holding-import-confirmation-title"
          className="import-confirmation"
        >
          <div>
            <p className="eyebrow">Final review</p>
            <h3
              id="holding-import-confirmation-title"
              ref={confirmationHeadingRef}
              tabIndex={-1}
            >
              Apply the reviewed import?
            </h3>
            {isRobinhood ? (
              <p>
                Create {preview.summary.createCount}, update{" "}
                {preview.summary.updateCount}, and confirm{" "}
                {preview.summary.unchangedCount} unchanged. Missing positions
                will not be recorded as sales. No forecast, underwriting value,
                or usable liquidity will be inferred.
              </p>
            ) : (
              <p>
                Create {preview.summary.createCount}, update{" "}
                {preview.summary.updateCount}, and confirm{" "}
                {preview.summary.unchangedCount} unchanged.{" "}
                {preview.summary.lockedValueCount} locked values will remain
                unavailable. No forecast, underwriting value, or liquidity value
                will be inferred.
              </p>
            )}
            {preview.summary.needsAttentionCount > 0 && (
              <small>
                {preview.summary.needsAttentionCount}{" "}
                {preview.summary.needsAttentionCount === 1
                  ? "position is"
                  : "positions are"}{" "}
                excluded because they need attention.
              </small>
            )}
          </div>
          <div>
            <Button
              disabled={working !== "idle" || !currencyConfirmed}
              onClick={() => setConfirming(false)}
              tone="quiet"
            >
              Back
            </Button>
            <Button
              disabled={working !== "idle" || !currencyConfirmed}
              onClick={applyPreview}
              tone="primary"
            >
              {working === "applying"
                ? "Applying…"
                : changeCount === 0
                  ? "Confirm review"
                  : "Confirm & apply"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="import-footer">
          <div>
            <strong>{readyCount} positions reviewed</strong>
            <span>Every row receives an explicit review decision.</span>
          </div>
          <div>
            <Button
              onClick={initialPreview === null ? resetFile : onClose}
              tone="quiet"
            >
              {initialPreview === null ? "Choose another file" : "Back"}
            </Button>
            <Button
              disabled={!currencyConfirmed}
              onClick={() => setConfirming(true)}
              tone="primary"
            >
              {primaryActionLabel}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function HoldingDetailWorkspace({ holding }: { holding: Holding }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const primaryName = holdingPrimaryName(holding);
  const legalPositionLabel = holdingLegalPositionLabel(holding);
  const sourceSectionTitle = isRobinhoodHolding(holding)
    ? "Brokerage source"
    : holding.externalMarkMinor === null
      ? "Administrator source"
      : "External mark source";
  const valueLenses = [
    {
      label: isRobinhoodHolding(holding) ? "Market value" : "Administrator NAV",
      value: administratorValueLabel(holding),
      helper: isRobinhoodHolding(holding)
        ? "Brokerage-reported market value as of the source date."
        : holding.administratorNavState === "locked" &&
            holding.sourceLabel === "AngelList export"
          ? "AngelList did not disclose this value in the export."
          : "Administrator-reported value as of the source date.",
      wide: holding.administratorNavState === "locked",
    },
    {
      label: "External mark",
      value: holdingValueLabel(holding.externalMarkMinor),
      helper: "Latest observed third-party economic mark.",
      wide: false,
    },
    {
      label: "FI planning value",
      value: holdingValueLabel(holding.underwritingValueMinor),
      helper: "Conservative value allowed into FI planning.",
      wide: false,
    },
    {
      label: "Scenario value",
      value: holdingValueLabel(holding.scenarioValueMinor),
      helper: "Thesis-weighted conditional economic value.",
      wide: false,
    },
    {
      label: "Usable liquidity",
      value: holdingValueLabel(holding.usableLiquidityMinor),
      helper: "Capital currently available for actual decisions.",
      wide: false,
    },
  ] as const;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      aria-labelledby="holding-detail-title"
      className="holding-detail-workspace"
    >
      <header className="holding-detail-heading">
        <p className="eyebrow">Holding detail</p>
        <h2 id="holding-detail-title" ref={headingRef} tabIndex={-1}>
          {primaryName}
        </h2>
        <p>
          {holding.exposureName === null
            ? holdingKindLabel(holding)
            : holding.positionKind === "direct"
              ? "Direct position"
              : `Via ${holding.positionName}`}
        </p>
      </header>

      <section aria-labelledby="holding-values-title">
        <p className="eyebrow">Value lenses</p>
        <h3 id="holding-values-title">Current values</h3>
        <div className="holding-detail-values">
          {valueLenses.map((lens) => (
            <article
              className={
                lens.wide
                  ? "holding-detail-value holding-detail-value--wide"
                  : "holding-detail-value"
              }
              key={lens.label}
            >
              <span>{lens.label}</span>
              <strong className={lens.value === "Not set" ? "is-not-set" : ""}>
                {lens.value}
              </strong>
              <small>{lens.helper}</small>
            </article>
          ))}
        </div>
      </section>

      <div className="holding-detail-records">
        <section aria-labelledby="holding-position-title">
          <p className="eyebrow">Accepted record</p>
          <h3 id="holding-position-title">Position</h3>
          <dl>
            <div>
              <dt>{legalPositionLabel}</dt>
              <dd>{holding.positionName}</dd>
            </div>
            <div>
              <dt>Held through</dt>
              <dd>{holding.ownerLabel}</dd>
            </div>
            {isRobinhoodHolding(holding) && (
              <>
                <div>
                  <dt>Ticker</dt>
                  <dd>{holding.ticker ?? "Not reported"}</dd>
                </div>
                <div>
                  <dt>Shares</dt>
                  <dd>{formatQuantityMicros(holding.quantityMicros)}</dd>
                </div>
                <div>
                  <dt>Cost basis</dt>
                  <dd>{holdingValueLabel(holding.costBasisMinor)}</dd>
                </div>
              </>
            )}
          </dl>
        </section>

        <section aria-labelledby="holding-source-title">
          <p className="eyebrow">Value evidence</p>
          <h3 id="holding-source-title">{sourceSectionTitle}</h3>
          <dl>
            <div>
              <dt>Source</dt>
              <dd>{holding.sourceLabel}</dd>
            </div>
            <div>
              <dt>As of</dt>
              <dd>{formatDate(holding.effectiveDate)}</dd>
            </div>
            {holding.confidencePpm !== null && (
              <div>
                <dt>Source confidence</dt>
                <dd>{formatProbability(holding.confidencePpm)}</dd>
              </div>
            )}
            {holding.sourceStatus !== "verified" && (
              <div>
                <dt>Source status</dt>
                <dd>
                  <SourceBadge status={holding.sourceStatus} />
                </dd>
              </div>
            )}
          </dl>
        </section>
      </div>
    </section>
  );
}

function angelListAgentMessage(overview: AngelListMacAgentOverview | null): {
  title: string;
  description: string;
} {
  if (overview === null) {
    return {
      title: "Checking AngelList updates",
      description: "Keel is checking whether your Mac is ready.",
    };
  }
  if (overview.status === "setup_required") {
    return {
      title: "Finish setup on your Mac",
      description:
        "Run the one-time setup command on your Mac, then sign in to Keel and AngelList. Keel will check for work once a day.",
    };
  }
  if (overview.status === "offline") {
    return {
      title: "Daily Mac check is overdue",
      description:
        "Wake your Mac or rerun setup. Queued updates will wait safely for the next check.",
    };
  }
  if (overview.status === "running") {
    return overview.runStatus === "queued"
      ? {
          title: "AngelList update is queued",
          description:
            "Your Mac will pick it up at its next daily check. Use the local run command on your Mac if you need it sooner.",
        }
      : {
          title: "Importing AngelList CSV",
          description:
            "Your Mac is downloading the latest CSV. It will still wait for your review in Keel.",
        };
  }
  if (overview.status === "needs_attention") {
    if (overview.errorCode === "angellist_sign_in_required") {
      return {
        title: "AngelList needs attention on your Mac",
        description:
          "Open the dedicated Chrome window on your Mac and finish signing in to AngelList.",
      };
    }
    if (overview.errorCode === "keel_sign_in_required") {
      return {
        title: "Keel needs attention on your Mac",
        description:
          "Open the dedicated Chrome window on your Mac and finish signing in to Keel.",
      };
    }
    if (overview.errorCode === "export_unavailable") {
      return {
        title: "AngelList export needs attention",
        description:
          "Open AngelList on your Mac and confirm the read-only account can see Export CSV.",
      };
    }
    return {
      title: "AngelList update needs attention",
      description:
        "Open the dedicated Chrome window on your Mac, then run the update again.",
    };
  }
  return {
    title: "AngelList updates are ready",
    description:
      "Your Mac checks daily. Exports follow the interval below. Every CSV still waits for your review.",
  };
}

function AngelListMacAgentControl() {
  const [overview, setOverview] = useState<AngelListMacAgentOverview | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "copy" | "interval" | "run" | null
  >(null);

  const reload = useCallback(async () => {
    try {
      setOverview(await loadAngelListAutomationOverview());
      setError(null);
    } catch {
      setError("Keel could not check AngelList updates. Try again shortly.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [reload]);

  const setupCommand = `pnpm angellist:setup -- --keel-url ${window.location.origin}`;
  const message = angelListAgentMessage(overview);
  const setupRequired = overview?.status === "setup_required";
  const running = overview?.status === "running";

  const copySetupCommand = async () => {
    setBusyAction("copy");
    setError(null);
    try {
      await navigator.clipboard.writeText(setupCommand);
      setNotice("Mac setup command copied.");
    } catch {
      setError("Copy was blocked. Select and copy the command below.");
    } finally {
      setBusyAction(null);
    }
  };

  const changeInterval = async (interval: AngelListMacAgentInterval) => {
    setBusyAction("interval");
    setError(null);
    setNotice(null);
    try {
      setOverview(await configureAngelListMacAgent({ interval }));
      setNotice(
        interval === "off"
          ? "Automatic updates are off."
          : `AngelList will update ${interval}.`,
      );
    } catch {
      setError("Keel could not save that interval. Try again.");
    } finally {
      setBusyAction(null);
    }
  };

  const runNow = async () => {
    setBusyAction("run");
    setError(null);
    setNotice(null);
    try {
      const requested = await requestAngelListUpdate();
      setOverview((current) =>
        current === null
          ? current
          : {
              ...current,
              status: "running",
              runStatus: requested.status,
            },
      );
      setNotice("AngelList update queued for your Mac’s next daily check.");
      window.setTimeout(() => void reload(), 1_000);
    } catch {
      setError("Keel could not request an AngelList update. Try again.");
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section
      aria-labelledby="angellist-agent-title"
      className="angellist-agent"
    >
      <div className="angellist-agent__heading">
        <p className="eyebrow">AngelList updates</p>
        <h2 id="angellist-agent-title">{message.title}</h2>
        <p>{message.description}</p>
      </div>

      <div className="angellist-agent__action" aria-live="polite">
        {overview === null && error === null ? (
          <span className="angellist-agent__checking" role="status">
            Checking…
          </span>
        ) : setupRequired ? (
          <div className="angellist-agent__setup">
            <Button
              disabled={busyAction !== null}
              onClick={() => void copySetupCommand()}
              tone="primary"
            >
              {busyAction === "copy" ? "Copying…" : "Copy Mac setup command"}
            </Button>
            <code>{setupCommand}</code>
            <small>
              The dedicated Chrome profile stays on your Mac. Keel checks once a
              day and receives only the CSV export.
            </small>
          </div>
        ) : (
          <div className="angellist-agent__controls">
            <label htmlFor="angellist-update-interval">
              <span>Automatic updates</span>
              <select
                disabled={busyAction !== null}
                id="angellist-update-interval"
                onChange={(event) =>
                  void changeInterval(
                    event.currentTarget.value as AngelListMacAgentInterval,
                  )
                }
                value={overview?.interval ?? "weekly"}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="off">Off</option>
              </select>
            </label>
            <Button
              disabled={busyAction !== null || running}
              onClick={() => void runNow()}
              tone="primary"
            >
              {busyAction === "run"
                ? "Requesting…"
                : running
                  ? overview?.runStatus === "queued"
                    ? "Update queued"
                    : "Update in progress"
                  : "Queue update"}
            </Button>
          </div>
        )}

        {overview !== null && !setupRequired && (
          <dl className="angellist-agent__meta">
            <div>
              <dt>Last Mac check</dt>
              <dd>
                {overview.lastSeenAt === null
                  ? "Not yet"
                  : formatDate(overview.lastSeenAt)}
              </dd>
            </div>
            <div>
              <dt>Last completed</dt>
              <dd>
                {overview.lastCompletedAt === null
                  ? "Not yet"
                  : formatDate(overview.lastCompletedAt)}
              </dd>
            </div>
            <div>
              <dt>Next scheduled</dt>
              <dd>
                {overview.nextRunAt === null
                  ? "Off"
                  : formatDate(overview.nextRunAt)}
              </dd>
            </div>
          </dl>
        )}

        {notice !== null && (
          <p className="angellist-agent__notice" role="status">
            {notice}
          </p>
        )}
        {error !== null && (
          <p className="angellist-agent__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

const ANGELLIST_REFRESH_STORAGE_KEY = "keel.angellistSignInRefreshId";

function rememberedAngelListRefresh(): string | null {
  try {
    return window.sessionStorage.getItem(ANGELLIST_REFRESH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberAngelListRefresh(refreshId: string | null) {
  try {
    if (refreshId === null) {
      window.sessionStorage.removeItem(ANGELLIST_REFRESH_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(ANGELLIST_REFRESH_STORAGE_KEY, refreshId);
    }
  } catch {
    // The refresh still works when private browsing disables sessionStorage.
  }
}

function AngelListBrowserRunControl() {
  const [overview, setOverview] = useState<AngelListAutomationOverview | null>(
    null,
  );
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<AngelListSignInRefresh | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [handoffInput, setHandoffInput] = useState("");
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState("");
  const [busyAction, setBusyAction] = useState<
    "start" | "handoff_input" | "magic_link" | "cancel" | null
  >(null);

  const reloadOverview = useCallback(async () => {
    try {
      setOverview(await loadLegacyAngelListAutomationOverview());
      setOverviewError(null);
    } catch (error) {
      setOverviewError(
        error instanceof Error
          ? error.message
          : "Keel could not check AngelList sign-in.",
      );
    }
  }, []);

  const acceptRefresh = useCallback(
    (next: AngelListSignInRefresh) => {
      setRefresh((current) =>
        next.status === "waiting_for_sign_in" &&
        next.liveViewUrl === null &&
        current?.id === next.id
          ? {
              ...next,
              liveViewUrl: current.liveViewUrl,
              liveViewExpiresAt: current.liveViewExpiresAt,
            }
          : next,
      );
      setRefreshError(null);
      if (next.status === "waiting_for_sign_in") {
        rememberAngelListRefresh(next.id);
      } else {
        rememberAngelListRefresh(null);
      }
      if (next.status === "connected") {
        void reloadOverview();
      }
      if (next.status !== "waiting_for_sign_in") {
        setHandoffNotice(null);
      }
    },
    [reloadOverview],
  );

  useEffect(() => {
    let cancelled = false;
    void loadLegacyAngelListAutomationOverview()
      .then((next) => {
        if (!cancelled) {
          setOverview(next);
          setOverviewError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setOverviewError(
            error instanceof Error
              ? error.message
              : "Keel could not check AngelList sign-in.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const refreshId = rememberedAngelListRefresh();
    if (refreshId === null) {
      return;
    }
    let cancelled = false;
    void getAngelListSignInRefresh(refreshId)
      .then((next) => {
        if (!cancelled) {
          acceptRefresh(next);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setRefreshError(
            error instanceof Error
              ? error.message
              : "Keel could not reopen this sign-in refresh.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [acceptRefresh]);

  useEffect(() => {
    if (refresh?.status !== "waiting_for_sign_in") {
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const next = await getAngelListSignInRefresh(refresh.id);
        if (!cancelled) {
          acceptRefresh(next);
          if (next.status === "waiting_for_sign_in") {
            timer = window.setTimeout(() => void check(), 3_000);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setRefreshError(
            error instanceof Error
              ? error.message
              : "Keel could not check the AngelList sign-in.",
          );
          timer = window.setTimeout(() => void check(), 5_000);
        }
      }
    };
    timer = window.setTimeout(() => void check(), 3_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [acceptRefresh, refresh?.id, refresh?.status]);

  useEffect(() => {
    if (
      refresh?.status !== "waiting_for_sign_in" ||
      refresh.liveViewUrl === null ||
      refresh.liveViewExpiresAt === null
    ) {
      return;
    }
    const refreshId = refresh.id;
    const liveViewUrl = refresh.liveViewUrl;
    const delay = Math.max(
      0,
      new Date(refresh.liveViewExpiresAt).getTime() - Date.now(),
    );
    const timer = window.setTimeout(() => {
      setRefresh((current) =>
        current?.id === refreshId && current.liveViewUrl === liveViewUrl
          ? { ...current, liveViewUrl: null, liveViewExpiresAt: null }
          : current,
      );
    }, delay);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const startRefresh = async () => {
    setBusyAction("start");
    setRefreshError(null);
    try {
      acceptRefresh(await startAngelListSignInRefresh());
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Keel could not start AngelList sign-in.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const sendMagicLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (refresh?.status !== "waiting_for_sign_in") {
      return;
    }
    const link = magicLink.trim();
    setMagicLink("");
    setBusyAction("magic_link");
    setRefreshError(null);
    try {
      acceptRefresh(await submitAngelListMagicLink(refresh.id, link));
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Keel could not open that AngelList magic link.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const sendHandoffInput = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (refresh?.status !== "waiting_for_sign_in") {
      return;
    }
    const text = handoffInput.trim();
    setHandoffInput("");
    setHandoffNotice(null);
    setBusyAction("handoff_input");
    setRefreshError(null);
    try {
      acceptRefresh(await submitAngelListHandoffInput(refresh.id, text));
      setHandoffNotice("Text sent. Return to AngelList and tap Continue.");
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Keel could not type into the focused AngelList field.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const cancelRefresh = async () => {
    if (refresh?.status !== "waiting_for_sign_in") {
      return;
    }
    setBusyAction("cancel");
    setRefreshError(null);
    try {
      acceptRefresh(await cancelAngelListSignInRefresh(refresh.id));
    } catch (error) {
      setRefreshError(
        error instanceof Error
          ? error.message
          : "Keel could not cancel this sign-in refresh.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const waiting = refresh?.status === "waiting_for_sign_in";
  const title = waiting
    ? "Finish signing in to AngelList"
    : refresh?.status === "connected"
      ? "AngelList sign-in refreshed"
      : refresh?.status === "expired"
        ? "Sign-in window expired"
        : refresh?.status === "cancelled"
          ? "Sign-in refresh cancelled"
          : overview?.signInStatus === "connected"
            ? "AngelList sign-in is ready"
            : overview?.signInStatus === "needs_sign_in"
              ? "AngelList sign-in needs attention"
              : "Checking AngelList sign-in";
  const description = waiting
    ? "Open the temporary browser and finish signing in. If the phone keyboard does not appear, return here to type into the focused field."
    : refresh?.status === "connected"
      ? "Scheduled exports can continue. New exports will still wait for your review."
      : refresh?.status === "expired"
        ? "Your saved sign-in was not changed. Start a new window when you are ready."
        : refresh?.status === "cancelled"
          ? "Your saved sign-in was not changed."
          : overview?.signInStatus === "connected"
            ? "Keel can use this sign-in for the weekly export."
            : overview?.signInStatus === "needs_sign_in"
              ? "Refresh it from this phone to keep scheduled exports running."
              : "Keel is checking whether scheduled exports can continue.";

  return (
    <section
      aria-labelledby="angellist-sign-in-title"
      className="angellist-sign-in"
    >
      <div className="angellist-sign-in__heading">
        <p className="eyebrow">AngelList sign-in</p>
        <h2 id="angellist-sign-in-title">{title}</h2>
        <p>{description}</p>
      </div>

      <div className="angellist-sign-in__action" aria-live="polite">
        {waiting ? (
          <div className="angellist-sign-in__workflow">
            {refresh.liveViewUrl !== null ? (
              <a
                className="button button--primary angellist-live-view-link"
                href={refresh.liveViewUrl}
                referrerPolicy="no-referrer"
                rel="noreferrer noopener"
                target="_blank"
              >
                Open AngelList sign-in
              </a>
            ) : (
              <Button
                disabled={busyAction !== null}
                onClick={() => void startRefresh()}
                tone="primary"
              >
                {busyAction === "start" ? "Reopening…" : "Reopen sign-in"}
              </Button>
            )}

            <form
              className="angellist-input-form angellist-handoff-input"
              onSubmit={(event) => void sendHandoffInput(event)}
            >
              <label htmlFor="angellist-handoff-input">
                <span>Email or one-time code</span>
                <input
                  aria-describedby="angellist-handoff-input-help"
                  autoCapitalize="none"
                  autoComplete="off"
                  enterKeyHint="send"
                  id="angellist-handoff-input"
                  onChange={(event) => setHandoffInput(event.target.value)}
                  placeholder="Type on this phone"
                  required
                  spellCheck={false}
                  type="text"
                  value={handoffInput}
                />
              </label>
              <p id="angellist-handoff-input-help">
                Focus the matching AngelList field first. Keel sends this once
                and does not save it. Password fields are blocked.
              </p>
              <div>
                <Button
                  disabled={
                    busyAction !== null || handoffInput.trim().length === 0
                  }
                  type="submit"
                >
                  {busyAction === "handoff_input"
                    ? "Sending…"
                    : "Type in AngelList"}
                </Button>
                {handoffNotice !== null && (
                  <span
                    className="angellist-handoff-input__status"
                    role="status"
                  >
                    {handoffNotice}
                  </span>
                )}
              </div>
            </form>

            <form
              className="angellist-input-form angellist-magic-link"
              onSubmit={(event) => void sendMagicLink(event)}
            >
              <label htmlFor="angellist-magic-link">
                <span>Magic link from email</span>
                <input
                  aria-describedby="angellist-magic-link-help"
                  autoCapitalize="none"
                  autoComplete="off"
                  id="angellist-magic-link"
                  inputMode="url"
                  onChange={(event) => setMagicLink(event.target.value)}
                  placeholder="https://…"
                  required
                  spellCheck={false}
                  type="url"
                  value={magicLink}
                />
              </label>
              <p id="angellist-magic-link-help">
                If AngelList emails a link, copy it here. Keel opens it in the
                temporary browser and does not save it.
              </p>
              <div>
                <Button
                  disabled={
                    busyAction !== null || magicLink.trim().length === 0
                  }
                  type="submit"
                >
                  {busyAction === "magic_link" ? "Opening…" : "Open magic link"}
                </Button>
                <Button
                  disabled={busyAction !== null}
                  onClick={() => void cancelRefresh()}
                  tone="quiet"
                >
                  {busyAction === "cancel" ? "Cancelling…" : "Cancel"}
                </Button>
              </div>
            </form>
          </div>
        ) : overview === null && refresh === null && overviewError === null ? (
          <span className="angellist-sign-in__checking" role="status">
            Checking…
          </span>
        ) : (
          <Button
            disabled={busyAction !== null}
            onClick={() => void startRefresh()}
            tone={
              overview?.signInStatus === "needs_sign_in" ||
              refresh?.status === "expired"
                ? "primary"
                : "secondary"
            }
          >
            {busyAction === "start"
              ? "Starting…"
              : refresh?.status === "connected" ||
                  overview?.signInStatus === "connected"
                ? "Refresh sign-in"
                : "Start sign-in"}
          </Button>
        )}

        {overviewError !== null && overview === null && (
          <p className="angellist-sign-in__error" role="status">
            {overviewError}
          </p>
        )}
        {refreshError !== null && (
          <p className="angellist-sign-in__error" role="alert">
            {refreshError} Your saved sign-in was not changed.
          </p>
        )}
      </div>
    </section>
  );
}

const ANGELLIST_BROWSER_RUN_RETIRED = true;

function AngelListSignInControl() {
  return ANGELLIST_BROWSER_RUN_RETIRED ? (
    <AngelListMacAgentControl />
  ) : (
    <AngelListBrowserRunControl />
  );
}

const ROBINHOOD_LINK_TOKEN_STORAGE_KEY = "keel.robinhoodLinkToken";
const ROBINHOOD_OAUTH_RECONNECT_MESSAGE =
  "Reconnect Robinhood to finish signing in.";

function initialRobinhoodSyncError(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  const returningFromOauth = new URLSearchParams(window.location.search).has(
    "oauth_state_id",
  );
  return returningFromOauth &&
    window.sessionStorage.getItem(ROBINHOOD_LINK_TOKEN_STORAGE_KEY) === null
    ? ROBINHOOD_OAUTH_RECONNECT_MESSAGE
    : null;
}

function RobinhoodSyncControl({
  onReviewImport,
}: {
  onReviewImport: (importId: string) => void;
}) {
  const [status, setStatus] = useState<RobinhoodSyncStatus | null>(null);
  const [busyAction, setBusyAction] = useState<
    "connect" | "exchange" | "sync" | null
  >(null);
  const [error, setError] = useState<string | null>(initialRobinhoodSyncError);
  const [notice, setNotice] = useState<string | null>(null);
  const oauthStarted = useRef(false);

  const reload = useCallback(async () => {
    try {
      setStatus(await loadRobinhoodSyncStatus());
      setError((current) =>
        current === ROBINHOOD_OAUTH_RECONNECT_MESSAGE ? current : null,
      );
    } catch {
      setError("Keel could not check Robinhood right now. Try again shortly.");
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0);
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [reload]);

  const acceptSyncStatus = useCallback(
    (next: RobinhoodSyncStatus) => {
      setStatus(next);
      setError(null);
      if (
        next.latestImportId !== null &&
        (next.latestAdjudication?.quarantinedCount ?? 0) > 0
      ) {
        onReviewImport(next.latestImportId);
      } else if ((next.latestAdjudication?.autoAppliedCount ?? 0) > 0) {
        const applied = next.latestAdjudication?.autoAppliedCount ?? 0;
        setNotice(
          "Keel applied " +
            applied +
            " clear " +
            (applied === 1 ? "position" : "positions") +
            " automatically" +
            (next.latestAdjudication?.baselineRefreshStatus === "refreshed"
              ? " and refreshed your plan."
              : "."),
        );
      } else {
        setNotice("Robinhood is up to date. No holding changes were found.");
      }
    },
    [onReviewImport],
  );

  const exchangeToken = useCallback(
    async (publicToken: string) => {
      setBusyAction("exchange");
      setError(null);
      setNotice(null);
      try {
        const next = await exchangeRobinhoodPublicToken(publicToken);
        window.sessionStorage.removeItem(ROBINHOOD_LINK_TOKEN_STORAGE_KEY);
        if (window.location.search.length > 0) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        acceptSyncStatus(next);
      } catch {
        setError(
          "Robinhood could not be connected. Your holdings were not changed.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [acceptSyncStatus],
  );

  const openLink = useCallback(
    async (linkToken: string, receivedRedirectUri?: string) => {
      await openRobinhoodLink({
        linkToken,
        onExit: () => setBusyAction(null),
        onSuccess: (publicToken) => void exchangeToken(publicToken),
        ...(receivedRedirectUri === undefined ? {} : { receivedRedirectUri }),
      });
    },
    [exchangeToken],
  );

  useEffect(() => {
    if (
      oauthStarted.current ||
      !new URLSearchParams(window.location.search).has("oauth_state_id")
    ) {
      return;
    }
    const linkToken = window.sessionStorage.getItem(
      ROBINHOOD_LINK_TOKEN_STORAGE_KEY,
    );
    if (linkToken === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (oauthStarted.current) {
        return;
      }
      oauthStarted.current = true;
      setBusyAction("connect");
      void openLink(linkToken, window.location.href).catch(() => {
        setBusyAction(null);
        setError("Robinhood connection could not be reopened. Try again.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openLink]);

  const connect = async () => {
    setBusyAction("connect");
    setError(null);
    setNotice(null);
    try {
      const result = await createRobinhoodLinkToken();
      window.sessionStorage.setItem(
        ROBINHOOD_LINK_TOKEN_STORAGE_KEY,
        result.linkToken,
      );
      await openLink(result.linkToken);
    } catch {
      setBusyAction(null);
      setError("Robinhood connection could not be opened. Try again.");
    }
  };

  const sync = async () => {
    setBusyAction("sync");
    setError(null);
    setNotice(null);
    try {
      acceptSyncStatus(await syncRobinhoodHoldings());
    } catch {
      setError(
        "Robinhood could not be synced. Your holdings were not changed.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const setupRequired = status?.status === "setup_required";
  const disconnected = status?.status === "disconnected";
  const syncing = status?.status === "syncing";
  const connectionInvalid =
    status?.status === "needs_attention" &&
    status.errorCode === "connection_invalid";
  const quarantinedCount = status?.latestAdjudication?.quarantinedCount ?? 0;
  const autoAppliedCount = status?.latestAdjudication?.autoAppliedCount ?? 0;
  const title =
    status === null
      ? "Checking Robinhood"
      : setupRequired
        ? "Robinhood sync needs setup"
        : disconnected
          ? "Connect Robinhood"
          : syncing
            ? "Checking Robinhood"
            : connectionInvalid
              ? "Reconnect Robinhood"
              : quarantinedCount > 0
                ? quarantinedCount === 1
                  ? "One Robinhood exception was isolated"
                  : quarantinedCount + " Robinhood exceptions were isolated"
                : status.status === "needs_attention"
                  ? "Robinhood update needs attention"
                  : status.automaticUpdatesEnabled
                    ? "Robinhood updates automatically"
                    : "Turn on automatic Robinhood updates";
  const description = setupRequired
    ? "Add the Plaid connection settings to enable Robinhood holdings sync."
    : disconnected
      ? "Bring in stocks, ETFs, and mutual funds. Clear updates are recorded automatically."
      : syncing
        ? "Keel is checking the latest brokerage snapshot and isolating anything uncertain."
        : connectionInvalid
          ? "The saved connection no longer works. Reconnect to resume updates."
          : status?.errorCode === "holdings_incomplete"
            ? "The latest snapshot was incomplete. Prior holdings stayed unchanged."
            : status?.status === "needs_attention"
              ? "The latest update could not be safely applied. Try again shortly."
              : quarantinedCount > 0
                ? "Keel applied " +
                  autoAppliedCount +
                  " clear " +
                  (autoAppliedCount === 1 ? "position" : "positions") +
                  " and kept uncertain records unchanged."
                : status?.automaticUpdatesEnabled
                  ? "Keel records clear holdings changes automatically. Anything uncertain stays unchanged for you to inspect."
                  : "Check Robinhood once to enable automatic updates.";

  return (
    <section aria-labelledby="robinhood-sync-title" className="robinhood-sync">
      <div className="robinhood-sync__heading">
        <p className="eyebrow">Public holdings</p>
        <h2 id="robinhood-sync-title">{title}</h2>
        <p>{description}</p>
      </div>
      <div className="robinhood-sync__action" aria-live="polite">
        {status === null ? (
          error === null ? (
            <span className="robinhood-sync__checking" role="status">
              Checking…
            </span>
          ) : null
        ) : setupRequired ? null : disconnected || connectionInvalid ? (
          <Button
            disabled={busyAction !== null}
            onClick={() => void connect()}
            tone="primary"
          >
            {busyAction === "connect" || busyAction === "exchange"
              ? "Connecting…"
              : connectionInvalid
                ? "Reconnect Robinhood"
                : "Connect Robinhood"}
          </Button>
        ) : (
          <div className="robinhood-sync__controls">
            {status?.lastSyncedAt !== null &&
              status?.lastSyncedAt !== undefined && (
                <span>Last checked {formatDate(status.lastSyncedAt)}</span>
              )}
            {status.latestImportId !== null && quarantinedCount > 0 && (
              <Button
                onClick={() => onReviewImport(status.latestImportId!)}
                tone="primary"
              >
                {quarantinedCount === 1
                  ? "View exception"
                  : "View " + quarantinedCount + " exceptions"}
              </Button>
            )}
            <Button
              disabled={busyAction !== null || syncing}
              onClick={() => void sync()}
              tone={status.automaticUpdatesEnabled ? "secondary" : "primary"}
            >
              {busyAction === "sync" || syncing
                ? "Checking…"
                : status.automaticUpdatesEnabled
                  ? "Check now"
                  : "Turn on automatic updates"}
            </Button>
          </div>
        )}
        {notice !== null && (
          <p className="robinhood-sync__notice" role="status">
            {notice}
          </p>
        )}
        {error !== null && (
          <p className="robinhood-sync__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function minorUnitsToDollarInput(value: number): string {
  const minor = BigInt(value);
  const dollars = (minor / 100n).toLocaleString("en-US");
  const cents = (minor % 100n).toString().padStart(2, "0");
  return `${dollars}.${cents}`;
}

function dollarInputToMinorUnits(value: string): number | null {
  const normalized = value.trim().replaceAll(",", "");
  const match = /^(\d+)(?:\.(\d{0,2}))?$/u.exec(normalized);
  if (match === null) {
    return null;
  }
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const minor = whole * 100n + BigInt(fraction.length === 0 ? "0" : fraction);
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
}

function baselineValueLabel(
  position: PortfolioBaselineState["positions"][number],
): string {
  if (position.valueState === "locked") {
    return "Locked";
  }
  if (position.valueMinor === null) {
    return "Not reported";
  }
  return formatCompactMoney(position.valueMinor);
}

function PortfolioBaselineSection({
  onConfirmed,
  refreshKey,
}: {
  onConfirmed: () => Promise<void>;
  refreshKey: string;
}) {
  const [state, setState] = useState<PortfolioBaselineState | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [otherLiquidInput, setOtherLiquidInput] = useState("");
  const [changeNote, setChangeNote] = useState(
    "Replaced the FI liquid baseline with reviewed holdings.",
  );
  const [duplicateReviewConfirmed, setDuplicateReviewConfirmed] =
    useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const autoRefreshRevisionRef = useRef<string | null>(null);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await loadPortfolioBaseline(signal);
    setState(next);
    setError(null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void reload(controller.signal).catch((loadError: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Keel could not prepare the planning baseline.",
          );
        }
      });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [refreshKey, reload]);

  useEffect(() => {
    if (reviewing) {
      reviewHeadingRef.current?.focus();
    }
  }, [reviewing]);

  useEffect(() => {
    if (
      state === null ||
      state.status !== "ready" ||
      state.latestBaseline === null ||
      state.requiresDuplicateReview ||
      !state.canConfirm ||
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null ||
      autoRefreshRevisionRef.current === state.sourceRevision
    ) {
      return;
    }

    const sourceRevision = state.sourceRevision;
    const input: PortfolioBaselineConfirmInput = {
      sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor:
        state.latestBaseline.otherFiEligibleLiquidMinor,
      duplicateReviewConfirmed: false,
      changeNote: "Accepted holdings refreshed automatically.",
    };
    let cancelled = false;
    let retryTimer: number | undefined;
    autoRefreshRevisionRef.current = sourceRevision;
    setWorking(true);
    setError(null);

    void confirmPortfolioBaseline(input)
      .then(async () => {
        if (cancelled) {
          return;
        }
        setWorking(false);
        const reloads = await Promise.allSettled([onConfirmed(), reload()]);
        if (cancelled || reloads.every((item) => item.status === "fulfilled")) {
          return;
        }
        setError(
          "The planning baseline updated, but the latest view could not be loaded. Retrying shortly.",
        );
        autoRefreshRevisionRef.current = null;
        retryTimer = window.setTimeout(() => {
          void reload().catch(() => undefined);
        }, 5_000);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setWorking(false);
        setError(
          "Keel could not update the planning baseline yet. Retrying shortly.",
        );
        autoRefreshRevisionRef.current = null;
        retryTimer = window.setTimeout(() => {
          void reload().catch(() => undefined);
        }, 10_000);
      });

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        window.clearTimeout(retryTimer);
      }
    };
  }, [onConfirmed, reload, state]);

  const proposedOtherLiquidMinor = useMemo(
    () => dollarInputToMinorUnits(otherLiquidInput),
    [otherLiquidInput],
  );
  const proposedFiEligibleMinor = useMemo(() => {
    if (
      state === null ||
      state.summary === null ||
      proposedOtherLiquidMinor === null
    ) {
      return null;
    }
    return addMinorUnits(
      state.summary.publicMarketValueMinor,
      proposedOtherLiquidMinor,
    );
  }, [proposedOtherLiquidMinor, state]);
  const proposedImpact = useMemo(() => {
    if (state === null || proposedFiEligibleMinor === null) {
      return null;
    }
    return createPortfolioBaselineImpact(
      state.planning,
      proposedFiEligibleMinor,
    );
  }, [proposedFiEligibleMinor, state]);

  const openReview = () => {
    if (state === null) {
      return;
    }
    setOtherLiquidInput(
      minorUnitsToDollarInput(state.suggestedOtherFiEligibleLiquidMinor),
    );
    setChangeNote("Replaced the FI liquid baseline with reviewed holdings.");
    setDuplicateReviewConfirmed(false);
    setError(null);
    setReviewing(true);
  };

  const confirm = async () => {
    if (
      state === null ||
      state.sourceRevision === null ||
      state.baseForecastSnapshotId === null ||
      state.baseForecastSnapshotVersion === null ||
      proposedOtherLiquidMinor === null ||
      changeNote.trim().length === 0
    ) {
      return;
    }
    const input: PortfolioBaselineConfirmInput = {
      sourceRevision: state.sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: proposedOtherLiquidMinor,
      duplicateReviewConfirmed,
      changeNote: changeNote.trim(),
    };
    setWorking(true);
    setError(null);
    try {
      await confirmPortfolioBaseline(input);
      setReviewing(false);
      try {
        await Promise.all([onConfirmed(), reload()]);
      } catch {
        setError(
          "The baseline was confirmed, but the latest plan could not be reloaded. Refresh to see it.",
        );
      }
    } catch (confirmationError: unknown) {
      setError(
        confirmationError instanceof Error
          ? confirmationError.message
          : "Nothing changed. The baseline could not be confirmed.",
      );
    } finally {
      setWorking(false);
    }
  };

  if (state === null) {
    return error === null ? null : (
      <section className="portfolio-baseline portfolio-baseline--error">
        <div>
          <p className="eyebrow">Planning baseline</p>
          <h2>Planning baseline unavailable</h2>
          <p>{error}</p>
        </div>
        <Button onClick={() => void reload()} tone="quiet">
          Try again
        </Button>
      </section>
    );
  }
  if (
    state.status === "waiting_for_reviewed_holdings" ||
    state.summary === null
  ) {
    return null;
  }

  if (reviewing) {
    const otherLiquidInputInvalid = proposedOtherLiquidMinor === null;
    const duplicateCount = state.summary.potentialDuplicateCount;
    return (
      <section
        aria-labelledby="portfolio-baseline-review-title"
        className="portfolio-baseline-review"
      >
        <header className="portfolio-baseline-review__heading">
          <p className="eyebrow">Planning baseline</p>
          <h2
            id="portfolio-baseline-review-title"
            ref={reviewHeadingRef}
            tabIndex={-1}
          >
            Review the new FI liquid baseline
          </h2>
          <p>
            Reviewed public-market holdings are included in full. Add only cash
            or liquid assets held elsewhere.
          </p>
        </header>

        <div aria-label="Reviewed holding totals" className="baseline-totals">
          <div>
            <span>Imported liquid</span>
            <strong>
              {formatCompactMoney(state.summary.publicMarketValueMinor)}
            </strong>
          </div>
          <div>
            <span>Private paper</span>
            <strong>
              {formatCompactMoney(state.summary.privatePaperValueMinor)}
            </strong>
          </div>
          <div>
            <span>Value unavailable</span>
            <strong>{state.summary.unknownValueCount}</strong>
          </div>
        </div>

        <div className="baseline-position-list">
          <div className="baseline-position-list__header">
            <span>Reviewed position</span>
            <span>Source value</span>
          </div>
          {state.positions.map((position) => (
            <article key={position.id}>
              <div>
                <strong>{position.positionName}</strong>
                <span>
                  {position.sourceLabel} · {position.ownerLabel}
                </span>
                {position.potentialDuplicate && (
                  <small>Possible overlap across sources</small>
                )}
              </div>
              <div>
                <strong>{baselineValueLabel(position)}</strong>
                <span>
                  {position.classification === "public_market"
                    ? "Public market"
                    : "Private paper"}
                </span>
              </div>
            </article>
          ))}
        </div>

        {state.requiresDuplicateReview && (
          <label className="baseline-overlap-confirmation">
            <input
              checked={duplicateReviewConfirmed}
              onChange={(event) =>
                setDuplicateReviewConfirmed(event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>
              I reviewed the {duplicateCount} possible overlapping{" "}
              {duplicateCount === 1 ? "position" : "positions"} and set the FI
              amount without double counting.
            </span>
          </label>
        )}

        <div className="baseline-policy-grid">
          <div className="baseline-policy-input">
            <div
              aria-label="Proposed FI-eligible liquid calculation"
              className="baseline-liquid-composition"
            >
              <div className="baseline-liquid-composition__row">
                <span>Reviewed public-market holdings</span>
                <strong>
                  {formatMoney(state.summary.publicMarketValueMinor)}
                </strong>
              </div>
              <label
                className="field baseline-liquid-composition__field"
                htmlFor="other-fi-eligible-liquid-input"
              >
                <span>Other FI-eligible liquid assets</span>
                <span className="field__value">
                  <i>$</i>
                  <input
                    aria-describedby="fi-eligible-liquid-help"
                    aria-invalid={otherLiquidInputInvalid || undefined}
                    id="other-fi-eligible-liquid-input"
                    inputMode="decimal"
                    onChange={(event) =>
                      setOtherLiquidInput(event.currentTarget.value)
                    }
                    value={otherLiquidInput}
                  />
                </span>
              </label>
              <div className="baseline-liquid-composition__row baseline-liquid-composition__total">
                <span>Proposed FI-eligible liquid</span>
                <strong>
                  {proposedFiEligibleMinor === null
                    ? "—"
                    : formatMoney(proposedFiEligibleMinor)}
                </strong>
              </div>
            </div>
            <p id="fi-eligible-liquid-help">
              Private paper stays outside current liquidity. Nothing changes
              until you confirm. Locked values remain unknown.
            </p>
            <label className="field" htmlFor="portfolio-baseline-change-note">
              <span>What changed</span>
              <input
                id="portfolio-baseline-change-note"
                maxLength={500}
                onChange={(event) => setChangeNote(event.currentTarget.value)}
                value={changeNote}
              />
            </label>
          </div>

          <div aria-live="polite" className="baseline-impact">
            <p className="eyebrow">Forecast impact</p>
            {proposedImpact === null ? (
              <p>Enter a valid dollar amount with no more than two decimals.</p>
            ) : (
              <>
                <div>
                  <span>FI-eligible liquid</span>
                  <strong>
                    {formatCompactMoney(
                      state.planning.currentFiEligibleLiquidMinor,
                    )}{" "}
                    → {formatCompactMoney(proposedImpact.fiEligibleLiquidMinor)}
                  </strong>
                </div>
                <div>
                  <span>Protected runway</span>
                  <strong>{proposedImpact.protectedRunwayMonths} months</strong>
                </div>
                <div>
                  <span>FI gap</span>
                  <strong>
                    {formatCompactMoney(proposedImpact.fiGapMinor)}
                  </strong>
                </div>
                <div>
                  <span>5-year middle total</span>
                  <strong>
                    {formatCompactMoney(
                      proposedImpact.middleTotalAvailableMinor,
                    )}
                  </strong>
                </div>
                <div>
                  <span>Chance of reaching FI</span>
                  <strong>
                    {formatProbability(proposedImpact.probabilityCrossingFiPpm)}
                  </strong>
                </div>
              </>
            )}
          </div>
        </div>

        {error !== null && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <footer className="baseline-review-actions">
          <p>
            Confirming replaces the current FI liquid baseline and saves a new
            forecast version. Earlier versions remain available.
          </p>
          <div>
            <Button
              disabled={working}
              onClick={() => {
                setReviewing(false);
                setError(null);
              }}
              tone="quiet"
            >
              Cancel
            </Button>
            <Button
              disabled={
                working ||
                proposedImpact === null ||
                changeNote.trim().length === 0 ||
                (state.requiresDuplicateReview && !duplicateReviewConfirmed)
              }
              onClick={() => void confirm()}
              tone="primary"
            >
              {working ? "Confirming…" : "Confirm baseline"}
            </Button>
          </div>
        </footer>
      </section>
    );
  }

  const isCurrent = state.status === "current";
  const isUpdatingAutomatically =
    !isCurrent &&
    state.latestBaseline !== null &&
    !state.requiresDuplicateReview;
  const requiresOverlapReview =
    !isCurrent &&
    state.latestBaseline !== null &&
    state.requiresDuplicateReview;
  return (
    <section
      aria-labelledby="portfolio-baseline-title"
      className={`portfolio-baseline${isCurrent ? " portfolio-baseline--current" : ""}`}
    >
      <div className="portfolio-baseline__heading">
        <p className="eyebrow">Planning baseline</p>
        <h2 id="portfolio-baseline-title">
          {isCurrent
            ? "Planning baseline is current"
            : isUpdatingAutomatically
              ? "Updating the planning baseline"
              : requiresOverlapReview
                ? "Possible overlaps need review"
                : "Set the FI planning baseline"}
        </h2>
        <p>
          {isCurrent
            ? `Updated ${formatDate(state.latestBaseline?.createdAt ?? state.observedAt ?? "")}. Accepted holdings update this plan automatically.`
            : isUpdatingAutomatically
              ? "Accepted holdings changed. Keel is updating the FI plan automatically."
              : requiresOverlapReview
                ? "Confirm which accepted positions overlap before Keel updates the FI plan."
                : "Set imported liquid holdings as the FI baseline and add eligible liquid assets held elsewhere."}
        </p>
        {error !== null && (
          <p className="portfolio-baseline__error" role="status">
            {error}
          </p>
        )}
      </div>
      <div className="portfolio-baseline__summary">
        <span>
          <strong>{state.summary.positionCount}</strong> reviewed positions
        </span>
        <span>
          <strong>{state.summary.unknownValueCount}</strong> values unavailable
        </span>
        <span>
          <strong>
            {formatCompactMoney(state.planning.currentFiEligibleLiquidMinor)}
          </strong>{" "}
          in the FI plan
        </span>
      </div>
      {!isCurrent && !isUpdatingAutomatically && (
        <Button onClick={openReview} tone="primary">
          {requiresOverlapReview ? "Review overlaps" : "Set baseline"}
        </Button>
      )}
    </section>
  );
}

function Holdings({
  data,
  onBaselineConfirmed,
  onApplyImport,
  onImportRouteChange,
  onListPendingImports,
  onLoadImport,
  onPreviewImport,
  requestedImportId,
}: {
  data: AlphaData;
  onBaselineConfirmed: () => Promise<void>;
  onApplyImport: (
    importId: string,
    input: HoldingImportApplyInput,
  ) => Promise<HoldingImportApplyResult>;
  onImportRouteChange: (importId: string | null) => void;
  onListPendingImports: () => Promise<HoldingImportSummary[]>;
  onLoadImport: (importId: string) => Promise<HoldingImportPreview>;
  onPreviewImport: (file: File) => Promise<HoldingImportPreview>;
  requestedImportId: string | null;
}) {
  const [showImporter, setShowImporter] = useState(false);
  const [pendingImports, setPendingImports] = useState<HoldingImportSummary[]>(
    [],
  );
  const [pendingImportError, setPendingImportError] = useState<string | null>(
    null,
  );
  const [routedPreview, setRoutedPreview] =
    useState<HoldingImportPreview | null>(null);
  const [routedPreviewError, setRoutedPreviewError] = useState<{
    importId: string;
    message: string;
  } | null>(null);
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(
    null,
  );
  const holdingActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const selectedHolding =
    data.holdings.find((holding) => holding.id === selectedHoldingId) ?? null;
  const importerVisible = showImporter || requestedImportId !== null;
  const activeRoutedPreview =
    routedPreview?.id === requestedImportId ? routedPreview : null;
  const activeRoutedError =
    routedPreviewError?.importId === requestedImportId
      ? routedPreviewError.message
      : null;
  const baselineRefreshKey = data.holdings
    .map(
      (holding) =>
        `${holding.id}:${holding.effectiveDate}:${holding.administratorNavMinor ?? "unknown"}`,
    )
    .sort((left, right) => left.localeCompare(right))
    .join("|");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const loadPending = async () => {
      try {
        const imports = await onListPendingImports();
        if (!cancelled) {
          setPendingImports(
            imports.filter((item) => item.provider === "angellist"),
          );
          setPendingImportError(null);
        }
      } catch {
        if (!cancelled) {
          setPendingImportError("Keel could not check for holding updates.");
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(() => void loadPending(), 10_000);
        }
      }
    };
    void loadPending();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [onListPendingImports]);

  useEffect(() => {
    let cancelled = false;
    if (requestedImportId === null) {
      return () => {
        cancelled = true;
      };
    }
    void onLoadImport(requestedImportId)
      .then((preview) => {
        if (!cancelled) {
          setRoutedPreview(preview);
          setRoutedPreviewError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRoutedPreviewError({
            importId: requestedImportId,
            message:
              "This holding import is unavailable or has already been reviewed.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [onLoadImport, requestedImportId]);

  const closeImporter = () => {
    setShowImporter(false);
    setRoutedPreview(null);
    setRoutedPreviewError(null);
    if (requestedImportId !== null) {
      onImportRouteChange(null);
    }
  };

  const reviewPendingImport = useCallback(
    (importId: string) => onImportRouteChange(importId),
    [onImportRouteChange],
  );

  const closeHoldingDetail = () => {
    const returnFocusId = selectedHoldingId;
    setSelectedHoldingId(null);
    if (returnFocusId !== null) {
      window.requestAnimationFrame(() =>
        holdingActionRefs.current.get(returnFocusId)?.focus(),
      );
    }
  };

  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Portfolio evidence</p>
          <h1>Holdings</h1>
          <p>
            Five distinct value lenses. A mark does not imply an exit, and an
            exit does not imply usable liquidity.
          </p>
        </div>
        <div className="page-intro__actions">
          {selectedHolding !== null ? (
            <Button onClick={closeHoldingDetail} tone="quiet">
              Back to holdings
            </Button>
          ) : importerVisible ? (
            <Button onClick={closeImporter} tone="quiet">
              Close import
            </Button>
          ) : (
            <>
              <span className="page-count">
                {data.holdings.length} holdings
              </span>
              <Button
                onClick={() => {
                  setSelectedHoldingId(null);
                  setShowImporter(true);
                }}
                tone="primary"
              >
                Import holdings
              </Button>
            </>
          )}
        </div>
      </div>

      {selectedHolding !== null ? (
        <HoldingDetailWorkspace holding={selectedHolding} />
      ) : importerVisible ? (
        requestedImportId !== null &&
        activeRoutedPreview === null &&
        activeRoutedError === null ? (
          <div aria-live="polite" className="holding-import-loading">
            Loading the holding import…
          </div>
        ) : requestedImportId !== null && activeRoutedPreview === null ? (
          <div className="inline-error" role="alert">
            {activeRoutedError ?? "This holding import is unavailable."}
            <Button onClick={closeImporter} tone="quiet">
              Back to holdings
            </Button>
          </div>
        ) : (
          <HoldingImportWorkspace
            initialPreview={activeRoutedPreview}
            key={activeRoutedPreview?.id ?? "manual-import"}
            onApply={async (importId, input) => {
              const result = await onApplyImport(importId, input);
              setPendingImports((imports) =>
                imports.filter((item) => item.id !== importId),
              );
              return result;
            }}
            onClose={closeImporter}
            onPreview={onPreviewImport}
          />
        )
      ) : (
        <>
          <PortfolioBaselineSection
            onConfirmed={onBaselineConfirmed}
            refreshKey={baselineRefreshKey}
          />
          <RobinhoodSyncControl onReviewImport={reviewPendingImport} />
          <AngelListSignInControl />
          {pendingImports.length > 0 && (
            <section
              aria-labelledby="pending-holding-imports-title"
              className="holding-import-pending"
            >
              <div>
                <p className="eyebrow">Holding updates</p>
                <h2 id="pending-holding-imports-title">
                  {pendingImports.length === 1
                    ? "A holding update is ready"
                    : `${pendingImports.length} holding updates are ready`}
                </h2>
                <p>Nothing changes until you review it.</p>
              </div>
              <div className="holding-import-pending__items">
                {pendingImports.map((item) => (
                  <div key={item.id}>
                    <span>
                      <strong>{item.rowCount} positions</strong>
                      <small>
                        AngelList export · {formatDate(item.observedAt)}
                      </small>
                    </span>
                    <Button
                      aria-label={`Review AngelList import dated ${formatDate(item.observedAt)}`}
                      onClick={() => reviewPendingImport(item.id)}
                      tone="primary"
                    >
                      Review import
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
          {pendingImportError !== null && requestedImportId === null && (
            <div className="inline-error" role="status">
              {pendingImportError}
            </div>
          )}
          <Panel className="table-panel">
            <div className="holdings-table-wrap">
              <table className="data-table holdings-table">
                <thead>
                  <tr>
                    <th>Investment</th>
                    <th>Source value</th>
                    <th>External mark</th>
                    <th>FI planning value</th>
                    <th>Scenario value</th>
                    <th>Usable now</th>
                  </tr>
                </thead>
                <tbody>
                  {data.holdings.map((holding) => (
                    <tr key={holding.id}>
                      <td data-label="Investment">
                        <button
                          aria-label={`View ${holdingPrimaryName(holding)} holding details`}
                          className="holding-row-action"
                          onClick={() => setSelectedHoldingId(holding.id)}
                          ref={(node) => {
                            if (node === null) {
                              holdingActionRefs.current.delete(holding.id);
                            } else {
                              holdingActionRefs.current.set(holding.id, node);
                            }
                          }}
                          type="button"
                        >
                          <strong>{holdingPrimaryName(holding)}</strong>
                          <i aria-hidden="true">View details →</i>
                        </button>
                      </td>
                      <td data-label="Source value">
                        {administratorValueLabel(holding)}
                      </td>
                      <td data-label="External mark">
                        {holdingValueLabel(holding.externalMarkMinor)}
                      </td>
                      <td data-label="FI planning value">
                        <strong>
                          {holdingValueLabel(holding.underwritingValueMinor)}
                        </strong>
                      </td>
                      <td data-label="Scenario value">
                        {holdingValueLabel(holding.scenarioValueMinor)}
                      </td>
                      <td data-label="Usable now">
                        {holdingValueLabel(holding.usableLiquidityMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function sourceClassLabel(sourceClass: PublicSourceObservation["sourceClass"]) {
  return {
    official_company: "Official company",
    regulatory_filing: "Regulatory filing",
    reputable_reporting: "Named reporting",
    secondary_source: "Secondary source",
  }[sourceClass];
}

function evidenceStatusLabel(
  status: PublicSourceObservation["evidenceStatus"],
) {
  return {
    pending_review: "Needs review",
    accepted: "Reviewed",
    rejected: "Dismissed",
    scenario_only: "Scenario only",
  }[status];
}

function sourceHost(sourceUrl: string) {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl;
  }
}

type FinancingFacts = NonNullable<EvidenceInboxItem["financingFacts"]>;
type FinancingMoneyFact = NonNullable<FinancingFacts["announcedAmount"]>;
type FinancingValuationFact = NonNullable<FinancingFacts["companyValuation"]>;

function financingRoundLabel(facts: FinancingFacts) {
  const round =
    facts.roundLabel ??
    (facts.roundType === null
      ? null
      : {
          growth: "Growth financing",
          pre_seed: "Pre-seed",
          seed: "Seed",
          series: "Series financing",
          strategic: "Strategic financing",
          undisclosed: "Financing",
        }[facts.roundType]);
  const instrument = {
    convertible: "Convertible",
    debt: "Debt",
    equity: "Equity",
    mixed: "Mixed financing",
    undisclosed: null,
  }[facts.instrument];

  return (
    [round, instrument].filter((value) => value !== null).join(" · ") ||
    "Financing terms"
  );
}

function financingQualifierLabel(fact: FinancingMoneyFact) {
  return {
    approximately: "About ",
    at_least: "At least ",
    exact: "",
    up_to: "Up to ",
  }[fact.qualifier];
}

function financingAmountLabel(fact: FinancingMoneyFact) {
  return `${financingQualifierLabel(fact)}${formatCompactCurrency(
    fact.amountMinor,
    fact.currency,
  )}`;
}

function boundedSourceExcerpt(value: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const words = normalized.match(/\S+/gu) ?? [];
  let excerpt = "";
  for (const word of words.slice(0, 25)) {
    const candidate = excerpt.length === 0 ? word : `${excerpt} ${word}`;
    if (candidate.length > 240) {
      break;
    }
    excerpt = candidate;
  }
  return excerpt || normalized.slice(0, 240).trim();
}

function financingSourceExcerpt(facts: FinancingFacts, fallback: string) {
  return (
    facts.announcedAmount?.evidenceText ??
    facts.companyValuation?.evidenceText ??
    boundedSourceExcerpt(fallback)
  );
}

function financingValuationBasisLabel(fact: FinancingValuationFact) {
  return {
    pre_money: "pre-money company valuation",
    post_money: "post-money company valuation",
    undisclosed: "company valuation",
  }[fact.basis];
}

function financingScenarioTermsLabel(facts: FinancingFacts) {
  const terms = [financingRoundLabel(facts)];
  if (facts.announcedAmount !== null) {
    terms.push(`${financingAmountLabel(facts.announcedAmount)} announced`);
  }
  if (facts.companyValuation !== null) {
    terms.push(
      `${financingAmountLabel(facts.companyValuation)} ${financingValuationBasisLabel(facts.companyValuation)}`,
    );
  }
  return terms.join(" · ");
}

function financingAmbiguityLabel(
  ambiguity: FinancingFacts["ambiguities"][number],
) {
  return {
    combined_tranches: "combined tranches",
    currency_not_explicit: "currency not explicit",
    multiple_funding_amounts: "multiple funding amounts",
    multiple_valuations: "multiple valuations",
    prior_round_reference: "prior-round reference",
  }[ambiguity];
}

function FinancingAmbiguities({ facts }: { facts: FinancingFacts }) {
  if (facts.ambiguities.length === 0) {
    return null;
  }

  return (
    <small className="financing-ambiguity">
      Check source wording:{" "}
      {facts.ambiguities.map(financingAmbiguityLabel).join(", ")}
    </small>
  );
}

function ReportedFinancingTerms({
  facts,
  sourceExcerpt,
}: {
  facts: FinancingFacts;
  sourceExcerpt?: string | null;
}) {
  const displayedExcerpt =
    sourceExcerpt ??
    facts.announcedAmount?.evidenceText ??
    facts.companyValuation?.evidenceText ??
    null;
  return (
    <div className="reported-financing-terms">
      <span>Reported financing</span>
      <strong>{financingRoundLabel(facts)}</strong>
      {facts.announcedAmount !== null && (
        <div>
          <b>{financingAmountLabel(facts.announcedAmount)}</b>
        </div>
      )}
      {facts.companyValuation !== null && (
        <div>
          <b>
            {financingAmountLabel(facts.companyValuation)} ·{" "}
            {financingValuationBasisLabel(facts.companyValuation)}
          </b>
        </div>
      )}
      {displayedExcerpt !== null && (
        <small className="financing-source-excerpt">
          Source wording: “{displayedExcerpt}”
        </small>
      )}
      <FinancingAmbiguities facts={facts} />
    </div>
  );
}

function watchCoverageStatusLabel(
  status: "active" | "discovering" | "degraded" | "unavailable",
  lastCheckedAt: string | null,
  monitoringStatus: "active" | "paused",
) {
  if (monitoringStatus === "paused") {
    return "Monitoring paused";
  }
  if (status === "active") {
    return lastCheckedAt === null
      ? "Monitoring active"
      : `Monitoring active · Checked ${formatDate(lastCheckedAt)}`;
  }

  return {
    discovering: "Finding sources",
    degraded: "Temporarily unavailable · Will retry",
    unavailable: "No verified public source yet",
  }[status];
}

function PortfolioWatch({
  data,
  onReview,
  onScan,
}: {
  data: AlphaData;
  onReview: (eventId: string) => void;
  onScan: () => Promise<{
    discoveredCount: number;
    proposedCount: number;
    queuedCount: number;
  }>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runScan = () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    void onScan()
      .then((result) => {
        setMessage(
          result.queuedCount > 0
            ? "Source checks started."
            : result.discoveredCount === 0
              ? "You’re up to date."
              : `${result.proposedCount} ${result.proposedCount === 1 ? "update is" : "updates are"} ready to review.`,
        );
      })
      .catch(() => setError("Couldn’t check for updates. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <div className="screen-stack watch-screen">
      <div className="page-intro watch-intro">
        <div>
          <h1>Portfolio Watch</h1>
          <p>
            Follow public signals across your private holdings. Nothing changes
            until you review it.
          </p>
        </div>
        <Badge data-testid="portfolio-watch-status" tone="neutral">
          Public sources only
        </Badge>
      </div>

      <Panel
        className="watch-control-panel"
        data-testid="portfolio-watch-control"
      >
        <div>
          <h2>Check for updates</h2>
          <p>
            Keel automatically finds and checks company sources when you check.
          </p>
          <small data-testid="portfolio-watch-data-profile">
            {isRealCompanyAcceptanceProfile
              ? "Real public sources · Demo portfolio figures"
              : "Demo sources in this preview"}
          </small>
        </div>
        <Button disabled={busy} onClick={runScan} tone="primary">
          {busy ? "Checking…" : "Check now"}
        </Button>
      </Panel>

      {error !== null && <div className="inline-error">{error}</div>}
      {message !== null && (
        <p className="form-message success" role="status">
          {message}
        </p>
      )}

      <section>
        <div className="section-heading">
          <h2>Monitoring {data.portfolioWatch.targets.length} companies</h2>
        </div>
        <div className="watch-target-grid">
          {data.portfolioWatch.targets.map((target) => (
            <article data-testid={`watch-target-${target.id}`} key={target.id}>
              <strong>{target.companyName}</strong>
              <small data-testid="watch-target-coverage">
                {watchCoverageStatusLabel(
                  target.coverageStatus,
                  target.lastCheckedAt,
                  target.status,
                )}
              </small>
            </article>
          ))}
        </div>
      </section>

      <section>
        <div className="section-heading">
          <h2>Recent signals</h2>
        </div>

        {data.portfolioWatch.observations.length === 0 ? (
          <EmptyState title="No updates yet">
            Check now to look for new public signals.
          </EmptyState>
        ) : (
          <div className="watch-observation-list">
            {data.portfolioWatch.observations.map((observation) => (
              <article key={observation.id}>
                <header>
                  <div>
                    <p className="eyebrow">
                      {observation.companyName} ·{" "}
                      {sourceClassLabel(observation.sourceClass)}
                    </p>
                    <h2>{observation.sourceTitle}</h2>
                    <small>
                      Published {formatDate(observation.publishedAt)}
                    </small>
                  </div>
                  <Badge
                    tone={
                      observation.evidenceStatus === "pending_review"
                        ? "accent"
                        : "neutral"
                    }
                  >
                    {evidenceStatusLabel(observation.evidenceStatus)}
                  </Badge>
                </header>

                <div className="watch-observation-body">
                  {observation.financingFacts === null && (
                    <section>
                      <span>Observed</span>
                      <p>{observation.observedFact}</p>
                      <small>
                        Source reliability{" "}
                        {formatProbability(observation.sourceReliabilityPpm)}
                      </small>
                    </section>
                  )}
                  <section>
                    <span>
                      {observation.financingFacts === null
                        ? "Keel estimate"
                        : "What it means"}
                    </span>
                    <p>{observation.inference}</p>
                    <small>
                      {observation.financingFacts === null ? (
                        <>
                          Model confidence{" "}
                          {formatProbability(observation.modelConfidencePpm)}
                        </>
                      ) : (
                        <>
                          Source reliability{" "}
                          {formatProbability(observation.sourceReliabilityPpm)}{" "}
                          · Classification confidence{" "}
                          {formatProbability(observation.modelConfidencePpm)}
                        </>
                      )}
                    </small>
                  </section>
                  {observation.financingFacts === null ? (
                    <section>
                      <span>Estimated range</span>
                      {observation.valuationLowMinor !== null &&
                      observation.valuationMiddleMinor !== null &&
                      observation.valuationHighMinor !== null ? (
                        <strong>
                          {formatCompactMoney(observation.valuationLowMinor)} –{" "}
                          {formatCompactMoney(observation.valuationHighMinor)}
                        </strong>
                      ) : (
                        <strong>Not estimated</strong>
                      )}
                      {observation.valuationMiddleMinor !== null && (
                        <small>
                          Middle estimate{" "}
                          {formatCompactMoney(observation.valuationMiddleMinor)}
                        </small>
                      )}
                    </section>
                  ) : (
                    <section className="watch-reported-financing">
                      <ReportedFinancingTerms
                        facts={observation.financingFacts}
                        sourceExcerpt={financingSourceExcerpt(
                          observation.financingFacts,
                          observation.observedFact,
                        )}
                      />
                    </section>
                  )}
                </div>

                <footer>
                  <div>
                    <span>What&apos;s missing</span>
                    <p>{observation.limitations}</p>
                    <small>{sourceHost(observation.sourceUrl)}</small>
                  </div>
                  <Button
                    onClick={() => onReview(observation.evidenceEventId)}
                    tone="primary"
                  >
                    Review
                  </Button>
                </footer>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EvidenceCard({
  busy,
  item,
  onApply,
  onReview,
  reconciliation,
}: {
  busy: boolean;
  item: EvidenceInboxItem;
  onApply: (eventId: string) => void;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
  reconciliation?: {
    relationship: SignalReconciliationGroup["reports"][number]["relationship"];
    reviewOrder: number;
  };
}) {
  const pending = item.status === "pending_review";
  const reviewable = pending && reconciliation?.relationship !== "superseded";
  const application = item.financingFacts === null ? item.application : null;
  const canApply =
    item.financingFacts === null &&
    item.status === "accepted" &&
    application !== null &&
    !application.applied;
  const [showAcceptPreview, setShowAcceptPreview] = useState(false);
  const statusLabel = application?.applied
    ? "accepted & applied"
    : item.status.replaceAll("_", " ");
  return (
    <article className="evidence-card">
      <header>
        <div className="evidence-icon">E</div>
        <div>
          {reconciliation !== undefined && (
            <p className="evidence-reconciliation-order">
              Report {reconciliation.reviewOrder} ·{" "}
              {
                {
                  corroborating: "Corroborates",
                  conflicting: "Conflicts",
                  superseded: "Superseded",
                  unconfirmed: "Unconfirmed",
                }[reconciliation.relationship]
              }
            </p>
          )}
          <p className="eyebrow">
            {item.companyName} · {item.eventType.replaceAll("_", " ")}
          </p>
          <h2>{item.headline}</h2>
        </div>
        <Badge tone={pending ? "accent" : "neutral"}>{statusLabel}</Badge>
      </header>
      <div className="evidence-body">
        <div className="evidence-sources">
          <span>Supporting source</span>
          {item.sources.map((source) => (
            <strong key={source}>▣ {source}</strong>
          ))}
          {item.sourceUrl !== null && (
            <a
              className="evidence-source-link"
              href={item.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open official source ↗
            </a>
          )}
          <small>
            Effective {formatDate(item.effectiveDate)} · Retrieved{" "}
            {formatDate(item.detectedAt)}
          </small>
          {item.financingFacts !== null && (
            <small>
              {formatProbability(item.confidencePpm)} source reliability
              {item.modelConfidencePpm === null
                ? ""
                : ` · ${formatProbability(item.modelConfidencePpm)} classification confidence`}
            </small>
          )}
        </div>
        {item.financingFacts === null ? (
          <>
            <div className="proposed-change">
              <span>Proposed change</span>
              <div>
                <del>{item.priorValue}</del>
                <i>→</i>
                <ins>{item.replacementValue}</ins>
              </div>
              <small>
                {item.modelConfidencePpm === null
                  ? `${formatProbability(item.confidencePpm)} source confidence`
                  : `${formatProbability(item.confidencePpm)} source reliability · ${formatProbability(item.modelConfidencePpm)} model confidence`}
              </small>
            </div>
            <div className="forecast-impact">
              <span title="50th-percentile estimate">
                Estimated middle-outcome impact
              </span>
              <strong>
                {item.forecastImpactMinor >= 0 ? "+" : ""}
                {formatCompactMoney(item.forecastImpactMinor)}
              </strong>
              <small>Applied only after a new snapshot is created</small>
            </div>
          </>
        ) : (
          <>
            <ReportedFinancingTerms
              facts={item.financingFacts}
              sourceExcerpt={item.sourceExcerpt}
            />
            <div className="holding-impact-boundary">
              <span>Holding impact</span>
              <strong>Not calculated</strong>
              <small>Company terms do not set this holding’s value.</small>
            </div>
          </>
        )}
      </div>
      {(item.financingFacts === null || reviewable) && (
        <footer
          className={
            item.financingFacts === null ? undefined : "financing-review-footer"
          }
        >
          {item.financingFacts === null && (
            <p>
              {application?.applied
                ? `Accepted and applied to ${application.label}.`
                : "A review preserves both values. Applying updates only the mapped accepted record; scenario-only keeps the proposal out of it."}
            </p>
          )}
          {showAcceptPreview && (reviewable || canApply) ? (
            <div className="evidence-apply-preview">
              <div>
                <span>
                  {application === null
                    ? "Accept as reviewed evidence"
                    : "Apply to accepted record"}
                </span>
                {application === null ? (
                  <p>
                    {item.financingFacts === null
                      ? "This proposal has no financial record target yet. Accepting records the evidence without applying a value."
                      : `Record ${financingRoundLabel(item.financingFacts)} as reviewed company evidence.`}
                  </p>
                ) : (
                  <p>
                    Update {application.label}: {item.priorValue} →{" "}
                    {item.replacementValue}
                  </p>
                )}
                <small>
                  {item.financingFacts !== null
                    ? "No holding mark or forecast changes."
                    : item.application === null
                      ? "Use Scenario only to model its impact."
                      : "Creates an accepted mark on the effective date; forecast impact still requires a new snapshot."}
                </small>
              </div>
              <div>
                {application !== null && (
                  <Button
                    disabled={busy}
                    onClick={() => onApply(item.id)}
                    tone="primary"
                  >
                    Confirm & apply
                  </Button>
                )}
                {reviewable && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setShowAcceptPreview(false);
                      onReview(item.id, "accepted");
                    }}
                    tone={application === null ? "primary" : "quiet"}
                  >
                    {application === null
                      ? "Accept evidence"
                      : "Accept without applying"}
                  </Button>
                )}
                <Button
                  disabled={busy}
                  onClick={() => setShowAcceptPreview(false)}
                  tone="quiet"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : canApply ? (
            <div>
              <Button
                disabled={busy}
                onClick={() => setShowAcceptPreview(true)}
                tone="primary"
              >
                Apply accepted evidence
              </Button>
            </div>
          ) : (
            <div>
              <Button
                disabled={!reviewable || busy}
                onClick={() => onReview(item.id, "rejected")}
                tone="quiet"
              >
                Reject
              </Button>
              <Button
                disabled={!reviewable || busy}
                onClick={() => onReview(item.id, "scenario_only")}
              >
                Scenario only
              </Button>
              <Button
                disabled={!reviewable || busy}
                onClick={() => setShowAcceptPreview(true)}
                tone="primary"
              >
                Accept evidence
              </Button>
            </div>
          )}
        </footer>
      )}
    </article>
  );
}

function SignalProposalComposer({
  group,
  onCreate,
  proposals,
  scenarios,
}: {
  group: SignalReconciliationGroup;
  onCreate: (
    group: SignalReconciliationGroup,
    scenario: Scenario,
  ) => Promise<void>;
  proposals: SignalUpdateProposal[];
  scenarios: Scenario[];
}) {
  const availableScenarios = useMemo(
    () =>
      scenarios.filter(
        (scenario) =>
          scenario.latestSnapshotId !== null &&
          scenario.latestSnapshotVersion !== null,
      ),
    [scenarios],
  );
  const preferredScenario = useMemo(
    () =>
      availableScenarios.find((scenario) => scenario.isSandbox) ??
      availableScenarios[0] ??
      null,
    [availableScenarios],
  );
  const [selectedScenarioId, setSelectedScenarioId] = useState(
    preferredScenario?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentProposal = proposals.find((proposal) => proposal.isCurrent);
  const previousProposal = proposals.find((proposal) => !proposal.isCurrent);
  const selectedScenario =
    availableScenarios.find((scenario) => scenario.id === selectedScenarioId) ??
    preferredScenario;

  if (currentProposal !== undefined) {
    return (
      <div className="signal-proposal signal-proposal--saved">
        <div>
          <span>Proposed update</span>
          <strong>
            {financingAmountLabel(currentProposal.proposedCompanyValuation)}{" "}
            {financingValuationBasisLabel(
              currentProposal.proposedCompanyValuation,
            )}
          </strong>
          <small>
            {currentProposal.scenarioName} v
            {currentProposal.baseForecastSnapshotVersion} · Nothing has changed
            in holdings or the scenario.
          </small>
        </div>
      </div>
    );
  }

  if (!group.canCreateProposal || group.proposedCompanyValuation === null) {
    return (
      <div className="signal-proposal signal-proposal--waiting">
        <span>Next step</span>
        <p>
          {group.pendingReviewCount > 0
            ? "Review " +
              group.pendingReviewCount +
              " current " +
              (group.pendingReviewCount === 1 ? "report" : "reports") +
              " before drafting an update."
            : group.status === "conflicting"
              ? "Resolve the differing terms before drafting an update."
              : "No single reported company valuation is ready to propose."}
        </p>
        {previousProposal !== undefined && (
          <small>
            The earlier {previousProposal.scenarioName} proposal is out of date.
          </small>
        )}
      </div>
    );
  }

  if (selectedScenario === null) {
    return null;
  }

  return (
    <div className="signal-proposal signal-proposal--ready">
      <div>
        <span>Draft a separate scenario update</span>
        <strong>
          {financingAmountLabel(group.proposedCompanyValuation)} ·{" "}
          {financingValuationBasisLabel(group.proposedCompanyValuation)}
        </strong>
        <small>
          Company valuation only. Holding value still needs ownership and
          security terms.
        </small>
      </div>
      <label>
        Start from
        <select
          aria-label={
            "Scenario baseline for " +
            group.companyName +
            " " +
            group.roundLabel
          }
          disabled={busy}
          onChange={(event) => setSelectedScenarioId(event.target.value)}
          value={selectedScenario.id}
        >
          {availableScenarios.map((scenario) => (
            <option key={scenario.id} value={scenario.id}>
              {scenario.name} v{scenario.latestSnapshotVersion}
            </option>
          ))}
        </select>
      </label>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void onCreate(group, selectedScenario)
            .catch((caught: unknown) =>
              setError(
                caught instanceof Error
                  ? caught.message
                  : "The proposed update could not be created.",
              ),
            )
            .finally(() => setBusy(false));
        }}
        tone="primary"
      >
        {busy ? "Creating…" : "Create proposed update"}
      </Button>
      <small>
        Keel checks the exact reports and scenario version again before saving.
      </small>
      {error !== null && <div className="inline-error">{error}</div>}
    </div>
  );
}

function SignalReconciliationList({
  busyEvent,
  data,
  onApply,
  onCreateProposal,
  onReview,
}: {
  busyEvent: string | null;
  data: AlphaData;
  onApply: (eventId: string) => void;
  onCreateProposal: (
    group: SignalReconciliationGroup,
    scenario: Scenario,
  ) => Promise<void>;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
}) {
  if (data.signalReconciliations.length === 0) {
    return null;
  }

  return (
    <section className="signal-reconciliation-list">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Recommended review order</p>
          <h2>Reconcile related reports</h2>
        </div>
        <p>
          Compare current reports together. Superseded reports stay visible but
          do not drive a proposed update.
        </p>
      </div>
      {data.signalReconciliations.map((group) => {
        const proposalRows = data.signalUpdateProposals.filter(
          (proposal) => proposal.groupId === group.id,
        );
        return (
          <section
            className="signal-reconciliation-group"
            data-testid={"signal-group-" + group.id}
            key={group.id}
          >
            <header>
              <div>
                <p className="eyebrow">
                  Review {group.reviewRank} · {group.companyName}
                </p>
                <h2>{group.roundLabel}</h2>
                <p>{group.reviewReason}</p>
              </div>
              <Badge
                tone={
                  group.status === "conflicting"
                    ? "warning"
                    : group.status === "corroborated"
                      ? "positive"
                      : "neutral"
                }
              >
                {
                  {
                    corroborated: "Corroborated",
                    conflicting: "Terms conflict",
                    unconfirmed: "Unconfirmed",
                  }[group.status]
                }
              </Badge>
            </header>
            <div className="signal-reconciliation-reports">
              {group.reports.map((report) => {
                const item = data.evidenceInbox.find(
                  (candidate) => candidate.id === report.evidenceEventId,
                );
                return item === undefined ? null : (
                  <EvidenceCard
                    busy={busyEvent === item.id}
                    item={item}
                    key={item.id}
                    onApply={onApply}
                    onReview={onReview}
                    reconciliation={{
                      relationship: report.relationship,
                      reviewOrder: report.reviewOrder,
                    }}
                  />
                );
              })}
            </div>
            <SignalProposalComposer
              group={group}
              onCreate={onCreateProposal}
              proposals={proposalRows}
              scenarios={data.scenarios}
            />
          </section>
        );
      })}
    </section>
  );
}

function EvidenceInbox({
  busyEvent,
  data,
  error,
  onApply,
  onCreateProposal,
  onReview,
}: {
  busyEvent: string | null;
  data: AlphaData;
  error: string | null;
  onApply: (eventId: string) => void;
  onCreateProposal: (
    group: SignalReconciliationGroup,
    scenario: Scenario,
  ) => Promise<void>;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
}) {
  return (
    <div className="screen-stack evidence-screen">
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
      <SignalReconciliationList
        busyEvent={busyEvent}
        data={data}
        onApply={onApply}
        onCreateProposal={onCreateProposal}
        onReview={onReview}
      />
      <div className="evidence-list">
        {data.evidenceInbox
          .filter(
            (item) =>
              !data.signalReconciliations.some((group) =>
                group.reports.some(
                  (report) => report.evidenceEventId === item.id,
                ),
              ),
          )
          .map((item) => (
            <EvidenceCard
              busy={busyEvent === item.id}
              item={item}
              key={item.id}
              onApply={onApply}
              onReview={onReview}
            />
          ))}
      </div>
    </div>
  );
}

function Scenarios({
  data,
  onSave,
  onPlanSaved,
  scenarioContext,
  onClearScenarioContext,
}: {
  data: AlphaData;
  onSave: (input: ScenarioDraftInput) => Promise<void>;
  onPlanSaved: () => Promise<void>;
  scenarioContext: EvidenceInboxItem | null;
  onClearScenarioContext: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, number>>({});
  const [changeNote, setChangeNote] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const selected =
    data.scenarios.find((scenario) => scenario.id === selectedId) ??
    data.scenarios.find((scenario) => scenario.name === "FI Underwriting") ??
    data.scenarios[0];

  const hasDraftChanges =
    selected?.assumptions.some(
      (assumption) =>
        (draftValues[assumption.id] ?? assumption.value) !== assumption.value,
    ) ?? false;
  const workingAssumptions =
    selected?.assumptions.map((assumption) => ({
      ...assumption,
      value: draftValues[assumption.id] ?? assumption.value,
    })) ?? [];
  const changedAssumptions =
    selected?.assumptions
      .map((assumption) => ({
        assumption,
        nextValue: draftValues[assumption.id] ?? assumption.value,
      }))
      .filter(({ assumption, nextValue }) => nextValue !== assumption.value) ??
    [];
  const autoChangeNote =
    changedAssumptions.length === 0
      ? "Scenario assumption revision"
      : changedAssumptions
          .map(
            ({ assumption, nextValue }) =>
              `${assumption.label}: ${formatScenarioAssumptionValue(
                assumption,
                assumption.value,
              )} → ${formatScenarioAssumptionValue(assumption, nextValue)}`,
          )
          .join("; ");
  const effectiveChangeNote = [
    scenarioContext === null
      ? null
      : `Scenario-only evidence: ${scenarioContext.headline}`,
    changeNote.trim() || autoChangeNote,
  ]
    .filter((note): note is string => note !== null && note.length > 0)
    .join(" — ")
    .slice(0, 500);
  const draftInput = useMemo<ScenarioDraftInput | null>(
    () =>
      selected === undefined
        ? null
        : {
            scenarioId: selected.id,
            assumptions: selected.assumptions.map((assumption) => ({
              id: assumption.id,
              key: assumption.key,
              value: draftValues[assumption.id] ?? assumption.value,
            })),
            changeNote: effectiveChangeNote,
          },
    [draftValues, effectiveChangeNote, selected],
  );
  const projection = useMemo(() => {
    if (selected === undefined || draftInput === null) {
      return null;
    }
    try {
      return projectScenario(selected, draftInput);
    } catch {
      return null;
    }
  }, [draftInput, selected]);

  if (selected === undefined) {
    return (
      <EmptyState title="No scenarios">Seed the synthetic database.</EmptyState>
    );
  }

  const displayedScenario: Scenario =
    projection === null
      ? selected
      : {
          ...selected,
          conditionalValueMinor: projection.conditionalValueMinor,
          timingAdjustedLiquidityMinor: projection.timingAdjustedLiquidityMinor,
          liquidityCurve: projection.liquidityCurve,
        };
  const liquidityProbability = workingAssumptions.find(
    (assumption) => assumption.key === "liquidity_probability",
  )?.value;
  const timingDelay = workingAssumptions.find(
    (assumption) => assumption.key === "timing_delay_months",
  )?.value;
  const scenarioConditions =
    liquidityProbability === undefined || timingDelay === undefined
      ? "Scenario assumptions applied"
      : `${formatProbability(liquidityProbability)} probability · ${timingDelay}-month delay`;

  const selectScenario = (scenarioId: string) => {
    setSelectedId(scenarioId);
    setDraftValues({});
    setChangeNote("");
    setSaveState("idle");
    setSaveMessage(null);
  };

  const resetDraft = () => {
    setDraftValues({});
    setChangeNote("");
    setSaveState("idle");
    setSaveMessage(null);
  };

  const submit = () => {
    if (!hasDraftChanges) {
      setSaveState("error");
      setSaveMessage("Change an assumption before saving.");
      return;
    }
    if (projection === null) {
      setSaveState("error");
      setSaveMessage("The scenario preview is not available yet.");
      return;
    }
    setSaveState("saving");
    setSaveMessage(null);
    if (draftInput === null) {
      return;
    }
    void onSave({ ...draftInput, changeNote: effectiveChangeNote })
      .then(() => {
        setDraftValues({});
        setChangeNote("");
        setSaveState("saved");
        setSaveMessage("Scenario saved.");
        onClearScenarioContext();
      })
      .catch((error: unknown) => {
        setSaveState("error");
        setSaveMessage(
          error instanceof Error
            ? error.message
            : "The scenario could not be saved.",
        );
      });
  };

  return (
    <div className="screen-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">Forecast assumptions</p>
          <h1>Scenarios</h1>
          <p>
            Scenarios change projected outcomes. Goals define what success
            means. Edit the goal itself in Goals.
          </p>
        </div>
        <Badge
          tone={
            saveState === "error"
              ? "negative"
              : hasDraftChanges
                ? "warning"
                : "neutral"
          }
        >
          {hasDraftChanges ? "Unsaved draft" : "Saved scenario"}
        </Badge>
      </div>

      <PlanInputsEditor onSaved={onPlanSaved} />

      <div className="scenario-tabs" role="tablist">
        {data.scenarios.map((scenario) => (
          <button
            aria-selected={scenario.id === selected.id}
            className={scenario.id === selected.id ? "active" : ""}
            key={scenario.id}
            onClick={() => selectScenario(scenario.id)}
            role="tab"
            type="button"
          >
            {scenario.name}
          </button>
        ))}
      </div>

      {scenarioContext !== null ? (
        <div className="scenario-context" role="status">
          <div>
            <p className="eyebrow">
              {scenarioContext.financingFacts === null
                ? "Scenario-only evidence"
                : "Reported financing context"}
            </p>
            <strong>{scenarioContext.headline}</strong>
            {scenarioContext.financingFacts === null ? (
              <small>
                {scenarioContext.priorValue} →{" "}
                {scenarioContext.replacementValue} · estimated impact{" "}
                {scenarioContext.forecastImpactMinor >= 0 ? "+" : ""}
                {formatCompactMoney(scenarioContext.forecastImpactMinor)}
              </small>
            ) : (
              <>
                <small>
                  Reported terms:{" "}
                  {financingScenarioTermsLabel(scenarioContext.financingFacts)}.
                </small>
                <small>
                  Holding impact not calculated. No holding mark or forecast
                  changes. Adjust assumptions below to model your view.
                </small>
              </>
            )}
          </div>
          <Button tone="quiet" onClick={onClearScenarioContext}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="scenario-summary">
        <div>
          <p>{selected.description}</p>
          <span>
            {hasDraftChanges
              ? "Working draft preview"
              : "Current saved forecast output"}
          </span>
        </div>
        <article>
          <span>Conditional value</span>
          <strong>
            {formatCompactMoney(displayedScenario.conditionalValueMinor)}
          </strong>
          <small>Value if the modeled liquidity events occur</small>
        </article>
        <i aria-hidden="true">≠</i>
        <article className="usable">
          <span>Timing-adjusted liquidity</span>
          <strong>
            {formatCompactMoney(displayedScenario.timingAdjustedLiquidityMinor)}
          </strong>
          <small className="scenario-summary__assumptions">
            {scenarioConditions}
          </small>
        </article>
      </div>

      <div className="scenario-grid">
        <Panel eyebrow="Annual distribution" title="Cumulative liquidity curve">
          <LiquidityChart scenario={displayedScenario} />
          <div className="zero-probabilities">
            {displayedScenario.liquidityCurve.map((point) => (
              <span key={point.year}>
                <b>{point.year}</b>
                {formatProbability(point.probabilityZeroPpm)} chance of zero
              </span>
            ))}
          </div>
        </Panel>
        <Panel
          action={
            <Badge tone={hasDraftChanges ? "warning" : "neutral"}>
              {hasDraftChanges ? "Draft" : "Saved"}
            </Badge>
          }
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
          <label className="field field--wide">
            <span>What changed</span>
            <input
              maxLength={500}
              onChange={(event) => {
                setChangeNote(event.target.value);
                setSaveState("idle");
                setSaveMessage(null);
              }}
              value={changeNote || autoChangeNote}
            />
          </label>
          {saveMessage !== null && (
            <p
              className={
                saveState === "error" ? "form-message error" : "form-message"
              }
              role={saveState === "error" ? "alert" : "status"}
            >
              {saveMessage}
            </p>
          )}
          <div className="scenario-actions">
            <Button
              disabled={!hasDraftChanges || saveState === "saving"}
              onClick={resetDraft}
              tone="quiet"
            >
              Reset
            </Button>
            <Button
              disabled={!hasDraftChanges || saveState === "saving"}
              onClick={submit}
              tone="primary"
            >
              {saveState === "saving" ? "Saving…" : "Save scenario"}
            </Button>
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
        <Badge tone="positive">Read-only record</Badge>
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
                    <span title="50th-percentile outcome">
                      Prior middle
                      <b>
                        {item.priorP50Minor === null
                          ? "Baseline"
                          : formatCompactMoney(item.priorP50Minor)}
                      </b>
                    </span>
                    <span className="arrow">→</span>
                    <span title="50th-percentile outcome">
                      New middle
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileNavigationRef = useRef<HTMLElement>(null);
  const pending = data.evidenceInbox.filter(
    (item) => item.status === "pending_review",
  ).length;

  useEffect(() => {
    if (!mobileMenuOpen) {
      return;
    }

    const navigationElement = mobileNavigationRef.current;
    const activeItem = navigationElement?.querySelector<HTMLButtonElement>(
      '[aria-current="page"]',
    );
    const focusFrame = window.requestAnimationFrame(() => activeItem?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileMenuOpen(false);
        window.requestAnimationFrame(() =>
          mobileMenuButtonRef.current?.focus(),
        );
        return;
      }

      if (event.key !== "Tab" || navigationElement === null) {
        return;
      }

      const navigationButtons = Array.from(
        navigationElement.querySelectorAll<HTMLButtonElement>("button"),
      );
      const lastButton = navigationButtons.at(-1);

      if (
        event.shiftKey &&
        document.activeElement === mobileMenuButtonRef.current &&
        lastButton !== undefined
      ) {
        event.preventDefault();
        lastButton.focus();
      } else if (
        !event.shiftKey &&
        document.activeElement === lastButton &&
        mobileMenuButtonRef.current !== null
      ) {
        event.preventDefault();
        mobileMenuButtonRef.current.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
    window.requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  };

  const navigateFromMobileMenu = (screen: Screen) => {
    onNavigate(screen);
    closeMobileMenu();
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <KeelMark />
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
          <div className="topbar__title">
            <KeelMark />
            <span>Keel /</span> {pageHeading(activeScreen)}
          </div>
          <button
            aria-controls="mobile-navigation"
            aria-expanded={mobileMenuOpen}
            aria-label={
              mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            className="mobile-menu-toggle"
            onClick={() => setMobileMenuOpen((isOpen) => !isOpen)}
            ref={mobileMenuButtonRef}
            type="button"
          >
            <span aria-hidden="true" className="mobile-menu-toggle__icon">
              <span />
              <span />
              <span />
            </span>
          </button>
        </header>
        <div className="content">{children}</div>
      </main>

      <nav
        aria-label="Mobile navigation"
        className="mobile-nav"
        hidden={!mobileMenuOpen}
        id="mobile-navigation"
        ref={mobileNavigationRef}
      >
        {navigation.map((item) => (
          <button
            aria-current={activeScreen === item.id ? "page" : undefined}
            className={activeScreen === item.id ? "active" : ""}
            key={item.id}
            onClick={() => navigateFromMobileMenu(item.id)}
            type="button"
          >
            <i>{item.icon}</i>
            <span>{item.label}</span>
            {item.id === "evidence" && pending > 0 && <b>{pending}</b>}
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
  const [activeScreen, setActiveScreen] = useState<Screen>(
    () => routeFromLocation().screen,
  );
  const [holdingImportId, setHoldingImportId] = useState<string | null>(
    () => routeFromLocation().holdingImportId,
  );
  const [data, setData] = useState<AlphaData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [scenarioContext, setScenarioContext] =
    useState<EvidenceInboxItem | null>(null);

  const navigateToScreen = useCallback((screen: Screen) => {
    const path = pathForScreen(screen);
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setActiveScreen(screen);
    setHoldingImportId(null);
  }, []);

  const navigateToHoldingImport = useCallback((importId: string | null) => {
    const path =
      importId === null
        ? "/holdings"
        : `/holdings/imports/${encodeURIComponent(importId)}`;
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
    setActiveScreen("holdings");
    setHoldingImportId(importId);
  }, []);

  useEffect(() => {
    const updateRoute = () => {
      const route = routeFromLocation();
      setActiveScreen(route.screen);
      setHoldingImportId(route.holdingImportId);
    };
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, []);

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

  useEffect(() => {
    window.scrollTo({ behavior: "auto", top: 0 });
  }, [activeScreen, holdingImportId]);

  const content = useMemo(() => {
    if (data === null) {
      return null;
    }
    switch (activeScreen) {
      case "dashboard":
        return <Dashboard data={data} onNavigate={navigateToScreen} />;
      case "goals":
        return (
          <Goals
            data={data}
            onSave={async (input) => {
              await saveGoalVersion(input);
              setData(await loadAlphaData());
            }}
          />
        );
      case "holdings":
        return (
          <Holdings
            data={data}
            onBaselineConfirmed={async () => setData(await loadAlphaData())}
            onApplyImport={async (importId, input) => {
              const result = await applyHoldingImport(importId, input);
              setData(await loadAlphaData());
              return result;
            }}
            onImportRouteChange={navigateToHoldingImport}
            onListPendingImports={listPendingHoldingImports}
            onLoadImport={loadHoldingImport}
            onPreviewImport={previewAngelListHoldingImport}
            requestedImportId={holdingImportId}
          />
        );
      case "watch":
        return (
          <PortfolioWatch
            data={data}
            onReview={() => navigateToScreen("evidence")}
            onScan={async () => {
              const result = await scanPortfolioWatch();
              setData(await loadAlphaData());
              return result;
            }}
          />
        );
      case "evidence":
        return (
          <EvidenceInbox
            busyEvent={busyEvent}
            data={data}
            error={reviewError}
            onApply={(eventId) => {
              setBusyEvent(eventId);
              setReviewError(null);
              void applyAcceptedEvidence(eventId)
                .then(async () => setData(await loadAlphaData()))
                .catch((error: unknown) =>
                  setReviewError(
                    error instanceof Error
                      ? error.message
                      : "The evidence application could not be recorded.",
                  ),
                )
                .finally(() => setBusyEvent(null));
            }}
            onCreateProposal={async (group, scenario) => {
              if (scenario.latestSnapshotId === null) {
                throw new Error("The selected scenario has no saved version.");
              }
              await submitSignalUpdateProposal({
                groupId: group.id,
                reconciliationRevision: group.revision,
                scenarioId: scenario.id,
                baseForecastSnapshotId: scenario.latestSnapshotId,
                rationale:
                  "Reviewed " +
                  group.companyName +
                  " " +
                  group.roundLabel +
                  " reports; model the company valuation separately.",
              });
              setData(await loadAlphaData());
            }}
            onReview={(eventId, decision) => {
              const reviewedItem = data.evidenceInbox.find(
                (item) => item.id === eventId,
              );
              setBusyEvent(eventId);
              setReviewError(null);
              void submitEvidenceReview(eventId, decision)
                .then(async () => {
                  setData(await loadAlphaData());
                  if (
                    decision === "scenario_only" &&
                    reviewedItem !== undefined
                  ) {
                    setScenarioContext(reviewedItem);
                    navigateToScreen("scenarios");
                  }
                })
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
        return (
          <Scenarios
            data={data}
            onPlanSaved={async () => setData(await loadAlphaData())}
            onSave={async (input) => {
              await saveScenarioVersion(input);
              setData(await loadAlphaData());
            }}
            onClearScenarioContext={() => setScenarioContext(null)}
            scenarioContext={scenarioContext}
          />
        );
      case "history":
        return <ForecastHistory data={data} />;
    }
  }, [
    activeScreen,
    busyEvent,
    data,
    holdingImportId,
    navigateToHoldingImport,
    navigateToScreen,
    reviewError,
    scenarioContext,
  ]);

  if (data === null && loadError === null) {
    return <LoadingShell />;
  }

  if (data === null) {
    return (
      <div className="fatal-error">
        <div className="brand">
          <KeelMark />
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
    <Shell
      activeScreen={activeScreen}
      data={data}
      onNavigate={navigateToScreen}
    >
      {content}
    </Shell>
  );
}
