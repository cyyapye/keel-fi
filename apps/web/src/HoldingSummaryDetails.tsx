import type { PositionPerformance } from "@keel/domain/position-economics";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DisclosureIndicator,
  TextLink,
} from "@keel/ui";
import { formatDate } from "./format";
import { holdingPositionPath } from "./holding-position-route";

export type RelatedPosition = { id: string; label: string; entityId: string };

export function RelatedHoldingEntities({
  positions,
}: {
  positions: RelatedPosition[];
}) {
  const count = new Set(positions.map((position) => position.entityId)).size;
  if (!count) return null;
  return (
    <Collapsible className="holding-related holding-metadata">
      <CollapsibleTrigger layout="inline">
        Also held through {count} other {count === 1 ? "entity" : "entities"}{" "}
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul role="list" aria-label="Also held through">
          {positions.map((position) => (
            <li key={position.id}>
              <TextLink href={holdingPositionPath(position.id)}>
                {position.label}
              </TextLink>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function HoldingReturn({
  percent,
  performance,
  estimated,
  formatAmount,
  accessiblePercent,
  date,
}: {
  percent: string;
  performance: PositionPerformance;
  estimated: boolean;
  formatAmount: (amount: number) => string;
  accessiblePercent?: string;
  date?: string | null | undefined;
}) {
  const gain = performance.totalGainMinor;
  return (
    <p className="holding-return">
      <strong
        aria-label={`${accessiblePercent ?? `Total return ${percent}`}${estimated ? " (estimated)" : ""}`}
      >
        {percent}
      </strong>
      {gain !== null && (
        <span className="holding-return__amount">
          {" · "}
          {gain > 0 ? "+" : ""}
          {formatAmount(gain)}
        </span>
      )}
      {date && (
        <time className="holding-inline-date" dateTime={date}>
          {" · "}
          {formatDate(date)}
        </time>
      )}
    </p>
  );
}
