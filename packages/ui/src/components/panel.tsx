import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/utils";

type PanelProps = HTMLAttributes<HTMLElement> & {
  action?: ReactNode;
  eyebrow?: ReactNode;
  title?: ReactNode;
};

export function Panel({
  action,
  children,
  className,
  eyebrow,
  title,
  ...props
}: PanelProps) {
  return (
    <section className={cn("panel", className)} data-slot="panel" {...props}>
      {(eyebrow !== undefined ||
        title !== undefined ||
        action !== undefined) && (
        <header className="panel__header" data-slot="panel-header">
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
