import { useState } from "react";
import { Button, Field, Input } from "@keel/ui";

export function HoldingLinkButton({
  kind,
  id,
}: {
  kind: "holding" | "position";
  id: string;
}) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const label = `Copy ${kind} link`;
  return (
    <div className="holding-copy-link">
      <Button
        tone="quiet"
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
        {label}
      </Button>
      <span role="status">{copied ? "Link copied" : ""}</span>
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
