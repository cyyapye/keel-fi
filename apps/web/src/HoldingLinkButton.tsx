import { useEffect, useState } from "react";
import { Button, Field, Input } from "@keel/ui";

export function HoldingLinkButton({
  kind,
  id,
  icon = false,
}: {
  kind: "holding" | "position";
  id: string;
  icon?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const label = `Copy ${kind} link`;
  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);
  return (
    <div
      className={`holding-copy-link${icon ? " holding-copy-link--icon" : ""}`}
    >
      <Button
        tone="quiet"
        aria-label={icon ? label : undefined}
        title={icon ? label : undefined}
        data-copied={copied}
        onClick={() => {
          void (async () => {
            const url = new URL("/holdings", window.location.origin);
            url.searchParams.set(
              kind === "holding" ? "exposure" : "position",
              id,
            );
            try {
              await navigator.clipboard.writeText(url.href);
              setCopied(true);
              setFallback(null);
            } catch {
              setCopied(false);
              setFallback(url.href);
            }
          })();
        }}
      >
        {icon ? (
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            data-icon={copied ? "check" : "link"}
          >
            {copied ? (
              <path d="m5 12 4 4L19 6" />
            ) : (
              <>
                <path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7-7l-2 2" />
                <path d="M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7 7l2-2" />
              </>
            )}
          </svg>
        ) : (
          label
        )}
      </Button>
      <span role="status" className={icon ? "visually-hidden" : undefined}>
        {copied ? "Link copied" : ""}
      </span>
      {fallback && (
        <Field label={`${kind === "holding" ? "Holding" : "Position"} link`}>
          <Input
            aria-label={`${kind === "holding" ? "Holding" : "Position"} link`}
            readOnly
            value={fallback}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Field>
      )}
    </div>
  );
}
