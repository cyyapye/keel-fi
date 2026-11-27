import type { ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keel/ui";

export function MaintenanceControls({ children }: { children: ReactNode }) {
  return (
    <Collapsible>
      <CollapsibleTrigger layout="inline">
        Capture controls and source <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ExampleSelect<T extends string>({
  label,
  choices,
  value,
  onChange,
}: {
  label: string;
  choices: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <Field label={label}>
      <Select
        value={value}
        onValueChange={(next) => {
          const choice = choices.find((item) => item === next);
          if (choice) onChange(choice);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue>{value}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {choices.map((item) => (
            <SelectItem key={item} value={item}>
              {item}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
