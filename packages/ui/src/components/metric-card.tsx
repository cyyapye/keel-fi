import type { HTMLAttributes } from "react";

import { cn } from "../lib/utils";

type MetricCardProps = Omit<HTMLAttributes<HTMLElement>, "onClick"> & {
  actionLabel?: string;
  detail?: string;
  label: string;
  onClick?: () => void;
  tone?: "default" | "accent" | "dark";
  value: string;
};

export function MetricCard({
  actionLabel,
  className,
  detail,
  label,
  onClick,
  tone = "default",
  value,
  ...props
}: MetricCardProps) {
  const content = (
    <>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail !== undefined && (
        <span className="metric-card__detail">{detail}</span>
      )}
      {actionLabel !== undefined && (
        <span className="keel-link metric-card__action">{actionLabel}</span>
      )}
    </>
  );

  const classes = cn(
    "metric-card",
    `metric-card--${tone}`,
    onClick !== undefined && "metric-card--interactive",
    className,
  );

  if (onClick !== undefined) {
    return (
      <button
        aria-label={`${label}: ${value}. ${actionLabel ?? "View details"}`}
        className={classes}
        data-slot="metric-card"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <article className={classes} data-slot="metric-card" {...props}>
      {content}
    </article>
  );
}
