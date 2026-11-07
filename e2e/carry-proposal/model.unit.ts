import { describe, expect, it } from "vitest";
import {
  assessInvestmentCarry,
  summarizeInvestmentCarryCapital,
} from "../../packages/domain/src/investment-details";
import {
  calculate,
  cents,
  clone,
  facts,
  invalid,
  investmentFromDraft,
  ordinary,
  type Source,
} from "./model";

const source: Source = {
  carry: "before_carry",
  reportedDistributions: 900_000n,
};

describe("synthetic carry proposal domain adapter", () => {
  it("uses contributed capital and includes the received value once", () => {
    expect(calculate(ordinary, source)).toMatchObject({
      received: 900_000n,
      unreturned: 2_100_000n,
      carry: 380_000n,
      after: 3_620_000n,
      beforeReturn: "+81.5%",
      afterReturn: "+67.4%",
    });
  });

  it("reconstructs historical gross with prior carry, then subtracts prior carry once", () => {
    const draft = clone(ordinary);
    draft.events[0]!.amount = "34000";
    draft.priorCarryAmount = "1000";
    expect(
      calculate(draft, { ...source, reportedDistributions: 3_400_000n }),
    ).toMatchObject({
      carry: 800_000n,
      after: 3_200_000n,
    });
  });

  it("rounds cumulative carry half up once, including split-event holdouts", () => {
    const draft = clone(ordinary);
    draft.events = [];
    draft.providerInclusion = "excluded";
    const noReceived = { ...source, reportedDistributions: 0n };
    expect(
      calculate(draft, noReceived, {
        ...facts,
        capital: 1n,
        remaining: 4n,
        carryPpm: 500_000n,
      }).carry,
    ).toBe(2n);
    expect(
      calculate(draft, noReceived, {
        ...facts,
        capital: 1n,
        remaining: 3n,
        carryPpm: 200_000n,
      }).carry,
    ).toBe(0n);
    const split = clone(ordinary);
    split.events = [0, 1].map((index) => ({
      ...ordinary.events[0]!,
      id: `rounding-${index}`,
      amount: "0.01",
    }));
    expect(
      calculate(
        split,
        { ...source, reportedDistributions: 2n },
        { ...facts, capital: 1n, remaining: 1n, carryPpm: 250_000n },
      ).carry,
    ).toBe(1n);
  });

  it("does not create a clawback credit and withholds unsupported liabilities", () => {
    const draft = clone(ordinary);
    draft.priorCarryAmount = "3000";
    expect(calculate(draft, source, { ...facts, remaining: 0n })).toMatchObject(
      { carry: 0n, after: 0n },
    );
    draft.priorCarryAmount = "0";
    draft.events[0]!.amount = "100000";
    const result = calculate(
      draft,
      { ...source, reportedDistributions: 10_000_000n },
      { ...facts, remaining: 100n },
    );
    expect(result.carry).toBeNull();
    expect(result.after).toBeNull();
    expect(result.carryReason).toContain("exceeds the remaining value");
  });

  it("keeps unknown historical values saveable and withholds dependent estimates", () => {
    const draft = clone(ordinary);
    draft.events[0]!.amount = "";
    expect(invalid(draft)).toBeNull();
    expect(calculate(draft, source)).toMatchObject({
      received: null,
      carry: null,
      after: null,
      afterReturn: null,
    });
    expect(calculate(draft, source).carryReason).toContain(
      "historical distribution value is unknown",
    );
    draft.priorCarryAmount = "";
    expect(calculate(draft, { ...source, carry: "after_carry" }).after).toBe(
      facts.remaining,
    );
    expect(calculate(draft, source, { ...facts, carryPpm: 0n })).toMatchObject({
      carry: 0n,
      after: facts.remaining,
    });
  });

  it("requires an actual reviewed-through date and permits unknown stock metadata", () => {
    const draft = clone(ordinary);
    const event = draft.events[0]!;
    if (event.kind !== "stock")
      throw new Error("Expected synthetic stock fixture");
    event.security = "";
    event.quantity = "";
    expect(invalid(draft)).toBeNull();
    event.quantity = "-1";
    expect(invalid(draft)).toContain("positive share quantity");
    event.quantity = "";
    draft.coverage = "unknown";
    draft.throughDate = "";
    expect(invalid(draft)).toContain("date covered");
  });

  it("preserves unknown source carry and dated-history constraints", () => {
    expect(
      calculate(ordinary, { ...source, carry: "unknown" }).after,
    ).toBeNull();
    for (const change of [
      { coverage: "partial" as const },
      { throughDate: "2026-09-30" },
      { priorCarryAmount: "" },
    ])
      expect(
        calculate({ ...clone(ordinary), ...change }, source).carry,
      ).toBeNull();
    const future = clone(ordinary);
    future.events[0]!.receivedOn = "2026-10-02";
    future.throughDate = "2026-10-02";
    expect(calculate(future, source).carryReason).toContain(
      "after this valuation",
    );
  });

  it("separates mixed and unknown reconciliation from available carry", () => {
    for (const providerInclusion of ["mixed", "unknown"] as const) {
      const result = calculate(
        { ...clone(ordinary), providerInclusion },
        source,
      );
      expect(result).toMatchObject({
        carry: 380_000n,
        after: 3_620_000n,
        beforeReturn: null,
        afterReturn: null,
      });
      expect(result.returnReason).toContain(
        providerInclusion === "mixed"
          ? "mixed provider inclusion is not supported"
          : "inclusion",
      );
    }
    expect(
      calculate(
        { ...clone(ordinary), providerInclusion: "excluded" },
        { ...source, reportedDistributions: 0n },
      ).afterReturn,
    ).toBe("+67.4%");
    expect(
      calculate({ ...clone(ordinary), providerInclusion: "excluded" }, source)
        .returnReason,
    ).toContain("do not reconcile");
  });

  it("keeps known investor capital independent of unknown prior GP carry", () => {
    const draft = {
      ...clone(ordinary),
      priorCarryAmount: "",
    };
    const investment = investmentFromDraft(draft, source);
    const summary = summarizeInvestmentCarryCapital({
      investment,
      asOfDate: draft.throughDate,
    });
    expect(summary).toEqual({
      capitalBasisMinor: 3_000_000,
      investorDistributionsMinor: 900_000,
      capitalRemainingMinor: 2_100_000,
      historyReason: null,
    });
    expect(
      assessInvestmentCarry({
        investment,
        valueMinor: 4_000_000,
        carryStatus: source.carry,
        valuationDate: facts.asOf,
      }),
    ).toEqual({ status: "unavailable", reason: "unknown_prior_carry" });
    expect(calculate(draft, source)).toMatchObject({
      unreturned: BigInt(summary.capitalRemainingMinor!),
      carry: null,
      after: null,
    });
  });

  it("derives historical-value knowledge from amount presence without treating blank as zero", () => {
    const draft = clone(ordinary);
    for (const amount of ["", "   "]) {
      draft.events[0]!.amount = amount;
      expect(invalid(draft)).toBeNull();
      expect(
        investmentFromDraft(draft, source).distributionReview?.events[0]
          ?.investorValueMinor,
      ).toBeNull();
      expect(calculate(draft, source).carryReason).toContain(
        "historical distribution value is unknown",
      );
    }
    draft.events[0]!.amount = "9000";
    expect(
      investmentFromDraft(draft, source).distributionReview?.events[0]
        ?.investorValueMinor,
    ).toBe(900_000);
    draft.events[0]!.amount = "0";
    expect(
      investmentFromDraft(draft, source).distributionReview?.events[0]
        ?.investorValueMinor,
    ).toBe(0);
    draft.events[0]!.amount = "";
    expect(
      investmentFromDraft(draft, source).distributionReview?.events[0]
        ?.investorValueMinor,
    ).toBeNull();
  });

  it("requires explicit prior carry including zero and never infers it from investor distributions", () => {
    const draft = clone(ordinary);
    draft.priorCarryAmount = "";
    expect(invalid(draft)).toBeNull();
    expect(
      investmentFromDraft(draft, source).distributionReview?.priorCarry,
    ).toEqual({ status: "unknown" });
    expect(calculate(draft, source)).toMatchObject({
      unreturned: 2_100_000n,
      carry: null,
      after: null,
    });
    draft.priorCarryAmount = "1000";
    expect(
      investmentFromDraft(draft, source).distributionReview?.priorCarry,
    ).toEqual({ status: "known", amountMinor: 100_000 });
    draft.priorCarryAmount = "0";
    expect(
      investmentFromDraft(draft, source).distributionReview?.priorCarry,
    ).toEqual({ status: "known", amountMinor: 0 });
    expect(calculate(draft, source).after).toBe(3_620_000n);
    draft.priorCarryAmount = "   ";
    expect(
      investmentFromDraft(draft, source).distributionReview?.priorCarry,
    ).toEqual({ status: "unknown" });
  });

  it("rejects nonempty invalid amounts instead of changing them to unknown", () => {
    for (const value of [
      "-1",
      "9.001",
      "not an amount",
      "9007199254740993.01",
    ]) {
      const eventDraft = clone(ordinary);
      eventDraft.events[0]!.amount = value;
      expect(calculate(eventDraft, source).inputError).toBeTruthy();
      expect(() => investmentFromDraft(eventDraft, source)).toThrow();
      const carryDraft = clone(ordinary);
      carryDraft.priorCarryAmount = value;
      expect(calculate(carryDraft, source).inputError).toBeTruthy();
      expect(() => investmentFromDraft(carryDraft, source)).toThrow();
    }
  });

  it("requires confirmed zero prior carry for complete empty history", () => {
    const draft = clone(ordinary);
    draft.events = [];
    draft.providerInclusion = "excluded";
    const emptySource = { ...source, reportedDistributions: 0n };
    draft.priorCarryAmount = "";
    expect(invalid(draft)).toContain("Confirm zero carry");
    expect(calculate(draft, emptySource).inputError).toContain(
      "Confirm zero carry",
    );
    draft.priorCarryAmount = "0";
    expect(invalid(draft)).toBeNull();
    expect(calculate(draft, emptySource).after).toBe(3_800_000n);
  });

  it("parses currency exactly beyond Number's integer precision", () => {
    expect(cents("9007199254740993.01")).toBe(900_719_925_474_099_301n);
    expect(cents("0.001")).toBeNull();
    expect(cents("-1")).toBeNull();
  });
});
