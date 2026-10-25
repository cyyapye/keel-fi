import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/** Decorative; supply meaningful pending text on the action or LoadingStatus. */
export function Spinner({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      {...props}
      className={cn("spinner", className)}
      data-slot="spinner"
      aria-hidden="true"
    />
  );
}
export function LoadingStatus({
  children,
  className,
  ...props
}: ComponentProps<"p">) {
  return (
    <p
      {...props}
      className={cn("loading-status", className)}
      data-slot="loading-status"
      role="status"
      aria-live="polite"
    >
      <Spinner />
      {children}
    </p>
  );
}
