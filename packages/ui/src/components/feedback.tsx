import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/utils";

type EmptyStateProps = HTMLAttributes<HTMLDivElement> & {
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({
  children,
  className,
  icon = "◎",
  title,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={cn("empty-state", className)}
      data-slot="empty-state"
      {...props}
    >
      <span aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p>{children}</p>
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
