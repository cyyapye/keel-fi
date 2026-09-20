import { describe, expect, it } from "vitest";
import {
  InvestmentEventInputSchema,
  suggestInvestmentEvent,
} from "./investment-events";

describe("investment event evidence", () => {
  it("scopes securities to the exact vehicle and keeps contingent shares and warrants separate", () => {
    const notice = `Synthetic Labs has merged with Synthetic Holdings. This is not an exit that gives LPs liquidity.
For Synthetic Vehicle I, here are the terms:
The SPV invested $420,000.
The SPV received 1,234 acquirer Series A shares, valued at $42.31 per share.
The SPV will receive an additional 321 shares upon release of earnout.
The SPV received 88 closing warrant shares.
For Synthetic Vehicle II, here are the terms:
The SPV received 9,999 acquirer Series A shares.`;
    const draft = suggestInvestmentEvent(notice, "Synthetic Vehicle I", "USD");
    expect(draft).toMatchObject({
      matchedVehicle: true,
      successor: "Synthetic Holdings",
      lpDistribution: "none_reported",
    });
    expect(
      draft.components.map(({ kind, quantity, status, unitPriceMinor }) => ({
        kind,
        quantity,
        status,
        unitPriceMinor,
      })),
    ).toEqual([
      {
        kind: "shares",
        quantity: "1234",
        status: "received",
        unitPriceMinor: 4231,
      },
      {
        kind: "earnout",
        quantity: "321",
        status: "conditional",
        unitPriceMinor: null,
      },
      {
        kind: "warrants",
        quantity: "88",
        status: "received",
        unitPriceMinor: null,
      },
    ]);
  });
  it("does not borrow another vehicle's terms or invent a cash distribution", () => {
    const draft = suggestInvestmentEvent(
      "For Synthetic Vehicle II, here are the terms:\nThe SPV received 222 shares.",
      "Synthetic Vehicle I",
      "USD",
    );
    expect(draft).toMatchObject({
      matchedVehicle: false,
      components: [],
      lpDistribution: "unknown",
    });
  });
  it("requires a continuing SPV scope and distinct issuers at the external boundary", () => {
    const valid = {
      eventId: crypto.randomUUID(),
      supersedesRevisionId: null,
      kind: "conversion",
      scope: "underlying_securities",
      participationContinues: true,
      status: "completed",
      predecessor: "Synthetic Issuer",
      successor: "Synthetic Issuer",
      noticeDate: null,
      effectiveDate: null,
      sourceLabel: "Synthetic notice",
      sourceText: "Synthetic note converted into shares.",
      documentId: null,
      lpDistribution: "unknown",
      components: [],
      note: null,
      expectedMappingIds: [],
    };
    expect(InvestmentEventInputSchema.safeParse(valid).success).toBe(true);
    expect(
      InvestmentEventInputSchema.safeParse({ ...valid, kind: "merger" })
        .success,
    ).toBe(false);
    expect(
      InvestmentEventInputSchema.safeParse({
        ...valid,
        scope: "personal",
        participationContinues: false,
      }).success,
    ).toBe(false);
  });
});
