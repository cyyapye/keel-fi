import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  PropsWithChildren,
  ReactNode,
} from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "danger" | "quiet";
};

export function Button({
  className = "",
  tone = "secondary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${tone} ${className}`.trim()}
      type={type}
      {...props}
    />
  );
}

type BadgeProps = PropsWithChildren<{
  tone?: "positive" | "warning" | "neutral" | "negative" | "accent";
}>;

export function Badge({ children, tone = "neutral" }: BadgeProps) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

type PanelProps = HTMLAttributes<HTMLElement> & {
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
};

export function Panel({
  action,
  children,
  className = "",
  eyebrow,
  title,
  ...props
}: PanelProps) {
  return (
    <section className={`panel ${className}`.trim()} {...props}>
      {(eyebrow !== undefined ||
        title !== undefined ||
        action !== undefined) && (
        <header className="panel__header">
          <div>
            {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
            {title !== undefined && <h2>{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

type MetricCardProps = {
  actionLabel?: string;
  label: string;
  onClick?: () => void;
  value: string;
  detail?: string;
  tone?: "default" | "accent" | "dark";
};

export function MetricCard({
  actionLabel,
  detail,
  label,
  onClick,
  tone = "default",
  value,
}: MetricCardProps) {
  const content = (
    <>
      <p>{label}</p>
      <strong>{value}</strong>
      {detail !== undefined && (
        <span className="metric-card__detail">{detail}</span>
      )}
      {actionLabel !== undefined && (
        <span className="metric-card__action">{actionLabel} →</span>
      )}
    </>
  );

  if (onClick !== undefined) {
    return (
      <button
        aria-label={`${label}: ${value}. ${actionLabel ?? "View details"}`}
        className={`metric-card metric-card--${tone} metric-card--interactive`}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <article className={`metric-card metric-card--${tone}`}>{content}</article>
  );
}
