import { Switch as SwitchPrimitive } from "@base-ui/react/switch";

import { cn } from "../lib/utils";

export function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn("keel-switch", className)}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="keel-switch__thumb"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}
