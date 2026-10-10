import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

import { Button } from "./button";

/** Supplementary information available to mouse, keyboard and touch users. */
export function InfoTip({
  label,
  children,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Button tone="plain" size="icon" />}
        aria-label={label}
        disabled={disabled}
        openOnHover
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="M12 11v6" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="12" cy="7.5" r="1" fill="currentColor" />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          data-slot="info-tip-positioner"
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
        >
          <Popover.Popup data-slot="info-tip" aria-label={label}>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
