import type { ComponentProps } from "react";
import { SectionHeader, Text } from "@keel/ui";
import { formatDate, formatMoney } from "./format";

type Position = {
  id: string;
  name: string;
  shares: string;
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
      Value at close
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
            const close = <td>{money(p.closeMinor)}</td>;
            return (
              <tr key={p.id}>
                <th scope="row">
                  {p.name}
                  <small>
                    {p.shares} <span aria-hidden="true">sh</span>
                    <span className="visually-hidden">shares</span>
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
          Future closes update these estimates automatically. GP marks stay
          available in holding details.
        </Text>
      )}
    </div>
  );
}
