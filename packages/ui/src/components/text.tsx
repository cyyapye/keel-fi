import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

type TextProps = ComponentProps<"p"> & {
  as?: "p" | "span" | "strong";
  variant?: "body" | "primary" | "supporting" | "small";
};
/** Visual hierarchy is separate from heading level; use SectionHeader for sections. */
export function Text({
  as: Element = "p",
  variant = "body",
  className,
  ...props
}: TextProps) {
  return (
    <Element
      {...props}
      className={cn("text-role", `text-role--${variant}`, className)}
      data-slot="text"
    />
  );
}
