import { describe, expect, it } from "vitest";

import { extractFinancingAnnouncementFacts } from "./financing-announcement";

describe("financing announcement fact extraction", () => {
  it("extracts a raise and post-money valuation using integer minor units", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Northstar Robotics raises Series C funding",
        evidenceText:
          "Northstar Robotics raised US$250 million in Series C funding at a US$1.5 billion post-money valuation.",
      }),
    ).toEqual({
      roundType: "series",
      roundLabel: "Series C",
      instrument: "undisclosed",
      announcedAmount: {
        amountMinor: 25_000_000_000,
        currency: "USD",
        qualifier: "exact",
        evidenceText:
          "Northstar Robotics raised US$250 million in Series C funding at a US$1.5 billion post-money valuation.",
      },
      companyValuation: {
        amountMinor: 150_000_000_000,
        currency: "USD",
        qualifier: "exact",
        evidenceText:
          "Northstar Robotics raised US$250 million in Series C funding at a US$1.5 billion post-money valuation.",
        basis: "post_money",
      },
      ambiguities: [],
    });
  });

  it("does not infer a currency from an unqualified dollar symbol", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Northstar Robotics raises Series C funding",
        evidenceText:
          "Northstar Robotics raised $250 million at a $1.5 billion post-money valuation.",
      }),
    ).toMatchObject({
      roundType: "series",
      announcedAmount: null,
      companyValuation: null,
      ambiguities: ["currency_not_explicit"],
    });
  });

  it("surfaces a currency ambiguity even without another structured term", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Northstar Robotics raises funding",
        evidenceText: "Northstar Robotics raised $25 million.",
      }),
    ).toEqual({
      roundType: null,
      roundLabel: null,
      instrument: "undisclosed",
      announcedAmount: null,
      companyValuation: null,
      ambiguities: ["currency_not_explicit"],
    });
  });

  it("keeps exact source wording within the quote boundary", () => {
    const result = extractFinancingAnnouncementFacts({
      title: "Northstar Robotics raises growth financing",
      evidenceText:
        "After years of careful product work across robotics software operations manufacturing customer support partnerships research safety testing international expansion and field deployments Northstar Robotics raised USD 42 million in growth financing to expand its engineering organization and production capacity while continuing long-term research programs for industrial customers around the world.",
    });
    const excerpt = result?.announcedAmount?.evidenceText;

    expect(excerpt).toContain("USD 42 million");
    expect(excerpt?.split(/\s+/u).length).toBeLessThanOrEqual(25);
    expect(excerpt?.length).toBeLessThanOrEqual(240);
  });

  it("extracts an explicit pre-money valuation without inferring currency", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Juniper Works closes its seed round",
        evidenceText:
          "Juniper Works closed US$40 million in equity financing at a pre-money valuation of US$180 million.",
      }),
    ).toMatchObject({
      roundType: "seed",
      roundLabel: "Seed",
      instrument: "equity",
      announcedAmount: {
        amountMinor: 4_000_000_000,
        currency: "USD",
        qualifier: "exact",
      },
      companyValuation: {
        amountMinor: 18_000_000_000,
        currency: "USD",
        basis: "pre_money",
      },
      ambiguities: [],
    });
  });

  it("fails closed when multiple current funding amounts conflict", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Lattice Harbor announces Series A financing",
        evidenceText:
          "Lattice Harbor announced USD 80 million in Series A financing and an additional USD 25 million investment.",
      }),
    ).toMatchObject({
      announcedAmount: null,
      companyValuation: null,
      ambiguities: ["multiple_funding_amounts"],
    });
  });

  it("selects the current amount and flags an explicit prior-round reference", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Aster Labs raises Series B financing",
        evidenceText:
          "Aster Labs raised USD 90 million in Series B financing. It previously raised USD 25 million in its Series A round.",
      }),
    ).toMatchObject({
      roundType: "series",
      roundLabel: "Series B",
      announcedAmount: {
        amountMinor: 9_000_000_000,
        currency: "USD",
      },
      ambiguities: ["prior_round_reference"],
    });
  });

  it("preserves an up-to qualifier", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Beacon Grid secures debt financing",
        evidenceText:
          "Beacon Grid secured a credit facility of up to EUR 75 million.",
      }),
    ).toMatchObject({
      instrument: "debt",
      announcedAmount: {
        amountMinor: 7_500_000_000,
        currency: "EUR",
        qualifier: "up_to",
      },
      ambiguities: [],
    });
  });

  it("uses an explicit total for combined debt and equity tranches", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Solstice Engine closes mixed financing",
        evidenceText:
          "Solstice Engine closed a US$300 million financing comprising US$200 million of equity and US$100 million of debt.",
      }),
    ).toMatchObject({
      instrument: "mixed",
      announcedAmount: {
        amountMinor: 30_000_000_000,
        currency: "USD",
      },
      ambiguities: ["combined_tranches"],
    });
  });

  it("supports explicit non-USD currency terms", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Cobalt Orchard raises growth financing",
        evidenceText:
          "Cobalt Orchard raised approximately EUR 62.5 million in growth financing.",
      }),
    ).toMatchObject({
      roundType: "growth",
      roundLabel: "Growth",
      announcedAmount: {
        amountMinor: 6_250_000_000,
        currency: "EUR",
        qualifier: "approximately",
      },
      ambiguities: [],
    });
  });

  it.each([
    "Atlas Forge raised USD 50-60 million in growth financing.",
    "Atlas Forge raised USD 50–60 million in growth financing.",
    "Atlas Forge raised USD 50 to 60 million in growth financing.",
    "Atlas Forge raised 50-60 million USD in growth financing.",
    "Atlas Forge raised US$50-$60 million in growth financing.",
    "Atlas Forge raised USD 50-USD 60 million in growth financing.",
  ])("fails closed on funding range case %#", (evidenceText) => {
    const result = extractFinancingAnnouncementFacts({
      title: "Atlas Forge raises growth financing",
      evidenceText,
    });
    expect(result).toMatchObject({
      announcedAmount: null,
      companyValuation: null,
    });
    expect(result?.ambiguities).toContain("multiple_funding_amounts");
  });

  it("fails closed on a valuation range", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises growth financing",
        evidenceText:
          "The round values Atlas Forge at USD 500-600 million post-money.",
      }),
    ).toMatchObject({
      announcedAmount: null,
      companyValuation: null,
      ambiguities: ["multiple_valuations"],
    });
  });

  it("fails closed on a between-and funding range", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises growth financing",
        evidenceText:
          "Atlas Forge raised between USD 50 million and 60 million in growth financing.",
      }),
    ).toMatchObject({
      announcedAmount: null,
      companyValuation: null,
      ambiguities: ["multiple_funding_amounts"],
    });
  });

  it("does not choose a separate exact amount when the same announcement has a funding range", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises growth financing",
        evidenceText:
          "Atlas Forge secured USD 10 million initially within a USD 50-60 million growth financing.",
      }),
    ).toMatchObject({
      announcedAmount: null,
      ambiguities: ["multiple_funding_amounts"],
    });
  });

  it("fails closed on a between-and valuation range", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises growth financing",
        evidenceText:
          "The round values Atlas Forge between USD 500 million and 600 million post-money.",
      }),
    ).toMatchObject({
      announcedAmount: null,
      companyValuation: null,
      ambiguities: ["multiple_valuations"],
    });
  });

  it.each(["less than", "under", "below"])(
    "preserves an upper bound instead of claiming an exact amount: %s",
    (qualifier) => {
      expect(
        extractFinancingAnnouncementFacts({
          title: "Atlas Forge raises growth financing",
          evidenceText: `Atlas Forge raised ${qualifier} USD 50 million in growth financing.`,
        }),
      ).toMatchObject({
        announcedAmount: {
          amountMinor: 5_000_000_000,
          qualifier: "up_to",
        },
      });
    },
  );

  it.each([
    ["not over", "up_to"],
    ["no greater than", "up_to"],
    ["not greater than", "up_to"],
    ["not less than", "at_least"],
    ["not under", "at_least"],
    ["not below", "at_least"],
  ] as const)(
    "preserves a negated money bound: %s",
    (qualifier, expectedQualifier) => {
      expect(
        extractFinancingAnnouncementFacts({
          title: "Atlas Forge raises growth financing",
          evidenceText: `Atlas Forge raised ${qualifier} USD 50 million in growth financing.`,
        }),
      ).toMatchObject({
        announcedAmount: {
          amountMinor: 5_000_000_000,
          qualifier: expectedQualifier,
        },
      });
    },
  );

  it.each([
    ["<US$50 million", "up_to"],
    ["≤US$50 million", "up_to"],
    [">US$50 million", "at_least"],
    ["≥US$50 million", "at_least"],
    ["~US$50 million", "approximately"],
    ["≈US$50 million", "approximately"],
  ] as const)(
    "preserves a symbolic money qualifier: %s",
    (amountText, expectedQualifier) => {
      expect(
        extractFinancingAnnouncementFacts({
          title: "Atlas Forge raises growth financing",
          evidenceText: `Atlas Forge raised ${amountText} in growth financing.`,
        }),
      ).toMatchObject({
        announcedAmount: {
          amountMinor: 5_000_000_000,
          qualifier: expectedQualifier,
        },
      });
    },
  );

  it.each([
    "USD 50 million or more",
    "USD 50 million+",
    "USD 50+ million",
    "50+ million USD",
  ])(
    "preserves a trailing lower bound instead of claiming an exact amount: %s",
    (amountText) => {
      expect(
        extractFinancingAnnouncementFacts({
          title: "Atlas Forge raises growth financing",
          evidenceText: `Atlas Forge raised ${amountText} in growth financing.`,
        }),
      ).toMatchObject({
        announcedAmount: {
          amountMinor: 5_000_000_000,
          qualifier: "at_least",
        },
      });
    },
  );

  it("does not treat a raise amount as the following company valuation", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises growth financing",
        evidenceText:
          "Atlas Forge raised USD 50 million at a post-money valuation of $250 million.",
      }),
    ).toMatchObject({
      announcedAmount: {
        amountMinor: 5_000_000_000,
        currency: "USD",
        qualifier: "exact",
      },
      companyValuation: null,
      ambiguities: ["currency_not_explicit"],
    });
  });

  it("binds valuation basis to the selected current valuation phrase", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises Series B financing",
        evidenceText:
          "The round values Atlas Forge at USD 1 billion post-money valuation; its prior round valued the company at USD 800 million pre-money valuation.",
      }),
    ).toMatchObject({
      companyValuation: {
        amountMinor: 100_000_000_000,
        currency: "USD",
        basis: "post_money",
      },
      ambiguities: ["prior_round_reference"],
    });
  });

  it("does not let a later prior-round clause contaminate the current valuation", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises Series B financing",
        evidenceText:
          "The round has a post-money valuation of USD 1 billion, compared with USD 800 million in its prior round.",
      }),
    ).toMatchObject({
      companyValuation: {
        amountMinor: 100_000_000_000,
        basis: "post_money",
      },
      ambiguities: ["prior_round_reference"],
    });
  });

  it("does not let incidental debt prose change an explicit equity instrument", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises equity financing",
        evidenceText:
          "Atlas Forge raised USD 70 million in equity financing to help customers manage debt and equity workflows.",
      }),
    ).toMatchObject({
      instrument: "equity",
      announcedAmount: { amountMinor: 7_000_000_000 },
    });
  });

  it("binds an instrument after an explicit round label to the amount", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises Series B financing",
        evidenceText:
          "Atlas Forge raised USD 70 million in Series B equity financing.",
      }),
    ).toMatchObject({
      instrument: "equity",
      announcedAmount: { amountMinor: 7_000_000_000 },
    });
  });

  it("does not infer debt financing from the use of proceeds", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises financing",
        evidenceText:
          "Atlas Forge raised USD 70 million in financing to repay debt and expand operations.",
      }),
    ).toMatchObject({
      instrument: "undisclosed",
      announcedAmount: { amountMinor: 7_000_000_000 },
    });
  });

  it.each([
    "to repay its existing credit facility",
    "to repay a convertible note",
    "to provide liquidity to holders of preferred shares",
    "to build a marketplace for debt financing",
  ])("does not infer an instrument from purpose prose: %s", (purpose) => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises financing",
        evidenceText: `Atlas Forge raised USD 70 million in financing ${purpose}.`,
      }),
    ).toMatchObject({
      instrument: "undisclosed",
      announcedAmount: { amountMinor: 7_000_000_000 },
    });
  });

  it("retains an explicitly amount-bound convertible instrument", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Atlas Forge raises financing",
        evidenceText:
          "Atlas Forge raised USD 70 million through a convertible note.",
      }),
    ).toMatchObject({
      instrument: "convertible",
      announcedAmount: { amountMinor: 7_000_000_000 },
    });
  });

  it.each([
    [
      "Acme announces new financing",
      "Acme announced new financing after reaching USD 20 million in annual recurring revenue.",
    ],
    [
      "Acme secures growth financing",
      "After generating USD 30 million in annual revenue, Acme secured growth financing.",
    ],
    [
      "Acme announces financing",
      "Acme announced financing after processing USD 2 billion in customer payments last year.",
    ],
    [
      "Acme closes financing",
      "Acme closed financing after winning a USD 75 million customer contract.",
    ],
    [
      "Acme raises a new round",
      "Acme raised a new round following USD 15 million in customer bookings.",
    ],
    [
      "Acme announces Series B",
      "Acme announced its Series B, bringing total funding to USD 100 million.",
    ],
  ])(
    "does not treat an unrelated business metric as funding case %#",
    (title, evidenceText) => {
      const result = extractFinancingAnnouncementFacts({ title, evidenceText });
      expect(result?.announcedAmount ?? null).toBeNull();
      expect(result?.companyValuation ?? null).toBeNull();
    },
  );

  it("selects the explicitly raised amount while ignoring nearby ARR", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Acme raises Series B financing",
        evidenceText:
          "Acme raised USD 50 million in Series B financing after reaching USD 20 million ARR.",
      }),
    ).toMatchObject({
      announcedAmount: {
        amountMinor: 5_000_000_000,
        currency: "USD",
      },
      ambiguities: [],
    });
  });

  it("returns null when an announcement contains no structured terms", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Mosaic Systems announces new financing",
        evidenceText:
          "Mosaic Systems announced new financing to support product development.",
      }),
    ).toBeNull();
  });

  it("omits multiple current valuations rather than choosing one", () => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Pioneer Stack raises strategic financing",
        evidenceText:
          "Pioneer Stack raised US$50 million at a pre-money valuation of US$200 million and a post-money valuation of US$250 million.",
      }),
    ).toMatchObject({
      roundType: "strategic",
      companyValuation: null,
      ambiguities: ["multiple_valuations"],
    });
  });

  it.each([
    "The round values the company at USD 1.25 billion.",
    "The round values Acme Labs at USD 1.25 billion.",
  ])("classifies present-tense valuation wording: %s", (evidenceText) => {
    expect(
      extractFinancingAnnouncementFacts({
        title: "Acme Labs raises Series C financing",
        evidenceText,
      }),
    ).toMatchObject({
      announcedAmount: null,
      companyValuation: {
        amountMinor: 125_000_000_000,
        currency: "USD",
        basis: "undisclosed",
      },
    });
  });
});
