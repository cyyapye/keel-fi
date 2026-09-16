import { useMemo, useState } from "react";
import { Combobox } from "@base-ui/react/combobox";
import {
  matchesSearchTokens,
  normalizeSearchText,
  searchTokens,
} from "../lib/text-search";
import { DisclosureIndicator } from "./disclosure-indicator";

type Item = { value: string; label: string; searchText?: string };
const visibleLimit = 100;

/** A searchable single selection with a bounded list, backed by loaded items. */
export function SearchSelect({
  label,
  searchLabel,
  emptyMessage = "No matches found.",
  placeholder = "Choose a company",
  disabled = false,
  items,
  value,
  onChange,
}: {
  label: string;
  searchLabel: string;
  emptyMessage?: string;
  placeholder?: string;
  disabled?: boolean;
  items: readonly Item[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const prepared = useMemo(
    () =>
      items.map((item) => ({
        item,
        text: normalizeSearchText(`${item.label} ${item.searchText ?? ""}`),
      })),
    [items],
  );
  const matches = useMemo(() => {
    const tokens = searchTokens(query);
    return prepared
      .filter(({ text }) => matchesSearchTokens(text, tokens))
      .map(({ item }) => item);
  }, [prepared, query]);
  return (
    <Combobox.Root
      disabled={disabled}
      items={items}
      filteredItems={matches.slice(0, visibleLimit)}
      value={items.find((item) => item.value === value) ?? null}
      isItemEqualToValue={(left, right) => left.value === right.value}
      inputValue={query}
      onInputValueChange={setQuery}
      onOpenChange={() => setQuery("")}
      onValueChange={(item) => {
        if (item !== null) onChange(item.value);
      }}
    >
      <Combobox.Trigger className="select-trigger" aria-label={label}>
        <span className="select-value">
          {items.find((item) => item.value === value)?.label ?? placeholder}
        </span>
        <DisclosureIndicator className="select-trigger__icon" />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner
          className="select-positioner"
          sideOffset={6}
          align="start"
        >
          <Combobox.Popup className="select-content search-select" initialFocus>
            <Combobox.Input
              className="input search-select__input"
              aria-label={searchLabel}
              placeholder={`${searchLabel}…`}
            />
            <Combobox.Empty className="search-select__message">
              {emptyMessage}
            </Combobox.Empty>
            <Combobox.List className="select-list search-select__list">
              {(item: Item) => (
                <Combobox.Item
                  key={item.value}
                  value={item}
                  className="select-item search-select__item"
                >
                  <Combobox.ItemIndicator
                    className="select-item__indicator"
                    keepMounted
                  >
                    <svg aria-hidden="true" fill="none" viewBox="0 0 12 12">
                      <path d="m2 6 2.5 2.5L10 3" />
                    </svg>
                  </Combobox.ItemIndicator>
                  <span>{item.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
            {matches.length > visibleLimit && (
              <p className="search-select__message" role="status">
                Showing the first {visibleLimit} matches. Keep typing to narrow
                the list.
              </p>
            )}
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
