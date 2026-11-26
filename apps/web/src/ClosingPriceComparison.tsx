import type { ComponentProps } from "react";
import type { CloseProxyBasis } from "@keel/domain/market-close";
import {
  Field,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SectionHeader,
  Text,
} from "@keel/ui";
import { formatDate, formatMoney, formatSharePrice } from "./format";

type Position = {
  id: string;
  name: string;
  shares: string;
  privateClasses?: string[] | undefined;
  proxyBasis?:
    | Pick<
        Extract<CloseProxyBasis, { method: "price_change" }>,
        | "method"
        | "startMinor"
        | "sourceLabel"
        | "valueDate"
        | "startDate"
        | "startPriceMicros"
      >
    | { method: "indicative_shares" }
    | undefined;
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
  ticker,
  shareClass,
  price,
  date,
  following,
  positions,
  headingProps = {},
  choice,
  onChoiceChange,
  disabled,
}: {
  choice: "follow" | "keep";
  onChoiceChange: (choice: "follow" | "keep") => void;
  disabled: boolean;
  company: string;
  ticker: string;
  shareClass: string;
  price: string;
  date: string;
  following: boolean;
  positions: Position[];
  headingProps?: ComponentProps<typeof SectionHeader>["headingProps"];
}) {
  const hasProxy = positions.some((p) => p.proxyBasis);
  const scope = `${positions.length} ${positions.length === 1 ? "position" : "positions"}`;
  const keepLabel = following
    ? "Restore prior sources"
    : "Keep current sources";
  const indexed = positions.flatMap((p) =>
    p.proxyBasis?.method === "price_change"
      ? [{ name: p.name, basis: p.proxyBasis }]
      : [],
  );
  const anchor = indexed[0]?.basis;
  const commonAnchor =
    anchor &&
    indexed.every(
      ({ basis }) =>
        basis.startDate === anchor.startDate &&
        basis.startPriceMicros === anchor.startPriceMicros,
    );
  const indexNote = commonAnchor
    ? `${indexed.length === 1 ? indexed[0]!.name + " tracks" : "GP estimates track"} ${ticker} from its ${formatSharePrice(anchor.startPriceMicros)}/share close on ${formatDate(anchor.startDate)}. `
    : "";
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
          title="Valuation source"
          headingProps={headingProps}
        />
        <Field
          label={`Source for ${scope}`}
          className="valuation-comparison__source"
        >
          {(control) => (
            <Select
              value={choice}
              disabled={disabled}
              onValueChange={(value) => {
                if (value === "keep" || value === "follow")
                  onChoiceChange(value);
              }}
            >
              <SelectTrigger {...control}>
                <SelectValue>
                  {choice === "follow" ? `Follow ${ticker} closes` : keepLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="follow">Follow {ticker} closes</SelectItem>
                <SelectItem value="keep">{keepLabel}</SelectItem>
              </SelectContent>
            </Select>
          )}
        </Field>
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
                      : `From ${money(basis.startMinor)}`}
                    {basis.valueDate && (
                      <>
                        {" "}
                        ·{" "}
                        <time dateTime={basis.valueDate}>
                          {formatDate(basis.valueDate)}
                        </time>
                      </>
                    )}
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
      <Text as="span" variant="supporting">
        {choice === "follow"
          ? `${indexNote}Future closes update ${positions.length === 1 ? "this position" : "these positions"} automatically.`
          : `Each position uses its ${following ? "prior" : "current"} valuation source.`}
      </Text>
    </div>
  );
}
