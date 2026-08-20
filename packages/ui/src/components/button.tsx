import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva("button", {
  variants: {
    size: {
      compact: "button--compact",
      default: "",
      icon: "button--icon",
    },
    tone: {
      danger: "button--danger",
      primary: "button--primary",
      quiet: "button--quiet",
      secondary: "button--secondary",
    },
  },
  defaultVariants: {
    size: "default",
    tone: "secondary",
  },
});

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>;

export function Button({
  className,
  size = "default",
  tone = "secondary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ className, size, tone }))}
      data-slot="button"
      type={type}
      {...props}
    />
  );
}
