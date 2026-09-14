import { Fragment, useId, useRef } from "react";

import { searchHighlightRanges, searchTokens } from "../lib/text-search";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Input } from "./field";

export function SearchField({
  className,
  label,
  onValueChange,
  placeholder,
  resultLabel,
  value,
}: {
  className?: string;
  label: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  resultLabel?: string | undefined;
  value: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const statusId = useId();
  const clear = () => {
    onValueChange("");
    input.current?.focus();
  };
  return (
    <search aria-label={label} className={cn("search", className)}>
      <div className="search__field">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="m16 16 4.5 4.5" />
        </svg>
        <Input
          aria-describedby={resultLabel === undefined ? undefined : statusId}
          aria-label={label}
          autoComplete="off"
          maxLength={200}
          onChange={(event) => onValueChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              clear();
            }
          }}
          placeholder={placeholder}
          ref={input}
          spellCheck={false}
          type="search"
          value={value}
        />
        {value.length > 0 && (
          <Button
            aria-label="Clear search"
            onClick={clear}
            size="icon"
            tone="quiet"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
              <path d="m6 6 12 12M6 18 18 6" />
            </svg>
          </Button>
        )}
      </div>
      <p className="search__status" id={statusId} role="status">
        {resultLabel}
      </p>
    </search>
  );
}

export function SearchHighlight({
  children,
  query,
}: {
  children: string;
  query: string;
}) {
  const ranges = searchHighlightRanges(children, searchTokens(query));
  return (
    <>
      {ranges.map((range, index) => {
        const before = children.slice(ranges[index - 1]?.end ?? 0, range.start);
        return (
          <Fragment key={range.start}>
            {before}
            <mark className="search-highlight">
              {children.slice(range.start, range.end)}
            </mark>
          </Fragment>
        );
      })}
      {children.slice(ranges.at(-1)?.end ?? 0)}
    </>
  );
}
