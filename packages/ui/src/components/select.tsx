import { Select as SelectPrimitive } from "@base-ui/react/select";

import { cn } from "../lib/utils";

export function Select({
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

export function SelectValue({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return (
    <SelectPrimitive.Value
      className={cn("select-value", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

export function SelectTrigger({
  children,
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn("select-trigger", className)}
      data-slot="select-trigger"
      {...props}
    >
      {children}
      <svg
        aria-hidden="true"
        className="select-trigger__icon"
        fill="none"
        viewBox="0 0 12 12"
      >
        <path d="m2.5 4.25 3.5 3.5 3.5-3.5" />
      </svg>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  children,
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Popup>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align="start"
        alignItemWithTrigger={false}
        className="select-positioner"
        sideOffset={6}
      >
        <SelectPrimitive.Popup
          className={cn("select-content", className)}
          data-slot="select-content"
          {...props}
        >
          <SelectPrimitive.List className="select-list">
            {children}
          </SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn("select-item", className)}
      data-slot="select-item"
      {...props}
    >
      <SelectPrimitive.ItemIndicator
        className="select-item__indicator"
        keepMounted
      >
        <svg aria-hidden="true" fill="none" viewBox="0 0 12 12">
          <path d="m2 6 2.5 2.5L10 3" />
        </svg>
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
