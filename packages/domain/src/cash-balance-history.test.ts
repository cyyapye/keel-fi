import { expect, it } from "vitest";
import {
  cashBalanceHistoryPage,
  CashBalanceHistoryCursorError,
  CashBalanceHistoryQuerySchema,
} from "./cash-balance-history";

it("paginates recorded changes without unchanged checks, preserving a real zero and an unknown balance", () => {
  const observations = Array.from({ length: 24 }, (_, n) => ({
    id: `accepted-${n.toString().padStart(2, "0")}`,
    observedAt: "2026-08-01T00:00:00.000Z",
    acceptedAt: `2026-08-${(n + 1).toString().padStart(2, "0")}T00:00:00.000Z`,
    valueMinor: n < 2 ? null : Number(BigInt(Math.floor(n / 2)) * 100n),
  }));
  const recent = cashBalanceHistoryPage(observations, 5);
  expect(recent.total).toBe(12);
  expect(recent.entries).toHaveLength(5);
  expect(recent.entries[0]).toMatchObject({
    valueMinor: 1100,
    previousValueMinor: 1000,
  });
  const earlier = cashBalanceHistoryPage(
    observations,
    5,
    undefined,
    observations[20]!.id,
  );
  expect(earlier).toMatchObject({ total: 11 });
  expect(earlier.entries[0]?.valueMinor).toBe(1000);
  const first = cashBalanceHistoryPage(observations, 10);
  const last = cashBalanceHistoryPage(observations, 10, first.next!);
  expect(last).toMatchObject({ start: 10, next: null, total: 12 });
  expect(last.entries.at(-1)).toMatchObject({
    valueMinor: null,
    initial: true,
  });
  expect(
    new Set([...first.entries, ...last.entries].map((entry) => entry.id)).size,
  ).toBe(12);
  expect(
    cashBalanceHistoryPage([{ ...observations[0]!, valueMinor: 0 }], 5)
      .entries[0]?.valueMinor,
  ).toBe(0);
  expect(() =>
    cashBalanceHistoryPage(observations, 10, "not-a-cursor"),
  ).toThrow(CashBalanceHistoryCursorError);
});

it("uses all accepted ordering keys for tied dates and rejects unbounded or extra query inputs", () => {
  const base = {
    observedAt: "2026-08-01T00:00:00.000Z",
    acceptedAt: "2026-08-01T00:00:00.000Z",
  };
  const page = cashBalanceHistoryPage(
    [
      { ...base, id: "z", order: "00", valueMinor: null },
      { ...base, id: "a", order: "11", valueMinor: 123 },
    ],
    5,
  );
  expect(page.entries[0]?.valueMinor).toBe(123);
  for (const extra of [
    { limit: 1000 },
    { limit: 0 },
    { extra: "field" },
    { after: "" },
  ])
    expect(
      CashBalanceHistoryQuerySchema.safeParse({
        kind: "bank",
        id: "demo",
        ...extra,
      }).success,
    ).toBe(false);
});
