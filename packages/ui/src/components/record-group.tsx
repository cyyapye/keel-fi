import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";

/** One quiet surface for related records. Disclosure and loading belong to the caller. */
export function RecordGroup({ className, ...props }: ComponentProps<"div">) {
  return (
    <div role="list" {...props} className={cn("record-group", className)} />
  );
}

type RecordRowProps = Omit<ComponentProps<"article">, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  metadata?: ReactNode;
  action?: ReactNode;
};

/** Neutral presentation slots; the application owns value meaning and actions. */
export function RecordRow({
  title,
  detail,
  value,
  metadata,
  action,
  className,
  ...props
}: RecordRowProps) {
  return (
    <article role="listitem" {...props} className={cn("record-row", className)}>
      <div className="record-row__identity">
        <strong className="record-row__title">{title}</strong>
        {detail && <div className="record-row__detail">{detail}</div>}
      </div>
      {value !== undefined && <div className="record-row__value">{value}</div>}
      {metadata && <div className="record-row__metadata">{metadata}</div>}
      {action && <div className="record-row__action">{action}</div>}
    </article>
  );
}
