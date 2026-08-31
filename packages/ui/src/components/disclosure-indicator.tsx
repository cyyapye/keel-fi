import { cn } from "../lib/utils";

export function DisclosureIndicator({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn("disclosure-indicator", className)}
      data-slot="disclosure-indicator"
      fill="none"
      focusable="false"
      viewBox="0 0 12 12"
    >
      <path d="m2.5 4.25 3.5 3.5 3.5-3.5" />
    </svg>
  );
}
