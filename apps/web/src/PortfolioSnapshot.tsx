import {
  createPortfolioDashboardSnapshot,
  type PortfolioDashboardMover,
  type PortfolioDashboardSnapshot,
  type PortfolioDashboardLiquiditySegment,
} from "@keel/domain/portfolio-dashboard";
import {
  Button,
  ChartContainer,
  ChartTooltipContent,
  DataItem,
  DataList,
  EmptyState,
  FormMessage,
  Notice,
  Panel,
  SectionHeader,
  TextLink,
  type ChartConfig,
} from "@keel/ui";
import { type KeyboardEvent, useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  type BarShapeProps,
  LabelList,
  Rectangle,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { loadInvestmentHoldings, loadPortfolioBaseline } from "./api";
import {
  formatCompactCurrency,
  formatCompactMoney,
  formatDate,
  formatProbability,
} from "./format";

const exposureChartConfig = {
  valueMinor: { label: "Value", color: "var(--ink)" },
} satisfies ChartConfig;

const moverChartConfig = {
  magnitudeMinor: { label: "Change", color: "var(--ink)" },
} satisfies ChartConfig;

const LIQUIDITY_OPACITY = [1, 0.68, 0.32, 0.16] as const;

export type PortfolioSnapshotDrilldown =
  | { type: "exposure"; exposureId: string }
  | {
      type: "access";
      accessKey: PortfolioDashboardLiquiditySegment["key"];
    };

function formatChartMoney(valueMinor: number, currency: string): string {
  return currency === "USD"
    ? formatCompactMoney(valueMinor)
    : formatCompactCurrency(valueMinor, currency);
}

function formatSignedMoney(valueMinor: number, currency: string): string {
  if (valueMinor === 0) {
    return formatChartMoney(0, currency);
  }
  const formatted = formatChartMoney(Math.abs(valueMinor), currency);
  return valueMinor > 0 ? `+${formatted}` : `−${formatted}`;
}

function ratioPpm(value: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return Number((BigInt(value) * 1_000_000n) / BigInt(total));
}

function shortenLabel(value: unknown): string {
  const label = String(value);
  return label.length <= 18 ? label : `${label.slice(0, 17)}…`;
}

function DrilldownBarShape({
  accessibleName,
  onActivate,
  ...props
}: BarShapeProps & {
  accessibleName: string;
  onActivate: () => void;
}) {
  const hitHeight = Math.max(props.height, 44);
  const hitWidth = Math.max(props.width, 44);
  const hitY = props.y - (hitHeight - props.height) / 2;
  const activateFromKeyboard = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    onActivate();
  };

  return (
    <g
      aria-label={accessibleName}
      className="portfolio-chart__drilldown"
      onClick={onActivate}
      onKeyDown={activateFromKeyboard}
      role="link"
      tabIndex={0}
    >
      <Rectangle
        className="portfolio-chart__hit-area"
        fill="transparent"
        height={hitHeight}
        width={hitWidth}
        x={props.x}
        y={hitY}
      />
      <Rectangle
        className="portfolio-chart__bar"
        fill={props.fill}
        height={props.height}
        width={props.width}
        x={props.x}
        y={props.y}
      />
    </g>
  );
}

function TopExposureChart({
  onViewExposure,
  snapshot,
}: {
  onViewExposure: (exposureId: string) => void;
  snapshot: PortfolioDashboardSnapshot;
}) {
  const rows = snapshot.topExposures.map((exposure) => ({
    ...exposure,
    label: exposure.name,
  }));

  if (rows.length === 0) {
    return (
      <EmptyState title="No valued exposures">
        Reviewed values will appear here after holdings are available.
      </EmptyState>
    );
  }

  return (
    <>
      <ChartContainer
        aria-label={`Top ${rows.length} holdings grouped by economic exposure in ${snapshot.currency}`}
        config={exposureChartConfig}
        height={Math.max(250, rows.length * 44)}
      >
        <BarChart
          accessibilityLayer
          data={rows}
          layout="vertical"
          margin={{ bottom: 4, left: 0, right: 72, top: 4 }}
        >
          <XAxis dataKey="valueMinor" hide type="number" />
          <YAxis
            axisLine={false}
            dataKey="label"
            tickFormatter={shortenLabel}
            tickLine={false}
            type="category"
            width={122}
          />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={(value) =>
                  formatChartMoney(value, snapshot.currency)
                }
              />
            }
            cursor={{ fill: "var(--wash)" }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="valueMinor"
            fill="var(--color-valueMinor)"
            isAnimationActive={false}
            maxBarSize={18}
            shape={(props: BarShapeProps) => {
              const row = props.payload as (typeof rows)[number] | undefined;
              return row === undefined ? (
                <Rectangle {...props} />
              ) : (
                <DrilldownBarShape
                  {...props}
                  accessibleName={`View ${row.name} holdings detail, ${formatChartMoney(row.valueMinor, snapshot.currency)}`}
                  onActivate={() => onViewExposure(row.id)}
                />
              );
            }}
          >
            <LabelList
              className="portfolio-chart__value-label"
              dataKey="valueMinor"
              formatter={(value: unknown) =>
                formatChartMoney(Number(value), snapshot.currency)
              }
              position="right"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ol className="visually-hidden">
        {rows.map((row) => (
          <li key={row.id}>
            {row.name}: {formatChartMoney(row.valueMinor, snapshot.currency)}
          </li>
        ))}
      </ol>
    </>
  );
}

function LiquidityChart({
  onViewAccess,
  snapshot,
}: {
  onViewAccess: (accessKey: PortfolioDashboardLiquiditySegment["key"]) => void;
  snapshot: PortfolioDashboardSnapshot;
}) {
  const total = snapshot.liquidity.reduce(
    (sum, segment) => sum + segment.valueMinor,
    0,
  );
  if (total === 0) {
    return (
      <EmptyState title="No reviewed values">
        Cash and holding values will appear here after review.
      </EmptyState>
    );
  }
  const chartData = [
    Object.fromEntries([
      ["name", "Portfolio"],
      ...snapshot.liquidity.map((segment) => [segment.key, segment.valueMinor]),
    ]),
  ];
  const config = Object.fromEntries(
    snapshot.liquidity.map((segment, index) => [
      segment.key,
      {
        label: segment.label,
        color: `rgb(38 34 56 / ${LIQUIDITY_OPACITY[index] ?? 0.16})`,
      },
    ]),
  ) satisfies ChartConfig;

  return (
    <>
      <ChartContainer
        aria-label={`Portfolio value by access in ${snapshot.currency}`}
        className="portfolio-liquidity-chart"
        config={config}
        height={72}
      >
        <BarChart
          accessibilityLayer
          data={chartData}
          layout="vertical"
          margin={{ bottom: 6, left: 0, right: 0, top: 6 }}
        >
          <XAxis hide type="number" />
          <YAxis dataKey="name" hide type="category" />
          <Tooltip
            content={
              <ChartTooltipContent
                hideLabel
                valueFormatter={(value) =>
                  formatChartMoney(value, snapshot.currency)
                }
              />
            }
            cursor={false}
            isAnimationActive={false}
          />
          {snapshot.liquidity.map((segment) => (
            <Bar
              className="portfolio-chart__access-segment"
              dataKey={segment.key}
              fill={`var(--color-${segment.key})`}
              isAnimationActive={false}
              key={segment.key}
              onClick={() => onViewAccess(segment.key)}
              stackId="access"
            />
          ))}
        </BarChart>
      </ChartContainer>
      <ul
        aria-label="Portfolio access details"
        className="portfolio-liquidity-legend"
      >
        {snapshot.liquidity.map((segment, index) => (
          <li key={segment.key}>
            <Button
              aria-label={`View ${segment.label} holdings detail, ${formatChartMoney(segment.valueMinor, snapshot.currency)}, ${formatProbability(ratioPpm(segment.valueMinor, total))}`}
              className="portfolio-liquidity-legend__action"
              onClick={() => onViewAccess(segment.key)}
              tone="plain"
            >
              <span className="portfolio-liquidity-legend__label">
                <i
                  aria-hidden="true"
                  style={{
                    background: `rgb(38 34 56 / ${LIQUIDITY_OPACITY[index] ?? 0.16})`,
                  }}
                />
                {segment.label}
              </span>
              <span className="portfolio-liquidity-legend__value">
                <strong>
                  {formatChartMoney(segment.valueMinor, snapshot.currency)}
                </strong>
                <small>
                  {formatProbability(ratioPpm(segment.valueMinor, total))}
                </small>
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}

function MoverBarChart({
  currency,
  direction,
  movers,
  onViewExposure,
}: {
  currency: string;
  direction: "up" | "down";
  movers: readonly PortfolioDashboardMover[];
  onViewExposure: (exposureId: string) => void;
}) {
  if (movers.length === 0) {
    return (
      <EmptyState
        className="portfolio-movers__empty"
        compact
        headingAs="h4"
        icon={null}
        title="No comparable changes."
      />
    );
  }
  const rows = movers.map((mover) => ({
    ...mover,
    label: mover.name,
    magnitudeMinor: Math.abs(mover.changeMinor),
  }));
  const sign = direction === "up" ? 1 : -1;

  return (
    <>
      <ChartContainer
        aria-label={`${direction === "up" ? "Largest increases" : "Largest decreases"} in ${currency}`}
        className={direction === "down" ? "portfolio-mover-chart--down" : ""}
        config={moverChartConfig}
        height={Math.max(190, rows.length * 44)}
      >
        <BarChart
          accessibilityLayer
          data={rows}
          layout="vertical"
          margin={{ bottom: 4, left: 0, right: 72, top: 4 }}
        >
          <XAxis dataKey="magnitudeMinor" hide type="number" />
          <YAxis
            axisLine={false}
            dataKey="label"
            tickFormatter={shortenLabel}
            tickLine={false}
            type="category"
            width={112}
          />
          <Tooltip
            content={
              <ChartTooltipContent
                valueFormatter={(value) =>
                  formatSignedMoney(value * sign, currency)
                }
              />
            }
            cursor={{ fill: "var(--wash)" }}
            isAnimationActive={false}
          />
          <Bar
            dataKey="magnitudeMinor"
            fill="var(--color-magnitudeMinor)"
            isAnimationActive={false}
            maxBarSize={16}
            shape={(props: BarShapeProps) => {
              const row = props.payload as (typeof rows)[number] | undefined;
              return row === undefined ? (
                <Rectangle {...props} />
              ) : (
                <DrilldownBarShape
                  {...props}
                  accessibleName={`View ${row.name} holdings detail, ${formatSignedMoney(row.magnitudeMinor * sign, currency)}`}
                  onActivate={() => onViewExposure(row.id)}
                />
              );
            }}
          >
            <LabelList
              className="portfolio-chart__value-label"
              dataKey="magnitudeMinor"
              formatter={(value: unknown) =>
                formatSignedMoney(Number(value) * sign, currency)
              }
              position="right"
            />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ol className="visually-hidden">
        {rows.map((row) => (
          <li key={row.id}>
            {row.name}: {formatSignedMoney(row.magnitudeMinor * sign, currency)}
          </li>
        ))}
      </ol>
    </>
  );
}

export function PortfolioSnapshot({
  onDrilldown,
  onViewHoldings,
}: {
  onDrilldown: (drilldown: PortfolioSnapshotDrilldown) => void;
  onViewHoldings: () => void;
}) {
  const [snapshot, setSnapshot] = useState<PortfolioDashboardSnapshot | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setReloadVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const initial = window.setTimeout(() => {
      void Promise.all([
        loadInvestmentHoldings(controller.signal),
        loadPortfolioBaseline(controller.signal),
      ])
        .then(([holdings, baseline]) => {
          if (!controller.signal.aborted) {
            setSnapshot(createPortfolioDashboardSnapshot(holdings, baseline));
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSnapshot(null);
            setError("Portfolio snapshot unavailable.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 0);
    return () => {
      window.clearTimeout(initial);
      controller.abort();
    };
  }, [reloadVersion]);

  return (
    <section aria-label="Portfolio snapshot" className="portfolio-snapshot">
      <SectionHeader
        action={<TextLink onClick={onViewHoldings}>View holdings</TextLink>}
        eyebrow="Current portfolio"
        title="Portfolio snapshot"
      />

      {loading && (
        <FormMessage className="portfolio-snapshot__status">
          Loading portfolio snapshot…
        </FormMessage>
      )}
      {!loading && error !== null && (
        <Notice className="portfolio-snapshot__error" tone="error">
          <p>{error}</p>
          <Button onClick={reload} tone="secondary">
            Try again
          </Button>
        </Notice>
      )}
      {!loading && error === null && snapshot !== null && (
        <>
          <DataList className="portfolio-snapshot__metrics">
            <DataItem
              label="Known portfolio"
              value={formatChartMoney(
                snapshot.knownPortfolioValueMinor,
                snapshot.currency,
              )}
            />
            <DataItem
              label="Mapped exposure"
              value={formatChartMoney(
                snapshot.knownExposureValueMinor,
                snapshot.currency,
              )}
            />
            <DataItem
              label="Top five concentration"
              value={formatProbability(snapshot.topFiveConcentrationPpm)}
            />
          </DataList>

          <p className="portfolio-snapshot__trust">
            Known reviewed values as of {formatDate(snapshot.asOf)}.
            {snapshot.unknownValueCount > 0 &&
              ` ${snapshot.unknownValueCount} ${snapshot.unknownValueCount === 1 ? "value is" : "values are"} unavailable and excluded.`}
            {snapshot.otherCurrencyCount > 0 &&
              ` ${snapshot.otherCurrencyCount} other ${snapshot.otherCurrencyCount === 1 ? "currency is" : "currencies are"} shown separately in Holdings.`}
          </p>

          <div className="portfolio-snapshot__grid">
            <Panel
              className="portfolio-snapshot__top"
              eyebrow={`Economic exposure · ${snapshot.currency}`}
              title="Top 10 holdings"
            >
              <TopExposureChart
                onViewExposure={(exposureId) =>
                  onDrilldown({ type: "exposure", exposureId })
                }
                snapshot={snapshot}
              />
            </Panel>

            <Panel
              className="portfolio-snapshot__liquidity"
              eyebrow="Current liquidity"
              title="Portfolio by access"
            >
              <LiquidityChart
                onViewAccess={(accessKey) =>
                  onDrilldown({ type: "access", accessKey })
                }
                snapshot={snapshot}
              />
            </Panel>

            <Panel
              className="portfolio-snapshot__movers"
              eyebrow="Since prior accepted values"
              title="Largest value changes"
            >
              <div className="portfolio-movers">
                <section aria-labelledby="portfolio-movers-up-title">
                  <h3 id="portfolio-movers-up-title">Up</h3>
                  <MoverBarChart
                    currency={snapshot.currency}
                    direction="up"
                    movers={snapshot.moversUp}
                    onViewExposure={(exposureId) =>
                      onDrilldown({ type: "exposure", exposureId })
                    }
                  />
                </section>
                <section aria-labelledby="portfolio-movers-down-title">
                  <h3 id="portfolio-movers-down-title">Down</h3>
                  <MoverBarChart
                    currency={snapshot.currency}
                    direction="down"
                    movers={snapshot.moversDown}
                    onViewExposure={(exposureId) =>
                      onDrilldown({ type: "exposure", exposureId })
                    }
                  />
                </section>
              </div>
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}
