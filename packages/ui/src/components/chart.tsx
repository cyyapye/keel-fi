import {
  createContext,
  useContext,
  useId,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { ResponsiveContainer, type TooltipContentProps } from "recharts";

import { cn } from "../lib/utils";

export type ChartConfig = Record<
  string,
  {
    label: ReactNode;
    color?: string;
  }
>;

const ChartContext = createContext<ChartConfig | null>(null);

function useChartConfig(): ChartConfig {
  const context = useContext(ChartContext);
  if (context === null) {
    throw new Error("Chart content must be rendered inside ChartContainer.");
  }
  return context;
}

type ChartContainerProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children: ReactElement;
  config: ChartConfig;
  height?: number;
};

export function ChartContainer({
  children,
  className,
  config,
  height = 260,
  style,
  ...props
}: ChartContainerProps) {
  const chartId = useId().replaceAll(":", "");
  const colorVariables = Object.fromEntries(
    Object.entries(config).flatMap(([key, item]) =>
      item.color === undefined ? [] : [[`--color-${key}`, item.color]],
    ),
  ) as CSSProperties;

  return (
    <ChartContext.Provider value={config}>
      <div
        className={cn("keel-chart", className)}
        data-chart={chartId}
        data-slot="chart"
        style={{ ...colorVariables, height, ...style }}
        {...props}
      >
        <ResponsiveContainer height="100%" width="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

type ChartTooltipContentProps = Partial<TooltipContentProps<number, string>> & {
  hideLabel?: boolean;
  valueFormatter?: (value: number, name: string) => ReactNode;
};

export function ChartTooltipContent({
  active = false,
  hideLabel = false,
  label,
  payload = [],
  valueFormatter,
}: ChartTooltipContentProps) {
  const config = useChartConfig();
  if (!active || payload.length === 0) {
    return null;
  }

  return (
    <div className="keel-chart-tooltip">
      {!hideLabel && label !== undefined && (
        <strong className="keel-chart-tooltip__label">{label}</strong>
      )}
      <div className="keel-chart-tooltip__items">
        {payload.map((item, index) => {
          const key = String(item.dataKey ?? item.name ?? index);
          const name = typeof item.name === "string" ? item.name : key;
          const displayName = config[key]?.label ?? name;
          const value = typeof item.value === "number" ? item.value : 0;
          return (
            <div key={`${key}-${index}`}>
              <span
                aria-hidden="true"
                className="keel-chart-tooltip__marker"
                style={{ background: item.color ?? "var(--ink)" }}
              />
              <span>{displayName}</span>
              <strong>
                {valueFormatter === undefined
                  ? value.toLocaleString()
                  : valueFormatter(value, name)}
              </strong>
            </div>
          );
        })}
      </div>
    </div>
  );
}
