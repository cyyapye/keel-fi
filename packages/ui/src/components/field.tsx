import type { ComponentProps, LabelHTMLAttributes, ReactNode } from "react";

import { cn } from "../lib/utils";

type FieldProps = LabelHTMLAttributes<HTMLLabelElement> & {
  description?: ReactNode;
  label: ReactNode;
  variant?: "line" | "filled";
  wide?: boolean;
};

export function Field({
  children,
  className,
  description,
  label,
  variant = "line",
  wide = false,
  ...props
}: FieldProps) {
  return (
    <label
      className={cn(
        "field",
        variant === "filled" && "field--filled",
        wide && "field--wide",
        className,
      )}
      data-slot="field"
      {...props}
    >
      <span data-slot="field-label">{label}</span>
      {children}
      {description !== undefined && (
        <small data-slot="field-description">{description}</small>
      )}
    </label>
  );
}

type InputGroupProps = ComponentProps<"span"> & {
  prefix?: ReactNode;
  suffix?: ReactNode;
};

export function InputGroup({
  children,
  className,
  prefix,
  suffix,
  ...props
}: InputGroupProps) {
  const hasPrefix = prefix !== undefined;
  const hasSuffix = suffix !== undefined;

  return (
    <span
      className={cn(
        "field__value",
        !hasPrefix && "field__value--no-prefix",
        !hasSuffix && "field__value--no-suffix",
        className,
      )}
      data-slot="input-group"
      {...props}
    >
      {hasPrefix && <i data-slot="input-prefix">{prefix}</i>}
      {children}
      {hasSuffix && <i data-slot="input-suffix">{suffix}</i>}
    </span>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input className={cn("input", className)} data-slot="input" {...props} />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn("input", "textarea", className)}
      data-slot="textarea"
      {...props}
    />
  );
}
