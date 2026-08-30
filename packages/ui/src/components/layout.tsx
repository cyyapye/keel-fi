import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/utils";

export function Screen({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("screen-stack", className)}
      data-slot="screen"
      {...props}
    />
  );
}

type PageHeaderProps = HTMLAttributes<HTMLElement> & {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  title,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={cn("page-intro", className)}
      data-slot="page-header"
      {...props}
    >
      <div>
        {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description !== undefined && <p>{description}</p>}
      </div>
      {actions !== undefined && (
        <div className="page-intro__actions" data-slot="page-header-actions">
          {actions}
        </div>
      )}
    </header>
  );
}

type SectionHeaderProps = HTMLAttributes<HTMLElement> & {
  action?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
};

export function SectionHeader({
  action,
  className,
  description,
  eyebrow,
  title,
  ...props
}: SectionHeaderProps) {
  return (
    <header
      className={cn("section-heading", className)}
      data-slot="section-header"
      {...props}
    >
      <div>
        {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {description !== undefined && <p>{description}</p>}
      {action}
    </header>
  );
}

type ActionGroupProps = HTMLAttributes<HTMLElement> & {
  align?: "end" | "start";
  as?: "div" | "footer";
  layout?: "inline" | "split" | "stack";
  mobileLayout?: "grid" | "inline" | "stack";
  wrap?: boolean;
};

export function ActionGroup({
  align = "start",
  as = "div",
  className,
  layout = "inline",
  mobileLayout = "inline",
  wrap = false,
  ...props
}: ActionGroupProps) {
  const Root = as;
  return (
    <Root
      className={cn(
        "action-group",
        align === "end" && "action-group--end",
        layout === "split" && "action-group--split",
        layout === "stack" && "action-group--stack",
        mobileLayout === "grid" && "action-group--mobile-grid",
        mobileLayout === "stack" && "action-group--mobile-stack",
        wrap && "action-group--wrap",
        className,
      )}
      data-slot="action-group"
      {...props}
    />
  );
}
