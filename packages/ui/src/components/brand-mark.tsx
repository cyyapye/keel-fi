import type { SVGAttributes } from "react";

import { cn } from "../lib/utils";

export function BrandMark({ className, ...props }: SVGAttributes<SVGElement>) {
  return (
    <svg
      aria-hidden="true"
      className={cn("brand-mark", className)}
      data-slot="brand-mark"
      viewBox="0 0 32 32"
      {...props}
    >
      <path d="M10 2h12l8 8v12l-8 8H10l-8-8V10Z" />
      <path d="M16 6v19M7 12h18M8 18l8 7 8-7" />
    </svg>
  );
}
