import { describe, expect, it } from "vitest";

import {
  matchesSearchTokens,
  normalizeSearchText,
  searchHighlightRanges,
  searchTokens,
} from "./text-search";

describe("collection text search", () => {
  it("matches all query words across accents, punctuation and spacing", () => {
    const prepared = normalizeSearchText("Café—Horizon, L.L.C. / Demo Owner");
    expect(
      matchesSearchTokens(prepared, searchTokens("  CAFE  horizon OWNER ")),
    ).toBe(true);
    expect(matchesSearchTokens(prepared, searchTokens("cafe absent"))).toBe(
      false,
    );
    expect(searchTokens(" / — ... ")).toEqual([]);
    expect(searchTokens("CAFE café")).toEqual(["cafe"]);
    expect(
      matchesSearchTokens(
        normalizeSearchText("東京ファンド"),
        searchTokens("東京"),
      ),
    ).toBe(true);
  });

  it("highlights original graphemes and merges overlapping matches", () => {
    const text = "Cafe\u0301 Horizon / CAFÉ";
    const ranges = searchHighlightRanges(
      text,
      searchTokens("cafe caf horizon"),
    );
    expect(ranges.map(({ start, end }) => text.slice(start, end))).toEqual([
      "Cafe\u0301",
      "Horizon",
      "CAFÉ",
    ]);
    expect(
      searchHighlightRanges("ﬃ Family", searchTokens("ffi")).map(
        ({ start, end }) => "ﬃ Family".slice(start, end),
      ),
    ).toEqual(["ﬃ"]);
    expect(
      searchHighlightRanges("東京ファンド", searchTokens("東京")).map(
        ({ start, end }) => "東京ファンド".slice(start, end),
      ),
    ).toEqual(["東京"]);
  });

  it("treats punctuation-only input as browsing and special characters as text", () => {
    expect(
      matchesSearchTokens(
        normalizeSearchText("Demo Holdings"),
        searchTokens("  /  "),
      ),
    ).toBe(true);
    expect(
      searchHighlightRanges("Demo Holdings", searchTokens("  /  ")),
    ).toEqual([]);
    expect(
      searchHighlightRanges("<Demo> [LLC]", searchTokens("demo")).map(
        ({ start, end }) => "<Demo> [LLC]".slice(start, end),
      ),
    ).toEqual(["Demo"]);
  });
});
