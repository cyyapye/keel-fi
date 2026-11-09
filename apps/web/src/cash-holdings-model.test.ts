import { expect, it } from "vitest";
import {
  cashTotal,
  foldableCashBalance,
  shouldFoldCashBalances,
  type CashBalanceDisplay,
} from "./cash-holdings-model";

const balance = (
  valueMinor: number | null,
  attention = false,
): CashBalanceDisplay => ({
  key: "synthetic",
  id: "synthetic",
  accountKey: "synthetic",
  revision: "synthetic",
  kind: "bank",
  name: "Synthetic bank cash",
  currency: "USD",
  valueMinor,
  observedAt: "2026-08-01T00:00:00.000Z",
  attention,
  retirement: false,
});
it("folds only a crowded list with five eligible small balances and keeps its total exact", () => {
  const rows = (total: number, small: number) =>
    Array.from({ length: total }, (_, i) => balance(i < small ? 101 : 10000));
  expect(shouldFoldCashBalances(rows(10, 10))).toBe(false);
  expect(shouldFoldCashBalances(rows(11, 4))).toBe(false);
  expect(shouldFoldCashBalances(rows(11, 5))).toBe(true);
  const crowded = rows(120, 119);
  crowded[0] = balance(101, true);
  crowded[1] = balance(null);
  expect(crowded.filter(foldableCashBalance)).toHaveLength(117);
  expect(cashTotal(crowded)).toBe("$219.18");
  expect(cashTotal([balance(0)])).toBe("$0.00");
  expect(cashTotal([balance(null)])).toBe("Not available");
  expect(foldableCashBalance({ ...balance(99), currency: "EUR" })).toBe(false);
});
