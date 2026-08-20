import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "../lib/utils";

const badgeVariants = cva("badge", {
  variants: {
    tone: {
      accent: "badge--accent",
      negative: "badge--negative",
      neutral: "badge--neutral",
      positive: "badge--positive",
      warning: "badge--warning",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
});

type BadgeProps = HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ className, tone }))}
      data-slot="badge"
      {...props}
    />
  );
}
