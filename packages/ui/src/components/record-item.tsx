import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";
import { ActionGroup } from "./layout";

type RecordItemProps = Omit<ComponentProps<"article">, "title"> & {
  title: ReactNode;
  detail?: ReactNode;
  metadata?: ReactNode;
  action?: ReactNode;
  headingAs?: "h2" | "h3" | "h4";
};
/** Presentation slots only; navigation and record meaning belong to the caller. */
export function RecordItem({
  title,
  detail,
  metadata,
  action,
  headingAs: Heading = "h3",
  children,
  className,
  ...props
}: RecordItemProps) {
  return (
    <article
      {...props}
      className={cn("record-item", className)}
      data-slot="record-item"
    >
      <div className="record-item__heading">
        <div>
          <Heading>{title}</Heading>
          {detail && <p>{detail}</p>}
          {metadata && (
            <p className="text-role text-role--supporting">{metadata}</p>
          )}
        </div>
        {action && <ActionGroup wrap>{action}</ActionGroup>}
      </div>
      {children && <div className="record-item__detail">{children}</div>}
    </article>
  );
}
