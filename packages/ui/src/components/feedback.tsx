import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/utils";

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  compact?: boolean;
  headingAs?: "h2" | "h3" | "h4";
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({
  children,
  className,
  compact = false,
  headingAs = "h2",
  icon = "◎",
  title,
  ...props
}: EmptyStateProps) {
  const Heading = headingAs;

  return (
    <div
      className={cn(
        "empty-state",
        compact && "empty-state--compact",
        className,
      )}
      data-slot="empty-state"
      {...props}
    >
      {icon !== null && icon !== false && (
        <span aria-hidden="true">{icon}</span>
      )}
      <Heading>{title}</Heading>
      {children !== undefined && children !== null && <p>{children}</p>}
    </div>
  );
}

type FormMessageProps = HTMLAttributes<HTMLParagraphElement> & {
  tone?: "error" | "neutral" | "success";
};

export function FormMessage({
  className,
  role,
  tone = "neutral",
  ...props
}: FormMessageProps) {
  return (
    <p
      className={cn(
        "form-message",
        tone === "error" && "error",
        tone === "success" && "success",
        className,
      )}
      data-slot="form-message"
      role={role ?? (tone === "error" ? "alert" : "status")}
      {...props}
    />
  );
}

type NoticeProps = ComponentProps<"div"> & {
  tone?: "error" | "info";
};

export function Notice({
  className,
  role,
  tone = "info",
  ...props
}: NoticeProps) {
  return (
    <div
      className={cn("notice", tone === "error" && "inline-error", className)}
      data-slot="notice"
      role={role ?? (tone === "error" ? "alert" : "status")}
      {...props}
    />
  );
}
