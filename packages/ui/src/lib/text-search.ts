export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function searchTokens(query: string): readonly string[] {
  const normalized = normalizeSearchText(query);
  return normalized.length === 0 ? [] : [...new Set(normalized.split(" "))];
}

export function matchesSearchTokens(
  preparedText: string,
  tokens: readonly string[],
): boolean {
  return tokens.every((token) => preparedText.includes(token));
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Original-string ranges keep accents and Unicode graphemes intact. */
export function searchHighlightRanges(
  text: string,
  tokens: readonly string[],
): readonly { start: number; end: number }[] {
  if (tokens.length === 0) return [];
  let normalized = "";
  const offsets: { start: number; end: number }[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    const prepared = normalizeSearchText(segment) || " ";
    normalized += prepared;
    for (let offset = 0; offset < prepared.length; offset += 1) {
      offsets.push({ start: index, end: index + segment.length });
    }
  }
  const ranges: { start: number; end: number }[] = [];
  for (const token of tokens) {
    let from = 0;
    let found: number;
    while ((found = normalized.indexOf(token, from)) !== -1) {
      ranges.push({
        start: offsets[found]!.start,
        end: offsets[found + token.length - 1]!.end,
      });
      from = found + token.length;
    }
  }
  ranges.sort((left, right) => left.start - right.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
