import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@keel/ui";
import { useMemo, useState } from "react";
import { CashHoldingsView } from "../../apps/web/src/CashHoldings";
import {
  cashBalanceHistoryPage,
  type CashBalanceHistoryQuery,
} from "../../packages/domain/src/cash-balance-history";
import type { InvestmentHoldingsView } from "../../packages/domain/src/investment-holdings-view";
import { bankBalances, observations, observedAt } from "./cash-history-fixture";

const bank = bankBalances();
const savings = bank[0]!;
const checking = bank[3]!;
const accounts = [savings, checking];
const checkingHistory = [
  {
    id: checking.id,
    acceptedAt: checking.acceptedAt,
    observedAt: checking.observedAt,
    valueMinor: checking.valueMinor,
  },
];
const bankOnly: InvestmentHoldingsView = {
  version: 1,
  authorizationStatus: "available",
  positionView: { asOf: observedAt, connections: [] },
  exposureView: { asOf: observedAt, exposures: [], positions: [] },
};
const examples = [
  "Recorded balances",
  "Recent history fails once",
  "Older page fails once",
  "No recorded history",
] as const;
type Example = (typeof examples)[number];
const noHoldings = new Set<string>();

function CashExample({ example }: { example: Example }) {
  const [showSmall, setShowSmall] = useState(false);
  const loadHistory = useMemo(() => {
    let failed = false;
    return async (query: CashBalanceHistoryQuery, signal?: AbortSignal) => {
      // Give the local example the same pending state as a history request.
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      signal?.throwIfAborted();
      const account = accounts.find(
        (item) => item.id === query.id && item.id === query.revision,
      );
      if (!account || query.kind !== "bank")
        throw new Error("Unknown sample account.");
      if (
        !failed &&
        ((example === "Recent history fails once" && query.limit === 5) ||
          (example === "Older page fails once" && query.after !== undefined))
      ) {
        failed = true;
        throw new Error("Sample history unavailable.");
      }
      const changes =
        account.id === savings.id ? observations : checkingHistory;
      return cashBalanceHistoryPage(
        example === "No recorded history" ? [] : changes,
        query.limit,
        query.after,
      );
    };
  }, [example]);
  return (
    <CashHoldingsView
      accounts={accounts}
      data={bankOnly}
      loadHistory={loadHistory}
      error={null}
      searchMatches={null}
      searchQuery=""
      showSmallBalances={showSmall}
      onShowSmallBalancesChange={setShowSmall}
      visibleCount={accounts.length}
      openableHoldingIds={noHoldings}
      onOpenHolding={() => {}}
      onLoadMore={() => {}}
    />
  );
}

export function CashHistoryWalkthrough() {
  const [example, setExample] = useState<Example>("Recorded balances");
  return (
    <>
      <CashExample key={example} example={example} />
      <Collapsible>
        <CollapsibleTrigger layout="inline">
          Capture controls and source <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Field label="History example">
            <Select
              value={example}
              onValueChange={(value) => {
                const selected = examples.find((item) => item === value);
                if (selected) setExample(selected);
              }}
            >
              <SelectTrigger aria-label="History example">
                <SelectValue>{example}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {examples.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <p className="catalogue-note">
            Changing the example returns to the account list. In Holdings,
            opening history reads the selected account’s recorded balances.
          </p>
          <p className="catalogue-note">
            Product reference · Holdings · CashHoldings.tsx at 7815d2cb.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </>
  );
}
