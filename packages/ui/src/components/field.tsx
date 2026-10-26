import {
  useId,
  type ComponentProps,
  type LabelHTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "../lib/utils";

type FieldControlProps = {
  id: string;
  "aria-labelledby": string;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true | undefined;
};
type FieldProps = Omit<LabelHTMLAttributes<HTMLLabelElement>, "children"> & {
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
  error?: ReactNode;
  description?: ReactNode;
  label: ReactNode;
  variant?: "line" | "filled";
  wide?: boolean;
};

export function Field({
  children,
  className,
  description,
  error,
  htmlFor,
  label,
  variant = "line",
  wide = false,
  ...props
}: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  const associated = typeof children === "function";
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const described =
    [description ? descriptionId : "", error ? errorId : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <label
      className={cn(
        "field",
        variant === "filled" && "field--filled",
        wide && "field--wide",
        className,
      )}
      data-slot="field"
      htmlFor={associated ? id : htmlFor}
      {...props}
    >
      <span data-slot="field-label" id={associated ? `${id}-label` : undefined}>
        {label}
      </span>
      {associated
        ? children({
            id,
            "aria-labelledby": `${id}-label`,
            "aria-describedby": described,
            "aria-invalid": error ? true : undefined,
          })
        : children}
      {description !== undefined && (
        <small data-slot="field-description" id={descriptionId}>
          {description}
        </small>
      )}
      {error && (
        <span
          data-slot="field-error"
          className="field-error"
          id={errorId}
          role="alert"
        >
          {error}
        </span>
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

export function FieldGroup({
  label,
  children,
  className,
  ...props
}: ComponentProps<"fieldset"> & { label: ReactNode }) {
  return (
    <fieldset
      {...props}
      className={cn("field-group", className)}
      data-slot="field-group"
    >
      <legend>{label}</legend>
      {children}
    </fieldset>
  );
}
