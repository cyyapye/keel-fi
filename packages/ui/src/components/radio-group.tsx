import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { useId, type ReactNode } from "react";
import { cn } from "../lib/utils";

export type RadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};
type RadioGroupProps = {
  label: ReactNode;
  name?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly RadioOption[];
  disabled?: boolean;
  error?: ReactNode;
  className?: string;
};

export function RadioGroup({
  label,
  name,
  value,
  onValueChange,
  options,
  disabled = false,
  error,
  className,
}: RadioGroupProps) {
  const id = useId();
  return (
    <fieldset
      className={cn("field-group", className)}
      disabled={disabled}
      data-slot="radio-group-field"
    >
      <legend id={`${id}-label`}>{label}</legend>
      <RadioGroupPrimitive
        name={name ?? id}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        data-slot="radio-group"
      >
        {options.map((option, index) => (
          <label
            key={option.value}
            className="choice-control"
            data-disabled={disabled || option.disabled || undefined}
          >
            <RadioPrimitive.Root
              className="radio"
              data-slot="radio"
              value={option.value}
              disabled={option.disabled}
              aria-labelledby={`${id}-${index}-label`}
              aria-describedby={
                option.description ? `${id}-${index}-description` : undefined
              }
            >
              <RadioPrimitive.Indicator className="radio__dot" />
            </RadioPrimitive.Root>
            <span>
              <span
                className="choice-control__label"
                id={`${id}-${index}-label`}
              >
                {option.label}
              </span>
              {option.description && (
                <span
                  className="choice-control__description"
                  id={`${id}-${index}-description`}
                >
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
      </RadioGroupPrimitive>
      {error && (
        <p className="field-error" role="alert" id={`${id}-error`}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
