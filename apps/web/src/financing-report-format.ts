import type { EvidenceInboxItem } from "@keel/domain";
import { formatCompactCurrency } from "./format";

export type FinancingFacts = NonNullable<EvidenceInboxItem["financingFacts"]>;
type FinancingMoneyFact = NonNullable<FinancingFacts["announcedAmount"]>;
type FinancingValuationFact = NonNullable<FinancingFacts["companyValuation"]>;

export function financingRoundLabel(facts: FinancingFacts) {
  const round =
    facts.roundLabel ??
    (facts.roundType === null
      ? null
      : {
          growth: "Growth financing",
          pre_seed: "Pre-seed",
          seed: "Seed",
          series: "Series financing",
          strategic: "Strategic financing",
          undisclosed: "Financing",
        }[facts.roundType]);
  const instrument = {
    convertible: "Convertible",
    debt: "Debt",
    equity: "Equity",
    mixed: "Mixed financing",
    undisclosed: null,
  }[facts.instrument];

  return (
    [round, instrument].filter((value) => value !== null).join(" · ") ||
    "Financing terms"
  );
}

function financingQualifierLabel(fact: FinancingMoneyFact) {
  return {
    approximately: "About ",
    at_least: "At least ",
    exact: "",
    up_to: "Up to ",
  }[fact.qualifier];
}

export function financingAmountLabel(fact: FinancingMoneyFact) {
  return `${financingQualifierLabel(fact)}${formatCompactCurrency(
    fact.amountMinor,
    fact.currency,
  )}`;
}

function boundedSourceExcerpt(value: string) {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const words = normalized.match(/\S+/gu) ?? [];
  let excerpt = "";
  for (const word of words.slice(0, 25)) {
    const candidate = excerpt.length === 0 ? word : `${excerpt} ${word}`;
    if (candidate.length > 240) {
      break;
    }
    excerpt = candidate;
  }
  return excerpt || normalized.slice(0, 240).trim();
}

export function financingSourceExcerpt(
  facts: FinancingFacts,
  fallback: string,
) {
  return (
    facts.announcedAmount?.evidenceText ??
    facts.companyValuation?.evidenceText ??
    boundedSourceExcerpt(fallback)
  );
}

export function financingValuationBasisLabel(fact: FinancingValuationFact) {
  return {
    pre_money: "pre-money company valuation",
    post_money: "post-money company valuation",
    undisclosed: "company valuation",
  }[fact.basis];
}

export function financingScenarioTermsLabel(facts: FinancingFacts) {
  const terms = [financingRoundLabel(facts)];
  if (facts.announcedAmount !== null) {
    terms.push(`${financingAmountLabel(facts.announcedAmount)} announced`);
  }
  if (facts.companyValuation !== null) {
    terms.push(
      `${financingAmountLabel(facts.companyValuation)} ${financingValuationBasisLabel(facts.companyValuation)}`,
    );
  }
  return terms.join(" · ");
}

export function financingAmbiguityLabel(
  ambiguity: FinancingFacts["ambiguities"][number],
) {
  return {
    combined_tranches: "combined tranches",
    currency_not_explicit: "currency not explicit",
    multiple_funding_amounts: "multiple funding amounts",
    multiple_valuations: "multiple valuations",
    prior_round_reference: "prior-round reference",
  }[ambiguity];
}
