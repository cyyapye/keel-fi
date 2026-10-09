import { useId, type ReactNode } from "react";
import { cn } from "../lib/utils";

export type ChoiceOption = {
  value: string;
  label: ReactNode;
  content: ReactNode;
  disabled?: boolean;
};
/** Native radio semantics, with alternatives visible together at every width. */
export function ChoiceGroup({
  label,
  value,
  onValueChange,
  options,
  disabled = false,
  className,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: readonly ChoiceOption[];
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cn("choice-group", className)} disabled={disabled}>
      <legend>{label}</legend>
      <div className="choice-group__options">
        {options.map((option) => (
          <label key={option.value} className="choice-group__option">
            <span className="choice-group__heading">
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={option.disabled}
                onChange={() => onValueChange(option.value)}
              />
              <span>{option.label}</span>
            </span>
            <span className="choice-group__content">{option.content}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
