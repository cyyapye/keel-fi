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
  type CashAccountsState,
  type CashAccountIdentityCandidate,
  type CashAccountIdentityDecision,
  type CashBalanceProposal,
  type CashFlowPlanSuggestion,
  type EvidenceInboxItem,
  type Goal,
  type GoalDraftInput,
  type Holding,
  type HoldingImportApplyInput,
  type HoldingImportApplyResult,
  type HoldingImportPreview,
  type HoldingImportRowPreview,
  type PortfolioBaselineConfirmInput,
  type PortfolioBaselineState,
  type ProviderBrowserSession,
  type ProviderPortfolioAgentOverview,
  type ProviderPortfolioAgentProvider,
  type PublicSourceObservation,
  type Scenario,
  type ScenarioDraftInput,
  type SignalReconciliationGroup,
  type SignalUpdateProposal,
} from "@keel/domain";
import type { PositionValueSourceKind } from "@keel/domain/position-value";
import type { HoldingsPage } from "@keel/domain/holdings-page";
import { calculatePositionPerformance } from "@keel/domain/position-economics";
import {
  ActionGroup,
  AppShell,
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  Carousel,
  type CarouselApi,
  CarouselContent,
  CarouselDots,
  CarouselItem,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DatePicker,
  DisclosureIndicator,
  EmptyState,
  Field,
  FormMessage,
  Input,
  InputGroup,
  MetricCard,
  Notice,
  PageHeader,
  Panel,
  Screen as ScreenLayout,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  StatGroup,
  SectionHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
  Textarea,
} from "@keel/ui";
import {
  type CSSProperties,
  type FormEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyAcceptedEvidence,
  acceptPositionValueAdjustment,
  applyCashAccountProposal,
  applyHoldingImport,
  cancelAngelListSignInRefresh,
  cancelProviderBrowserReconnect,
  confirmPortfolioBaseline,
  configureAngelListMacAgent,
  configureProviderPortfolioAgent,
  createCashAccountLinkToken,
  createSignalUpdateProposal as submitSignalUpdateProposal,
  getAngelListSignInRefresh,
  getProviderBrowserReconnect,
  exchangeCashAccountPublicToken,
  loadAngelListAutomationOverview,
  loadAlphaData,
  loadHoldingsPage,
  loadHoldingImport,
  loadLegacyAngelListAutomationOverview,
  loadCashAccounts,
  loadPortfolioBaseline,
  loadProviderPortfolioAgentOverview,
  previewHoldingImport,
  requestAngelListUpdate,
  requestProviderPortfolioUpdate,
  providerBrowserReconnectOpenPath,
  refreshCashAccount,
  refreshDueCashAccounts,
  reviewCashAccountIdentity,
  saveGoalVersion,
  saveScenarioVersion,
  scanPortfolioWatch,
  startAngelListSignInRefresh,
  startProviderBrowserReconnect,
  submitAngelListHandoffInput,
  submitAngelListMagicLink,
  submitEvidenceReview,
  type UploadHoldingImportProvider,
} from "./api";
import {
  navigation,
  pageHeading,
  pathForScreen,
  type Screen,
} from "./app-navigation";
import {
  formatCompactCurrency,
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatProbability,
} from "./format";
import { openPlaidLink } from "./plaid-link";
import { InvestmentHoldings } from "./InvestmentHoldings";
import { LegalEntities } from "./LegalEntities";
import { PositionEconomicsEditor } from "./PositionEconomicsEditor";
import { Obligations } from "./Obligations";
import { ObservedCashFlow } from "./ObservedCashFlow";
import { PlanActualMonitoring } from "./PlanActualMonitoring";
import { PlanInputsEditor } from "./PlanInputsEditor";
import type { PortfolioSnapshotDrilldown } from "./PortfolioSnapshot";
import { HoldingsRouteShell, LoadingShell } from "./RouteShells";

const PortfolioSnapshot = lazy(async () => {
  const module = await import("./PortfolioSnapshot");
  return { default: module.PortfolioSnapshot };
});

const isRealCompanyAcceptanceProfile =
  import.meta.env.VITE_KEEL_ACCEPTANCE_PROFILE === "real-company";

type AppRoute = {
  screen: Screen;
  holdingImportId: string | null;
  holdingsDrilldown: PortfolioSnapshotDrilldown | null;
  holdingsView: "entities" | "overview" | "sources";
};

type PortfolioAccessKey = Extract<
  PortfolioSnapshotDrilldown,
  { type: "access" }
>["accessKey"];

const portfolioAccessKeys: ReadonlySet<string> = new Set([
  "cash",
  "public_market",
  "private_paper",
  "other_liquid",
] as const);

function holdingsDrilldownFromLocation(): PortfolioSnapshotDrilldown | null {
  const search = new URLSearchParams(window.location.search);
  const exposureId = search.get("exposure");
  if (
    exposureId !== null &&
    exposureId.trim().length > 0 &&
    exposureId.length <= 200
  ) {
    return { type: "exposure", exposureId };
  }
  const accessKey = search.get("access");
  if (accessKey !== null && portfolioAccessKeys.has(accessKey)) {
    return {
      type: "access",
      accessKey: accessKey as PortfolioAccessKey,
    };
  }
  return null;
}

function routeFromLocation(): AppRoute {
  if (/^\/holdings\/entities\/?$/u.test(window.location.pathname)) {
    return {
      screen: "holdings",
      holdingImportId: null,
      holdingsDrilldown: null,
      holdingsView: "entities",
    };
  }
  if (/^\/holdings\/sources\/?$/u.test(window.location.pathname)) {
    return {
      screen: "holdings",
      holdingImportId: null,
      holdingsDrilldown: null,
      holdingsView: "sources",
    };
  }
  const importMatch = window.location.pathname.match(
    /^\/holdings\/imports\/([^/]+)\/?$/,
  );
  if (importMatch?.[1] !== undefined) {
    try {
      return {
        screen: "holdings",
        holdingImportId: decodeURIComponent(importMatch[1]),
        holdingsDrilldown: null,
        holdingsView: "overview",
      };
    } catch {
      return {
        screen: "holdings",
        holdingImportId: null,
        holdingsDrilldown: null,
        holdingsView: "overview",
      };
    }
  }
  const screen = navigation.find(
    (item) => window.location.pathname === `/${item.id}`,
  )?.id;
  return {
    screen: screen ?? "dashboard",
    holdingImportId: null,
    holdingsDrilldown:
      screen === "holdings" ? holdingsDrilldownFromLocation() : null,
    holdingsView: "overview",
  };
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

type GoalUnit = GoalDraftInput["targetUnit"];

const GOAL_UNIT_OPTIONS = [
  { label: "USD", value: "minor_units" },
  { label: "Months", value: "months" },
  { label: "Count", value: "count" },
  { label: "Percentage", value: "ppm" },
] satisfies ReadonlyArray<{ label: string; value: GoalUnit }>;

function latestGoalVersion(goal: Goal) {
  const version = goal.versions[0];
  if (version === undefined) {
    throw new Error("A goal must have at least one saved version.");
  }
  return version;
}

function orderGoalsPrimaryFirst(goals: Goal[]) {
  return [...goals].sort(
    (left, right) => Number(right.isPrimary) - Number(left.isPrimary),
  );
}

function goalProgressPpm(version: ReturnType<typeof latestGoalVersion>) {
  const target = version.targetValueInteger;
  if (target === null) return 0;
  if (target === 0) return 1_000_000;
  return Math.min(
    Number((BigInt(version.currentValueInteger) * 1_000_000n) / BigInt(target)),
    1_000_000,
  );
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

function formatSignedProbability(valuePpm: number): string {
  if (valuePpm === 0) {
    return formatProbability(0);
  }
  return `${valuePpm > 0 ? "+" : "−"}${formatProbability(Math.abs(valuePpm))}`;
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
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const activeIndex = focusedIndex ?? hoveredIndex ?? selectedIndex;
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
              aria-pressed={selectedIndex === index}
              className="chart-hit chart-point"
              cx={xAt(index)}
              cy={yAt(point.p50Minor)}
              onBlur={() => setFocusedIndex(null)}
              onClick={() => setSelectedIndex(index)}
              onFocus={() => setFocusedIndex(index)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
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
  onEditGoal,
  onNavigate,
  onPortfolioDrilldown,
}: {
  data: AlphaData;
  onEditGoal: (goalId: string) => void;
  onNavigate: (screen: Screen) => void;
  onPortfolioDrilldown: (drilldown: PortfolioSnapshotDrilldown) => void;
}) {
  const scenario =
    data.scenarios.find((item) => item.name === "FI Underwriting") ??
    data.scenarios[0];
  const dashboard = data.dashboard;
  const orderedGoals = useMemo(
    () => orderGoalsPrimaryFirst(data.goals),
    [data.goals],
  );
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(
    () => orderedGoals[0]?.id ?? null,
  );
  const selectGoal = useCallback((goalId: string) => {
    setSelectedGoalId(goalId);
  }, []);
  const selectedGoal =
    orderedGoals.find((goal) => goal.id === selectedGoalId) ?? orderedGoals[0];
  if (selectedGoal === undefined) {
    return (
      <EmptyState title="No planning goal">
        Create a goal before using the overview.
      </EmptyState>
    );
  }
  const selectedVersion = latestGoalVersion(selectedGoal);
  const selectedForecast = selectedVersion.forecast;
  const target = selectedVersion.targetValueInteger;
  const progressPpm = goalProgressPpm(selectedVersion);
  const ringStyle = {
    "--probability": `${Math.floor(progressPpm / 10_000)}%`,
  } as CSSProperties;
  const targetMet =
    target !== null && selectedVersion.currentValueInteger >= target;
  const targetDifference =
    target === null ? null : selectedVersion.currentValueInteger - target;
  const targetPosition =
    targetDifference === null
      ? {
          detail: "Add a target to measure progress",
          label: "Goal gap",
          value: "Not available",
        }
      : targetDifference === 0
        ? {
            detail: "Current measure equals the saved target",
            label: "Target status",
            value: "Met",
          }
        : targetDifference > 0
          ? {
              detail: "Current measure is above the saved target",
              label: "Above target",
              value: formatGoalValue(
                targetDifference,
                selectedVersion.targetUnit,
              ),
            }
          : {
              detail: "To reach the saved target",
              label: "Still needed",
              value: formatGoalValue(
                -targetDifference,
                selectedVersion.targetUnit,
              ),
            };
  const totalMonthlyBurnMinor = addMinorUnits(
    dashboard.householdBurnMonthlyMinor,
    dashboard.businessBurnMonthlyMinor,
  );
  const pendingEvidence = data.evidenceInbox.filter(
    (item) => item.status === "pending_review",
  ).length;

  return (
    <ScreenLayout>
      <OverviewGoalHero
        goals={orderedGoals}
        onEditGoal={onEditGoal}
        onSelectedGoalChange={selectGoal}
      />

      <div className="goal-overview" data-goal-id={selectedGoal.id}>
        <Panel
          className="goal-signal"
          eyebrow="Goal progress"
          title={selectedVersion.name}
        >
          <div className="goal-signal__body">
            <div className="probability-ring" style={ringStyle}>
              <div>
                <strong>{formatProbability(progressPpm)}</strong>
                <span>current progress</span>
              </div>
            </div>
            <div className="goal-signal__readout">
              <StatGroup
                aria-label="Selected goal target"
                className="goal-signal__stats"
              >
                <Stat
                  detail={
                    target === null
                      ? "Add a target when it becomes useful"
                      : selectedVersion.targetDate === null
                        ? "No target date"
                        : `By ${formatDate(selectedVersion.targetDate)}`
                  }
                  label="Goal target"
                  value={
                    target === null
                      ? "Not set"
                      : formatGoalValue(target, selectedVersion.targetUnit)
                  }
                />
                <Stat
                  detail={targetPosition.detail}
                  label={targetPosition.label}
                  value={targetPosition.value}
                />
              </StatGroup>
              <p className="panel-note">
                {target === null
                  ? "Add a target to measure progress."
                  : selectedForecast.successProbabilityPpm !== null
                    ? `Current progress uses the saved baseline. Saved plan v${selectedVersion.version} estimates ${formatProbability(selectedForecast.successProbabilityPpm)} success.`
                    : "Current progress is saved. Add scenario inputs before treating this goal as a forecast."}
              </p>
            </div>
          </div>
        </Panel>
      </div>

      <Suspense fallback={null}>
        <PortfolioSnapshot
          onDrilldown={onPortfolioDrilldown}
          onViewHoldings={() => onNavigate("holdings")}
        />
      </Suspense>

      <Panel
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
            <section
              aria-labelledby="portfolio-outlook-current-base"
              className="portfolio-outlook__base"
            >
              <SectionHeader
                className="portfolio-outlook__base-heading"
                headingAs="h3"
                headingProps={{
                  className: "eyebrow",
                  id: "portfolio-outlook-current-base",
                }}
                title="Current base"
              />
              <StatGroup
                aria-label="Current portfolio base"
                className="portfolio-outlook__metrics"
              >
                <article className="portfolio-outlook__metric">
                  <Stat
                    as="div"
                    detail="From accepted holdings"
                    label="FI-eligible liquid"
                    value={formatCompactMoney(dashboard.fiEligibleLiquidMinor)}
                  />
                  <TextLink onClick={() => onNavigate("holdings")}>
                    View holdings
                  </TextLink>
                </article>
                <article className="portfolio-outlook__metric">
                  <Stat
                    as="div"
                    detail={`${formatCompactMoney(totalMonthlyBurnMinor)}/month after a ${formatCompactMoney(dashboard.protectedCashFloorMinor)} cash floor`}
                    label="Protected runway"
                    value={`${dashboard.protectedRunwayMonths} months`}
                  />
                  <TextLink onClick={() => onNavigate("scenarios")}>
                    View plan inputs
                  </TextLink>
                </article>
              </StatGroup>
            </section>
          </>
        )}
      </Panel>

      <Panel
        action={
          <TextLink onClick={() => onEditGoal(selectedGoal.id)}>
            Review goal
          </TextLink>
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

      <PlanActualMonitoring onNavigate={onNavigate} />
    </ScreenLayout>
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

function GoalSelectorHeader({ goal }: { goal: Goal }) {
  const version = latestGoalVersion(goal);

  return (
    <span className="goal-selector__goal-header">
      <span>
        {goal.isPrimary ? "Primary" : templateLabels[goal.templateKey]}
      </span>
      <strong>{version.name}</strong>
      <small>
        v{version.version} ·{" "}
        {formatGoalValue(version.currentValueInteger, version.targetUnit)}
      </small>
    </span>
  );
}

function GoalHeroContent({
  goal,
  isActive = true,
  onEditGoal,
}: {
  goal: Goal;
  isActive?: boolean;
  onEditGoal: (goalId: string) => void;
}) {
  const version = latestGoalVersion(goal);
  const target = version.targetValueInteger;
  const progressPpm = goalProgressPpm(version);

  return (
    <>
      <div>
        <p className="eyebrow">
          {goal.isPrimary ? "Primary goal" : templateLabels[goal.templateKey]} ·
          saved plan v{version.version}
        </p>
        <h1>{version.name}</h1>
        <p className="hero__copy">
          {version.metricLabel}:{" "}
          {formatGoalValue(version.currentValueInteger, version.targetUnit)}
          {target === null
            ? ". Add a target when it becomes useful."
            : ` of ${formatGoalValue(target, version.targetUnit)}${
                version.targetDate === null
                  ? "."
                  : ` by ${formatDate(version.targetDate)}.`
              }`}
        </p>
        <TextLink
          className="hero__action"
          onClick={() => onEditGoal(goal.id)}
          tabIndex={isActive ? 0 : -1}
          tone="inverse"
        >
          Edit this goal
        </TextLink>
      </div>
      <div className="hero__runway">
        <span>Current measure</span>
        <strong>
          {formatGoalValue(version.currentValueInteger, version.targetUnit)}
        </strong>
        <small>
          {target === null
            ? "No target set"
            : `${formatProbability(progressPpm)} of target`}
        </small>
      </div>
    </>
  );
}

function OverviewGoalHero({
  goals,
  onEditGoal,
  onSelectedGoalChange,
}: {
  goals: Goal[];
  onEditGoal: (goalId: string) => void;
  onSelectedGoalChange: (goalId: string) => void;
}) {
  const options = useMemo(() => ({ align: "start" as const }), []);
  const [api, setApi] = useState<CarouselApi>();
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (api === undefined) return;

    const updateVisibleGoal = () => {
      const nextIndex = api.selectedScrollSnap();
      const nextGoal = goals[nextIndex];
      setCurrentIndex(nextIndex);
      if (nextGoal !== undefined) onSelectedGoalChange(nextGoal.id);
    };

    api.on("reInit", updateVisibleGoal);
    api.on("select", updateVisibleGoal);
    const frame = requestAnimationFrame(updateVisibleGoal);

    return () => {
      cancelAnimationFrame(frame);
      api.off("reInit", updateVisibleGoal);
      api.off("select", updateVisibleGoal);
    };
  }, [api, goals, onSelectedGoalChange]);

  const onlyGoal = goals[0];
  if (goals.length === 1 && onlyGoal !== undefined) {
    return (
      <section className="hero">
        <GoalHeroContent goal={onlyGoal} onEditGoal={onEditGoal} />
      </section>
    );
  }

  return (
    <section className="hero hero--carousel">
      <Carousel
        aria-label="Goal overview"
        className="hero-carousel"
        opts={options}
        setApi={setApi}
      >
        <CarouselContent>
          {goals.map((goal, index) => {
            const version = latestGoalVersion(goal);
            const isActive = index === currentIndex;
            return (
              <CarouselItem
                aria-hidden={!isActive}
                aria-label={`${index + 1} of ${goals.length}: ${version.name}`}
                className="hero-carousel__slide"
                key={goal.id}
              >
                <article className="hero__slide">
                  <GoalHeroContent
                    goal={goal}
                    isActive={isActive}
                    onEditGoal={onEditGoal}
                  />
                </article>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        <footer className="hero-carousel__footer">
          <CarouselDots
            aria-label="Choose a goal"
            getDotLabel={(index) => {
              const goal = goals[index];
              return goal === undefined
                ? `Show goal ${index + 1}`
                : `Show goal ${index + 1} of ${goals.length}: ${latestGoalVersion(goal).name}`;
            }}
          />
          <span
            aria-atomic="true"
            aria-live="polite"
            className="visually-hidden"
          >
            Goal {currentIndex + 1} of {goals.length}:{" "}
            {goals[currentIndex] === undefined
              ? ""
              : latestGoalVersion(goals[currentIndex]).name}
          </span>
        </footer>
      </Carousel>
    </section>
  );
}

function Goals({
  data,
  initialGoalId,
  onSave,
}: {
  data: AlphaData;
  initialGoalId: string | null;
  onSave: (input: GoalDraftInput) => Promise<void>;
}) {
  const initialGoal =
    data.goals.find((goal) => goal.id === initialGoalId) ??
    data.goals.find((goal) => goal.isPrimary) ??
    data.goals[0];
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
  const goalOptions = data.goals.map((goal) => ({
    label: latestGoalVersion(goal).name,
    value: goal.id,
  }));
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

  const chooseGoal = useCallback((goal: Goal) => {
    setSelectedGoalId(goal.id);
    setForm(goalFormFromGoal(goal));
    setSaveState("idle");
    setSaveMessage(null);
  }, []);

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
    <ScreenLayout>
      <PageHeader
        actions={
          <Badge tone="neutral">
            {data.goals.length} active{" "}
            {data.goals.length === 1 ? "goal" : "goals"}
          </Badge>
        }
        description="Track several goals and choose the one that drives your forecast."
        eyebrow="Planning priorities"
        title="Goals"
      />

      <div className="goal-workspace">
        <Panel
          action={
            selectedGoal === null ? undefined : (
              <TextLink onClick={() => chooseTemplate("custom")}>
                New goal +
              </TextLink>
            )
          }
          aria-label="Goal selector"
          className="goal-selector"
          eyebrow="Goals"
        >
          <Select
            items={goalOptions}
            onValueChange={(value) => {
              if (typeof value !== "string") return;
              const goal = data.goals.find(
                (candidate) => candidate.id === value,
              );
              if (goal !== undefined) chooseGoal(goal);
            }}
            value={selectedGoalId}
          >
            <SelectTrigger
              aria-label="Saved goal"
              className="goal-selector__trigger"
            >
              <SelectValue>
                {(value) => {
                  const goal =
                    typeof value === "string"
                      ? data.goals.find((candidate) => candidate.id === value)
                      : undefined;
                  return goal === undefined ? (
                    <span className="goal-selector__goal-header goal-selector__goal-header--empty">
                      <span>Saved goals</span>
                      <strong>Choose a goal</strong>
                      <small>Edit its latest version</small>
                    </span>
                  ) : (
                    <GoalSelectorHeader goal={goal} />
                  );
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="goal-selector__content">
              {data.goals.map((goal) => (
                <SelectItem
                  className="goal-selector__item"
                  key={goal.id}
                  label={latestGoalVersion(goal).name}
                  value={goal.id}
                >
                  <GoalSelectorHeader goal={goal} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Panel>

        <div className="goal-main">
          {selectedGoal === null && (
            <Panel className="goal-templates" title="Start from a template">
              <div>
                {(
                  Object.keys(templateLabels) as GoalDraftInput["templateKey"][]
                ).map((templateKey) => (
                  <Button
                    aria-pressed={form.templateKey === templateKey}
                    key={templateKey}
                    onClick={() => chooseTemplate(templateKey)}
                    size="compact"
                  >
                    {templateLabels[templateKey]}
                  </Button>
                ))}
              </div>
            </Panel>
          )}

          <div className="goal-edit-grid">
            <form className="goal-form" onSubmit={submit}>
              <Panel
                action={
                  selectedGoal?.isPrimary === true ? (
                    <Badge tone="positive">Primary</Badge>
                  ) : (
                    <Button
                      aria-pressed={form.makePrimary}
                      onClick={() =>
                        updateForm("makePrimary", !form.makePrimary)
                      }
                      size="compact"
                    >
                      {form.makePrimary ? "Primary on save" : "Make primary"}
                    </Button>
                  )
                }
                className="goal-form__panel"
                eyebrow={
                  selectedGoal === null
                    ? "New draft"
                    : `Editing v${latestGoalVersion(selectedGoal).version}`
                }
                title={
                  selectedGoal === null
                    ? "Define the goal"
                    : "Create a new version"
                }
              >
                <div className="goal-form__fields">
                  <Field label="Goal name" variant="filled" wide>
                    <Input
                      maxLength={120}
                      onChange={(event) =>
                        updateForm("name", event.target.value)
                      }
                      required
                      value={form.name}
                    />
                  </Field>
                  <Field label="How success is measured" variant="filled" wide>
                    <Input
                      maxLength={120}
                      onChange={(event) =>
                        updateForm("metricLabel", event.target.value)
                      }
                      required
                      value={form.metricLabel}
                    />
                  </Field>
                  <Field label="Unit" variant="filled">
                    <Select
                      items={GOAL_UNIT_OPTIONS}
                      onValueChange={(value) => {
                        if (
                          value === "minor_units" ||
                          value === "months" ||
                          value === "count" ||
                          value === "ppm"
                        ) {
                          updateForm("targetUnit", value);
                        }
                      }}
                      value={form.targetUnit}
                    >
                      <SelectTrigger aria-label="Unit">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GOAL_UNIT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Current value" variant="filled">
                    <InputGroup
                      prefix={
                        form.targetUnit === "minor_units" ? "$" : undefined
                      }
                    >
                      <Input
                        inputMode="decimal"
                        onChange={(event) =>
                          updateForm("currentValue", event.target.value)
                        }
                        required
                        value={form.currentValue}
                      />
                    </InputGroup>
                  </Field>
                  <Field label="Target value · optional" variant="filled">
                    <InputGroup
                      prefix={
                        form.targetUnit === "minor_units" ? "$" : undefined
                      }
                    >
                      <Input
                        inputMode="decimal"
                        onChange={(event) =>
                          updateForm("targetValue", event.target.value)
                        }
                        value={form.targetValue}
                      />
                    </InputGroup>
                  </Field>
                  <Field label="Target date · optional" variant="filled">
                    <DatePicker
                      aria-label="Target date"
                      onValueChange={(value) => updateForm("targetDate", value)}
                      value={form.targetDate}
                    />
                  </Field>
                  <Field label="What changed" variant="filled" wide>
                    <Input
                      maxLength={500}
                      onChange={(event) =>
                        updateForm("changeNote", event.target.value)
                      }
                      required
                      value={form.changeNote}
                    />
                  </Field>
                </div>

                {saveMessage !== null && (
                  <FormMessage
                    tone={
                      saveState === "error"
                        ? "error"
                        : saveState === "saved"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {saveMessage}
                  </FormMessage>
                )}
                <ActionGroup
                  className="goal-form__actions"
                  mobileLayout="stack"
                >
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
                </ActionGroup>
              </Panel>
            </form>

            <Panel
              aria-live="polite"
              className="goal-preview"
              eyebrow="Live preview"
              title={form.name || "Untitled goal"}
            >
              {preview === null ? (
                <EmptyState title="Preview unavailable">
                  Enter a valid current value and complete the required fields.
                </EmptyState>
              ) : (
                <>
                  <MetricCard
                    className="goal-preview__measure"
                    detail={
                      preview.targetValueInteger === null
                        ? "No target set"
                        : `${formatProbability(
                            preview.progressPpm ?? 0,
                          )} of ${formatGoalValue(
                            preview.targetValueInteger,
                            form.targetUnit,
                          )}`
                    }
                    label={form.metricLabel || "Progress measure"}
                    value={formatGoalValue(
                      preview.currentValueInteger,
                      form.targetUnit,
                    )}
                  />
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
            </Panel>
          </div>

          {selectedGoal !== null && (
            <Panel
              className="goal-version-history"
              eyebrow="Version history"
              title="Prior decisions stay visible"
            >
              <div>
                {selectedGoal.versions.map((version) => (
                  <article key={version.id}>
                    <span className="goal-version-history__version">
                      v{version.version}
                    </span>
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
            </Panel>
          )}
        </div>
      </div>
    </ScreenLayout>
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
  if (
    holding.administratorNavState === "not_set" &&
    (holding.sourceLabel === "Tokenfolio template" ||
      holding.sourceLabel === "Sydecar template")
  ) {
    return "Not reported";
  }
  return holdingValueLabel(holding.administratorNavMinor);
}

function isPlaidInvestmentsHolding(holding: Holding): boolean {
  return holding.sourceLabel === "Plaid Investments";
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
    return provider === "plaid_investments" ? "Not available" : "Not reported";
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
    no_change: "Position unchanged",
    needs_attention: "Needs attention",
  }[action];
}

function importCurrentGroupingLabel(
  row: HoldingImportRowPreview,
  provider: HoldingImportPreview["provider"],
): string | null {
  if (provider === "plaid_investments") {
    return null;
  }
  if (row.currentExposureNames.length === 0) {
    return row.action === "append_snapshot" || row.action === "no_change"
      ? "No reviewed grouping yet"
      : null;
  }
  const visibleNames = row.currentExposureNames.slice(0, 2);
  const remainingCount = row.currentExposureNames.length - visibleNames.length;
  return `Grouped under ${visibleNames.join(", ")}${remainingCount > 0 ? ` + ${remainingCount} more` : ""}`;
}

function importDecisionForRow(
  row: HoldingImportRowPreview,
  provider: HoldingImportPreview["provider"],
  included: boolean,
): HoldingImportApplyInput["decisions"][number] {
  if (row.action === "needs_attention" || !included) {
    return {
      rowId: row.id,
      decision: "rejected",
      rationale:
        row.action === "needs_attention"
          ? "Excluded because the imported position needs attention."
          : `Excluded during the ${holdingImportProviderName(provider)} holdings import review.`,
    };
  }
  return {
    rowId: row.id,
    decision: "accepted",
    rationale:
      row.action === "no_change"
        ? "Reviewed; no accepted holding change was required."
        : `Accepted during the ${holdingImportProviderName(provider)} holdings import review.`,
  };
}

function holdingImportProviderName(
  provider: HoldingImportPreview["provider"],
): string {
  return {
    angellist: "AngelList",
    plaid_investments: "investment account",
    sydecar: "Sydecar",
    tokenfolio: "Tokenfolio",
  }[provider];
}

const HOLDING_IMPORT_PROVIDER_OPTIONS = [
  { label: "AngelList", value: "angellist" },
  { label: "Tokenfolio", value: "tokenfolio" },
  { label: "Sydecar", value: "sydecar" },
] satisfies ReadonlyArray<{
  label: string;
  value: UploadHoldingImportProvider;
}>;

function holdingImportSourceLabel(
  provider: HoldingImportPreview["provider"],
): string {
  return {
    angellist: "AngelList export",
    plaid_investments: "Investment account",
    sydecar: "Sydecar template",
    tokenfolio: "Tokenfolio template",
  }[provider];
}

function ImportResult({
  provider,
  row,
}: {
  provider: HoldingImportPreview["provider"];
  row: HoldingImportRowPreview;
}) {
  const label =
    row.adjudicationStatus === "auto_applied"
      ? "Applied automatically"
      : row.adjudicationStatus === "quarantined"
        ? "Isolated"
        : importActionLabel(row.action);
  const groupingLabel = importCurrentGroupingLabel(row, provider);
  return (
    <div className={`import-result import-result--${row.action}`}>
      {row.adjudicationStatus === "quarantined" ||
      row.action === "needs_attention" ? (
        <Badge tone="warning">{label}</Badge>
      ) : (
        <strong>{label}</strong>
      )}
      {groupingLabel !== null && <small>{groupingLabel}</small>}
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
  onPreview: (
    provider: UploadHoldingImportProvider,
    file: File,
  ) => Promise<HoldingImportPreview>;
}) {
  const [selectedProvider, setSelectedProvider] =
    useState<UploadHoldingImportProvider>(
      initialPreview === null ||
        initialPreview === undefined ||
        initialPreview.provider === "plaid_investments"
        ? "angellist"
        : initialPreview.provider,
    );
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
  const [excludedRowIds, setExcludedRowIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  const provider = preview?.provider ?? selectedProvider;
  const providerName = holdingImportProviderName(provider);
  const isPlaidInvestments = provider === "plaid_investments";
  const isAngelList = provider === "angellist";
  const unavailableValueCount =
    preview?.rows.filter((row) => row.administratorNavState !== "reported")
      .length ?? 0;

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
    setExcludedRowIds(new Set());
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
      setError(
        selectedProvider === "angellist"
          ? "Choose an AngelList investments CSV export to continue."
          : `Choose the completed Keel ${holdingImportProviderName(selectedProvider)} CSV template to continue.`,
      );
      return;
    }
    setWorking("previewing");
    setError(null);
    void onPreview(selectedProvider, selectedFile)
      .then((nextPreview) => {
        setPreview(nextPreview);
        setExcludedRowIds(new Set());
        setPage(0);
        window.requestAnimationFrame(() =>
          workspaceHeadingRef.current?.focus(),
        );
      })
      .catch((previewError: unknown) => {
        setError(
          previewError instanceof Error
            ? previewError.message
            : `This file could not be reviewed. Choose a supported ${holdingImportSourceLabel(selectedProvider)}.`,
        );
      })
      .finally(() => setWorking("idle"));
  };

  const applyPreview = () => {
    if (preview === null) {
      return;
    }
    const pendingRows = preview.rows.filter(
      (row) => row.adjudicationStatus === "pending_review",
    );
    const hasIncludedRows = pendingRows.some(
      (row) => row.action !== "needs_attention" && !excludedRowIds.has(row.id),
    );
    if (hasIncludedRows && !currencyConfirmed) {
      return;
    }
    setWorking("applying");
    setError(null);
    void onApply(preview.id, {
      currency: "USD",
      decisions: preview.rows
        .filter((row) => row.adjudicationStatus === "pending_review")
        .map((row) =>
          importDecisionForRow(
            row,
            preview.provider,
            row.action !== "needs_attention" && !excludedRowIds.has(row.id),
          ),
        ),
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
    const allRowsRejected =
      applyResult.rejectedCount === preview.summary.rowCount;
    return (
      <section
        aria-labelledby="holding-import-success-title"
        className="holding-import-workspace"
      >
        <Notice
          className="import-message import-message--success"
          ref={messageRef}
          tabIndex={-1}
        >
          <p className="eyebrow">
            {allRowsRejected
              ? "Import rejected"
              : isPlaidInvestments
                ? "Automatic update"
                : "Import reviewed"}
          </p>
          <h2 id="holding-import-success-title">
            {allRowsRejected || changedCount === 0
              ? "No holdings changed"
              : `${changedCount} ${changedCount === 1 ? "change" : "changes"} applied`}
          </h2>
          {allRowsRejected ? (
            <p>
              Excluded all {preview.summary.rowCount} {providerName} positions.
              The import is reviewed and accepted holdings are unchanged.
            </p>
          ) : isPlaidInvestments ? (
            <p>
              Reviewed {preview.summary.rowCount} investment positions.{" "}
              {preview.summary.administratorValueCount} market values were
              recorded from this snapshot.
            </p>
          ) : isAngelList ? (
            <p>
              Reviewed {preview.summary.rowCount} AngelList positions.{" "}
              {preview.summary.administratorValueCount} administrator values
              were available; {applyResult.lockedValueCount} locked values
              remain unavailable.
            </p>
          ) : (
            <p>
              Reviewed {preview.summary.rowCount} {providerName} positions.{" "}
              {preview.summary.administratorValueCount} current values were
              available; {unavailableValueCount} unavailable values remain
              explicit.
            </p>
          )}
          {!allRowsRejected && applyResult.rejectedCount > 0 && (
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
        </Notice>
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
          <p className="eyebrow">Review first</p>
          <h2 id="holding-import-title" ref={workspaceHeadingRef} tabIndex={-1}>
            Import holdings
          </h2>
          <p id="holding-import-boundary">
            {selectedProvider === "angellist"
              ? "Choose your AngelList investments CSV export. Nothing changes until you review it."
              : `Use Keel’s ${holdingImportProviderName(selectedProvider)} template and copy one row per legal position. Enter funded capital as Invested; leave unavailable current values blank. Nothing changes until review.`}
          </p>
        </div>
        <form className="import-upload" onSubmit={requestPreview}>
          <Field htmlFor="holding-import-provider" label="Source">
            <Select
              disabled={working !== "idle"}
              items={HOLDING_IMPORT_PROVIDER_OPTIONS}
              onValueChange={(nextProvider) => {
                if (
                  nextProvider !== "angellist" &&
                  nextProvider !== "tokenfolio" &&
                  nextProvider !== "sydecar"
                ) {
                  return;
                }
                setSelectedProvider(nextProvider);
                setSelectedFile(null);
                setCurrencyConfirmed(false);
                setError(null);
                if (fileInputRef.current !== null) {
                  fileInputRef.current.value = "";
                }
              }}
              value={selectedProvider}
            >
              <SelectTrigger aria-label="Source" id="holding-import-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLDING_IMPORT_PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {selectedProvider !== "angellist" && (
            <div className="import-template-help">
              <ButtonLink
                download
                href={`/api/holding-import-templates/${selectedProvider}`}
                size="compact"
                tone="secondary"
              >
                Download {holdingImportProviderName(selectedProvider)} template
              </ButtonLink>
              <small>
                Keep the first two lines. Use Direct, SPV, or Fund; Live or
                Realized; YYYY-MM-DD dates; and USD values such as $1250.00.
              </small>
            </div>
          )}
          <Field
            htmlFor="holding-import-file"
            label={
              selectedProvider === "angellist"
                ? "AngelList CSV export"
                : `${holdingImportProviderName(selectedProvider)} template`
            }
          >
            <Input
              accept=".csv,text/csv"
              aria-describedby={`holding-import-boundary${error === null ? "" : " holding-import-error"}`}
              aria-invalid={error === null ? undefined : true}
              disabled={working !== "idle"}
              id="holding-import-file"
              onChange={(event) => {
                setSelectedFile(event.currentTarget.files?.[0] ?? null);
                setCurrencyConfirmed(false);
                setError(null);
              }}
              ref={fileInputRef}
              type="file"
            />
          </Field>
          {error !== null && (
            <Notice
              id="holding-import-error"
              ref={messageRef}
              tabIndex={-1}
              tone="error"
            >
              {error}
            </Notice>
          )}
          <ActionGroup
            align="end"
            className="import-actions"
            mobileLayout="grid"
          >
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
          </ActionGroup>
        </form>
      </section>
    );
  }

  if (isPlaidInvestments && preview.status === "quarantined") {
    const exceptionRows = preview.rows.filter(
      (row) => row.adjudicationStatus === "quarantined",
    );
    return (
      <section
        aria-labelledby="holding-import-exceptions-title"
        className="holding-import-workspace"
      >
        <div className="import-heading">
          <p className="eyebrow">Investment exceptions</p>
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

        <StatGroup
          aria-label="Automatic review summary"
          className="import-summary"
        >
          <Stat
            as="div"
            label="Applied"
            value={preview.summary.autoAppliedCount}
            valueFirst
          />
          <Stat
            as="div"
            label="Exceptions"
            value={preview.summary.quarantinedCount}
            valueFirst
          />
          <Stat
            as="div"
            label="Prior positions kept"
            value={preview.summary.preservedPositionCount}
            valueFirst
          />
        </StatGroup>

        {preview.summary.preservedPositionCount > 0 && (
          <Notice className="import-attention">
            This account did not report {preview.summary.preservedPositionCount}{" "}
            prior{" "}
            {preview.summary.preservedPositionCount === 1
              ? "position"
              : "positions"}
            . Keel kept the last accepted values and did not infer sales.
          </Notice>
        )}

        {exceptionRows.length > 0 && (
          <Panel className="table-panel import-table-panel">
            <div className="holdings-table-wrap">
              <table className="data-table import-table">
                <caption className="visually-hidden">
                  Isolated investment positions
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
                        <ImportResult provider={preview.provider} row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        <ActionGroup align="end" className="import-actions" mobileLayout="grid">
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </ActionGroup>
      </section>
    );
  }

  if (isPlaidInvestments && preview.status === "pending_review") {
    return (
      <section
        aria-labelledby="holding-import-checking-title"
        className="holding-import-workspace"
      >
        <div className="import-heading">
          <p className="eyebrow">Investment update</p>
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
        <ActionGroup align="end" className="import-actions" mobileLayout="grid">
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </ActionGroup>
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
            {isPlaidInvestments ? (
              <>
                Keel applied {preview.summary.autoAppliedCount} clear positions
                from the {formatDate(preview.observedAt)} snapshot.
              </>
            ) : (
              <>
                Reviewed {preview.summary.rowCount} positions from the{" "}
                {holdingImportSourceLabel(provider).toLowerCase()} dated{" "}
                {formatDate(preview.observedAt)}.
              </>
            )}
          </p>
        </div>
        <ActionGroup align="end" className="import-actions" mobileLayout="grid">
          <Button onClick={onClose} tone="primary">
            Back to holdings
          </Button>
        </ActionGroup>
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
  const reviewRows = preview.rows.filter(
    (row) => row.adjudicationStatus === "pending_review",
  );
  const rowIsIncluded = (row: HoldingImportRowPreview) =>
    row.action !== "needs_attention" && !excludedRowIds.has(row.id);
  const includedRows = reviewRows.filter(rowIsIncluded);
  const includedCount = includedRows.length;
  const excludedCount = reviewRows.length - includedCount;
  const includedCreateCount = includedRows.filter(
    (row) => row.action === "create_position",
  ).length;
  const includedUpdateCount = includedRows.filter(
    (row) => row.action === "append_snapshot",
  ).length;
  const includedUnchangedCount = includedRows.filter(
    (row) => row.action === "no_change",
  ).length;
  const includedChangeCount = includedCreateCount + includedUpdateCount;
  const includedLockedValueCount = includedRows.filter(
    (row) => row.administratorNavState === "locked",
  ).length;
  const includedUnavailableValueCount = includedRows.filter(
    (row) => row.administratorNavState !== "reported",
  ).length;
  const allRowsExcluded = includedCount === 0;
  const primaryActionLabel = allRowsExcluded
    ? "Reject import"
    : `Apply ${includedCount} ${includedCount === 1 ? "position" : "positions"}`;
  const hasReportedCarry = preview.rows.some(
    (row) => row.reportedCarryPpm !== null,
  );

  return (
    <section
      aria-busy={working === "applying"}
      aria-labelledby="holding-import-title"
      className="holding-import-workspace"
    >
      <div className="import-heading">
        <p className="eyebrow">
          {isPlaidInvestments
            ? "Investment sync"
            : holdingImportSourceLabel(provider)}
        </p>
        <h2 id="holding-import-title" ref={workspaceHeadingRef} tabIndex={-1}>
          Review {providerName} import
        </h2>
        {isPlaidInvestments ? (
          <p>
            Snapshot dated {formatDate(preview.observedAt)}. Positions missing
            from this snapshot are not treated as sales.
          </p>
        ) : isAngelList ? (
          <p>
            Export dated {formatDate(preview.observedAt)}. Locked values stay
            unavailable; Keel will not treat them as zero.
            {hasReportedCarry &&
              " Reported carry stays pending until reviewed in the position."}
          </p>
        ) : provider === "sydecar" ? (
          <p>
            Snapshot dated {formatDate(preview.observedAt)}. Missing current
            values stay unavailable. Existing company groupings stay in place.
            Reported fee and carry stay pending until reviewed in each position.
          </p>
        ) : (
          <p>
            Snapshot dated {formatDate(preview.observedAt)}. Missing current
            values stay unavailable; Keel will not treat them as zero.
          </p>
        )}
      </div>

      <StatGroup aria-label="Import summary" className="import-summary">
        <Stat
          as="div"
          label="Positions"
          value={preview.summary.rowCount}
          valueFirst
        />
        <Stat
          as="div"
          label={
            isPlaidInvestments
              ? "Market values"
              : isAngelList
                ? "Administrator values"
                : "Current values"
          }
          value={preview.summary.administratorValueCount}
          valueFirst
        />
        <Stat
          as="div"
          label={
            isPlaidInvestments
              ? "Need attention"
              : isAngelList
                ? "Locked values"
                : "Unavailable values"
          }
          value={
            isPlaidInvestments
              ? preview.summary.needsAttentionCount
              : isAngelList
                ? preview.summary.lockedValueCount
                : unavailableValueCount
          }
          valueFirst
        />
      </StatGroup>

      {preview.summary.needsAttentionCount > 0 && (
        <Notice className="import-attention">
          {preview.summary.needsAttentionCount}{" "}
          {preview.summary.needsAttentionCount === 1
            ? "position needs"
            : "positions need"}{" "}
          attention and will not be applied.
        </Notice>
      )}

      {error !== null && (
        <Notice ref={messageRef} tabIndex={-1} tone="error">
          {error} Nothing changed. Try again.
        </Notice>
      )}

      <Panel className="table-panel import-table-panel">
        <div className="holdings-table-wrap">
          <table className="data-table import-table">
            <caption className="visually-hidden">
              {providerName} positions ready for review
            </caption>
            <thead>
              {isPlaidInvestments ? (
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
                  <th>{isAngelList ? "Admin value" : "Current value"}</th>
                  <th>Import result</th>
                </tr>
              )}
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                const included = rowIsIncluded(row);
                return isPlaidInvestments ? (
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
                      <ImportResult provider={preview.provider} row={row} />
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
                        {row.investedOnState === "reported" &&
                        row.investedOn !== null
                          ? `Invested ${formatDate(row.investedOn)}`
                          : "Investment date not reported"}
                      </span>
                    </td>
                    <td data-label="Invested">
                      {formatCompactMoney(row.investedMinor)}
                      {(row.reportedManagementFeePpm !== null ||
                        row.reportedCarryPpm !== null) && (
                        <span className="source-meta">
                          {row.reportedManagementFeePpm !== null && (
                            <>
                              Fee{" "}
                              {formatProbability(row.reportedManagementFeePpm)}
                            </>
                          )}
                          {row.reportedManagementFeePpm !== null &&
                            row.reportedCarryPpm !== null &&
                            " · "}
                          {row.reportedCarryPpm !== null && (
                            <>Carry {formatProbability(row.reportedCarryPpm)}</>
                          )}
                        </span>
                      )}
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
                      data-label={isAngelList ? "Admin value" : "Current value"}
                    >
                      {importAdministratorValueLabel(row, preview.provider)}
                    </td>
                    <td data-label="Import result">
                      <ImportResult provider={preview.provider} row={row} />
                      {row.adjudicationStatus === "pending_review" && (
                        <label
                          className={`import-row-decision${included ? "" : " import-row-decision--excluded"}`}
                        >
                          <Input
                            aria-label={
                              row.action === "needs_attention"
                                ? `${row.exposureName} is excluded because it needs attention`
                                : `Include ${row.exposureName}`
                            }
                            checked={included}
                            disabled={
                              row.action === "needs_attention" ||
                              working !== "idle"
                            }
                            onChange={(event) => {
                              const nextIncluded = event.currentTarget.checked;
                              setExcludedRowIds((current) => {
                                const next = new Set(current);
                                if (nextIncluded) {
                                  next.delete(row.id);
                                } else {
                                  next.add(row.id);
                                }
                                return next;
                              });
                            }}
                            type="checkbox"
                          />
                          <span>
                            {row.action === "needs_attention"
                              ? "Excluded by Keel"
                              : included
                                ? "Included"
                                : "Excluded"}
                          </span>
                        </label>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <nav aria-label="Import preview pages" className="import-pagination">
        <span>
          {pageStart + 1}–{pageEnd} of {preview.rows.length}
        </span>
        <div>
          <TextLink
            aria-label="Previous import preview page"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
          >
            Previous
          </TextLink>
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <TextLink
            aria-label="Next import preview page"
            disabled={page + 1 >= pageCount}
            onClick={() =>
              setPage((current) => Math.min(pageCount - 1, current + 1))
            }
          >
            Next
          </TextLink>
        </div>
      </nav>

      <label className="import-currency-confirmation">
        <Input
          checked={currencyConfirmed}
          onChange={(event) =>
            setCurrencyConfirmed(event.currentTarget.checked)
          }
          type="checkbox"
        />
        <span>
          I confirm the{" "}
          {isPlaidInvestments
            ? "investment account’s"
            : isAngelList
              ? "export’s"
              : "template’s"}{" "}
          $ values are USD.
        </span>
      </label>

      {confirming ? (
        <ActionGroup
          aria-labelledby="holding-import-confirmation-title"
          className="import-confirmation"
          layout="split"
          mobileLayout="stack"
        >
          <div>
            <p className="eyebrow">Final review</p>
            <h3
              id="holding-import-confirmation-title"
              ref={confirmationHeadingRef}
              tabIndex={-1}
            >
              {allRowsExcluded
                ? "Reject this import?"
                : "Apply the reviewed import?"}
            </h3>
            {allRowsExcluded ? (
              <p>
                Exclude all {excludedCount} positions. Accepted holdings will
                not change, and this import will leave the review queue.
              </p>
            ) : isPlaidInvestments ? (
              <p>
                Create {preview.summary.createCount}, update{" "}
                {preview.summary.updateCount}, and confirm{" "}
                {preview.summary.unchangedCount} unchanged. Missing positions
                will not be recorded as sales. No forecast, underwriting value,
                or usable liquidity will be inferred.
              </p>
            ) : isAngelList ? (
              <p>
                Create {includedCreateCount}, update {includedUpdateCount}, and
                confirm {includedUnchangedCount} unchanged.
                {excludedCount > 0 && (
                  <>
                    {" "}
                    {excludedCount}{" "}
                    {excludedCount === 1 ? "position is" : "positions are"}{" "}
                    excluded.
                  </>
                )}{" "}
                {includedLockedValueCount} locked values will remain
                unavailable. No forecast, underwriting value, or liquidity value
                will be inferred.
              </p>
            ) : (
              <p>
                Create {includedCreateCount}, update {includedUpdateCount}, and
                confirm {includedUnchangedCount} unchanged.
                {excludedCount > 0 && (
                  <>
                    {" "}
                    {excludedCount}{" "}
                    {excludedCount === 1 ? "position is" : "positions are"}{" "}
                    excluded.
                  </>
                )}{" "}
                {includedUnavailableValueCount} unavailable values will remain
                explicit. No forecast, underwriting value, or liquidity value
                will be inferred.
              </p>
            )}
          </div>
          <ActionGroup align="end" mobileLayout="grid">
            <Button
              disabled={working !== "idle"}
              onClick={() => setConfirming(false)}
              tone="quiet"
            >
              Back
            </Button>
            <Button
              disabled={
                working !== "idle" || (!allRowsExcluded && !currencyConfirmed)
              }
              onClick={applyPreview}
              tone="primary"
            >
              {working === "applying"
                ? "Applying…"
                : allRowsExcluded
                  ? "Reject import"
                  : includedChangeCount === 0
                    ? "Confirm review"
                    : "Confirm & apply"}
            </Button>
          </ActionGroup>
        </ActionGroup>
      ) : (
        <ActionGroup
          className="import-footer"
          layout="split"
          mobileLayout="stack"
        >
          <div>
            <strong>
              {includedCount} included · {excludedCount} excluded
            </strong>
            <span>Excluded rows will not change accepted holdings.</span>
          </div>
          <ActionGroup align="end" mobileLayout="grid">
            <Button
              onClick={initialPreview === null ? resetFile : onClose}
              tone="quiet"
            >
              {initialPreview === null ? "Choose another file" : "Back"}
            </Button>
            <Button
              disabled={working !== "idle"}
              onClick={() => {
                setExcludedRowIds(new Set(reviewRows.map((row) => row.id)));
                setConfirming(true);
              }}
              tone="quiet"
            >
              Reject entire import
            </Button>
            <Button
              disabled={!allRowsExcluded && !currencyConfirmed}
              onClick={() => setConfirming(true)}
              tone="primary"
            >
              {primaryActionLabel}
            </Button>
          </ActionGroup>
        </ActionGroup>
      )}
    </section>
  );
}

const POSITION_VALUE_SOURCE_OPTIONS = [
  { label: "GP update", value: "gp_update" },
  { label: "News article", value: "news_article" },
  { label: "Other", value: "other" },
] as const satisfies ReadonlyArray<{
  label: string;
  value: PositionValueSourceKind;
}>;

function positionValueSourceKindLabel(kind: PositionValueSourceKind): string {
  return (
    POSITION_VALUE_SOURCE_OPTIONS.find((option) => option.value === kind)
      ?.label ?? "Other"
  );
}

function positionValueSourceUrlIsValid(value: string): boolean {
  if (value.length === 0) {
    return true;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

function PositionValueAdjustmentEditor({
  holding,
  onAccepted,
}: {
  holding: Holding;
  onAccepted: () => Promise<void>;
}) {
  const context = holding.positionValueContext ?? null;
  const projectedEstimate = context?.projectedEstimate ?? null;
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [value, setValue] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(
    new Date().toISOString().slice(0, "YYYY-MM-DD".length),
  );
  const [sourceKind, setSourceKind] =
    useState<PositionValueSourceKind>("gp_update");
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [commentary, setCommentary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (context === null) {
    return null;
  }

  const valueMinor = parseMoneyInput(value);
  const trimmedUrl = sourceUrl.trim();
  const canReview =
    valueMinor !== null &&
    effectiveDate.length > 0 &&
    sourceLabel.trim().length > 0 &&
    commentary.trim().length >= 3 &&
    positionValueSourceUrlIsValid(trimmedUrl) &&
    (sourceKind !== "news_article" || trimmedUrl.length > 0);
  const currentValueMinor =
    context.acceptedAdjustment?.valueMinor ?? context.providerValueMinor;
  const currentValueLabel =
    currentValueMinor === null
      ? context.providerValueState === "locked"
        ? "Locked"
        : "Not reported"
      : formatCompactCurrency(currentValueMinor, context.currency).replace(
          /^USD /u,
          "$",
        );
  const proposedValueLabel =
    valueMinor === null
      ? "Not set"
      : formatCompactCurrency(valueMinor, context.currency).replace(
          /^USD /u,
          "$",
        );

  const reset = () => {
    setOpen(false);
    setReviewing(false);
    setValue("");
    setSourceKind("gp_update");
    setSourceLabel("");
    setSourceUrl("");
    setCommentary("");
    setError(null);
  };

  const openEditor = () => {
    if (projectedEstimate !== null) {
      setValue(moneyInputValue(projectedEstimate.valueMinor));
      setEffectiveDate(projectedEstimate.effectiveDate);
      setSourceKind("other");
      setSourceLabel(
        `Portfolio Watch + ${projectedEstimate.referenceSourceLabel}`.slice(
          0,
          240,
        ),
      );
      setSourceUrl("");
      setCommentary(
        `Estimated from the ${projectedEstimate.referenceSourceLabel} position mark using the reviewed financing valuations nearest the reference and this tranche dates.`,
      );
    }
    setOpen(true);
    setNotice(null);
  };

  const accept = async () => {
    if (!canReview || valueMinor === null) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await acceptPositionValueAdjustment(holding.id, {
        expectedSnapshotId: context.snapshotId,
        expectedAdjustmentId: context.acceptedAdjustment?.id ?? null,
        valueMinor,
        currency: context.currency,
        effectiveDate,
        sourceKind,
        sourceLabel: sourceLabel.trim(),
        sourceUrl: trimmedUrl.length === 0 ? null : trimmedUrl,
        commentary: commentary.trim(),
      });
      await onAccepted();
      reset();
      setNotice("Reviewed value accepted. Exposure totals now use this mark.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The reviewed value could not be accepted.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="position-value-adjustment-title"
      className="position-value-adjustment"
    >
      <div className="position-value-adjustment__heading">
        <div>
          <p className="eyebrow">Your evidence</p>
          <h3 id="position-value-adjustment-title">Position value</h3>
          <p>
            {projectedEstimate === null
              ? "Add a sourced mark when you know more than the latest provider update."
              : "Review the Portfolio Watch estimate or replace it with stronger position evidence."}
          </p>
        </div>
        {!open && (
          <Button onClick={openEditor} tone="secondary">
            {context.acceptedAdjustment === null
              ? projectedEstimate === null
                ? "Add value evidence"
                : "Review estimate"
              : "Update value evidence"}
          </Button>
        )}
      </div>

      {notice !== null && <FormMessage tone="success">{notice}</FormMessage>}
      {open && !reviewing && (
        <form
          className="position-value-adjustment__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (canReview) {
              setReviewing(true);
              setError(null);
            }
          }}
        >
          <div className="position-value-adjustment__fields">
            <Field label={`Value · ${context.currency}`} variant="filled">
              <InputGroup
                prefix={context.currency === "USD" ? "$" : context.currency}
              >
                <Input
                  inputMode="decimal"
                  onChange={(event) => setValue(event.currentTarget.value)}
                  required
                  value={value}
                />
              </InputGroup>
            </Field>
            <Field label="As of" variant="filled">
              <DatePicker
                aria-label="As of"
                max={new Date().toISOString().slice(0, "YYYY-MM-DD".length)}
                onValueChange={setEffectiveDate}
                required
                value={effectiveDate}
              />
            </Field>
            <Field label="Source type" variant="filled">
              <Select
                items={POSITION_VALUE_SOURCE_OPTIONS}
                onValueChange={(next) => {
                  if (
                    next === "gp_update" ||
                    next === "news_article" ||
                    next === "other"
                  ) {
                    setSourceKind(next);
                  }
                }}
                value={sourceKind}
              >
                <SelectTrigger aria-label="Position value source type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POSITION_VALUE_SOURCE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Source name" variant="filled">
              <Input
                maxLength={240}
                onChange={(event) => setSourceLabel(event.currentTarget.value)}
                placeholder="Q2 GP update"
                required
                value={sourceLabel}
              />
            </Field>
            <Field
              description={
                sourceKind === "news_article"
                  ? "Required for a news article. HTTPS only."
                  : "Optional. HTTPS only."
              }
              label="Source link"
              variant="filled"
              wide
            >
              <Input
                inputMode="url"
                onChange={(event) => setSourceUrl(event.currentTarget.value)}
                placeholder="https://…"
                required={sourceKind === "news_article"}
                type="url"
                value={sourceUrl}
              />
            </Field>
            <Field label="What this value reflects" variant="filled" wide>
              <Textarea
                maxLength={1_000}
                onChange={(event) => setCommentary(event.currentTarget.value)}
                required
                rows={3}
                value={commentary}
              />
            </Field>
          </div>
          {error !== null && <Notice tone="error">{error}</Notice>}
          <ActionGroup
            align="end"
            className="position-value-adjustment__actions"
            mobileLayout="grid"
          >
            <Button disabled={busy} onClick={reset} tone="quiet" type="button">
              Cancel
            </Button>
            <Button disabled={!canReview || busy} tone="primary" type="submit">
              Review value
            </Button>
          </ActionGroup>
        </form>
      )}

      {open && reviewing && (
        <div className="position-value-adjustment__review">
          <div>
            <span>Position value</span>
            <strong>
              {currentValueLabel} → {proposedValueLabel}
            </strong>
            <small>
              {sourceLabel.trim()} · {positionValueSourceKindLabel(sourceKind)}{" "}
              · As of {formatDate(effectiveDate)}
            </small>
          </div>
          <p>{commentary.trim()}</p>
          {trimmedUrl.length > 0 && (
            <TextLink href={trimmedUrl} rel="noreferrer" target="_blank">
              Open source
            </TextLink>
          )}
          <small>
            The provider value stays in source history. Keel uses this mark
            until you accept a newer one.
          </small>
          {error !== null && <Notice tone="error">{error}</Notice>}
          <ActionGroup
            align="end"
            className="position-value-adjustment__actions"
            mobileLayout="grid"
          >
            <Button
              disabled={busy}
              onClick={() => setReviewing(false)}
              tone="quiet"
            >
              Back
            </Button>
            <Button
              disabled={busy}
              onClick={() => void accept()}
              tone="primary"
            >
              {busy ? "Accepting…" : "Accept value"}
            </Button>
          </ActionGroup>
        </div>
      )}
    </section>
  );
}

function isCashLikeHolding(holding: Holding): boolean {
  return holding.instrumentType?.trim().toLowerCase() === "cash";
}

function PositionPerformanceSummary({ holding }: { holding: Holding }) {
  if (isCashLikeHolding(holding)) {
    return null;
  }
  const acceptedAdjustment =
    holding.positionValueContext?.acceptedAdjustment ?? null;
  const projectedEstimate =
    holding.positionValueContext?.projectedEstimate ?? null;
  const currentValueMinor =
    acceptedAdjustment?.valueMinor ??
    holding.administratorNavMinor ??
    projectedEstimate?.valueMinor ??
    null;
  const currentValueReported =
    acceptedAdjustment !== null ||
    holding.administratorNavState === "reported" ||
    projectedEstimate !== null;
  const performance = calculatePositionPerformance({
    currentValueMinor,
    currentValueReported,
    realizedValueMinor: holding.realizedValueMinor ?? 0,
    providerCostBasisMinor: holding.costBasisMinor,
    fundedMinor: holding.investedMinor ?? null,
    economicsContext: holding.positionEconomicsContext ?? null,
    allowFundedAmountEstimate:
      holding.companyId !== null ||
      holding.positionKind === "spv_interest" ||
      holding.positionKind === "fund_interest",
  });
  const basisHelper = {
    provider: "Reported by the brokerage source.",
    reviewed_spv_terms: "Commitment less the reviewed upfront admin fee.",
    funded_amount_estimate: "Funded amount estimate; fee terms are not set.",
  }[performance.costBasisSource ?? "funded_amount_estimate"];

  return (
    <section
      aria-labelledby="holding-performance-title"
      className="holding-performance"
    >
      <p className="eyebrow">Performance</p>
      <h3 id="holding-performance-title">Position return</h3>
      <StatGroup className="holding-performance__values">
        <Stat
          detail={
            performance.costBasisMinor === null
              ? "Add SPV terms or wait for source cost basis."
              : basisHelper
          }
          label="Cost basis"
          value={
            performance.costBasisMinor === null
              ? "Not reported"
              : formatCompactMoney(performance.costBasisMinor)
          }
          valueClassName={
            performance.costBasisMinor === null ? "is-not-set" : ""
          }
        />
        <Stat
          detail="Current value plus realized proceeds, less cost basis."
          label="Total gain / loss"
          value={
            performance.totalGainMinor === null
              ? "Unavailable"
              : `${performance.totalGainMinor > 0 ? "+" : ""}${formatCompactMoney(performance.totalGainMinor)}`.replace(
                  "-",
                  "−",
                )
          }
          valueClassName={
            performance.totalGainMinor === null ? "is-not-set" : ""
          }
        />
        <Stat
          details={
            projectedEstimate !== null && acceptedAdjustment === null
              ? [
                  "Not annualized. Carry is applied only after an exit.",
                  "Uses the Portfolio Watch estimate until stronger evidence is reviewed.",
                ]
              : ["Not annualized. Carry is applied only after an exit."]
          }
          label="Total return"
          value={
            performance.totalReturnPpm === null
              ? "Unavailable"
              : formatSignedProbability(performance.totalReturnPpm)
          }
          valueClassName={
            performance.totalReturnPpm === null ? "is-not-set" : ""
          }
        />
        {isPlaidInvestmentsHolding(holding) && (
          <Stat
            detail="Needs a prior daily price at the same share count."
            label="Day gain / loss"
            value="Unavailable"
            valueClassName="is-not-set"
          />
        )}
      </StatGroup>
    </section>
  );
}

function HoldingDetailWorkspace({
  holding,
  onValueAccepted,
}: {
  holding: Holding;
  onValueAccepted: () => Promise<void>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const primaryName = holdingPrimaryName(holding);
  const legalPositionLabel = holdingLegalPositionLabel(holding);
  const acceptedAdjustment =
    holding.positionValueContext?.acceptedAdjustment ?? null;
  const projectedEstimate =
    holding.positionValueContext?.projectedEstimate ?? null;
  const isImportedPosition =
    holding.positionValueContext !== null &&
    holding.positionValueContext !== undefined;
  const isProviderTemplateHolding =
    holding.sourceLabel === "Tokenfolio template" ||
    holding.sourceLabel === "Sydecar template";
  const sourceSectionTitle = isPlaidInvestmentsHolding(holding)
    ? "Brokerage source"
    : isImportedPosition || isProviderTemplateHolding
      ? "Imported source"
      : holding.externalMarkMinor === null
        ? "Administrator source"
        : "External mark source";
  const valueLenses = [
    {
      label: isPlaidInvestmentsHolding(holding)
        ? "Market value"
        : isProviderTemplateHolding
          ? "Current value"
          : "Administrator NAV",
      value: administratorValueLabel(holding),
      helper: isPlaidInvestmentsHolding(holding)
        ? "Brokerage-reported market value as of the source date."
        : isProviderTemplateHolding
          ? "Reviewed value copied into the provider template as of the source date."
          : holding.administratorNavState === "locked" &&
              holding.sourceLabel === "AngelList export"
            ? "AngelList did not disclose this value in the export."
            : "Administrator-reported value as of the source date.",
      wide: holding.administratorNavState === "locked",
    },
    {
      label:
        acceptedAdjustment !== null
          ? "Reviewed mark"
          : projectedEstimate !== null
            ? "Portfolio Watch estimate"
            : "External mark",
      value: holdingValueLabel(
        acceptedAdjustment?.valueMinor ??
          projectedEstimate?.valueMinor ??
          holding.externalMarkMinor,
      ),
      helper:
        acceptedAdjustment !== null
          ? `Accepted from ${acceptedAdjustment.sourceLabel} as of ${formatDate(acceptedAdjustment.effectiveDate)}.`
          : projectedEstimate !== null
            ? `Based on ${projectedEstimate.referenceSourceLabel} and reviewed financing rounds; not an accepted mark.`
            : "Latest observed third-party economic mark.",
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
        <StatGroup className="holding-detail-values">
          {valueLenses.map((lens) => (
            <Stat
              className={
                lens.wide
                  ? "holding-detail-value holding-detail-value--wide"
                  : "holding-detail-value"
              }
              detail={lens.helper}
              key={lens.label}
              label={lens.label}
              value={lens.value}
              valueClassName={lens.value === "Not set" ? "is-not-set" : ""}
            />
          ))}
        </StatGroup>
      </section>

      <PositionPerformanceSummary holding={holding} />

      <PositionEconomicsEditor holding={holding} onAccepted={onValueAccepted} />

      {!isCashLikeHolding(holding) && (
        <PositionValueAdjustmentEditor
          holding={holding}
          onAccepted={onValueAccepted}
        />
      )}

      <div className="holding-detail-records">
        <section aria-labelledby="holding-position-title">
          <p className="eyebrow">Accepted record</p>
          <h3 id="holding-position-title">Position</h3>
          <DataList>
            <DataItem label={legalPositionLabel} value={holding.positionName} />
            <DataItem label="Held through" value={holding.ownerLabel} />
            {isPlaidInvestmentsHolding(holding) && (
              <>
                <DataItem
                  label="Ticker"
                  value={holding.ticker ?? "Not reported"}
                />
                <DataItem
                  label="Shares"
                  value={formatQuantityMicros(holding.quantityMicros)}
                />
                <DataItem
                  label="Cost basis"
                  value={holdingValueLabel(holding.costBasisMinor)}
                />
              </>
            )}
          </DataList>
        </section>

        <section aria-labelledby="holding-source-title">
          <p className="eyebrow">Value evidence</p>
          <h3 id="holding-source-title">{sourceSectionTitle}</h3>
          <DataList>
            <DataItem label="Source" value={holding.sourceLabel} />
            <DataItem label="As of" value={formatDate(holding.effectiveDate)} />
            {holding.confidencePpm !== null && (
              <DataItem
                label="Source confidence"
                value={formatProbability(holding.confidencePpm)}
              />
            )}
            {holding.sourceStatus !== "verified" && (
              <DataItem
                label="Source status"
                value={<SourceBadge status={holding.sourceStatus} />}
              />
            )}
          </DataList>
        </section>
      </div>
      {acceptedAdjustment !== null && (
        <section
          aria-labelledby="holding-reviewed-mark-title"
          className="holding-reviewed-mark"
        >
          <p className="eyebrow">Reviewed position mark</p>
          <h3 id="holding-reviewed-mark-title">
            {acceptedAdjustment.sourceLabel}
          </h3>
          <DataList>
            <DataItem
              label="Value"
              value={holdingValueLabel(holding.externalMarkMinor)}
            />
            <DataItem
              label="As of"
              value={formatDate(acceptedAdjustment.effectiveDate)}
            />
            <DataItem
              label="Source"
              value={positionValueSourceKindLabel(
                acceptedAdjustment.sourceKind,
              )}
            />
            {acceptedAdjustment.sourceUrl !== null && (
              <DataItem
                label="Link"
                value={
                  <TextLink
                    href={acceptedAdjustment.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open source
                  </TextLink>
                }
              />
            )}
            <DataItem
              className="holding-reviewed-mark__commentary"
              label="Note"
              value={acceptedAdjustment.commentary}
            />
          </DataList>
        </section>
      )}
      {acceptedAdjustment === null && projectedEstimate !== null && (
        <section
          aria-labelledby="holding-portfolio-watch-estimate-title"
          className="holding-reviewed-mark"
        >
          <p className="eyebrow">Estimated position value</p>
          <h3 id="holding-portfolio-watch-estimate-title">
            Portfolio Watch estimate
          </h3>
          <DataList>
            <DataItem
              label="Value"
              value={holdingValueLabel(projectedEstimate.valueMinor)}
            />
            <DataItem
              label="As of"
              value={formatDate(projectedEstimate.effectiveDate)}
            />
            <DataItem
              label="GP mark"
              value={projectedEstimate.referenceSourceLabel}
            />
            <DataItem
              label="This tranche"
              value={
                <>
                  <TextLink
                    href={projectedEstimate.positionRound.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {projectedEstimate.positionRound.sourceTitle}
                  </TextLink>{" "}
                  · {formatDate(projectedEstimate.positionRound.effectiveDate)}
                </>
              }
            />
            <DataItem
              label="Reference tranche"
              value={
                <>
                  <TextLink
                    href={projectedEstimate.referenceRound.sourceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {projectedEstimate.referenceRound.sourceTitle}
                  </TextLink>{" "}
                  · {formatDate(projectedEstimate.referenceRound.effectiveDate)}
                </>
              }
            />
          </DataList>
          <small>
            Scales funded cost basis by the GP mark and the nearest accepted
            financing valuation for each tranche. Review it before treating it
            as a position mark; it does not enter FI planning.
          </small>
        </section>
      )}
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
      description: "Keel is checking whether your update agent is ready.",
    };
  }
  if (overview.status === "setup_required") {
    return {
      title: "Finish AngelList setup",
      description: "Sign in once on the computer that will run updates.",
    };
  }
  if (overview.status === "offline") {
    return {
      title: "AngelList is paused — agent check overdue",
      description:
        "The update computer is not responding. No holdings changed.",
    };
  }
  if (overview.status === "running") {
    return overview.runStatus === "queued"
      ? {
          title: "AngelList update is queued",
          description:
            "It will start at the next daily check. Run the update command if you need it sooner.",
        }
      : {
          title: "Importing AngelList CSV",
          description:
            "Downloading the latest CSV. Nothing changes until you review it.",
        };
  }
  if (overview.status === "needs_attention") {
    if (overview.errorCode === "angellist_sign_in_required") {
      return {
        title: "AngelList needs reconnecting",
        description:
          "Finish sign-in and 2FA in a private browser. New changes will still wait for review.",
      };
    }
    if (overview.errorCode === "keel_sign_in_required") {
      return {
        title: "AngelList is paused — agent access needs renewal",
        description:
          "The update computer needs troubleshooting. Your AngelList sign-in can stay as-is.",
      };
    }
    if (overview.errorCode === "export_unavailable") {
      return {
        title: "AngelList export needs attention",
        description:
          "Reconnect and confirm Export CSV is available. Nothing changes until you review it.",
      };
    }
    return {
      title: "AngelList update needs attention",
      description: "Reconnect AngelList, then try the update again.",
    };
  }
  return {
    title: "AngelList is working",
    description: "New exports follow your schedule and wait for review.",
  };
}

function providerAgentSetupCommand(
  provider: "angellist" | ProviderPortfolioAgentProvider,
): string {
  return `make provider-agent-setup PROVIDER=${provider} KEEL_URL=${window.location.origin}`;
}

const PORTFOLIO_AGENT_INTERVAL_OPTIONS = [
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Off", value: "off" },
] satisfies ReadonlyArray<{
  label: string;
  value: AngelListMacAgentInterval;
}>;

const COPY_AGENT_COMMAND_ERROR =
  "Copy was blocked. Select and copy the command below.";

function providerReconnectStorageKey(
  provider: "angellist" | ProviderPortfolioAgentProvider,
): string {
  return `keel.providerReconnect.${provider}`;
}

function rememberedProviderReconnect(
  provider: "angellist" | ProviderPortfolioAgentProvider,
): string | null {
  try {
    return window.sessionStorage.getItem(providerReconnectStorageKey(provider));
  } catch {
    return null;
  }
}

function rememberProviderReconnect(
  provider: "angellist" | ProviderPortfolioAgentProvider,
  sessionId: string | null,
): void {
  try {
    const key = providerReconnectStorageKey(provider);
    if (sessionId === null) {
      window.sessionStorage.removeItem(key);
    } else {
      window.sessionStorage.setItem(key, sessionId);
    }
  } catch {
    // The reconnect still works if private browsing disables session storage.
  }
}

function ProviderReconnectControl({
  disabled = false,
  label,
  onActiveChange,
  onConnected,
  provider,
  tone = "primary",
}: {
  disabled?: boolean;
  label: string;
  onActiveChange?: (active: boolean) => void;
  onConnected: () => void;
  provider: "angellist" | ProviderPortfolioAgentProvider;
  tone?: "primary" | "secondary";
}) {
  const [session, setSession] = useState<ProviderBrowserSession | null>(null);
  const [busy, setBusy] = useState<"cancel" | "start" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const openedSessionRef = useRef<string | null>(null);

  const acceptSession = useCallback(
    (next: ProviderBrowserSession) => {
      setSession(next);
      setError(null);
      const active = ["requested", "starting", "ready", "opened"].includes(
        next.status,
      );
      onActiveChange?.(active);
      if (active) {
        rememberProviderReconnect(provider, next.id);
      } else {
        rememberProviderReconnect(provider, null);
      }
      if (next.status === "connected") {
        popupRef.current?.close();
        popupRef.current = null;
        onConnected();
      }
      if (["expired", "cancelled", "failed"].includes(next.status)) {
        popupRef.current?.close();
        popupRef.current = null;
      }
    },
    [onActiveChange, onConnected, provider],
  );

  const openReadySession = useCallback((ready: ProviderBrowserSession) => {
    if (
      ready.status !== "ready" ||
      openedSessionRef.current === ready.id ||
      popupRef.current === null ||
      popupRef.current.closed
    ) {
      return;
    }
    openedSessionRef.current = ready.id;
    popupRef.current.location.replace(
      providerBrowserReconnectOpenPath(ready.id),
    );
  }, []);

  useEffect(() => {
    const sessionId = rememberedProviderReconnect(provider);
    if (sessionId === null) {
      return;
    }
    let cancelled = false;
    void getProviderBrowserReconnect(sessionId)
      .then((next) => {
        if (!cancelled && next.provider === provider) {
          acceptSession(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          rememberProviderReconnect(provider, null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [acceptSession, provider]);

  useEffect(() => {
    if (
      session === null ||
      !["requested", "starting", "ready", "opened"].includes(session.status)
    ) {
      return;
    }
    let cancelled = false;
    let checking = false;
    let timer: number | undefined;
    const scheduleCheck = (delay: number) => {
      if (cancelled) {
        return;
      }
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => void check(), delay);
    };
    const check = async () => {
      if (cancelled || checking) {
        return;
      }
      checking = true;
      try {
        const next = await getProviderBrowserReconnect(session.id);
        if (cancelled) {
          return;
        }
        acceptSession(next);
        openReadySession(next);
        if (
          ["requested", "starting", "ready", "opened"].includes(next.status)
        ) {
          scheduleCheck(1_000);
        }
      } catch {
        if (!cancelled) {
          setError(`Keel could not check the ${label} reconnect. Try again.`);
          scheduleCheck(3_000);
        }
      } finally {
        checking = false;
      }
    };
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        scheduleCheck(0);
      }
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("pageshow", checkWhenVisible);
    scheduleCheck(500);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", checkWhenVisible);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("pageshow", checkWhenVisible);
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [acceptSession, label, openReadySession, session]);

  const startReconnect = async () => {
    setBusy("start");
    onActiveChange?.(true);
    setError(null);
    openedSessionRef.current = null;
    const popup = window.open("", `keel-${provider}-reconnect`);
    if (popup !== null) {
      popup.opener = null;
      popup.document.title = `Reconnect ${label}`;
      popup.document.body.textContent = `Preparing a secure ${label} browser…`;
      popupRef.current = popup;
    }
    try {
      const next = await startProviderBrowserReconnect(provider);
      acceptSession(next);
      openReadySession(next);
    } catch {
      popup?.close();
      popupRef.current = null;
      onActiveChange?.(false);
      setError(`Keel could not start the ${label} reconnect. Try again.`);
    } finally {
      setBusy(null);
    }
  };

  const cancelReconnect = async () => {
    if (session === null) {
      return;
    }
    setBusy("cancel");
    setError(null);
    try {
      acceptSession(await cancelProviderBrowserReconnect(session.id));
    } catch {
      setError(`Keel could not cancel the ${label} reconnect.`);
    } finally {
      setBusy(null);
    }
  };

  const active =
    session !== null &&
    ["requested", "starting", "ready", "opened"].includes(session.status);
  const openPath =
    session?.status === "ready"
      ? providerBrowserReconnectOpenPath(session.id)
      : null;
  const status =
    session?.status === "requested" || session?.status === "starting"
      ? "Preparing a private browser…"
      : session?.status === "ready"
        ? `The ${label} browser is ready for 15 minutes.`
        : session?.status === "opened"
          ? provider === "angellist"
            ? `Finish signing in to ${label}. When the private screen closes, return to Keel.`
            : `Finish signing in to ${label}. Keel will check the saved sign-in before confirming.`
          : session?.status === "connected"
            ? null
            : session?.status === "expired"
              ? "The private browser expired. Start again when you are ready."
              : session?.status === "failed"
                ? session.errorCode === "provider_sign_in_incomplete"
                  ? "The sign-in did not stay available for automatic updates. Keel has not marked it connected."
                  : "Keel could not complete the reconnect. Your prior holdings are unchanged."
                : null;

  return (
    <div className="provider-reconnect">
      {active ? (
        <ActionGroup
          className="provider-reconnect__active"
          mobileLayout="stack"
        >
          {openPath === null ? (
            <Button disabled tone="primary">
              {session?.status === "opened"
                ? `Reconnecting ${label}…`
                : "Preparing browser…"}
            </Button>
          ) : (
            <ButtonLink
              href={openPath}
              referrerPolicy="no-referrer"
              rel="noreferrer noopener"
              target="_blank"
              tone="primary"
            >
              Open {label}
            </ButtonLink>
          )}
          <Button
            disabled={busy !== null}
            onClick={() => void cancelReconnect()}
            tone="quiet"
          >
            {busy === "cancel" ? "Cancelling…" : "Cancel"}
          </Button>
        </ActionGroup>
      ) : (
        <Button
          disabled={disabled || busy !== null}
          onClick={() => void startReconnect()}
          tone={tone}
        >
          {busy === "start" ? "Starting…" : `Reconnect ${label}`}
        </Button>
      )}
      {status !== null && (
        <FormMessage className="provider-reconnect__status">
          {status}
        </FormMessage>
      )}
      {error !== null && (
        <FormMessage className="provider-reconnect__error" tone="error">
          {error}
        </FormMessage>
      )}
    </div>
  );
}

function AgentTroubleshooting({
  copyCommand,
  error,
  label,
  setupCommand,
}: {
  copyCommand: () => void;
  error: string | null;
  label: string;
  setupCommand: string;
}) {
  return (
    <Collapsible className="provider-agent-troubleshooting">
      <CollapsibleTrigger className="provider-agent-troubleshooting__trigger">
        <span>Troubleshooting</span>
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="provider-agent-troubleshooting__content">
          <p>
            If Keel cannot open the private browser, run the repair command on
            the update computer.
          </p>
          <Button onClick={copyCommand} tone="quiet">
            Copy {label} repair command
          </Button>
          {error === COPY_AGENT_COMMAND_ERROR && <code>{setupCommand}</code>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
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
    return () => {
      window.clearTimeout(initial);
    };
  }, [reload]);

  useEffect(() => {
    if (overview?.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [overview?.status, reload]);

  const setupCommand = providerAgentSetupCommand("angellist");
  const message = angelListAgentMessage(overview);
  const setupRequired = overview?.status === "setup_required";
  const repairRequired =
    overview?.status === "offline" || overview?.status === "needs_attention";
  const managedReconnectAvailable =
    overview?.status === "needs_attention" &&
    overview.errorCode !== "keel_sign_in_required";
  const running = overview?.status === "running";

  const copySetupCommand = async () => {
    setBusyAction("copy");
    setError(null);
    try {
      await navigator.clipboard.writeText(setupCommand);
      setNotice("Copied. Paste in Terminal.");
    } catch {
      setError(COPY_AGENT_COMMAND_ERROR);
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
      setNotice("AngelList update queued for the agent’s next daily check.");
      window.setTimeout(() => void reload(), 1_000);
    } catch {
      setError("Keel could not request an AngelList update. Try again.");
    } finally {
      setBusyAction(null);
    }
  };

  const reconnectCompleted = useCallback(() => {
    setNotice(
      "AngelList reconnected. Updates resumed and new changes will wait for review.",
    );
    void reload();
  }, [reload]);

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
              {busyAction === "copy" ? "Copying…" : "Copy setup command"}
            </Button>
            {error === COPY_AGENT_COMMAND_ERROR && <code>{setupCommand}</code>}
          </div>
        ) : repairRequired ? (
          <div className="angellist-agent__setup">
            {managedReconnectAvailable && (
              <ProviderReconnectControl
                label="AngelList"
                onConnected={reconnectCompleted}
                provider="angellist"
              />
            )}
            <AgentTroubleshooting
              copyCommand={() => void copySetupCommand()}
              error={error}
              label="AngelList"
              setupCommand={setupCommand}
            />
          </div>
        ) : (
          <ActionGroup
            align="end"
            className="angellist-agent__controls"
            mobileLayout="stack"
          >
            <div className="angellist-agent__interval">
              <span id="angellist-update-interval-label">
                Automatic updates
              </span>
              <Select
                disabled={busyAction !== null}
                items={PORTFOLIO_AGENT_INTERVAL_OPTIONS}
                onValueChange={(value) => {
                  if (
                    value === "daily" ||
                    value === "weekly" ||
                    value === "off"
                  ) {
                    void changeInterval(value);
                  }
                }}
                value={overview?.interval ?? "weekly"}
              >
                <SelectTrigger
                  aria-labelledby="angellist-update-interval-label"
                  id="angellist-update-interval"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTFOLIO_AGENT_INTERVAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          </ActionGroup>
        )}

        {overview !== null && !setupRequired && (
          <DataList className="angellist-agent__meta">
            <DataItem
              label="Last agent check"
              value={
                overview.lastSeenAt === null
                  ? "Not yet"
                  : formatDate(overview.lastSeenAt)
              }
            />
            <DataItem
              label="Last completed"
              value={
                overview.lastCompletedAt === null
                  ? "Not yet"
                  : formatDate(overview.lastCompletedAt)
              }
            />
            <DataItem
              label="Next scheduled"
              value={
                overview.nextRunAt === null
                  ? "Off"
                  : formatDate(overview.nextRunAt)
              }
            />
          </DataList>
        )}

        {notice !== null && (
          <FormMessage className="angellist-agent__notice" tone="success">
            {notice}
          </FormMessage>
        )}
        {error !== null && (
          <FormMessage className="angellist-agent__error" tone="error">
            {error}
          </FormMessage>
        )}
      </div>
    </section>
  );
}

const PROVIDER_PORTFOLIO_AGENTS = ["tokenfolio", "sydecar"] as const;

function providerPortfolioAgentLabel(
  provider: ProviderPortfolioAgentProvider,
): string {
  return provider === "tokenfolio" ? "Tokenfolio" : "Sydecar";
}

function providerPortfolioAgentMessage(
  provider: ProviderPortfolioAgentProvider,
  overview: ProviderPortfolioAgentOverview | null,
): { title: string | null; description: string | null } {
  const label = providerPortfolioAgentLabel(provider);
  if (overview === null) {
    return {
      title: null,
      description: null,
    };
  }
  if (overview.status === "setup_required") {
    return {
      title: null,
      description: null,
    };
  }
  if (overview.status === "offline") {
    return {
      title: "Paused — agent check overdue",
      description:
        "The update computer is not responding. No holdings changed.",
    };
  }
  if (overview.status === "running") {
    return overview.runStatus === "queued"
      ? {
          title: "Update queued",
          description: "It will start at the agent’s next daily check.",
        }
      : {
          title: "Reading portfolio",
          description:
            "Keel will show the result for review before anything changes.",
        };
  }
  if (overview.status === "needs_attention") {
    if (overview.errorCode === "provider_sign_in_required") {
      return {
        title: `${label} needs reconnecting`,
        description: `Finish sign-in and 2FA in a private browser. New changes will still wait for review.`,
      };
    }
    if (overview.errorCode === "keel_sign_in_required") {
      return {
        title: "Paused — agent access needs renewal",
        description: `The update computer needs troubleshooting. Your ${label} sign-in can stay as-is.`,
      };
    }
    if (overview.errorCode === "incomplete_snapshot") {
      return {
        title: "Paused — totals did not reconcile",
        description:
          "Try the update again once the portfolio has finished loading. Your prior holdings are unchanged.",
      };
    }
    if (overview.errorCode === "identity_ambiguous") {
      return {
        title: "Paused — position match is unclear",
        description:
          "Keel could not match the positions safely. Your prior holdings are unchanged.",
      };
    }
    if (overview.errorCode === "page_not_supported") {
      return {
        title: `Could not read ${label}`,
        description:
          "Try the update again, or reconnect to check your sign-in.",
      };
    }
    if (overview.errorCode === "upload_failed") {
      return {
        title: "Paused — upload failed",
        description: "Your prior holdings are unchanged. Try the update again.",
      };
    }
    return {
      title: "Paused — update failed",
      description: "Your prior holdings are unchanged. Try the update again.",
    };
  }
  return {
    title:
      overview.lastCompletedAt === null ? "Ready for first update" : "Working",
    description: null,
  };
}

function ProviderPortfolioAgentRow({
  provider,
}: {
  provider: ProviderPortfolioAgentProvider;
}) {
  const label = providerPortfolioAgentLabel(provider);
  const [overview, setOverview] =
    useState<ProviderPortfolioAgentOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconnectActive, setReconnectActive] = useState(false);
  const [busyAction, setBusyAction] = useState<
    "copy" | "interval" | "run" | null
  >(null);

  const reload = useCallback(async () => {
    try {
      const next = await loadProviderPortfolioAgentOverview(provider);
      setOverview(next);
      if (next.status === "needs_attention") {
        setNotice(null);
      }
      setError(null);
    } catch {
      setError(`Keel could not check ${label} updates. Try again shortly.`);
    }
  }, [label, provider]);

  useEffect(() => {
    const initial = window.setTimeout(() => void reload(), 0);
    return () => window.clearTimeout(initial);
  }, [reload]);

  useEffect(() => {
    if (overview?.status !== "running") {
      return;
    }
    const timer = window.setInterval(() => void reload(), 10_000);
    return () => window.clearInterval(timer);
  }, [overview?.status, reload]);

  const setupCommand = providerAgentSetupCommand(provider);
  const message = providerPortfolioAgentMessage(provider, overview);
  const setupRequired = overview?.status === "setup_required";
  const repairRequired =
    overview?.status === "offline" || overview?.status === "needs_attention";
  const managedReconnectAvailable =
    overview?.status === "needs_attention" &&
    (overview.errorCode === "provider_sign_in_required" ||
      overview.errorCode === "page_not_supported");
  const retryAvailable =
    overview?.status === "needs_attention" &&
    (overview.errorCode === "upload_failed" ||
      overview.errorCode === "page_not_supported" ||
      overview.errorCode === "incomplete_snapshot" ||
      overview.errorCode === "unexpected_failure");
  const running = overview?.status === "running";

  const copySetupCommand = async () => {
    setBusyAction("copy");
    setError(null);
    try {
      await navigator.clipboard.writeText(setupCommand);
      setNotice("Copied. Paste in Terminal.");
    } catch {
      setError(COPY_AGENT_COMMAND_ERROR);
    } finally {
      setBusyAction(null);
    }
  };

  const changeInterval = async (interval: AngelListMacAgentInterval) => {
    setBusyAction("interval");
    setError(null);
    setNotice(null);
    try {
      setOverview(
        await configureProviderPortfolioAgent(provider, { interval }),
      );
      setNotice(
        interval === "off"
          ? `${label} automatic updates are off.`
          : `${label} will update ${interval}.`,
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
      const requested = await requestProviderPortfolioUpdate(provider);
      setOverview((current) =>
        current === null
          ? current
          : {
              ...current,
              status: "running",
              runStatus: requested.status,
            },
      );
      setNotice(`${label} update queued for the agent’s next daily check.`);
      window.setTimeout(() => void reload(), 1_000);
    } catch {
      setError(`Keel could not request a ${label} update. Try again.`);
    } finally {
      setBusyAction(null);
    }
  };

  const reconnectCompleted = useCallback(() => {
    setNotice(
      `${label} reconnected. Checking for updates now; new changes will wait for review.`,
    );
    setOverview((current) =>
      current === null
        ? current
        : {
            ...current,
            errorCode: null,
            runStatus: "queued",
            status: "running",
          },
    );
  }, [label]);

  const labelId = `${provider}-agent-label`;
  const titleId = `${provider}-agent-title`;
  return (
    <article
      aria-labelledby={
        message.title === null ? labelId : `${labelId} ${titleId}`
      }
      className="provider-agent-row"
    >
      <div className="provider-agent-row__heading">
        <p className="eyebrow" id={labelId}>
          {label}
        </p>
        {message.title !== null && <h3 id={titleId}>{message.title}</h3>}
        {message.description !== null && <p>{message.description}</p>}
      </div>

      <div className="provider-agent-row__action" aria-live="polite">
        {overview === null && error === null ? (
          <span className="provider-agent-row__checking" role="status">
            Checking…
          </span>
        ) : setupRequired ? (
          <div className="provider-agent-row__setup">
            <Button
              disabled={busyAction !== null}
              onClick={() => void copySetupCommand()}
              tone="primary"
            >
              {busyAction === "copy" ? "Copying…" : "Copy setup command"}
            </Button>
            {error === COPY_AGENT_COMMAND_ERROR && <code>{setupCommand}</code>}
          </div>
        ) : repairRequired ? (
          <div className="provider-agent-row__setup">
            {retryAvailable && (
              <Button
                disabled={busyAction !== null || reconnectActive}
                onClick={() => void runNow()}
                tone="primary"
              >
                {busyAction === "run" ? "Requesting…" : "Try update"}
              </Button>
            )}
            {managedReconnectAvailable && (
              <ProviderReconnectControl
                disabled={busyAction !== null}
                label={label}
                onActiveChange={setReconnectActive}
                onConnected={reconnectCompleted}
                provider={provider}
                tone={retryAvailable ? "secondary" : "primary"}
              />
            )}
            <AgentTroubleshooting
              copyCommand={() => void copySetupCommand()}
              error={error}
              label={label}
              setupCommand={setupCommand}
            />
          </div>
        ) : (
          <ActionGroup
            align="end"
            className="provider-agent-row__controls"
            mobileLayout="stack"
          >
            <div className="provider-agent-row__interval">
              <span id={`${provider}-update-interval-label`}>
                Automatic updates
              </span>
              <Select
                disabled={busyAction !== null}
                items={PORTFOLIO_AGENT_INTERVAL_OPTIONS}
                onValueChange={(value) => {
                  if (
                    value === "daily" ||
                    value === "weekly" ||
                    value === "off"
                  ) {
                    void changeInterval(value);
                  }
                }}
                value={overview?.interval ?? "daily"}
              >
                <SelectTrigger
                  aria-labelledby={`${provider}-update-interval-label`}
                  id={`${provider}-update-interval`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PORTFOLIO_AGENT_INTERVAL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          </ActionGroup>
        )}

        {overview !== null && !setupRequired && (
          <DataList className="provider-agent-row__meta">
            <DataItem
              label="Last agent check"
              value={
                overview.lastSeenAt === null
                  ? "Not yet"
                  : formatDate(overview.lastSeenAt)
              }
            />
            <DataItem
              label="Last completed"
              value={
                overview.lastCompletedAt === null
                  ? "Not yet"
                  : formatDate(overview.lastCompletedAt)
              }
            />
            <DataItem
              label="Next scheduled"
              value={
                overview.nextRunAt === null
                  ? "Off"
                  : formatDate(overview.nextRunAt)
              }
            />
          </DataList>
        )}
        {notice !== null && (
          <FormMessage className="provider-agent-row__notice" tone="success">
            {notice}
          </FormMessage>
        )}
        {error !== null && (
          <FormMessage className="provider-agent-row__error" tone="error">
            {error}
          </FormMessage>
        )}
      </div>
    </article>
  );
}

function ProviderPortfolioAgentsControl() {
  return (
    <section
      aria-labelledby="provider-portfolio-agents-title"
      className="provider-agents"
    >
      <div className="provider-agents__heading">
        <p className="eyebrow">Other portfolio updates</p>
        <h2 id="provider-portfolio-agents-title">Tokenfolio and Sydecar</h2>
        <p>Set up each once. New updates wait for your review.</p>
      </div>
      <div className="provider-agents__rows">
        {PROVIDER_PORTFOLIO_AGENTS.map((provider) => (
          <ProviderPortfolioAgentRow key={provider} provider={provider} />
        ))}
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
              <ButtonLink
                className="angellist-live-view-link"
                href={refresh.liveViewUrl}
                referrerPolicy="no-referrer"
                rel="noreferrer noopener"
                target="_blank"
                tone="primary"
              >
                Open AngelList sign-in
              </ButtonLink>
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
                <Input
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
                  <FormMessage className="angellist-handoff-input__status">
                    {handoffNotice}
                  </FormMessage>
                )}
              </div>
            </form>

            <form
              className="angellist-input-form angellist-magic-link"
              onSubmit={(event) => void sendMagicLink(event)}
            >
              <label htmlFor="angellist-magic-link">
                <span>Magic link from email</span>
                <Input
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
          <FormMessage className="angellist-sign-in__error" tone="error">
            {overviewError}
          </FormMessage>
        )}
        {refreshError !== null && (
          <FormMessage className="angellist-sign-in__error" tone="error">
            {refreshError} Your saved sign-in was not changed.
          </FormMessage>
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

const PLAID_OAUTH_FLOW_STORAGE_KEY = "keel.plaidOauthFlow";

const CASH_LINK_TOKEN_STORAGE_KEY = "keel.cashLinkToken";

function initialCashAccountError(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).has("oauth_state_id") &&
    window.sessionStorage.getItem(PLAID_OAUTH_FLOW_STORAGE_KEY) === "cash" &&
    window.sessionStorage.getItem(CASH_LINK_TOKEN_STORAGE_KEY) === null
    ? "Reconnect the institution to finish signing in."
    : null;
}

function cashProposalValueLabel(
  row: CashBalanceProposal["rows"][number],
): string {
  if (row.valueState === "not_reported") {
    return "Not reported";
  }
  if (row.valueMinor === null) {
    return "Needs attention";
  }
  return formatMoney(row.valueMinor);
}

function acceptedCashValueLabel(valueMinor: number | null): string {
  return valueMinor === null ? "Not reported" : formatMoney(valueMinor);
}

function CashBalanceProposalReview({
  onApplied,
  onCancel,
  proposal,
}: {
  onApplied: () => Promise<void>;
  onCancel: () => void;
  proposal: CashBalanceProposal;
}) {
  const [includedByRow, setIncludedByRow] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(
        proposal.rows.map((row) => [
          row.id,
          row.valueState === "reported" || row.valueState === "not_reported",
        ]),
      ),
  );
  const [changeNote, setChangeNote] = useState(
    `Reviewed ${proposal.institutionLabel} cash balances.`,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const heading = headingRef.current;
    if (heading === null) {
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, []);

  const apply = async () => {
    setWorking(true);
    setError(null);
    try {
      await applyCashAccountProposal(proposal.id, {
        changeNote: changeNote.trim(),
        decisions: proposal.rows.map((row) => ({
          rowId: row.id,
          decision: includedByRow[row.id] ? "accepted" : "excluded",
        })),
      });
      await onApplied();
    } catch (applyError: unknown) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "The cash account review could not be applied.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="cash-review">
      <header className="cash-review__heading">
        <h3 ref={headingRef} tabIndex={-1}>
          {proposal.institutionLabel} balances
        </h3>
        <p>
          {proposal.refreshKind === "live"
            ? `Live balances from ${formatDate(proposal.observedAt)}.`
            : `Cached balances from ${formatDate(proposal.observedAt)}.`}{" "}
          Choose which balances to approve. Your FI plan will not change until
          you confirm its baseline.
        </p>
      </header>

      <StatGroup
        aria-label="Cash balance totals"
        className="cash-review__totals"
      >
        <Stat
          as="span"
          inline
          label="accounts"
          value={proposal.summary.rowCount}
          valueFirst
        />
        <Stat
          as="span"
          inline
          label="reported"
          value={formatCompactMoney(proposal.summary.totalReportedMinor)}
          valueFirst
        />
        <Stat
          as="span"
          inline
          label="need attention"
          value={proposal.summary.needsAttentionCount}
          valueFirst
        />
      </StatGroup>

      <div className="cash-review__rows">
        {proposal.rows.map((row) => {
          const canAccept =
            row.valueState === "reported" || row.valueState === "not_reported";
          const checked = includedByRow[row.id] ?? false;
          return (
            <article key={row.id}>
              <div>
                <span className="cash-review__type">{row.subtype}</span>
                <strong>{row.accountLabel}</strong>
                <small>
                  {row.action === "new_account"
                    ? "New account"
                    : row.action === "update_balance"
                      ? `Previously ${row.priorValueMinor === null ? "not reported" : formatMoney(row.priorValueMinor)}`
                      : row.action === "no_change"
                        ? "Balance unchanged"
                        : row.action === "not_reported"
                          ? "Missing from this check"
                          : "Cannot be used as cash"}
                </small>
              </div>
              <div className="cash-review__decision">
                <strong>{cashProposalValueLabel(row)}</strong>
                {row.balanceSource !== null && (
                  <span>{row.balanceSource} balance</span>
                )}
                <label>
                  <Input
                    checked={checked}
                    disabled={!canAccept || working}
                    onChange={(event) =>
                      setIncludedByRow((current) => ({
                        ...current,
                        [row.id]: event.currentTarget.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span>
                    {row.valueState === "not_reported"
                      ? "Confirm not reported"
                      : canAccept
                        ? "Approve balance"
                        : "Cannot approve this balance"}
                  </span>
                </label>
              </div>
              {row.issues.length > 0 && (
                <p className="cash-review__issue">{row.issues.join(" ")}</p>
              )}
            </article>
          );
        })}
      </div>

      <Field
        className="cash-review__note"
        htmlFor="cash-review-note"
        label="What changed"
      >
        <Input
          id="cash-review-note"
          maxLength={500}
          onChange={(event) => setChangeNote(event.currentTarget.value)}
          value={changeNote}
        />
      </Field>
      {error !== null && <Notice tone="error">{error}</Notice>}
      <ActionGroup
        align="end"
        as="footer"
        className="cash-review__actions"
        mobileLayout="grid"
      >
        <Button disabled={working} onClick={onCancel} tone="quiet">
          Decide later
        </Button>
        <Button
          disabled={working || changeNote.trim().length === 0}
          onClick={() => void apply()}
          tone="primary"
        >
          {working ? "Saving…" : "Save decisions"}
        </Button>
      </ActionGroup>
    </div>
  );
}

function CashAccountsControl({
  onAccepted,
}: {
  onAccepted: () => Promise<void>;
}) {
  const [state, setState] = useState<CashAccountsState | null>(null);
  const [activeProposalId, setActiveProposalId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialCashAccountError);
  const oauthStarted = useRef(false);

  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await loadCashAccounts(signal);
    setState(next);
    setError(null);
    return next;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void reload(controller.signal)
        .then(async (initialState) => {
          const refreshCutoff = Date.now() - 7 * 24 * 60 * 60 * 1_000;
          const hasDueConnection = initialState.connections.some(
            (connection) =>
              connection.status === "ready" &&
              connection.liveRefreshesRemaining > 0 &&
              !initialState.pendingProposals.some(
                (proposal) => proposal.connectionId === connection.id,
              ) &&
              (connection.lastCheckedAt === null ||
                Date.parse(connection.lastCheckedAt) < refreshCutoff),
          );
          if (
            controller.signal.aborted ||
            !initialState.configured ||
            !hasDueConnection
          ) {
            return;
          }
          setBusyAction("automatic");
          try {
            const next = await refreshDueCashAccounts();
            if (controller.signal.aborted) {
              return;
            }
            setState(next);
            const pending = next.pendingProposals.find(
              (proposal) =>
                !initialState.pendingProposals.some(
                  (initialProposal) => initialProposal.id === proposal.id,
                ),
            );
            if (pending !== undefined) {
              setNotice("Updated bank balances are ready to review.");
            }
          } catch (refreshError: unknown) {
            if (!controller.signal.aborted) {
              setError(
                refreshError instanceof Error
                  ? refreshError.message
                  : "Automatic bank balance checks are temporarily unavailable.",
              );
            }
          } finally {
            if (!controller.signal.aborted) {
              setBusyAction(null);
            }
          }
        })
        .catch((loadError: unknown) => {
          if (!controller.signal.aborted) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Keel could not check cash accounts.",
            );
          }
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [reload]);

  const acceptState = useCallback((next: CashAccountsState) => {
    setState(next);
    setError(null);
    const pending = next.pendingProposals[0];
    if (pending !== undefined) {
      setActiveProposalId(pending.id);
      setNotice(null);
    } else {
      setNotice("Balances checked. No review is waiting.");
    }
  }, []);

  const exchangeToken = useCallback(
    async (publicToken: string) => {
      setBusyAction("exchange");
      setError(null);
      setNotice(null);
      try {
        const next = await exchangeCashAccountPublicToken(publicToken);
        window.sessionStorage.removeItem(CASH_LINK_TOKEN_STORAGE_KEY);
        window.sessionStorage.removeItem(PLAID_OAUTH_FLOW_STORAGE_KEY);
        if (window.location.search.length > 0) {
          window.history.replaceState(null, "", window.location.pathname);
        }
        acceptState(next);
      } catch (exchangeError: unknown) {
        setError(
          exchangeError instanceof Error
            ? exchangeError.message
            : "The cash account could not be connected.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [acceptState],
  );

  const openLink = useCallback(
    async (linkToken: string, receivedRedirectUri?: string) => {
      await openPlaidLink({
        linkToken,
        onExit: () => setBusyAction(null),
        onSuccess: (publicToken) => {
          if (publicToken === null) {
            setBusyAction(null);
            setError("The cash institution did not return a connection token.");
            return;
          }
          void exchangeToken(publicToken);
        },
        ...(receivedRedirectUri === undefined ? {} : { receivedRedirectUri }),
      });
    },
    [exchangeToken],
  );

  useEffect(() => {
    if (
      oauthStarted.current ||
      !new URLSearchParams(window.location.search).has("oauth_state_id") ||
      window.sessionStorage.getItem(PLAID_OAUTH_FLOW_STORAGE_KEY) !== "cash"
    ) {
      return;
    }
    const linkToken = window.sessionStorage.getItem(
      CASH_LINK_TOKEN_STORAGE_KEY,
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
        setError("The cash account connection could not be reopened.");
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openLink]);

  const connect = async () => {
    setBusyAction("connect");
    setError(null);
    setNotice(null);
    try {
      const result = await createCashAccountLinkToken();
      window.sessionStorage.setItem(
        CASH_LINK_TOKEN_STORAGE_KEY,
        result.linkToken,
      );
      window.sessionStorage.setItem(PLAID_OAUTH_FLOW_STORAGE_KEY, "cash");
      await openLink(result.linkToken);
    } catch (connectError: unknown) {
      setBusyAction(null);
      setError(
        connectError instanceof Error
          ? connectError.message
          : "The cash account connection could not be opened.",
      );
    }
  };

  const checkBalances = async (connectionId: string) => {
    setBusyAction(connectionId);
    setError(null);
    setNotice(null);
    try {
      acceptState(await refreshCashAccount(connectionId));
    } catch (refreshError: unknown) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Cash balances could not be checked.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const reviewIdentity = async (
    candidate: CashAccountIdentityCandidate,
    decision: CashAccountIdentityDecision,
  ) => {
    const actionKey = [
      "identity",
      candidate.priorNaturalKeySha256,
      candidate.reportedNaturalKeySha256,
      decision,
    ].join(":");
    setBusyAction(actionKey);
    setError(null);
    setNotice(null);
    try {
      const next = await reviewCashAccountIdentity({
        connectionId: candidate.connectionId,
        priorNaturalKeySha256: candidate.priorNaturalKeySha256,
        reportedNaturalKeySha256: candidate.reportedNaturalKeySha256,
        decision,
        changeNote:
          decision === "same_account"
            ? "Confirmed both records describe the same cash account."
            : "Confirmed the records describe separate cash accounts.",
      });
      setState(next);
      setNotice(
        decision === "same_account"
          ? "Account records combined. Review the FI baseline when ready."
          : "Account records kept separate.",
      );
      try {
        await onAccepted();
      } catch {
        setError(
          "The account decision was saved, but the planning baseline could not refresh.",
        );
      }
    } catch (reviewError: unknown) {
      setError(
        reviewError instanceof Error
          ? reviewError.message
          : "The account match could not be saved.",
      );
    } finally {
      setBusyAction(null);
    }
  };

  const activeProposal =
    state?.pendingProposals.find(
      (proposal) => proposal.id === activeProposalId,
    ) ?? null;
  const acceptedCashMinor = addMinorUnits(
    ...(state?.acceptedAccounts.map((account) => account.valueMinor ?? 0) ??
      []),
  );
  const setupRequired = state?.status === "setup_required";
  const latestBankCheckAt =
    state?.connections.reduce<string | null>((latest, connection) => {
      if (connection.lastCheckedAt === null) {
        return latest;
      }
      return latest === null || connection.lastCheckedAt > latest
        ? connection.lastCheckedAt
        : latest;
    }, null) ?? null;

  return (
    <section aria-labelledby="cash-accounts-title" className="cash-accounts">
      <div className="cash-accounts__heading">
        <div>
          <p className="eyebrow">Bank cash</p>
          <h2 id="cash-accounts-title">
            {setupRequired
              ? "Bank accounts need setup"
              : state?.status === "disconnected"
                ? "Add a bank"
                : "Bank cash"}
          </h2>
          <p>
            Bank accounts are separate from cash held inside a brokerage. New
            balances wait for your review.
          </p>
        </div>
        {!setupRequired && (
          <Button
            disabled={busyAction !== null}
            onClick={() => void connect()}
            tone={state?.connections.length === 0 ? "primary" : "secondary"}
          >
            {busyAction === "connect" || busyAction === "exchange"
              ? "Connecting…"
              : "Add bank"}
          </Button>
        )}
      </div>

      {setupRequired && (
        <p className="cash-accounts__setup">
          Add the Plaid connection settings to enable cash accounts.
        </p>
      )}

      {state !== null && state.acceptedAccounts.length > 0 && (
        <div className="cash-accounts__accepted">
          <div className="cash-accounts__total">
            <span>Total cash</span>
            <strong>{formatCompactMoney(acceptedCashMinor)}</strong>
          </div>
          <div className="cash-accounts__accepted-list">
            {state.acceptedAccounts.map((account) => (
              <div className="cash-accounts__accepted-account" key={account.id}>
                <span>
                  <strong>{account.accountLabel}</strong>
                  <small>
                    {account.institutionLabel} · As of{" "}
                    {formatDate(account.observedAt)}
                  </small>
                </span>
                <strong className="cash-accounts__accepted-value">
                  {acceptedCashValueLabel(account.valueMinor)}
                </strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {state !== null && state.identityCandidates.length > 0 && (
        <div
          aria-labelledby="cash-account-identity-title"
          className="cash-accounts__identity-review"
        >
          <div className="cash-accounts__identity-heading">
            <h3 id="cash-account-identity-title">
              Possible duplicate accounts
            </h3>
            <p>
              Keel found a new bank record where a prior record disappeared.
              Confirm each match before the records are combined.
            </p>
          </div>
          <div className="cash-accounts__identity-list">
            {state.identityCandidates.map((candidate) => {
              const actionKey = [
                "identity",
                candidate.priorNaturalKeySha256,
                candidate.reportedNaturalKeySha256,
              ].join(":");
              const keepingSeparate =
                busyAction === [actionKey, "separate_accounts"].join(":");
              const combining =
                busyAction === [actionKey, "same_account"].join(":");
              return (
                <div
                  key={[
                    candidate.connectionId,
                    candidate.priorNaturalKeySha256,
                    candidate.reportedNaturalKeySha256,
                  ].join(":")}
                >
                  <span>
                    <strong>{candidate.accountLabel}</strong>
                    <small>
                      {candidate.institutionLabel} · new record returned{" "}
                      {formatDate(candidate.observedAt)}
                    </small>
                  </span>
                  <div>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() =>
                        void reviewIdentity(candidate, "separate_accounts")
                      }
                      tone="quiet"
                    >
                      {keepingSeparate ? "Saving…" : "Keep separate"}
                    </Button>
                    <Button
                      disabled={busyAction !== null}
                      onClick={() =>
                        void reviewIdentity(candidate, "same_account")
                      }
                      tone="primary"
                    >
                      {combining ? "Saving…" : "Same account"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {state !== null &&
        state.connections.some(
          (connection) =>
            connection.status === "needs_attention" ||
            state.pendingProposals.some(
              (proposal) => proposal.connectionId === connection.id,
            ),
        ) && (
          <div className="cash-accounts__connections">
            {state.connections.map((connection) => {
              const pendingProposal = state.pendingProposals.find(
                (proposal) => proposal.connectionId === connection.id,
              );
              if (
                pendingProposal === undefined &&
                connection.status !== "needs_attention"
              ) {
                return null;
              }
              if (
                pendingProposal !== undefined &&
                pendingProposal.id === activeProposal?.id
              ) {
                return (
                  <CashBalanceProposalReview
                    key={pendingProposal.id}
                    onApplied={async () => {
                      setActiveProposalId(null);
                      await Promise.all([reload(), onAccepted()]);
                      setNotice(
                        "Balance decisions saved. Confirm the FI baseline when ready.",
                      );
                    }}
                    onCancel={() => setActiveProposalId(null)}
                    proposal={pendingProposal}
                  />
                );
              }
              return (
                <div className="cash-accounts__connection" key={connection.id}>
                  <span>
                    <strong>{connection.institutionLabel}</strong>
                    <small>
                      {pendingProposal !== undefined
                        ? `${pendingProposal.summary.rowCount} ${pendingProposal.summary.rowCount === 1 ? "balance" : "balances"} ready · ${pendingProposal.refreshKind === "live" ? "live check" : "cached"} ${formatDate(pendingProposal.observedAt)}`
                        : connection.lastCheckedAt === null
                          ? "Not checked yet"
                          : `Automatic check failed after ${formatDate(connection.lastCheckedAt)}`}
                    </small>
                  </span>
                  <Button
                    disabled={
                      busyAction !== null ||
                      (pendingProposal === undefined &&
                        connection.liveRefreshesRemaining === 0)
                    }
                    onClick={() => {
                      if (pendingProposal !== undefined) {
                        setActiveProposalId(pendingProposal.id);
                        return;
                      }
                      void checkBalances(connection.id);
                    }}
                    tone={
                      pendingProposal === undefined ? "secondary" : "primary"
                    }
                  >
                    {busyAction === connection.id
                      ? "Checking…"
                      : pendingProposal !== undefined
                        ? `Review ${pendingProposal.summary.rowCount} ${pendingProposal.summary.rowCount === 1 ? "balance" : "balances"}`
                        : "Try again"}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

      {notice !== null && (
        <FormMessage className="cash-accounts__notice" tone="success">
          {notice}
        </FormMessage>
      )}
      {error !== null && (
        <FormMessage className="cash-accounts__error" tone="error">
          {error}
        </FormMessage>
      )}
      {!setupRequired && (state?.connections.length ?? 0) > 0 && (
        <p className="cash-accounts__cost-note">
          {busyAction === "automatic"
            ? "Checking due bank balances…"
            : latestBankCheckAt === null
              ? "Balances are checked automatically when due."
              : `Last checked ${formatDate(latestBankCheckAt)}.`}{" "}
          Checks run no more than once a week or four times per bank each month.
        </p>
      )}
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

type BaselineChangeValue = {
  valueMinor: number | null;
  valueState: "reported" | "locked" | "not_reported";
};

function baselineChangeValueLabel(value: BaselineChangeValue): string {
  if (value.valueState === "locked") {
    return "Locked";
  }
  if (value.valueState !== "reported" || value.valueMinor === null) {
    return "Not reported";
  }
  return formatMoney(value.valueMinor);
}

function baselineChangeTransition(change: {
  changeType: "added" | "updated";
  current: BaselineChangeValue;
  previous: BaselineChangeValue | null;
}): string {
  const current = baselineChangeValueLabel(change.current);
  if (change.changeType === "added" || change.previous === null) {
    return `Added at ${current}`;
  }
  const previous = baselineChangeValueLabel(change.previous);
  return previous === current ? current : `${previous} → ${current}`;
}

function pluralizedCount(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function automaticPortfolioBaselineChangeNote(
  state: PortfolioBaselineState,
  otherFiEligibleLiquidMinor: number,
): string {
  const descriptions = [
    ...state.changes.positions.map((change) => {
      const current = baselineChangeValueLabel(change.current);
      const outsideFi =
        change.current.classification === "private_paper"
          ? " (outside FI liquid)"
          : "";
      if (change.changeType === "added" || change.previous === null) {
        return `${change.current.positionName}: added at ${current}${outsideFi}`;
      }
      const previous = baselineChangeValueLabel(change.previous);
      return previous === current
        ? `${change.current.positionName}: source refreshed; value unchanged at ${current}${outsideFi}`
        : `${change.current.positionName}: ${previous} → ${current}${outsideFi}`;
    }),
    ...state.changes.cashAccounts.map((change) => {
      const current = baselineChangeValueLabel(change.current);
      if (change.changeType === "added" || change.previous === null) {
        return `${change.current.accountLabel}: added at ${current}`;
      }
      const previous = baselineChangeValueLabel(change.previous);
      return previous === current
        ? `${change.current.accountLabel}: balance refreshed; value unchanged at ${current}`
        : `${change.current.accountLabel}: ${previous} → ${current}`;
    }),
  ];
  const parts =
    descriptions.length <= 3
      ? descriptions
      : [
          [
            state.changes.positions.length > 0
              ? pluralizedCount(
                  state.changes.positions.length,
                  "holding changed",
                  "holdings changed",
                )
              : null,
            state.changes.cashAccounts.length > 0
              ? pluralizedCount(
                  state.changes.cashAccounts.length,
                  "cash account changed",
                  "cash accounts changed",
                )
              : null,
          ]
            .filter((value): value is string => value !== null)
            .join("; "),
        ];
  const priorOtherFiEligibleLiquidMinor =
    state.latestBaseline?.otherFiEligibleLiquidMinor ?? 0;
  if (priorOtherFiEligibleLiquidMinor !== otherFiEligibleLiquidMinor) {
    parts.push(
      `Cash held elsewhere: ${formatMoney(priorOtherFiEligibleLiquidMinor)} → ${formatMoney(otherFiEligibleLiquidMinor)}`,
    );
  }
  const proposedFiEligibleLiquidMinor = addMinorUnits(
    state.summary?.publicMarketValueMinor ?? 0,
    state.summary?.cashAccountValueMinor ?? 0,
    otherFiEligibleLiquidMinor,
  );
  if (
    proposedFiEligibleLiquidMinor !==
    state.planning.currentFiEligibleLiquidMinor
  ) {
    parts.push(
      `FI-eligible liquid: ${formatMoney(state.planning.currentFiEligibleLiquidMinor)} → ${formatMoney(proposedFiEligibleLiquidMinor)}`,
    );
  } else if (parts.length > 0) {
    parts.push(
      `FI-eligible liquid remains ${formatMoney(proposedFiEligibleLiquidMinor)}`,
    );
  }
  return (parts.filter(Boolean).join("; ") || "Reviewed source update").slice(
    0,
    500,
  );
}

function portfolioBaselineRequiresCashOverlapReview(
  state: PortfolioBaselineState,
  otherFiEligibleLiquidMinor: number,
): boolean {
  if (otherFiEligibleLiquidMinor <= 0 || state.summary === null) {
    return false;
  }
  const brokerageCashMinor = addMinorUnits(
    ...state.positions
      .filter(
        (position) => position.isCashPosition && position.valueMinor !== null,
      )
      .map((position) => position.valueMinor ?? 0),
  );
  return state.summary.cashAccountValueMinor > 0 || brokerageCashMinor > 0;
}

const PORTFOLIO_ACCESS_DETAIL_PAGE_SIZE = 12;
const PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE = 12;

type PortfolioAccessDetailRow = {
  context: string;
  id: string;
  name: string;
  observedAt: string | null;
  valueMinor: number | null;
  valueState: "reported" | "locked" | "not_reported";
};

const portfolioAccessDetailCopy: Record<
  PortfolioAccessKey,
  { description: string; title: string }
> = {
  cash: {
    title: "Cash",
    description: "Linked bank balances and brokerage cash in this segment.",
  },
  public_market: {
    title: "Public market",
    description: "Reviewed public positions behind this segment.",
  },
  private_paper: {
    title: "Private paper",
    description: "Reviewed private positions behind this segment.",
  },
  other_liquid: {
    title: "Other liquid",
    description:
      "Liquid assets recorded outside linked cash accounts and public holdings.",
  },
};

function comparePortfolioAccessRows(
  left: PortfolioAccessDetailRow,
  right: PortfolioAccessDetailRow,
): number {
  if (left.valueMinor === null && right.valueMinor !== null) {
    return 1;
  }
  if (left.valueMinor !== null && right.valueMinor === null) {
    return -1;
  }
  if (left.valueMinor !== right.valueMinor) {
    return (right.valueMinor ?? 0) > (left.valueMinor ?? 0) ? 1 : -1;
  }
  return left.name.localeCompare(right.name);
}

function portfolioAccessRows(
  state: PortfolioBaselineState,
  accessKey: PortfolioAccessKey,
): PortfolioAccessDetailRow[] {
  if (accessKey === "cash") {
    return [
      ...state.cashAccounts.map((account) => ({
        context: `${account.institutionLabel} · ${account.subtype}`,
        id: `cash-account:${account.id}`,
        name: account.accountLabel,
        observedAt: account.observedAt,
        valueMinor: account.valueMinor,
        valueState: account.valueState,
      })),
      ...state.positions
        .filter((position) => position.isCashPosition)
        .map((position) => ({
          context: `${position.sourceLabel} · ${position.ownerLabel}`,
          id: `cash-position:${position.id}`,
          name: position.positionName,
          observedAt: position.observedAt,
          valueMinor: position.valueMinor,
          valueState: position.valueState,
        })),
    ].sort(comparePortfolioAccessRows);
  }
  if (accessKey === "other_liquid") {
    return [
      {
        context:
          state.latestBaseline === null
            ? "Planning baseline"
            : "Accepted planning baseline",
        id: "other-liquid",
        name: "Assets held elsewhere",
        observedAt: state.latestBaseline?.observedAt ?? state.observedAt,
        valueMinor:
          state.latestBaseline?.otherFiEligibleLiquidMinor ??
          state.suggestedOtherFiEligibleLiquidMinor,
        valueState: "reported",
      },
    ];
  }
  return state.positions
    .filter(
      (position) =>
        !position.isCashPosition && position.classification === accessKey,
    )
    .map((position) => ({
      context: `${position.sourceLabel} · ${position.ownerLabel}`,
      id: position.id,
      name: position.positionName,
      observedAt: position.observedAt,
      valueMinor: position.valueMinor,
      valueState: position.valueState,
    }))
    .sort(comparePortfolioAccessRows);
}

function portfolioAccessRowValue(row: PortfolioAccessDetailRow): string {
  if (row.valueState === "locked") {
    return "Locked";
  }
  if (row.valueState !== "reported" || row.valueMinor === null) {
    return "Not reported";
  }
  return formatCompactMoney(row.valueMinor);
}

function PortfolioAccessDetail({
  accessKey,
  state,
}: {
  accessKey: PortfolioAccessKey;
  state: PortfolioBaselineState;
}) {
  const [visibleRowCount, setVisibleRowCount] = useState(
    PORTFOLIO_ACCESS_DETAIL_PAGE_SIZE,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const copy = portfolioAccessDetailCopy[accessKey];
  const rows = portfolioAccessRows(state, accessKey);
  const knownTotalMinor = rows.reduce(
    (total, row) =>
      row.valueState === "reported" && row.valueMinor !== null
        ? addMinorUnits(total, row.valueMinor)
        : total,
    0,
  );
  const unavailableCount = rows.filter(
    (row) => row.valueState !== "reported" || row.valueMinor === null,
  ).length;
  const visibleRows = rows.slice(0, visibleRowCount);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      headingRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [accessKey]);

  return (
    <section
      aria-labelledby="portfolio-access-detail-title"
      className="portfolio-access-detail"
    >
      <header className="portfolio-access-detail__heading">
        <div>
          <p className="eyebrow">Portfolio by access</p>
          <h2 id="portfolio-access-detail-title" ref={headingRef} tabIndex={-1}>
            {copy.title}
          </h2>
          <p>{copy.description}</p>
        </div>
        <Stat
          as="span"
          className="portfolio-access-detail__total"
          detail={`${rows.length} ${rows.length === 1 ? "source" : "sources"}${
            unavailableCount === 0
              ? ""
              : ` · ${unavailableCount} ${unavailableCount === 1 ? "value" : "values"} unavailable`
          }`}
          detailAs="span"
          label="Known reviewed value"
          labelAs="small"
          value={formatCompactMoney(knownTotalMinor)}
        />
      </header>
      {rows.length === 0 ? (
        <EmptyState title={`No ${copy.title.toLowerCase()} detail`}>
          No reviewed sources are available for this segment.
        </EmptyState>
      ) : (
        <>
          <div className="portfolio-access-detail__rows">
            {visibleRows.map((row) => (
              <article key={row.id}>
                <span>
                  <strong>{row.name}</strong>
                  <small>{row.context}</small>
                </span>
                <span>
                  <strong>{portfolioAccessRowValue(row)}</strong>
                  <small>
                    {row.observedAt === null
                      ? "Date unavailable"
                      : `As of ${formatDate(row.observedAt)}`}
                  </small>
                </span>
              </article>
            ))}
          </div>
          {visibleRows.length < rows.length && (
            <div className="portfolio-access-detail__more">
              <span>
                Showing {visibleRows.length} of {rows.length} sources
              </span>
              <Button
                onClick={() =>
                  setVisibleRowCount(
                    (current) => current + PORTFOLIO_ACCESS_DETAIL_PAGE_SIZE,
                  )
                }
                tone="secondary"
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function PortfolioBaselineSection({
  onConfirmed,
  refreshKey,
  selectedAccessKey,
}: {
  onConfirmed: () => Promise<void>;
  refreshKey: string;
  selectedAccessKey: PortfolioAccessKey | null;
}) {
  const [state, setState] = useState<PortfolioBaselineState | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [otherLiquidInput, setOtherLiquidInput] = useState("");
  const [changeNote, setChangeNote] = useState<string | null>(null);
  const [visibleChangeCount, setVisibleChangeCount] = useState(
    PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE,
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

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
      state.summary.cashAccountValueMinor,
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
  const automaticChangeNote = useMemo(() => {
    if (state === null || proposedOtherLiquidMinor === null) {
      return "";
    }
    return automaticPortfolioBaselineChangeNote(
      state,
      proposedOtherLiquidMinor,
    );
  }, [proposedOtherLiquidMinor, state]);
  const effectiveChangeNote = (changeNote ?? automaticChangeNote).trim();

  const openReview = () => {
    if (state === null) {
      return;
    }
    setOtherLiquidInput(
      minorUnitsToDollarInput(state.suggestedOtherFiEligibleLiquidMinor),
    );
    setChangeNote(null);
    setVisibleChangeCount(PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE);
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
      effectiveChangeNote.length === 0
    ) {
      return;
    }
    const input: PortfolioBaselineConfirmInput = {
      sourceRevision: state.sourceRevision,
      baseForecastSnapshotId: state.baseForecastSnapshotId,
      baseForecastSnapshotVersion: state.baseForecastSnapshotVersion,
      otherFiEligibleLiquidMinor: proposedOtherLiquidMinor,
      duplicateReviewConfirmed: state.requiresDuplicateReview,
      cashOverlapReviewConfirmed: portfolioBaselineRequiresCashOverlapReview(
        state,
        proposedOtherLiquidMinor,
      ),
      changeNote: effectiveChangeNote,
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
    selectedAccessKey !== null &&
    portfolioAccessKeys.has(selectedAccessKey)
  ) {
    return (
      <PortfolioAccessDetail
        accessKey={selectedAccessKey}
        key={selectedAccessKey}
        state={state}
      />
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
    const sourceChanges = [
      ...state.changes.positions.map((change) => {
        const valueUnchanged =
          change.previous !== null &&
          baselineChangeValueLabel(change.previous) ===
            baselineChangeValueLabel(change.current);
        return {
          context: `${change.current.sourceLabel} · ${change.current.ownerLabel}`,
          id: `position:${change.current.id}`,
          meta: valueUnchanged
            ? `Source refreshed ${formatDate(change.current.observedAt)}`
            : change.current.isCashPosition
              ? "Brokerage cash"
              : change.current.classification === "public_market"
                ? "Public market"
                : "Private paper · outside FI liquid",
          name: change.current.positionName,
          possibleOverlap: change.current.potentialDuplicate,
          transition: baselineChangeTransition(change),
        };
      }),
      ...state.changes.cashAccounts.map((change) => {
        const valueUnchanged =
          change.previous !== null &&
          baselineChangeValueLabel(change.previous) ===
            baselineChangeValueLabel(change.current);
        return {
          context: `${change.current.institutionLabel} · ${change.current.subtype}`,
          id: `cash:${change.current.id}`,
          meta: valueUnchanged
            ? `Source refreshed ${formatDate(change.current.observedAt)}`
            : `Bank cash · ${formatDate(change.current.observedAt)}`,
          name: change.current.accountLabel,
          possibleOverlap: false,
          transition: baselineChangeTransition(change),
        };
      }),
    ];
    const visibleSourceChanges = sourceChanges.slice(0, visibleChangeCount);
    const priorOtherLiquidMinor =
      state.latestBaseline?.otherFiEligibleLiquidMinor ?? 0;
    const otherLiquidChanged =
      proposedOtherLiquidMinor !== null &&
      proposedOtherLiquidMinor !== priorOtherLiquidMinor;
    const reviewChangeCount =
      sourceChanges.length + (otherLiquidChanged ? 1 : 0);
    const requiresCashOverlapReview =
      proposedOtherLiquidMinor !== null &&
      portfolioBaselineRequiresCashOverlapReview(
        state,
        proposedOtherLiquidMinor,
      );
    const impactChanges =
      proposedImpact === null
        ? []
        : [
            {
              changed:
                state.currentImpact.fiEligibleLiquidMinor !==
                proposedImpact.fiEligibleLiquidMinor,
              label: "FI-eligible liquid",
              value: `${formatCompactMoney(state.currentImpact.fiEligibleLiquidMinor)} → ${formatCompactMoney(proposedImpact.fiEligibleLiquidMinor)}`,
            },
            {
              changed:
                state.currentImpact.protectedRunwayMonths !==
                proposedImpact.protectedRunwayMonths,
              label: "Protected runway",
              value: `${state.currentImpact.protectedRunwayMonths} → ${proposedImpact.protectedRunwayMonths} months`,
            },
            {
              changed:
                state.currentImpact.fiGapMinor !== proposedImpact.fiGapMinor,
              label: "FI gap",
              value: `${formatCompactMoney(state.currentImpact.fiGapMinor)} → ${formatCompactMoney(proposedImpact.fiGapMinor)}`,
            },
            {
              changed:
                state.currentImpact.middleTotalAvailableMinor !==
                proposedImpact.middleTotalAvailableMinor,
              label: "5-year middle total",
              value: `${formatCompactMoney(state.currentImpact.middleTotalAvailableMinor)} → ${formatCompactMoney(proposedImpact.middleTotalAvailableMinor)}`,
            },
            {
              changed:
                state.currentImpact.probabilityCrossingFiPpm !==
                proposedImpact.probabilityCrossingFiPpm,
              label: "Chance of reaching FI",
              value: `${formatProbability(state.currentImpact.probabilityCrossingFiPpm)} → ${formatProbability(proposedImpact.probabilityCrossingFiPpm)}`,
            },
          ].filter((impact) => impact.changed);
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
            {state.latestBaseline === null
              ? "Set the FI liquid baseline"
              : reviewChangeCount === 1
                ? "Review 1 baseline change"
                : reviewChangeCount === 0
                  ? "Review the baseline change"
                  : `Review ${reviewChangeCount} baseline changes`}
          </h2>
          <p>
            {state.latestBaseline === null
              ? "Review the sources entering the FI plan. Nothing changes until you confirm."
              : `Only changes since ${formatDate(state.latestBaseline.observedAt)} are shown. Nothing changes until you confirm.`}
          </p>
        </header>

        {sourceChanges.length > 0 && (
          <section
            aria-label="Baseline source changes"
            className="baseline-changes"
          >
            <header>
              <p className="eyebrow">Source changes</p>
              <h3>
                {pluralizedCount(
                  sourceChanges.length,
                  "changed source",
                  "changed sources",
                )}
              </h3>
            </header>
            <div className="baseline-position-list">
              <div className="baseline-position-list__header">
                <span>Changed source</span>
                <span>Before → after</span>
              </div>
              {visibleSourceChanges.map((sourceChange) => (
                <article key={sourceChange.id}>
                  <div>
                    <strong>{sourceChange.name}</strong>
                    <span>{sourceChange.context}</span>
                    {sourceChange.possibleOverlap && (
                      <small>Possible overlap in this changed source</small>
                    )}
                  </div>
                  <div>
                    <strong>{sourceChange.transition}</strong>
                    <span>{sourceChange.meta}</span>
                  </div>
                </article>
              ))}
            </div>
            {visibleSourceChanges.length < sourceChanges.length && (
              <div className="baseline-changes__more">
                <span>
                  Showing {visibleSourceChanges.length} of{" "}
                  {sourceChanges.length}
                </span>
                <Button
                  onClick={() =>
                    setVisibleChangeCount(
                      (current) =>
                        current + PORTFOLIO_BASELINE_CHANGE_PAGE_SIZE,
                    )
                  }
                  tone="secondary"
                >
                  Show more
                </Button>
              </div>
            )}
          </section>
        )}

        <div className="baseline-policy-grid">
          <div className="baseline-policy-input">
            <div
              aria-label="Proposed FI-eligible liquid calculation"
              className="baseline-liquid-composition"
            >
              <div className="baseline-liquid-composition__row">
                <span>Public holdings</span>
                <strong>
                  {formatMoney(state.summary.publicMarketValueMinor)}
                </strong>
              </div>
              <div className="baseline-liquid-composition__row">
                <span>Bank cash</span>
                <strong>
                  {formatMoney(state.summary.cashAccountValueMinor)}
                </strong>
              </div>
              <Field
                className="baseline-liquid-composition__field"
                htmlFor="other-fi-eligible-liquid-input"
                label="Cash held elsewhere"
              >
                <InputGroup prefix="$">
                  <Input
                    aria-describedby="fi-eligible-liquid-help"
                    aria-invalid={otherLiquidInputInvalid || undefined}
                    id="other-fi-eligible-liquid-input"
                    inputMode="decimal"
                    onChange={(event) =>
                      setOtherLiquidInput(event.currentTarget.value)
                    }
                    value={otherLiquidInput}
                  />
                </InputGroup>
              </Field>
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
              Add liquid cash that is not in a linked bank or brokerage account.
              Private paper stays outside FI liquid.
            </p>
            {requiresCashOverlapReview && (
              <p className="baseline-cash-context">
                This amount is added on top of sourced bank and brokerage cash.
                Reduce it if any of that cash is already listed.
              </p>
            )}
            <Field
              htmlFor="portfolio-baseline-change-note"
              label="What changed"
            >
              <Textarea
                id="portfolio-baseline-change-note"
                maxLength={500}
                onChange={(event) => setChangeNote(event.currentTarget.value)}
                value={changeNote ?? automaticChangeNote}
              />
            </Field>
          </div>

          <div aria-live="polite" className="baseline-impact">
            <p className="eyebrow">Forecast impact</p>
            {proposedImpact === null ? (
              <p>Enter a valid dollar amount with no more than two decimals.</p>
            ) : impactChanges.length === 0 ? (
              <p>No forecast values change.</p>
            ) : (
              impactChanges.map((impact) => (
                <div key={impact.label}>
                  <span>{impact.label}</span>
                  <strong>{impact.value}</strong>
                </div>
              ))
            )}
          </div>
        </div>

        {error !== null && <Notice tone="error">{error}</Notice>}
        <ActionGroup
          as="footer"
          className="baseline-review-actions"
          layout="split"
          mobileLayout="stack"
        >
          <p>
            Applying these changes updates the FI plan and saves a new forecast
            version.
          </p>
          <ActionGroup align="end" mobileLayout="grid">
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
                effectiveChangeNote.length === 0
              }
              onClick={() => void confirm()}
              tone="primary"
            >
              {working
                ? "Applying…"
                : state.latestBaseline === null
                  ? "Set baseline"
                  : "Apply changes"}
            </Button>
          </ActionGroup>
        </ActionGroup>
      </section>
    );
  }

  const isCurrent = state.status === "current";
  if (isCurrent) {
    return null;
  }
  const sourceChangeCount =
    state.changes.positions.length + state.changes.cashAccounts.length;
  return (
    <section
      aria-labelledby="portfolio-baseline-title"
      className="portfolio-baseline"
    >
      <div className="portfolio-baseline__heading">
        <p className="eyebrow">Planning baseline</p>
        <h2 id="portfolio-baseline-title">
          {state.latestBaseline === null
            ? "Set the FI planning baseline"
            : sourceChangeCount === 1
              ? "1 baseline change is ready"
              : sourceChangeCount === 0
                ? "A baseline change is ready"
                : `${sourceChangeCount} baseline changes are ready`}
        </h2>
        <p>
          {state.latestBaseline === null
            ? "Set reviewed public holdings and cash as the FI baseline, then add any cash held elsewhere."
            : "Review only the changed sources and their forecast impact."}
        </p>
        {error !== null && (
          <FormMessage className="portfolio-baseline__error" tone="error">
            {error}
          </FormMessage>
        )}
      </div>
      <Button onClick={openReview} tone="primary">
        {state.latestBaseline === null ? "Set baseline" : "Review changes"}
      </Button>
    </section>
  );
}

const HOLDINGS_EXPOSURE_PAGE_SIZE = 12;

function Holdings({
  data,
  onBaselineConfirmed,
  onCashAccepted,
  onExposureResolved,
  onApplyImport,
  onImportRouteChange,
  onLoadImport,
  onPreviewImport,
  onViewChange,
  requestedDrilldown,
  requestedImportId,
  requestedView,
}: {
  data: HoldingsPage;
  onBaselineConfirmed: () => Promise<void>;
  onCashAccepted: () => Promise<void>;
  onExposureResolved: () => Promise<void>;
  onApplyImport: (
    importId: string,
    input: HoldingImportApplyInput,
  ) => Promise<HoldingImportApplyResult>;
  onImportRouteChange: (importId: string | null) => void;
  onLoadImport: (importId: string) => Promise<HoldingImportPreview>;
  onPreviewImport: (
    provider: UploadHoldingImportProvider,
    file: File,
  ) => Promise<HoldingImportPreview>;
  onViewChange: (view: "entities" | "overview" | "sources") => void;
  requestedDrilldown: PortfolioSnapshotDrilldown | null;
  requestedImportId: string | null;
  requestedView: "entities" | "overview" | "sources";
}) {
  const [showImporter, setShowImporter] = useState(false);
  const [reviewedImportIds, setReviewedImportIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [routedPreview, setRoutedPreview] =
    useState<HoldingImportPreview | null>(null);
  const [routedPreviewError, setRoutedPreviewError] = useState<{
    importId: string;
    message: string;
  } | null>(null);
  const [selectedHoldingId, setSelectedHoldingId] = useState<string | null>(
    null,
  );
  const [openExposureIds, setOpenExposureIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [showSmallCashBalances, setShowSmallCashBalances] = useState(false);
  const [cashRefreshVersion, setCashRefreshVersion] = useState(0);
  const [visibleExposureCount, setVisibleExposureCount] = useState(
    HOLDINGS_EXPOSURE_PAGE_SIZE,
  );
  const selectedHolding =
    data.holdings.find((holding) => holding.id === selectedHoldingId) ?? null;
  const importerVisible = showImporter || requestedImportId !== null;
  const sourcesVisible =
    selectedHolding === null && !importerVisible && requestedView === "sources";
  const entitiesVisible =
    selectedHolding === null &&
    !importerVisible &&
    requestedView === "entities";
  const activeRoutedPreview =
    routedPreview?.id === requestedImportId ? routedPreview : null;
  const activeRoutedError =
    routedPreviewError?.importId === requestedImportId
      ? routedPreviewError.message
      : null;
  const pendingImports = useMemo(
    () =>
      data.pendingImports.filter(
        (item) =>
          item.provider !== "plaid_investments" &&
          !reviewedImportIds.has(item.id),
      ),
    [data.pendingImports, reviewedImportIds],
  );
  const baselineRefreshKey = `${data.holdings
    .map(
      (holding) =>
        `${holding.id}:${holding.effectiveDate}:${holding.administratorNavMinor ?? "unknown"}`,
    )
    .sort((left, right) => left.localeCompare(right))
    .join("|")}:cash:${cashRefreshVersion}`;

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
  const loadMoreExposures = useCallback(
    () =>
      setVisibleExposureCount(
        (current) => current + HOLDINGS_EXPOSURE_PAGE_SIZE,
      ),
    [],
  );
  const setExposureOpen = useCallback((exposureId: string, open: boolean) => {
    setOpenExposureIds((current) => {
      if (current.has(exposureId) === open) {
        return current;
      }
      const next = new Set(current);
      if (open) {
        next.add(exposureId);
      } else {
        next.delete(exposureId);
      }
      return next;
    });
  }, []);

  const openHoldingDetail = useCallback((holdingId: string) => {
    const action = document.querySelector<HTMLElement>(
      `[data-holding-id="${CSS.escape(holdingId)}"]`,
    );
    const exposureId = action
      ?.closest<HTMLElement>("[data-exposure-id]")
      ?.getAttribute("data-exposure-id");

    setOpenExposureIds(
      exposureId === null || exposureId === undefined
        ? new Set()
        : new Set([exposureId]),
    );
    setSelectedHoldingId(holdingId);
  }, []);

  const closeHoldingDetail = () => {
    const returnFocusId = selectedHoldingId;
    setSelectedHoldingId(null);
    if (returnFocusId !== null) {
      let attempts = 0;
      const restoreFocus = () => {
        const action = document.querySelector<HTMLButtonElement>(
          `[data-holding-id="${CSS.escape(returnFocusId)}"]`,
        );
        if (action !== null) {
          action.focus();
          return;
        }
        attempts += 1;
        if (attempts < 120) {
          window.requestAnimationFrame(restoreFocus);
        }
      };
      window.requestAnimationFrame(restoreFocus);
    }
  };

  return (
    <ScreenLayout className="holdings-screen">
      <PageHeader
        actions={
          <>
            {selectedHolding !== null ? (
              <TextLink onClick={closeHoldingDetail}>Back to holdings</TextLink>
            ) : importerVisible ? (
              <TextLink onClick={closeImporter}>Close import</TextLink>
            ) : sourcesVisible ? (
              <>
                <TextLink onClick={() => onViewChange("overview")}>
                  Back to holdings
                </TextLink>
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
            ) : entitiesVisible ? (
              <TextLink onClick={() => onViewChange("overview")}>
                Back to holdings
              </TextLink>
            ) : (
              <>
                <TextLink onClick={() => onViewChange("entities")}>
                  Legal entities
                </TextLink>
                <Button onClick={() => onViewChange("sources")} tone="primary">
                  Manage sources
                </Button>
              </>
            )}
          </>
        }
        description={
          entitiesVisible
            ? "Prepare a reviewed entity list for counsel. This inventory does not transfer an entity to a trust."
            : sourcesVisible
              ? "Manage automatic updates, bank accounts, and brokerages."
              : "See shared economic exposure, then open each legal position for ownership and source details."
        }
        eyebrow={
          sourcesVisible || entitiesVisible ? "Holdings" : "Portfolio evidence"
        }
        title={
          entitiesVisible
            ? "Legal entities"
            : sourcesVisible
              ? "Holding sources"
              : "Holdings"
        }
      />

      {selectedHolding !== null ? (
        <HoldingDetailWorkspace
          holding={selectedHolding}
          onValueAccepted={onExposureResolved}
        />
      ) : importerVisible ? (
        requestedImportId !== null &&
        activeRoutedPreview === null &&
        activeRoutedError === null ? (
          <div aria-live="polite" className="holding-import-loading">
            Loading the holding import…
          </div>
        ) : requestedImportId !== null && activeRoutedPreview === null ? (
          <Notice tone="error">
            {activeRoutedError ?? "This holding import is unavailable."}
            <TextLink onClick={closeImporter}>Back to holdings</TextLink>
          </Notice>
        ) : (
          <HoldingImportWorkspace
            initialPreview={activeRoutedPreview}
            key={activeRoutedPreview?.id ?? "manual-import"}
            onApply={async (importId, input) => {
              const result = await onApplyImport(importId, input);
              setReviewedImportIds((current) => {
                const next = new Set(current);
                next.add(importId);
                return next;
              });
              return result;
            }}
            onClose={closeImporter}
            onPreview={onPreviewImport}
          />
        )
      ) : entitiesVisible ? (
        <LegalEntities />
      ) : (
        <>
          {sourcesVisible ? (
            <>
              <AngelListSignInControl />
              <ProviderPortfolioAgentsControl />
              <CashAccountsControl
                onAccepted={async () => {
                  setCashRefreshVersion((current) => current + 1);
                  await onCashAccepted();
                }}
              />
            </>
          ) : (
            <>
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
                            {holdingImportSourceLabel(item.provider)} ·{" "}
                            {formatDate(item.observedAt)}
                          </small>
                        </span>
                        <Button
                          aria-label={`Review ${holdingImportProviderName(item.provider)} import dated ${formatDate(item.observedAt)}`}
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
              <PortfolioBaselineSection
                onConfirmed={onBaselineConfirmed}
                refreshKey={baselineRefreshKey}
                selectedAccessKey={
                  requestedDrilldown?.type === "access"
                    ? requestedDrilldown.accessKey
                    : null
                }
              />
            </>
          )}
          <InvestmentHoldings
            acceptedCashAccounts={data.acceptedCashAccounts}
            data={data.investmentHoldings}
            holdings={data.holdings}
            mode={sourcesVisible ? "sources" : "exposures"}
            onExposureOpenChange={setExposureOpen}
            onExposureResolved={onExposureResolved}
            onLoadMoreExposures={loadMoreExposures}
            onOpenHolding={openHoldingDetail}
            onReviewImport={reviewPendingImport}
            onShowSmallBalancesChange={setShowSmallCashBalances}
            openExposureIds={openExposureIds}
            requestedExposureId={
              requestedDrilldown?.type === "exposure"
                ? requestedDrilldown.exposureId
                : null
            }
            showSmallBalances={showSmallCashBalances}
            visibleExposureCount={visibleExposureCount}
          />
        </>
      )}
    </ScreenLayout>
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
    <ScreenLayout className="watch-screen">
      <PageHeader
        actions={
          <Badge data-testid="portfolio-watch-status" tone="neutral">
            Public sources only
          </Badge>
        }
        className="watch-intro"
        description="Follow public signals across your private holdings. A signal never changes a holding on its own; a value changes only after you review and apply it."
        title="Portfolio Watch"
      />

      <Panel
        className="watch-control-panel"
        data-testid="portfolio-watch-control"
      >
        <div>
          <h2>Check for updates</h2>
          <p>
            Keel finds company sources and sends new evidence to review. Company
            financing terms do not determine what your position is worth.
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

      {error !== null && <Notice tone="error">{error}</Notice>}
      {message !== null && <FormMessage tone="success">{message}</FormMessage>}

      <section>
        <SectionHeader
          title={`Monitoring ${data.portfolioWatch.targets.length} companies`}
        />
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
        <SectionHeader title="Recent signals" />

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
    </ScreenLayout>
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
            <TextLink
              className="evidence-source-link"
              href={item.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              Open official source
            </TextLink>
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
  const scenarioOptions = availableScenarios.map((scenario) => ({
    label: `${scenario.name} v${scenario.latestSnapshotVersion}`,
    value: scenario.id,
  }));

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
        <Select
          disabled={busy}
          items={scenarioOptions}
          onValueChange={(value) => {
            if (typeof value === "string") setSelectedScenarioId(value);
          }}
          value={selectedScenario.id}
        >
          <SelectTrigger
            aria-label={
              "Scenario baseline for " +
              group.companyName +
              " " +
              group.roundLabel
            }
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {scenarioOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
      {error !== null && <Notice tone="error">{error}</Notice>}
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
      <SectionHeader
        description="Compare current reports together. Superseded reports stay visible but do not drive a proposed update."
        eyebrow="Recommended review order"
        title="Reconcile related reports"
      />
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
    <ScreenLayout className="evidence-screen">
      <PageHeader
        actions={
          <Badge tone="accent">
            {
              data.evidenceInbox.filter(
                (item) => item.status === "pending_review",
              ).length
            }{" "}
            pending
          </Badge>
        }
        description="External signals become proposals. You decide what enters the accepted record or a scenario."
        eyebrow="Review before change"
        title="Evidence Inbox"
      />
      {error !== null && <Notice tone="error">{error}</Notice>}
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
    </ScreenLayout>
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
  const [planSuggestion, setPlanSuggestion] =
    useState<CashFlowPlanSuggestion | null>(null);
  const [planSuggestionVersion, setPlanSuggestionVersion] = useState(0);
  const [cashFlowReloadKey, setCashFlowReloadKey] = useState(0);
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
    <ScreenLayout>
      <PageHeader
        actions={
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
        }
        description="Scenarios change projected outcomes. Goals define what success means. Edit the goal itself in Goals."
        eyebrow="Forecast assumptions"
        title="Scenarios"
      />

      <ObservedCashFlow
        onPreparePlanDraft={(suggestion) => {
          setPlanSuggestion(suggestion);
          setPlanSuggestionVersion((current) => current + 1);
        }}
        reloadKey={cashFlowReloadKey}
      />

      <PlanInputsEditor
        onSaved={async () => {
          await onPlanSaved();
          setPlanSuggestion(null);
          setCashFlowReloadKey((current) => current + 1);
        }}
        suggestion={planSuggestion}
        suggestionVersion={planSuggestionVersion}
      />

      <Tabs
        className="scenario-workspace"
        onValueChange={(value) => selectScenario(String(value))}
        value={selected.id}
      >
        <TabsList className="scenario-tabs" variant="line">
          {data.scenarios.map((scenario) => (
            <TabsTrigger key={scenario.id} value={scenario.id}>
              {scenario.name}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent className="scenario-content" value={selected.id}>
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
                      {financingScenarioTermsLabel(
                        scenarioContext.financingFacts,
                      )}
                      .
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

          <StatGroup className="scenario-summary">
            <div>
              <p>{selected.description}</p>
              <span>
                {hasDraftChanges
                  ? "Working draft preview"
                  : "Current saved forecast output"}
              </span>
            </div>
            <Stat
              detail="Value if the modeled liquidity events occur"
              label="Conditional value"
              value={formatCompactMoney(
                displayedScenario.conditionalValueMinor,
              )}
            />
            <i aria-hidden="true">≠</i>
            <Stat
              className="usable"
              detail={scenarioConditions}
              detailClassName="scenario-summary__assumptions"
              label="Timing-adjusted liquidity"
              value={formatCompactMoney(
                displayedScenario.timingAdjustedLiquidityMinor,
              )}
            />
          </StatGroup>

          <div className="scenario-grid">
            <Panel
              eyebrow="Annual distribution"
              title="Cumulative liquidity curve"
            >
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
                      <Input
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
              <Field label="What changed" wide>
                <Input
                  maxLength={500}
                  onChange={(event) => {
                    setChangeNote(event.target.value);
                    setSaveState("idle");
                    setSaveMessage(null);
                  }}
                  value={changeNote || autoChangeNote}
                />
              </Field>
              {saveMessage !== null && (
                <FormMessage tone={saveState === "error" ? "error" : "neutral"}>
                  {saveMessage}
                </FormMessage>
              )}
              <ActionGroup
                align="end"
                className="scenario-actions"
                mobileLayout="grid"
              >
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
              </ActionGroup>
            </Panel>
          </div>
        </TabsContent>
      </Tabs>
    </ScreenLayout>
  );
}

function ForecastHistory({ data }: { data: AlphaData }) {
  return (
    <ScreenLayout>
      <PageHeader
        actions={<Badge tone="positive">Read-only record</Badge>}
        description="Review what changed, who saved it, and how the forecast moved."
        eyebrow="Saved decisions"
        title="Forecast History"
      />

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
    </ScreenLayout>
  );
}

function HoldingsRouteStatus({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <HoldingsRouteShell
      status={
        error === null ? undefined : (
          <Notice className="investment-views__error" tone="error">
            <p>{error}</p>
            <Button onClick={onRetry} tone="secondary">
              Try again
            </Button>
          </Notice>
        )
      }
    />
  );
}

export function App() {
  const [activeScreen, setActiveScreen] = useState<Screen>(
    () => routeFromLocation().screen,
  );
  const [requestedGoalId, setRequestedGoalId] = useState<string | null>(null);
  const [holdingImportId, setHoldingImportId] = useState<string | null>(
    () => routeFromLocation().holdingImportId,
  );
  const [holdingsDrilldown, setHoldingsDrilldown] =
    useState<PortfolioSnapshotDrilldown | null>(
      () => routeFromLocation().holdingsDrilldown,
    );
  const [holdingsView, setHoldingsView] = useState<
    "entities" | "overview" | "sources"
  >(() => routeFromLocation().holdingsView);
  const [data, setData] = useState<AlphaData | null>(null);
  const [holdingsPageData, setHoldingsPageData] = useState<HoldingsPage | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [holdingsLoadError, setHoldingsLoadError] = useState<string | null>(
    null,
  );
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [busyEvent, setBusyEvent] = useState<string | null>(null);
  const [scenarioContext, setScenarioContext] =
    useState<EvidenceInboxItem | null>(null);
  const alphaRequestRef = useRef<Promise<AlphaData> | null>(null);
  const holdingsRequestRef = useRef<Promise<HoldingsPage> | null>(null);

  const refreshAlphaData = useCallback(
    async (force = false): Promise<AlphaData> => {
      let request = alphaRequestRef.current;
      if (request === null || force) {
        request = loadAlphaData();
        alphaRequestRef.current = request;
      }
      try {
        const next = await request;
        if (alphaRequestRef.current === request) {
          setData(next);
          setLoadError(null);
        }
        return next;
      } catch (error) {
        if (alphaRequestRef.current === request) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "The Keel data contract could not be loaded.",
          );
        }
        throw error;
      } finally {
        if (alphaRequestRef.current === request) {
          alphaRequestRef.current = null;
        }
      }
    },
    [],
  );

  const refreshHoldingsPage = useCallback(
    async (force = false): Promise<HoldingsPage> => {
      let request = holdingsRequestRef.current;
      if (request === null || force) {
        request = loadHoldingsPage();
        holdingsRequestRef.current = request;
      }
      try {
        const next = await request;
        if (holdingsRequestRef.current === request) {
          setHoldingsPageData(next);
          setHoldingsLoadError(null);
        }
        return next;
      } catch (error) {
        if (holdingsRequestRef.current === request) {
          setHoldingsLoadError(
            error instanceof Error
              ? error.message
              : "Keel could not load reviewed holdings.",
          );
        }
        throw error;
      } finally {
        if (holdingsRequestRef.current === request) {
          holdingsRequestRef.current = null;
        }
      }
    },
    [],
  );

  const navigateToScreen = useCallback((screen: Screen) => {
    const path = pathForScreen(screen);
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState(null, "", path);
    }
    setActiveScreen(screen);
    setHoldingImportId(null);
    setHoldingsDrilldown(null);
    setHoldingsView("overview");
    setRequestedGoalId(null);
  }, []);

  const navigateToGoal = useCallback((goalId: string) => {
    const path = pathForScreen("goals");
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState(null, "", path);
    }
    setActiveScreen("goals");
    setHoldingImportId(null);
    setHoldingsDrilldown(null);
    setHoldingsView("overview");
    setRequestedGoalId(goalId);
  }, []);

  const navigateToHoldingImport = useCallback((importId: string | null) => {
    const path =
      importId === null
        ? "/holdings"
        : `/holdings/imports/${encodeURIComponent(importId)}`;
    if (`${window.location.pathname}${window.location.search}` !== path) {
      window.history.pushState(null, "", path);
    }
    setActiveScreen("holdings");
    setHoldingImportId(importId);
    setHoldingsDrilldown(null);
    setHoldingsView("overview");
  }, []);

  const navigateToHoldingsView = useCallback(
    (view: "entities" | "overview" | "sources") => {
      const path =
        view === "entities"
          ? "/holdings/entities"
          : view === "sources"
            ? "/holdings/sources"
            : "/holdings";
      if (`${window.location.pathname}${window.location.search}` !== path) {
        window.history.pushState(null, "", path);
      }
      setActiveScreen("holdings");
      setHoldingImportId(null);
      setHoldingsDrilldown(null);
      setHoldingsView(view);
    },
    [],
  );

  const navigateToPortfolioDrilldown = useCallback(
    (drilldown: PortfolioSnapshotDrilldown) => {
      const search = new URLSearchParams();
      if (drilldown.type === "exposure") {
        search.set("exposure", drilldown.exposureId);
      } else {
        search.set("access", drilldown.accessKey);
      }
      const path = `/holdings?${search.toString()}`;
      if (`${window.location.pathname}${window.location.search}` !== path) {
        window.history.pushState(null, "", path);
      }
      setActiveScreen("holdings");
      setHoldingImportId(null);
      setHoldingsDrilldown(drilldown);
      setHoldingsView("overview");
    },
    [],
  );

  useEffect(() => {
    const updateRoute = () => {
      const route = routeFromLocation();
      setActiveScreen(route.screen);
      setHoldingImportId(route.holdingImportId);
      setHoldingsDrilldown(route.holdingsDrilldown);
      setHoldingsView(route.holdingsView);
      setRequestedGoalId(null);
    };
    window.addEventListener("popstate", updateRoute);
    return () => window.removeEventListener("popstate", updateRoute);
  }, []);

  const needsHoldingsData =
    activeScreen === "holdings" && holdingsView !== "entities";
  useEffect(() => {
    if (needsHoldingsData) {
      void refreshHoldingsPage().catch(() => undefined);
    }
  }, [needsHoldingsData, refreshHoldingsPage]);

  useEffect(() => {
    if (activeScreen !== "holdings" && data === null) {
      void refreshAlphaData().catch(() => undefined);
    }
  }, [activeScreen, data, refreshAlphaData]);

  useEffect(() => {
    const shouldPrefetchAlpha =
      activeScreen === "holdings" &&
      holdingsView !== "entities" &&
      holdingsPageData !== null &&
      data === null;
    const shouldPrefetchHoldings =
      activeScreen !== "holdings" && data !== null && holdingsPageData === null;
    if (!shouldPrefetchAlpha && !shouldPrefetchHoldings) {
      return;
    }
    const prefetch = () => {
      if (shouldPrefetchAlpha) {
        void refreshAlphaData().catch(() => undefined);
      } else {
        void refreshHoldingsPage().catch(() => undefined);
      }
    };
    if ("requestIdleCallback" in window) {
      const idle = window.requestIdleCallback(prefetch, { timeout: 3_000 });
      return () => window.cancelIdleCallback(idle);
    }
    const timer = globalThis.setTimeout(prefetch, 1_000);
    return () => globalThis.clearTimeout(timer);
  }, [
    activeScreen,
    data,
    holdingsPageData,
    holdingsView,
    refreshAlphaData,
    refreshHoldingsPage,
  ]);

  useEffect(() => {
    window.scrollTo({ behavior: "auto", top: 0 });
  }, [activeScreen, holdingImportId, holdingsDrilldown, holdingsView]);

  const content = useMemo(() => {
    if (activeScreen === "holdings") {
      // Entity review owns its data. Do not waterfall through unrelated
      // holdings, valuations, exposure reconciliation or planning requests.
      if (holdingsView === "entities")
        return (
          <ScreenLayout className="holdings-screen">
            <LegalEntities
              onBackToHoldings={() => navigateToHoldingsView("overview")}
            />
          </ScreenLayout>
        );
      if (holdingsPageData === null) {
        return (
          <HoldingsRouteStatus
            error={holdingsLoadError}
            onRetry={() => {
              void refreshHoldingsPage(true).catch(() => undefined);
            }}
          />
        );
      }
      const refreshReviewedHoldings = async () => {
        await Promise.all([refreshHoldingsPage(true), refreshAlphaData(true)]);
      };
      return (
        <Holdings
          data={holdingsPageData}
          onBaselineConfirmed={async () => {
            await refreshAlphaData(true);
          }}
          onCashAccepted={async () => {
            await refreshHoldingsPage(true);
          }}
          onExposureResolved={refreshReviewedHoldings}
          onApplyImport={async (importId, input) => {
            const result = await applyHoldingImport(importId, input);
            await refreshReviewedHoldings();
            return result;
          }}
          onImportRouteChange={navigateToHoldingImport}
          onViewChange={navigateToHoldingsView}
          onLoadImport={loadHoldingImport}
          onPreviewImport={previewHoldingImport}
          requestedImportId={holdingImportId}
          requestedDrilldown={holdingsDrilldown}
          requestedView={holdingsView}
        />
      );
    }
    if (data === null) {
      return null;
    }
    switch (activeScreen) {
      case "dashboard":
        return (
          <Dashboard
            data={data}
            onEditGoal={navigateToGoal}
            onNavigate={navigateToScreen}
            onPortfolioDrilldown={navigateToPortfolioDrilldown}
          />
        );
      case "goals":
        return (
          <Goals
            data={data}
            initialGoalId={requestedGoalId}
            onSave={async (input) => {
              await saveGoalVersion(input);
              setData(await loadAlphaData());
            }}
          />
        );
      case "obligations":
        return <Obligations />;
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
    holdingsDrilldown,
    holdingsLoadError,
    holdingsPageData,
    holdingsView,
    navigateToHoldingImport,
    navigateToHoldingsView,
    navigateToGoal,
    navigateToPortfolioDrilldown,
    navigateToScreen,
    refreshAlphaData,
    refreshHoldingsPage,
    requestedGoalId,
    reviewError,
    scenarioContext,
  ]);

  if (activeScreen !== "holdings" && data === null && loadError === null) {
    return <LoadingShell />;
  }

  if (activeScreen !== "holdings" && data === null) {
    return (
      <div className="fatal-error">
        <div className="brand">
          <BrandMark />
          <strong>Keel</strong>
        </div>
        <EmptyState title="The decision record is unavailable">
          {loadError}. Confirm the local D1 migration and seed have run, then
          reload.
        </EmptyState>
      </div>
    );
  }

  const pendingEvidenceCount =
    data?.evidenceInbox.filter((item) => item.status === "pending_review")
      .length ??
    holdingsPageData?.shell.pendingEvidenceCount ??
    0;
  const navigationItems = navigation.map((item) => ({
    ...item,
    badge:
      item.id === "evidence" && pendingEvidenceCount > 0
        ? pendingEvidenceCount
        : undefined,
  }));

  return (
    <AppShell
      activeItemId={activeScreen}
      brandMark={<BrandMark />}
      brandName="Keel"
      brandSubtitle="Private alpha"
      contextName={
        data?.dashboard.householdName ??
        holdingsPageData?.shell.householdName ??
        "Portfolio"
      }
      items={navigationItems}
      onNavigate={navigateToScreen}
      operatorInitials="DO"
      operatorName="Demo Operator"
      pageTitle={pageHeading(activeScreen)}
    >
      {content}
    </AppShell>
  );
}
