import {
  createGoalPreview,
  projectScenario,
  type AlphaData,
  type EvidenceInboxItem,
  type Goal,
  type GoalDraftInput,
  type PublicSourceObservation,
  type Scenario,
  type ScenarioDraftInput,
} from "@keel/domain";
import { Badge, Button, MetricCard, Panel } from "@keel/ui";
import {
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  applyAcceptedEvidence,
  loadAlphaData,
  saveGoalVersion,
  saveScenarioVersion,
  scanPortfolioWatch,
  submitEvidenceReview,
} from "./api";
import { formatCompactMoney, formatDate, formatProbability } from "./format";

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
  shortLabel: string;
  icon: string;
}[] = [
  {
    id: "dashboard",
    label: "Overview",
    shortLabel: "Overview",
    icon: "01",
  },
  { id: "goals", label: "Goals", shortLabel: "Goals", icon: "02" },
  { id: "holdings", label: "Holdings", shortLabel: "Holdings", icon: "03" },
  {
    id: "watch",
    label: "Portfolio Watch",
    shortLabel: "Watch",
    icon: "04",
  },
  {
    id: "evidence",
    label: "Evidence Inbox",
    shortLabel: "Evidence",
    icon: "05",
  },
  { id: "scenarios", label: "Scenarios", shortLabel: "Scenarios", icon: "06" },
  {
    id: "history",
    label: "Forecast History",
    shortLabel: "History",
    icon: "07",
  },
];

function pageHeading(screen: Screen) {
  return navigation.find((item) => item.id === screen)?.label ?? "Keel";
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
                  <section>
                    <span>Observed</span>
                    <p>{observation.observedFact}</p>
                    <small>
                      Source reliability{" "}
                      {formatProbability(observation.sourceReliabilityPpm)}
                    </small>
                  </section>
                  <section>
                    <span>Keel estimate</span>
                    <p>{observation.inference}</p>
                    <small>
                      Model confidence{" "}
                      {formatProbability(observation.modelConfidencePpm)}
                    </small>
                  </section>
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
}: {
  busy: boolean;
  item: EvidenceInboxItem;
  onApply: (eventId: string) => void;
  onReview: (
    eventId: string,
    decision: "accepted" | "rejected" | "scenario_only",
  ) => void;
}) {
  const pending = item.status === "pending_review";
  const canApply =
    item.status === "accepted" &&
    item.application !== null &&
    !item.application.applied;
  const [showAcceptPreview, setShowAcceptPreview] = useState(false);
  const statusLabel = item.application?.applied
    ? "accepted & applied"
    : item.status.replaceAll("_", " ");
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
        <Badge tone={pending ? "accent" : "neutral"}>{statusLabel}</Badge>
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
      </div>
      <footer>
        <p>
          {item.application?.applied
            ? `Accepted and applied to ${item.application.label}.`
            : "A review preserves both values. Applying updates only the mapped accepted record; scenario-only keeps the proposal out of it."}
        </p>
        {showAcceptPreview && (pending || canApply) ? (
          <div className="evidence-apply-preview">
            <div>
              <span>
                {item.application === null
                  ? "Accept as reviewed evidence"
                  : "Apply to accepted record"}
              </span>
              {item.application === null ? (
                <p>
                  This proposal has no deterministic financial record target
                  yet. Accepting will record the evidence without applying a
                  value.
                </p>
              ) : (
                <p>
                  Update {item.application.label}: {item.priorValue} →{" "}
                  {item.replacementValue}
                </p>
              )}
              <small>
                {item.application === null
                  ? "Use Scenario only to model its impact."
                  : "Creates an accepted mark on the effective date; forecast impact still requires a new snapshot."}
              </small>
            </div>
            <div>
              {item.application !== null && (
                <Button
                  disabled={busy}
                  onClick={() => onApply(item.id)}
                  tone="primary"
                >
                  Confirm & apply
                </Button>
              )}
              {pending && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    setShowAcceptPreview(false);
                    onReview(item.id, "accepted");
                  }}
                  tone={item.application === null ? "primary" : "quiet"}
                >
                  {item.application === null
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
              onClick={() => setShowAcceptPreview(true)}
              tone="primary"
            >
              Accept evidence
            </Button>
          </div>
        )}
      </footer>
    </article>
  );
}

function EvidenceInbox({
  busyEvent,
  data,
  error,
  onApply,
  onReview,
}: {
  busyEvent: string | null;
  data: AlphaData;
  error: string | null;
  onApply: (eventId: string) => void;
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
  scenarioContext,
  onClearScenarioContext,
}: {
  data: AlphaData;
  onSave: (input: ScenarioDraftInput) => Promise<void>;
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

      <Panel
        action={<Badge tone="neutral">Accepted inputs</Badge>}
        className="plan-inputs"
        eyebrow="Current planning goal"
        title="Financial independence"
      >
        <p className="plan-inputs__copy">
          These are the latest accepted cash-flow inputs used by the FI model.
          The scenario controls below create working drafts; they do not change
          this accepted plan.
        </p>
        <div className="plan-inputs__grid">
          <MetricCard
            detail="Decision-usable today"
            label="FI-eligible liquid"
            value={formatCompactMoney(data.dashboard.fiEligibleLiquidMinor)}
          />
          <MetricCard
            detail="Personal operating cost"
            label="Household burn"
            value={`${formatCompactMoney(
              data.dashboard.householdBurnMonthlyMinor,
            )} / mo`}
          />
          <MetricCard
            detail="Protected separately"
            label="Business burn"
            value={`${formatCompactMoney(
              data.dashboard.businessBurnMonthlyMinor,
            )} / mo`}
          />
          <MetricCard
            detail="Threshold for this template"
            label="FI target"
            value={formatCompactMoney(data.dashboard.fiTargetMinor)}
          />
        </div>
      </Panel>

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
            <p className="eyebrow">Scenario-only evidence</p>
            <strong>{scenarioContext.headline}</strong>
            <small>
              {scenarioContext.priorValue} → {scenarioContext.replacementValue}{" "}
              · estimated impact{" "}
              {scenarioContext.forecastImpactMinor >= 0 ? "+" : ""}
              {formatCompactMoney(scenarioContext.forecastImpactMinor)}
            </small>
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
  const pending = data.evidenceInbox.filter(
    (item) => item.status === "pending_review",
  ).length;

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
  const [scenarioContext, setScenarioContext] =
    useState<EvidenceInboxItem | null>(null);

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
  }, [activeScreen]);

  const content = useMemo(() => {
    if (data === null) {
      return null;
    }
    switch (activeScreen) {
      case "dashboard":
        return <Dashboard data={data} onNavigate={setActiveScreen} />;
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
        return <Holdings data={data} />;
      case "watch":
        return (
          <PortfolioWatch
            data={data}
            onReview={() => setActiveScreen("evidence")}
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
            onReview={(eventId, decision) => {
              const reviewedItem = data.evidenceInbox.find(
                (item) => item.id === eventId,
              );
              setBusyEvent(eventId);
              setReviewError(null);
              void submitEvidenceReview(eventId, decision)
                .then(() => {
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
                  );
                  if (
                    decision === "scenario_only" &&
                    reviewedItem !== undefined
                  ) {
                    setScenarioContext(reviewedItem);
                    setActiveScreen("scenarios");
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
  }, [activeScreen, busyEvent, data, reviewError, scenarioContext]);

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
    <Shell activeScreen={activeScreen} data={data} onNavigate={setActiveScreen}>
      {content}
    </Shell>
  );
}
