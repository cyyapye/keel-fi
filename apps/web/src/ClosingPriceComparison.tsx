import type { ComponentProps } from "react";
import type { CloseProxyBasis } from "@keel/domain/market-close";
import { SectionHeader, Text } from "@keel/ui";
import { formatDate, formatMoney } from "./format";

type Position = {
  id: string;
  name: string;
  shares: string;
  privateClasses?: string[] | undefined;
  proxyBasis?: CloseProxyBasis | undefined;
  closeMinor: number | bigint;
  priorMinor: number | bigint | null;
  priorSource: string | undefined;
};

function money(value: number | bigint | null) {
  return value === null
    ? "Unavailable"
    : formatMoney(value).replace(/\.00$/u, "");
}

export function ClosingPriceComparison({
  company,
  closeLabel = "closing price",
  ticker,
  shareClass,
  price,
  date,
  following,
  positions,
  headingProps = {},
}: {
  company: string;
  closeLabel?: "closing price" | "daily close";
  ticker: string;
  shareClass: string;
  price: string;
  date: string;
  following: boolean;
  positions: Position[];
  headingProps?: ComponentProps<typeof SectionHeader>["headingProps"];
}) {
  const hasProxy = positions.some((p) => p.proxyBasis);
  const closeTotal = positions.reduce(
    (sum, p) => sum + BigInt(p.closeMinor),
    0n,
  );
  const priorTotal = positions.reduce<bigint | null>(
    (sum, p) =>
      sum === null || p.priorMinor === null ? null : sum + BigInt(p.priorMinor),
    0n,
  );
  const closeHeader = (
    <th scope="col">
      {hasProxy ? "Estimated at close" : "Value at close"}
      <small>Before carry</small>
    </th>
  );
  const priorHeader = (
    <th scope="col">{following ? "Prior sources" : "Current sources"}</th>
  );
  return (
    <div className="valuation-comparison">
      <div className="valuation-comparison__intro">
        <SectionHeader
          eyebrow={company}
          title={
            following
              ? "Restore prior valuation sources?"
              : hasProxy
                ? `Use ${ticker} as a price proxy?`
                : `Use ${ticker}’s ${closeLabel}?`
          }
          headingProps={headingProps}
        />
        <div className="valuation-comparison__quote">
          <Text as="strong" variant="primary">
            {price}/share · <time dateTime={date}>{formatDate(date)}</time>
          </Text>
          <Text as="span" variant="supporting">
            {ticker} · {shareClass}
          </Text>
        </div>
      </div>
      <table aria-label="Position values">
        <thead>
          <tr>
            <th scope="col">Position</th>
            {following ? closeHeader : priorHeader}
            {following ? priorHeader : closeHeader}
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const prior = (
              <td>
                {money(p.priorMinor)}
                {p.priorSource && <small>{p.priorSource}</small>}
              </td>
            );
            const basis = p.proxyBasis;
            const close = (
              <td>
                {money(p.closeMinor)}
                {basis?.method === "indicative_shares" && (
                  <small>Assumes 1:1 pricing</small>
                )}
                {basis?.method === "price_change" && (
                  <small>
                    {BigInt(basis.startMinor) === BigInt(p.closeMinor)
                      ? "Starting value"
                      : `From ${money(basis.startMinor)}`}{" "}
                    ·{" "}
                    <time dateTime={basis.valueDate}>
                      {formatDate(basis.valueDate)}
                    </time>
                    {basis.sourceLabel !== p.priorSource &&
                      ` · ${basis.sourceLabel}`}
                  </small>
                )}
              </td>
            );
            return (
              <tr key={p.id}>
                <th scope="row">
                  {p.name}
                  <small>
                    {p.proxyBasis?.method === "price_change" ? (
                      `Tracks the % change in ${ticker}`
                    ) : p.proxyBasis?.method === "indicative_shares" ? (
                      `${p.shares} est. ${p.privateClasses?.join(" / ") ?? "underlying"} sh`
                    ) : (
                      <>
                        {p.shares} <span aria-hidden="true">sh</span>
                        <span className="visually-hidden">shares</span>
                      </>
                    )}
                  </small>
                </th>
                {following ? close : prior}
                {following ? prior : close}
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            <td>{money(following ? closeTotal : priorTotal)}</td>
            <td>{money(following ? priorTotal : closeTotal)}</td>
          </tr>
        </tfoot>
      </table>
      {!following && (
        <Text as="span" variant="supporting">
          {hasProxy
            ? "These SPV estimates follow future closes before shares reach your brokerage. Your GP marks stay in holding details."
            : "Future closes update these estimates automatically. GP marks stay available in holding details."}
        </Text>
      )}
    </div>
  );
}
