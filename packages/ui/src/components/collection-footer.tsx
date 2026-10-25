import { useEffect, useRef, type ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Spinner } from "./loading";
import { FormMessage } from "./feedback";

type CollectionFooterProps = Omit<ComponentProps<"div">, "children"> & {
  shown: number;
  total?: number | undefined;
  hasMore: boolean;
  busy?: boolean;
  error?: string | null | undefined;
  label?: string;
  moreLabel?: string;
  mode?: "manual" | "automatic";
  onLoadMore: (source: "manual" | "automatic") => void;
};

/** Count and loading trigger only. The owner controls cursors, concurrency and DOM bounds. */
export function CollectionFooter({
  shown,
  total,
  hasMore,
  busy = false,
  error,
  label = "records",
  moreLabel = `Load more ${label}`,
  mode = "manual",
  onLoadMore,
  className,
  ...props
}: CollectionFooterProps) {
  const sentinel = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (
      mode !== "automatic" ||
      busy ||
      error ||
      !hasMore ||
      !sentinel.current ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          // At most one automatic activation per observed state, including synchronous callbacks.
          observer.disconnect();
          onLoadMore("automatic");
        }
      },
      { rootMargin: "120px 0px" },
    );
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [mode, shown, hasMore, busy, error, onLoadMore]);
  return (
    <div
      {...props}
      className={cn("collection-footer", className)}
      data-slot="collection-footer"
    >
      <span
        ref={sentinel}
        className="collection-footer__sentinel"
        aria-hidden="true"
      />
      <div>
        <p role="status" aria-live="polite">
          {hasMore ? "Showing " : "All "}
          {shown}
          {total !== undefined && hasMore ? ` of ${total}` : ""} {label}
          {!hasMore ? " shown" : ""}
          {busy && (
            <span className="visually-hidden">. Loading more {label}.</span>
          )}
        </p>
        {error ? (
          <FormMessage tone="error">{error}</FormMessage>
        ) : mode === "automatic" && hasMore && !busy ? (
          <p className="text-role text-role--supporting">
            More {label} load as you scroll.
          </p>
        ) : null}
      </div>
      {hasMore && (
        <Button
          tone={mode === "automatic" && !error ? "quiet" : "secondary"}
          disabled={busy}
          onClick={() => onLoadMore("manual")}
        >
          {busy ? (
            <>
              <Spinner />
              Loading…
            </>
          ) : error ? (
            "Try loading again"
          ) : (
            moreLabel
          )}
        </Button>
      )}
    </div>
  );
}
