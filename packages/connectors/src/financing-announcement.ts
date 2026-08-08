import {
  FinancingAnnouncementFactsSchema,
  type FinancingAnnouncementFacts,
  type FinancingMoneyFact,
  type FinancingValuationFact,
} from "@keel/domain";
import { z } from "zod";

const MAX_EVENT_TEXT_CHARS = 2_000;
const MAX_EVIDENCE_TEXT_CHARS = 240;
const MAX_EVIDENCE_TEXT_WORDS = 25;

export const FinancingAnnouncementExtractionInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    evidenceText: z.string().trim().min(1).max(MAX_EVENT_TEXT_CHARS),
  })
  .strict();

type Ambiguity = FinancingAnnouncementFacts["ambiguities"][number];
type MoneyQualifier = FinancingMoneyFact["qualifier"];

type MoneyCandidate = {
  start: number;
  end: number;
  amountMinor: number;
  currency: string;
  qualifier: MoneyQualifier;
  evidenceText: string;
  priorReference: boolean;
  role: "funding" | "valuation";
  valuationBasis: FinancingValuationFact["basis"];
};

const MONEY_NUMBER_SOURCE = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
const MONEY_MAGNITUDE_SOURCE = String.raw`(?:thousand|million|billion|k|m|b)`;
const PREFIX_CURRENCY_SOURCE = String.raw`(?:US\$|C\$|A\$|NZ\$|S\$|USD|EUR|GBP|CAD|AUD|NZD|SGD|CHF|€|£)`;
const SUFFIX_CURRENCY_SOURCE = String.raw`(?:USD|EUR|GBP|CAD|AUD|NZD|SGD|CHF)`;

const PREFIX_MONEY_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?<currency>${PREFIX_CURRENCY_SOURCE})\s*(?<amount>${MONEY_NUMBER_SOURCE})(?<inlinePlus>\+)?(?:\s*(?<magnitude>${MONEY_MAGNITUDE_SOURCE}))?(?![\p{L}\p{N}])`,
  "giu",
);
const SUFFIX_MONEY_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?<amount>${MONEY_NUMBER_SOURCE})(?<inlinePlus>\+)?(?:\s*(?<magnitude>${MONEY_MAGNITUDE_SOURCE}))?\s+(?<currency>${SUFFIX_CURRENCY_SOURCE})(?![\p{L}\p{N}])`,
  "giu",
);
const PREFIX_MONEY_RANGE_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?<currency>${PREFIX_CURRENCY_SOURCE})\s*${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?\s*(?:[-–—]|\bto\b)\s*(?:(?:${PREFIX_CURRENCY_SOURCE}|\$)\s*)?${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?(?![\p{L}\p{N}])`,
  "giu",
);
const SUFFIX_MONEY_RANGE_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?\s*(?:[-–—]|\bto\b)\s*${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?\s+(?<currency>${SUFFIX_CURRENCY_SOURCE})(?![\p{L}\p{N}])`,
  "giu",
);
const PREFIX_BETWEEN_MONEY_RANGE_PATTERN = new RegExp(
  String.raw`\bbetween\s+(?<currency>${PREFIX_CURRENCY_SOURCE})\s*${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?\s+and\s+(?:(?:${PREFIX_CURRENCY_SOURCE}|\$)\s*)?${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?(?![\p{L}\p{N}])`,
  "giu",
);
const SUFFIX_BETWEEN_MONEY_RANGE_PATTERN = new RegExp(
  String.raw`\bbetween\s+${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?\s+and\s+${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?\s+(?<currency>${SUFFIX_CURRENCY_SOURCE})(?![\p{L}\p{N}])`,
  "giu",
);
const UNQUALIFIED_DOLLAR_MONEY_PATTERN = new RegExp(
  String.raw`(?<![\p{L}\p{N}])\$\s*${MONEY_NUMBER_SOURCE}(?:\s*${MONEY_MAGNITUDE_SOURCE})?(?![\p{L}\p{N}])`,
  "iu",
);

const PRIOR_MARKER_PATTERN =
  /\b(?:previous(?:ly)?|prior|earlier|last\s+round|preceding\s+round)\b/i;

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function currencyFromMarker(marker: string): string | null {
  switch (marker.toUpperCase()) {
    case "USD":
    case "US$":
      return "USD";
    case "EUR":
    case "€":
      return "EUR";
    case "GBP":
    case "£":
      return "GBP";
    case "CAD":
    case "C$":
      return "CAD";
    case "AUD":
    case "A$":
      return "AUD";
    case "NZD":
    case "NZ$":
      return "NZD";
    case "SGD":
    case "S$":
      return "SGD";
    case "CHF":
      return "CHF";
    default:
      return null;
  }
}

function magnitudeMultiplier(magnitude: string | undefined): bigint {
  switch (magnitude?.toLowerCase()) {
    case "k":
    case "thousand":
      return 1_000n;
    case "m":
    case "million":
      return 1_000_000n;
    case "b":
    case "billion":
      return 1_000_000_000n;
    default:
      return 1n;
  }
}

/** Converts a decimal source token to integer minor units without floating point. */
function parseAmountMinor(
  amount: string,
  magnitude: string | undefined,
): number | null {
  const normalized = amount.replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const [whole = "", fraction = ""] = normalized.split(".");
  const digits = `${whole}${fraction}`;
  const denominator = 10n ** BigInt(fraction.length);
  // Every currently accepted currency uses two decimal minor units. Extending
  // the currency allowlist must also supply its ISO minor-unit exponent here.
  const scaled = BigInt(digits) * magnitudeMultiplier(magnitude) * 100n;
  if (scaled % denominator !== 0n) {
    return null;
  }
  const minor = scaled / denominator;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(minor);
}

function qualifierAround(
  text: string,
  start: number,
  end: number,
): MoneyQualifier {
  const prefix = text.slice(Math.max(0, start - 48), start).toLowerCase();
  const suffix = text.slice(end, Math.min(text.length, end + 32)).toLowerCase();
  if (/(?:[<≤]=?)\s*$/.test(prefix)) {
    return "up_to";
  }
  if (/(?:[>≥]=?)\s*$/.test(prefix)) {
    return "at_least";
  }
  if (/[~≈]\s*$/.test(prefix)) {
    return "approximately";
  }
  if (
    /\b(?:not|no)\s+(?:over|above|greater\s+than|more\s+than)\s*$/.test(prefix)
  ) {
    return "up_to";
  }
  if (
    /\b(?:not|no)\s+(?:under|below|less\s+than|fewer\s+than)\s*$/.test(prefix)
  ) {
    return "at_least";
  }
  if (
    /\b(?:up to|no more than|not more than|maximum of|at most|as much as|less than|fewer than|under|below)\s*$/.test(
      prefix,
    ) ||
    /^\s+(?:or less|or fewer|and below)\b/.test(suffix)
  ) {
    return "up_to";
  }
  if (
    /\b(?:at least|no less than|minimum of|at a minimum of|more than|greater than|over|upwards of|north of)\s*$/.test(
      prefix,
    ) ||
    /^\+/.test(suffix) ||
    /^\s+(?:or more|and above)\b/.test(suffix)
  ) {
    return "at_least";
  }
  if (
    /\b(?:approximately|approx\.?|about|around|roughly|nearly)\s*$/.test(prefix)
  ) {
    return "approximately";
  }
  return "exact";
}

function sentenceBounds(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  const isSentenceBoundary = (index: number): boolean => {
    const character = text[index] ?? "";
    if (
      character === "." &&
      /\d/.test(text[index - 1] ?? "") &&
      /\d/.test(text[index + 1] ?? "")
    ) {
      return false;
    }
    return /[.!?;]/.test(character);
  };
  let sentenceStart = 0;
  for (let index = start - 1; index >= 0; index -= 1) {
    if (isSentenceBoundary(index)) {
      sentenceStart = index + 1;
      break;
    }
  }

  let sentenceEnd = text.length;
  for (let index = end; index < text.length; index += 1) {
    if (isSentenceBoundary(index)) {
      sentenceEnd = index + 1;
      break;
    }
  }
  return { start: sentenceStart, end: sentenceEnd };
}

function exactEvidenceWindow(text: string, start: number, end: number): string {
  const sentence = sentenceBounds(text, start, end);
  const rawSentence = text.slice(sentence.start, sentence.end);
  const leadingWhitespace = rawSentence.length - rawSentence.trimStart().length;
  const complete = rawSentence.trim();
  const words = Array.from(complete.matchAll(/\S+/g));
  if (
    complete.length <= MAX_EVIDENCE_TEXT_CHARS &&
    words.length <= MAX_EVIDENCE_TEXT_WORDS
  ) {
    return complete;
  }

  const relativeStart = Math.max(0, start - sentence.start - leadingWhitespace);
  const relativeEnd = Math.max(
    relativeStart,
    end - sentence.start - leadingWhitespace,
  );
  const firstTargetWord = words.findIndex(
    (word) => (word.index ?? 0) + word[0].length > relativeStart,
  );
  const targetStart = Math.max(0, firstTargetWord);
  let targetEnd = targetStart;
  for (let index = targetStart; index < words.length; index += 1) {
    if ((words[index]?.index ?? 0) < relativeEnd) {
      targetEnd = index;
    } else {
      break;
    }
  }
  const targetWordCount = targetEnd - targetStart + 1;
  let windowStart = Math.max(
    0,
    targetStart - Math.floor((MAX_EVIDENCE_TEXT_WORDS - targetWordCount) / 2),
  );
  let windowEnd = Math.min(words.length, windowStart + MAX_EVIDENCE_TEXT_WORDS);
  windowStart = Math.max(0, windowEnd - MAX_EVIDENCE_TEXT_WORDS);

  const excerpt = (): string => {
    const first = words[windowStart];
    const last = words[windowEnd - 1];
    if (first === undefined || last === undefined) {
      return complete.slice(0, MAX_EVIDENCE_TEXT_CHARS).trim();
    }
    return complete
      .slice(first.index, (last.index ?? 0) + last[0].length)
      .trim();
  };

  while (excerpt().length > MAX_EVIDENCE_TEXT_CHARS) {
    const leftContext = targetStart - windowStart;
    const rightContext = windowEnd - targetEnd - 1;
    if (leftContext === 0 && rightContext === 0) {
      break;
    }
    if (rightContext >= leftContext) {
      windowEnd -= 1;
    } else {
      windowStart += 1;
    }
  }
  return excerpt();
}

function isPriorReference(text: string, start: number, end: number): boolean {
  const bounds = sentenceBounds(text, start, end);
  const before = text.slice(Math.max(bounds.start, start - 72), start);
  const after = text.slice(end, Math.min(bounds.end, end + 72));
  return (
    PRIOR_MARKER_PATTERN.test(before) ||
    /^\s*(?:(?:pre|post)[ -]?money\s+)?(?:valuation\s+)?(?:,?\s*(?:in|from|during)\s+(?:its\s+|the\s+)?(?:previous|prior|earlier|last)\b|(?:its\s+|the\s+)?(?:previous|prior|earlier|last)\s+round\b)/i.test(
      after,
    )
  );
}

function classifyMoneyRole(
  text: string,
  start: number,
  end: number,
): {
  role: MoneyCandidate["role"];
  basis: FinancingValuationFact["basis"];
} | null {
  const bounds = sentenceBounds(text, start, end);
  const before = text.slice(Math.max(bounds.start, start - 96), start);
  const after = text.slice(end, Math.min(bounds.end, end + 96));
  const directlyAfterValuation =
    /^\s*(?:(?:pre|post)[ -]?money\s+)?valuation\b/i.exec(after) ??
    /^\s*(?:pre|post)[ -]?money(?:\s+valuation)?\b/i.exec(after);
  const directlyBeforeValuation =
    /\b(?:(?:pre|post)[ -]?money\s+)?(?:valuation(?:\s+(?:of|at))?|valu(?:e[sd]?|ing)(?:\s+(?:the\s+company|[\p{L}\p{N}&.'-]+(?:\s+[\p{L}\p{N}&.'-]+){0,4}))?\s+at)\s+(?:(?:approximately|about|around|roughly|at least|up to)\s+)?$/iu.exec(
      before,
    );
  if (directlyAfterValuation !== null || directlyBeforeValuation !== null) {
    const valuationPhrase = `${directlyBeforeValuation?.[0] ?? ""} ${directlyAfterValuation?.[0] ?? ""}`;
    const hasPreMoney = /\bpre[ -]?money\b/i.test(valuationPhrase);
    const hasPostMoney = /\bpost[ -]?money\b/i.test(valuationPhrase);
    const basis =
      hasPreMoney === hasPostMoney
        ? "undisclosed"
        : hasPreMoney
          ? "pre_money"
          : "post_money";
    return { role: "valuation", basis };
  }

  const metricAfter =
    /^\s*(?:in\s+|of\s+)?(?:annual\s+recurring\s+revenue|arr|annual\s+revenue|revenue|bookings|customer\s+payments?|payment\s+volume|customer\s+contracts?|contract\s+value|sales|gross\s+merchandise\s+value|gmv|total\s+funding)\b/i.test(
      after,
    );
  const metricBefore =
    /\b(?:annual\s+recurring\s+revenue|arr|annual\s+revenue|revenue|bookings|customer\s+payments?|payment\s+volume|customer\s+contracts?|contract\s+value|sales|gross\s+merchandise\s+value|gmv|total\s+funding)\s+(?:of|to|at|reaching)\s*$/i.test(
      before,
    );
  if (metricAfter || metricBefore) {
    return null;
  }

  const qualifierTail = String.raw`(?:(?:a|an|the|new|additional|further|initial|another|approximately|about|around|roughly|nearly|up\s+to|at\s+least|more\s+than|over|less\s+than|under)\s+)*(?:total\s+of\s+)?[<≤>≥~≈]?\s*`;
  const directlyAfterFunding = new RegExp(
    String.raw`^\s*(?:(?:in|as|through|via|from|of)\s+)?(?:an?\s+)?(?:(?:series\s+[a-z](?:-\d+)?|pre[ -]?seed|seed|growth|strategic)\s+)?(?:financing|funding|round|investment|capital\s+raise|debt|equity|credit\s+facility|term\s+loan|loan\s+facility|convertible\s+note)\b`,
    "iu",
  ).test(after);
  const explicitlyPriorRoundAfter =
    /^\s*,?\s*(?:in|from|during)\s+(?:its\s+|the\s+)?(?:previous|prior|earlier|last)\s+round\b/i.test(
      after,
    );
  const directlyBeforeFunding =
    new RegExp(
      String.raw`\b(?:raise[sd]?|raising|secure[sd]?|securing|close[sd]?|closing)(?:\s+on)?\s+${qualifierTail}$`,
      "iu",
    ).test(before) ||
    new RegExp(
      String.raw`\b(?:financing|funding|round|investment|capital\s+raise|credit\s+facility|term\s+loan|loan\s+facility|convertible\s+note|commitments?)\s+(?:of|for|totaling|totalling|worth)\s+${qualifierTail}$`,
      "iu",
    ).test(before);

  if (
    directlyAfterFunding ||
    directlyBeforeFunding ||
    explicitlyPriorRoundAfter
  ) {
    return { role: "funding", basis: "undisclosed" };
  }
  return null;
}

function collectMatches(
  text: string,
  pattern: RegExp,
  occupiedRanges: Array<{ start: number; end: number }>,
): MoneyCandidate[] {
  const candidates: MoneyCandidate[] = [];
  for (const match of text.matchAll(pattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (
      occupiedRanges.some((range) => start < range.end && end > range.start)
    ) {
      continue;
    }
    const marker = match.groups?.currency;
    const amount = match.groups?.amount;
    if (marker === undefined || amount === undefined) {
      continue;
    }
    const currency = currencyFromMarker(marker);
    const amountMinor = parseAmountMinor(amount, match.groups?.magnitude);
    const classification = classifyMoneyRole(text, start, end);
    if (currency === null || amountMinor === null || classification === null) {
      continue;
    }
    occupiedRanges.push({ start, end });
    candidates.push({
      start,
      end,
      amountMinor,
      currency,
      qualifier:
        match.groups?.inlinePlus === "+"
          ? "at_least"
          : qualifierAround(text, start, end),
      evidenceText: exactEvidenceWindow(text, start, end),
      priorReference: isPriorReference(text, start, end),
      role: classification.role,
      valuationBasis: classification.basis,
    });
  }
  return candidates;
}

function collectRangeRoles(
  text: string,
  patterns: RegExp[],
  occupiedRanges: Array<{ start: number; end: number }>,
): Array<MoneyCandidate["role"]> {
  const roles: Array<MoneyCandidate["role"]> = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      if (
        occupiedRanges.some((range) => start < range.end && end > range.start)
      ) {
        continue;
      }
      occupiedRanges.push({ start, end });
      const classification = classifyMoneyRole(text, start, end);
      if (classification !== null) {
        roles.push(classification.role);
      }
    }
  }
  return roles;
}

function findMoneyCandidates(text: string): {
  candidates: MoneyCandidate[];
  rangeRoles: Array<MoneyCandidate["role"]>;
} {
  const occupiedRanges: Array<{ start: number; end: number }> = [];
  const rangeRoles = collectRangeRoles(
    text,
    [
      PREFIX_MONEY_RANGE_PATTERN,
      SUFFIX_MONEY_RANGE_PATTERN,
      PREFIX_BETWEEN_MONEY_RANGE_PATTERN,
      SUFFIX_BETWEEN_MONEY_RANGE_PATTERN,
    ],
    occupiedRanges,
  );
  return {
    candidates: [
      ...collectMatches(text, PREFIX_MONEY_PATTERN, occupiedRanges),
      ...collectMatches(text, SUFFIX_MONEY_PATTERN, occupiedRanges),
    ].sort((left, right) => left.start - right.start),
    rangeRoles,
  };
}

function distinctCandidates(candidates: MoneyCandidate[]): MoneyCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = [
      candidate.role,
      candidate.amountMinor,
      candidate.currency,
      candidate.qualifier,
      candidate.valuationBasis,
    ].join(":");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractRound(
  title: string,
  currentText: string,
): {
  roundType: FinancingAnnouncementFacts["roundType"];
  roundLabel: string | null;
} {
  for (const text of [title, currentText]) {
    const series = /\bseries\s+([a-z](?:-\d+)?)\b/i.exec(text);
    if (series?.[1] !== undefined) {
      return {
        roundType: "series",
        roundLabel: `Series ${series[1].toUpperCase()}`,
      };
    }
    if (/\bpre[ -]?seed\b/i.test(text)) {
      return { roundType: "pre_seed", roundLabel: "Pre-seed" };
    }
    if (/\bseed\b/i.test(text)) {
      return { roundType: "seed", roundLabel: "Seed" };
    }
    if (/\bgrowth\s+(?:round|financing|investment)\b/i.test(text)) {
      return { roundType: "growth", roundLabel: "Growth" };
    }
    if (/\bstrategic\s+(?:round|financing|investment)\b/i.test(text)) {
      return { roundType: "strategic", roundLabel: "Strategic" };
    }
    if (/\bundisclosed\s+(?:funding|financing)?\s*round\b/i.test(text)) {
      return { roundType: "undisclosed", roundLabel: null };
    }
  }
  return { roundType: null, roundLabel: null };
}

function currentSentences(text: string): string {
  return Array.from(text.matchAll(/[^.!?;]+[.!?;]?/g), (match) => match[0])
    .filter((sentence) => !PRIOR_MARKER_PATTERN.test(sentence))
    .join(" ");
}

function extractInstrument(
  title: string,
  text: string,
  fundingCandidates: MoneyCandidate[],
): FinancingAnnouncementFacts["instrument"] {
  type InstrumentSignal = Exclude<
    FinancingAnnouncementFacts["instrument"],
    "undisclosed"
  >;
  const signals = new Set<InstrumentSignal>();
  const instrumentPatterns: Array<[InstrumentSignal, string]> = [
    [
      "mixed",
      String.raw`(?:mixed\s+financing|(?:debt\s+and\s+equity|equity\s+and\s+debt)\s+(?:financing|investment|tranches?))`,
    ],
    [
      "convertible",
      String.raw`(?:convertible\s+(?:note|debt|security|instrument)|safe\s+(?:note|financing|investment))`,
    ],
    [
      "debt",
      String.raw`(?:debt\s+(?:financing|investment|round)|venture\s+debt|credit\s+facility|term\s+loan|loan\s+facility)`,
    ],
    [
      "equity",
      String.raw`(?:equity\s+(?:financing|investment|round)|preferred\s+(?:shares|stock))`,
    ],
  ];
  const purposeBoundary =
    /\b(?:for|in\s+order\s+to|so\s+as\s+to|to|which\s+(?:will|would)|with\s+(?:the\s+)?proceeds)\b/i;
  const purposeStart = title.search(purposeBoundary);
  const eventTitle = purposeStart === -1 ? title : title.slice(0, purposeStart);
  const eventVerb = String.raw`(?:raise[sd]?|raising|close[sd]?|closing|secure[sd]?|securing|announce[sd]?|announcing|complete[sd]?|completing)`;

  for (const [signal, source] of instrumentPatterns) {
    if (
      new RegExp(String.raw`\b${eventVerb}\b.{0,64}\b${source}\b`, "iu").test(
        eventTitle,
      )
    ) {
      signals.add(signal);
    }
  }

  for (const candidate of fundingCandidates) {
    const bounds = sentenceBounds(text, candidate.start, candidate.end);
    const before = text.slice(
      Math.max(bounds.start, candidate.start - 112),
      candidate.start,
    );
    const after = text.slice(
      candidate.end,
      Math.min(bounds.end, candidate.end + 112),
    );
    for (const [signal, source] of instrumentPatterns) {
      const immediatelyBefore = new RegExp(
        String.raw`\b${source}\b(?:\s+(?:financing|of|for|totaling|totalling|worth))?\s+(?:(?:up\s+to|at\s+least|approximately|about|around|roughly)\s+)?$`,
        "iu",
      );
      const immediatelyAfter = new RegExp(
        String.raw`^\s*(?:(?:in|through|via|from|as\s+part\s+of)\s+)?(?:an?\s+)?(?:(?:series\s+[a-z](?:-\d+)?|pre[ -]?seed|seed|growth|strategic)\s+)?${source}\b`,
        "iu",
      );
      if (immediatelyBefore.test(before) || immediatelyAfter.test(after)) {
        signals.add(signal);
      }
    }
  }

  if (signals.has("mixed") || signals.size > 1) {
    return "mixed";
  }
  return signals.values().next().value ?? "undisclosed";
}

function isCombinedTrancheAnnouncement(
  text: string,
  candidates: MoneyCandidate[],
): boolean {
  if (candidates.length < 2) {
    return false;
  }
  return (
    /\b(?:mixed\s+financing|(?:debt\s+and\s+equity|equity\s+and\s+debt)\s+(?:financing|investment|tranches?))\b/i.test(
      text,
    ) ||
    (/\b(?:comprising|including|consisting\s+of|split\s+between)\b/i.test(
      text,
    ) &&
      candidates.some((candidate) =>
        /\b(?:of|in)\s+equity\b/i.test(candidate.evidenceText),
      ) &&
      candidates.some((candidate) =>
        /\b(?:of|in)\s+(?:debt|credit\s+facility|term\s+loan)\b/i.test(
          candidate.evidenceText,
        ),
      ))
  );
}

function selectExplicitCombinedTotal(
  text: string,
  candidates: MoneyCandidate[],
): MoneyCandidate | null {
  for (const candidate of candidates) {
    const after = text.slice(candidate.end, candidate.end + 72);
    if (
      /\b(?:including|comprising|consisting\s+of|split\s+between)\b/i.test(
        after,
      )
    ) {
      return candidate;
    }
  }
  return null;
}

function toMoneyFact(candidate: MoneyCandidate): FinancingMoneyFact {
  return {
    amountMinor: candidate.amountMinor,
    currency: candidate.currency,
    qualifier: candidate.qualifier,
    evidenceText: candidate.evidenceText,
  };
}

function toValuationFact(candidate: MoneyCandidate): FinancingValuationFact {
  return {
    ...toMoneyFact(candidate),
    basis: candidate.valuationBasis,
  };
}

/**
 * Deterministically extracts only source-stated financing terms. Conflicting
 * current amounts fail closed; explicit prior-round figures are never selected.
 */
export function extractFinancingAnnouncementFacts(
  input: z.input<typeof FinancingAnnouncementExtractionInputSchema>,
): FinancingAnnouncementFacts | null {
  const parsed = FinancingAnnouncementExtractionInputSchema.parse(input);
  const title = normalizeText(parsed.title);
  const normalizedEvidence = normalizeText(parsed.evidenceText);
  const text = normalizedEvidence.toLowerCase().includes(title.toLowerCase())
    ? normalizedEvidence
    : `${title}. ${normalizedEvidence}`;
  const nonPriorText = currentSentences(text);
  const round = extractRound(title, nonPriorText);
  const { candidates, rangeRoles } = findMoneyCandidates(text);
  const ambiguities = new Set<Ambiguity>();
  if (UNQUALIFIED_DOLLAR_MONEY_PATTERN.test(text)) {
    ambiguities.add("currency_not_explicit");
  }
  if (candidates.some((candidate) => candidate.priorReference)) {
    ambiguities.add("prior_round_reference");
  }
  if (rangeRoles.includes("funding")) {
    ambiguities.add("multiple_funding_amounts");
  }
  if (rangeRoles.includes("valuation")) {
    ambiguities.add("multiple_valuations");
  }

  const currentFunding = distinctCandidates(
    candidates.filter(
      (candidate) => candidate.role === "funding" && !candidate.priorReference,
    ),
  );
  const currentValuations = distinctCandidates(
    candidates.filter(
      (candidate) =>
        candidate.role === "valuation" && !candidate.priorReference,
    ),
  );

  const combinedTranches = isCombinedTrancheAnnouncement(
    nonPriorText,
    currentFunding,
  );
  const instrument = combinedTranches
    ? "mixed"
    : extractInstrument(title, text, currentFunding);
  let announcedCandidate: MoneyCandidate | null = null;
  if (rangeRoles.includes("funding")) {
    announcedCandidate = null;
  } else if (currentFunding.length === 1) {
    announcedCandidate = currentFunding[0] ?? null;
  } else if (currentFunding.length > 1) {
    if (combinedTranches) {
      ambiguities.add("combined_tranches");
      announcedCandidate = selectExplicitCombinedTotal(text, currentFunding);
    }
    if (announcedCandidate === null) {
      ambiguities.add("multiple_funding_amounts");
    }
  }
  if (combinedTranches) {
    ambiguities.add("combined_tranches");
  }

  let valuationCandidate: MoneyCandidate | null = null;
  if (rangeRoles.includes("valuation")) {
    valuationCandidate = null;
  } else if (currentValuations.length === 1) {
    valuationCandidate = currentValuations[0] ?? null;
  } else if (currentValuations.length > 1) {
    ambiguities.add("multiple_valuations");
  }

  const candidateFacts = {
    ...round,
    instrument,
    announcedAmount:
      announcedCandidate === null ? null : toMoneyFact(announcedCandidate),
    companyValuation:
      valuationCandidate === null ? null : toValuationFact(valuationCandidate),
    ambiguities: [
      "currency_not_explicit",
      "multiple_funding_amounts",
      "multiple_valuations",
      "combined_tranches",
      "prior_round_reference",
    ].filter((ambiguity): ambiguity is Ambiguity =>
      ambiguities.has(ambiguity as Ambiguity),
    ),
  } satisfies FinancingAnnouncementFacts;

  const result = FinancingAnnouncementFactsSchema.safeParse(candidateFacts);
  return result.success ? result.data : null;
}
