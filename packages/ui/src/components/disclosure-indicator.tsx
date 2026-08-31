import { cn } from "../lib/utils";

export function DisclosureIndicator({
  className,
  expanded,
}: {
  className?: string;
  expanded?: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("disclosure-indicator", className)}
      data-expanded={
        expanded === undefined ? undefined : expanded ? "true" : "false"
      }
      data-slot="disclosure-indicator"
      fill="none"
      focusable="false"
      viewBox="0 0 12 12"
    >
      <path d="m2.5 4.25 3.5 3.5 3.5-3.5" />
    </svg>
  );
}
