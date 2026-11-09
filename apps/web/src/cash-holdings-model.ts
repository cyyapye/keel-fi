import { addMinorUnits, type AcceptedCashAccount } from "@keel/domain";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import { isCashPosition } from "./collection-search";
import { formatCurrency, formatDate, formatMoney } from "./format";

export type CashBalanceDisplay = {
  key: string;
  id: string;
  accountKey: string;
  revision: string;
  historyId?: string;
  valueBasis?: string;
  reviewedValue?: boolean;
  valueDate?: string;
  kind: "bank" | "brokerage";
  name: string;
  currency: string;
  valueMinor: number | null;
  observedAt: string;
  attention: boolean;
  retirement: boolean;
};
const accountName = (institution: string, account: string) =>
  account.toLocaleLowerCase().includes(institution.toLocaleLowerCase())
    ? account
    : `${institution} · ${account}`;

export function cashBalances(
  accounts: readonly AcceptedCashAccount[],
  data: InvestmentHoldingsView,
): CashBalanceDisplay[] {
  const records = new Map(
    data.positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => [position.id, position] as const),
      ),
    ),
  );
  return [
    ...accounts.map((account): CashBalanceDisplay => ({
      key: `bank:${account.connectionId}:${account.naturalKeySha256}`,
      accountKey: `bank:${account.connectionId}:${account.naturalKeySha256}`,
      id: account.id,
      revision: account.id,
      kind: "bank",
      name: accountName(account.institutionLabel, account.accountLabel),
      currency: "USD",
      valueMinor: account.valueMinor,
      observedAt: account.observedAt,
      attention: account.valueState !== "reported",
      retirement: false,
    })),
    ...data.exposureView.positions
      .filter(isCashPosition)
      .map((position): CashBalanceDisplay => {
        const linked = records.get(position.id)?.linkedReportedValue;
        const reviewed =
          position.valueSource !== undefined &&
          position.valueSource !== "provider";
        const basis = reviewed
          ? `Reviewed value · ${position.valueSourceLabel ?? "Manual review"}`
          : linked
            ? `Linked source · ${linked.sourceLabel}`
            : null;
        return {
          key: `brokerage:${position.id}`,
          id: position.id,
          revision: linked?.snapshotId ?? position.snapshotId,
          ...(linked ? { historyId: linked.sourcePositionId } : {}),
          ...(basis ? { valueBasis: basis } : {}),
          ...(reviewed && position.valueEffectiveDate
            ? { valueDate: position.valueEffectiveDate }
            : linked
              ? { valueDate: linked.observedAt }
              : {}),
          reviewedValue: reviewed,
          accountKey: `brokerage:${position.containerId}`,
          kind: "brokerage",
          name: accountName(position.institutionLabel, position.containerLabel),
          currency: position.currency,
          valueMinor:
            position.valueState === "reported" ? position.valueMinor : null,
          observedAt: reviewed
            ? (position.valueEffectiveDate ?? position.observedAt)
            : (linked?.observedAt ?? position.observedAt),
          attention:
            position.sourceFreshness === "stale" ||
            position.valueState !== "reported" ||
            basis !== null,
          retirement: ["ira", "retirement"].includes(position.containerKind),
        };
      }),
  ];
}
export const cashAmount = (minor: number | null, currency: string) =>
  minor === null
    ? "Unavailable"
    : currency === "USD"
      ? formatMoney(minor)
      : formatCurrency(minor, currency);
export function cashBalanceDetail(row: CashBalanceDisplay) {
  if (row.valueMinor === null)
    return `Balance unavailable · Excluded from total · ${row.currency}`;
  if (row.valueBasis)
    return `${row.valueBasis}${row.valueDate ? ` · As of ${formatDate(row.valueDate)}` : ""} · ${row.currency}`;
  return `${row.attention ? "Last reported" : "Reported"} ${formatDate(row.observedAt)}${row.attention ? " · Still counted" : ""} · ${row.currency}`;
}
export const foldableCashBalance = (row: CashBalanceDisplay) =>
  row.currency === "USD" &&
  row.valueMinor !== null &&
  row.valueMinor < 10_000 &&
  !row.attention;
export const shouldFoldCashBalances = (rows: readonly CashBalanceDisplay[]) =>
  rows.length > 10 && rows.filter(foldableCashBalance).length >= 5;
export const cashAccountCount = (rows: readonly CashBalanceDisplay[]) =>
  new Set(rows.map((row) => row.accountKey)).size;
export function cashTotal(rows: readonly CashBalanceDisplay[]) {
  const currencies = new Map<string, number>();
  for (const row of rows)
    if (row.valueMinor !== null)
      currencies.set(
        row.currency,
        addMinorUnits(currencies.get(row.currency) ?? 0, row.valueMinor),
      );
  return currencies.size
    ? [...currencies]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, minor]) => cashAmount(minor, currency))
        .join(" · ")
    : "Not available";
}
