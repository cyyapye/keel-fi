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
export function HoldingInput({
  label,
  value,
  onChange,
  numeric = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
}) {
  return (
    <Field label={label} variant="filled">
      <Input
        aria-label={label}
        value={value}
        inputMode={numeric ? "decimal" : "text"}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    </Field>
  );
}
export function HoldingDate({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} variant="filled">
      <DatePicker aria-label={label} value={value} onValueChange={onChange} />
    </Field>
  );
}
export function HoldingSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <Field label={label} variant="filled">
      <Select
        items={options}
        value={value}
        onValueChange={(v) => onChange(String(v))}
      >
        <SelectTrigger aria-label={label}>
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
    </Field>
  );
}
