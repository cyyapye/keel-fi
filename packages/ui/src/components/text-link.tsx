import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from "react";

import { cn } from "../lib/utils";

type TextLinkBaseProps = {
  children: ReactNode;
  className?: string;
  tone?: "default" | "inverse";
};

type TextLinkAnchorProps = TextLinkBaseProps &
  AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
  };

type TextLinkButtonProps = TextLinkBaseProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: never;
  };

export type TextLinkProps = TextLinkAnchorProps | TextLinkButtonProps;

export function TextLink(props: TextLinkProps) {
  if ("href" in props && props.href !== undefined) {
    const { children, className, tone = "default", ...anchorProps } = props;
    return (
      <a
        {...anchorProps}
        className={cn(
          "keel-link",
          tone === "inverse" && "keel-link--inverse",
          className,
        )}
        data-slot="text-link"
      >
        {children}
      </a>
    );
  }

  const {
    children,
    className,
    tone = "default",
    type = "button",
    ...buttonProps
  } = props;
  return (
    <button
      {...buttonProps}
      className={cn(
        "keel-link",
        tone === "inverse" && "keel-link--inverse",
        className,
      )}
      data-slot="text-link"
      type={type}
    >
      {children}
    </button>
  );
}
