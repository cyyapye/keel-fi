import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { useId, type ReactNode } from "react";
import { cn } from "../lib/utils";

type CheckboxProps = Omit<
  CheckboxPrimitive.Root.Props,
  "children" | "className"
> & {
  label: ReactNode;
  description?: ReactNode;
  /** Context for assistive technology when the visible label is intentionally short. */
  accessibleLabel?: string;
  className?: string;
};

export function Checkbox({
  label,
  description,
  accessibleLabel,
  className,
  id: suppliedId,
  disabled,
  indeterminate,
  ...props
}: CheckboxProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <label
      className={cn("choice-control", className)}
      data-slot="checkbox-field"
      data-disabled={disabled || undefined}
      htmlFor={id}
    >
      <CheckboxPrimitive.Root
        {...props}
        id={id}
        disabled={disabled}
        indeterminate={indeterminate}
        className="checkbox"
        data-slot="checkbox"
        aria-labelledby={props["aria-labelledby"] ?? labelId}
        aria-describedby={
          [descriptionId, props["aria-describedby"]]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        <CheckboxPrimitive.Indicator
          className="checkbox__mark"
          aria-hidden="true"
        >
          {indeterminate ? "−" : "✓"}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>
        {accessibleLabel ? (
          <>
            <span id={labelId} className="visually-hidden">
              {accessibleLabel}
            </span>
            <span className="choice-control__label">{label}</span>
          </>
        ) : (
          <span className="choice-control__label" id={labelId}>
            {label}
          </span>
        )}
        {description && (
          <span className="choice-control__description" id={descriptionId}>
            {description}
          </span>
        )}
      </span>
    </label>
  );
}
