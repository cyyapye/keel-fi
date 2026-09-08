import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export type SectionTab = {
  value: string;
  label: string;
  status: string;
  complete?: boolean;
};

function SectionTabLabel({ item }: { item: SectionTab }) {
  return (
    <span className="section-navigation__label">
      <span>{item.label}</span>
      <span className="section-navigation__status">
        {item.complete && <span aria-hidden="true">✓ </span>}
        {item.status}
      </span>
    </span>
  );
}

/** A single set of section choices, presented as tabs or a compact mobile select. */
export function SectionNavigation({
  items,
  value,
  onValueChange,
  label,
}: {
  items: readonly SectionTab[];
  value: string;
  onValueChange: (value: string) => void;
  label: string;
}) {
  return (
    <div className="section-navigation">
      <TabsList
        variant="line"
        aria-label={label}
        className="section-navigation__tabs"
      >
        {items.map((item) => (
          <TabsTrigger
            key={item.value}
            value={item.value}
            aria-label={item.label}
            aria-description={item.status}
          >
            <SectionTabLabel item={item} />
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="section-navigation__select">
        <Select
          items={items}
          value={value}
          onValueChange={(next) => {
            if (typeof next === "string") onValueChange(next);
          }}
        >
          <SelectTrigger aria-label={label}>
            <SelectValue>
              {() => {
                const selected = items.find((item) => item.value === value);
                return selected ? <SectionTabLabel item={selected} /> : null;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <SectionTabLabel item={item} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      className={cn("tabs", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

const tabsListVariants = cva("tabs-list", {
  variants: {
    variant: {
      default: "tabs-list--default",
      line: "tabs-list--line",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      className={cn(tabsListVariants({ className, variant }))}
      data-slot="tabs-list"
      data-variant={variant}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn("tabs-trigger", className)}
      data-slot="tabs-trigger"
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("tabs-content", className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}
