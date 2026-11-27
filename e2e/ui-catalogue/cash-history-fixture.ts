import type { AcceptedCashAccount } from "../../packages/domain/src/index";

export const observedAt = "2026-11-08T12:00:00.000Z";
export const digest = (n: number) => n.toString(16).padStart(64, "0");
export function bankBalances(extra = false): AcceptedCashAccount[] {
  return [
    8240000,
    165000,
    2500,
    0,
    ...(extra ? [325, 110, 80, 215, 65, 435] : []),
  ].map((valueMinor, i) => ({
    id: `demo-bank-balance-${i}`,
    naturalKeySha256: digest(i + 1),
    connectionId: "demo-bank-connection",
    institutionLabel: i % 2 ? "Capital One" : "Robinhood",
    accountLabel:
      ["Savings", "Performance Savings", "Checking", "Checking"][i] ??
      `Demo reserve ${i}${i === 4 ? " · ExtremelyLongSyntheticAccountNameWithoutAnySpacesForResponsiveCoverage" : ""}`,
    subtype: i === 2 || i === 3 ? "checking" : "savings",
    valueMinor,
    valueState: "reported",
    balanceSource: "available",
    refreshKind: "live",
    observedAt,
    acceptedAt: observedAt,
  }));
}

const amounts = [
  4500000, 5000000, 5800000, 6400000, 6850000, 7000000, 7400000, 7600000,
  7800000, 7950000, 8100000, 8240000,
];
const dates = [
  "2022-02-10",
  "2023-05-02",
  "2024-11-08",
  "2025-07-01",
  "2025-12-02",
  "2026-02-01",
  "2026-05-12",
  "2026-08-05",
  "2026-09-20",
  "2026-10-18",
  "2026-11-02",
  "2026-11-08",
];
export const observations = amounts.flatMap((valueMinor, i) =>
  [0, 1].map((repeat) => ({
    id: `demo-change-${i}-${repeat}`,
    valueMinor,
    observedAt: `${dates[i]}T12:00:00.000Z`,
    acceptedAt: `${dates[i]}T1${2 + repeat}:00:00.000Z`,
  })),
);
