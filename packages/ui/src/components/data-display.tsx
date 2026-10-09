import { type HTMLAttributes, type ReactNode } from "react";

import { cn } from "../lib/utils";

export function DataList({
  layout,
  className,
  ...props
}: HTMLAttributes<HTMLDListElement> & { layout?: "rows" }) {
  return (
    <dl
      className={cn("data-list", className)}
      data-slot="data-list"
      data-layout={layout}
      {...props}
    />
  );
}

type DataItemProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: ReactNode;
  labelClassName?: string;
  value: ReactNode;
  valueClassName?: string;
};

export function DataItem({
  className,
  label,
  labelClassName,
  value,
  valueClassName,
  ...props
}: DataItemProps) {
  return (
    <div
      className={cn("data-list__item", className)}
      data-slot="data-item"
      {...props}
    >
      <dt className={cn("data-list__label", labelClassName)}>{label}</dt>
      <dd className={cn("data-list__value", valueClassName)}>{value}</dd>
    </div>
  );
}

type StatGroupProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section";
};

export function StatGroup({ as = "div", className, ...props }: StatGroupProps) {
  const Root = as;
  return (
    <Root
      className={cn("stat-group", className)}
      data-slot="stat-group"
      {...props}
    />
  );
}

type StatProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  as?: "article" | "div" | "span";
  detail?: ReactNode;
  detailAs?: "i" | "small" | "span";
  detailClassName?: string;
  details?: readonly ReactNode[];
  inline?: boolean;
  label: ReactNode;
  labelAs?: "small" | "span";
  labelClassName?: string;
  value: ReactNode;
  valueClassName?: string;
  valueFirst?: boolean;
};

export function Stat({
  as = "article",
  className,
  detail,
  detailAs = "small",
  detailClassName,
  details,
  inline = false,
  label,
  labelAs = "span",
  labelClassName,
  value,
  valueClassName,
  valueFirst = false,
  ...props
}: StatProps) {
  const Root = as;
  const Label = labelAs;
  const Detail = detailAs;
  const labelNode = (
    <Label className={cn("stat__label", labelClassName)}>{label}</Label>
  );
  const valueNode = (
    <strong className={cn("stat__value", valueClassName)}>{value}</strong>
  );
  const detailNodes = details ?? (detail === undefined ? [] : [detail]);

  return (
    <Root
      className={cn("stat", inline && "stat--inline", className)}
      data-slot="stat"
      {...props}
    >
      {valueFirst ? valueNode : labelNode}
      {valueFirst ? labelNode : valueNode}
      {detailNodes.map((item, index) => (
        <Detail className={cn("stat__detail", detailClassName)} key={index}>
          {item}
        </Detail>
      ))}
    </Root>
  );
}
