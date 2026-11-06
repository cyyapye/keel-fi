import {
  DatePicker,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keel/ui";
import { ShareBasisSchema } from "@keel/domain/valuation-record";
import { scaled } from "./decimal-input";
import type { ReactNode } from "react";

export function HoldingShareBasis({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const invalid =
    value.trim() === ""
      ? required
      : !ShareBasisSchema.shape.unitsPerOriginal.safeParse(scaled(value, 0))
          .success;
  return (
    <Field
      label={label}
      variant="filled"
      description={`Shares per original share. Enter 1 before a split or 5 for 5-for-1. ${
        required
          ? "A basis is required for these shares."
          : "Leave blank if undocumented."
      }`}
      error={invalid ? "Enter a whole number from 1 to 1,000,000." : undefined}
    >
      {(control) => (
        <Input
          {...control}
          value={value}
          inputMode="numeric"
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      )}
    </Field>
  );
}

export function HoldingInput({
  label,
  value,
  onChange,
  numeric = false,
  description,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  description?: ReactNode;
  error?: ReactNode;
}) {
  return (
    <Field
      label={label}
      variant="filled"
      description={description}
      error={error}
    >
      {(control) => (
        <Input
          {...control}
          value={value}
          inputMode={numeric ? "decimal" : "text"}
          onChange={(e) => onChange(e.currentTarget.value)}
        />
      )}
    </Field>
  );
}
export function HoldingDate({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: ReactNode;
}) {
  return (
    <Field label={label} variant="filled" description={description}>
      {(control) => (
        <DatePicker
          {...control}
          aria-label={label}
          value={value}
          onValueChange={onChange}
        />
      )}
    </Field>
  );
}
export function HoldingSelect({
  label,
  value,
  onChange,
  options,
  description,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
  description?: ReactNode;
}) {
  return (
    <Field label={label} variant="filled" description={description}>
      {(control) => (
        <Select
          items={options}
          value={value}
          onValueChange={(v) => onChange(String(v))}
        >
          <SelectTrigger {...control}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}
