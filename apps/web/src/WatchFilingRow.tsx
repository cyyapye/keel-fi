import { ButtonLink, RecordItem } from "@keel/ui";
import type { ReactNode } from "react";

export function WatchFilingRow({
  title,
  href,
  metadata,
  action,
  children,
}: {
  title: string;
  href: string;
  metadata: ReactNode;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <RecordItem
      aria-label={title}
      headingAs="h4"
      title={
        <ButtonLink
          className="watch-source-headline"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          tone="plain"
        >
          {title}
        </ButtonLink>
      }
      metadata={metadata}
      action={action}
    >
      {children}
    </RecordItem>
  );
}
