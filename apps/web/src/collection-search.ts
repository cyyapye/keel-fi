import type { AcceptedCashAccount } from "@keel/domain";
import type {
  InvestmentExposureGroup,
  InvestmentExposurePosition,
} from "@keel/domain/exposure-read-model";
import type { InvestmentHoldingsView } from "@keel/domain/investment-holdings-view";
import type {
  LegalEntityInventory,
  LegalEntitySourceSummary,
} from "@keel/domain/legal-entities";
import {
  matchesSearchTokens,
  normalizeSearchText,
  searchTokens,
} from "@keel/ui/text-search";

type SearchRecord = { id: string; text: string };
export const HOLDINGS_POSITION_PAGE_SIZE = 25;
type HoldingsSearchIndex = {
  accounts: readonly SearchRecord[];
  positions: readonly SearchRecord[];
  exposures: readonly { id: string; positions: readonly SearchRecord[] }[];
};

export type HoldingsSearchMatches = {
  accountIds: ReadonlySet<string>;
  positionIds: ReadonlySet<string>;
  exposurePositions: ReadonlyMap<string, ReadonlySet<string>>;
  resultLabel: string;
};

export function isCashPosition(position: InvestmentExposurePosition): boolean {
  return position.instrumentType.trim().toLowerCase() === "cash";
}

export function isCashExposure(group: InvestmentExposureGroup): boolean {
  return group.contributions.some((contribution) =>
    contribution.decisionReference.startsWith("cash-currency-v1:"),
  );
}

function prepare(values: readonly (string | null | undefined)[]): string {
  return normalizeSearchText(values.filter(Boolean).join(" "));
}

/** Cache only current projection fields, keyed by the existing record identities. */
export function buildHoldingsSearchIndex(
  data: InvestmentHoldingsView,
  accounts: readonly AcceptedCashAccount[],
): HoldingsSearchIndex {
  const owners = new Map(
    data.positionView.connections.flatMap((connection) =>
      connection.containers.flatMap((container) =>
        container.positions.map((position) => [
          position.id,
          position.ownerLabel,
        ]),
      ),
    ),
  );
  const positions = data.exposureView.positions.map((position) => ({
    id: position.id,
    text: prepare([
      position.legalVehicleName,
      position.reportedExposureName,
      position.ticker,
      position.institutionLabel,
      position.containerLabel,
      position.sourceLabel,
      owners.get(position.id),
    ]),
  }));
  const positionById = new Map(
    positions.map((position) => [position.id, position]),
  );
  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      text: prepare([account.accountLabel, account.institutionLabel]),
    })),
    positions,
    exposures: data.exposureView.exposures
      .filter((group) => !isCashExposure(group))
      .map((group) => {
        const name = normalizeSearchText(group.exposure.canonicalName);
        return {
          id: group.exposure.id,
          positions: [
            ...new Set(group.contributions.map((item) => item.positionId)),
          ].flatMap((id) => {
            const position = positionById.get(id);
            return position === undefined
              ? []
              : [{ id, text: `${name} ${position.text}` }];
          }),
        };
      }),
  };
}

export function searchHoldings(
  index: HoldingsSearchIndex,
  query: string,
): HoldingsSearchMatches | null {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return null;
  const matchedIds = (records: readonly SearchRecord[]) =>
    new Set(
      records
        .filter((record) => matchesSearchTokens(record.text, tokens))
        .map((record) => record.id),
    );
  const accountIds = matchedIds(index.accounts);
  const positionIds = matchedIds(index.positions);
  const exposurePositions = new Map<string, ReadonlySet<string>>();
  const allPositionIds = new Set(positionIds);
  for (const exposure of index.exposures) {
    const ids = matchedIds(exposure.positions);
    if (ids.size > 0) {
      exposurePositions.set(exposure.id, ids);
      for (const id of ids) allPositionIds.add(id);
    }
  }
  const counts = [
    [exposurePositions.size, "exposure"],
    [allPositionIds.size, "position"],
    [accountIds.size, "cash account"],
  ] as const;
  const resultLabel =
    counts
      .filter(([count]) => count > 0)
      .map(([count, label]) => `${count} ${label}${count === 1 ? "" : "s"}`)
      .join(" · ") || "0 results";
  return { accountIds, positionIds, exposurePositions, resultLabel };
}

function sourceFields(
  source: LegalEntitySourceSummary,
): (string | null | undefined)[] {
  return [
    source.sourceDisplayName,
    source.legalEntityNameEvidence.legalName,
    source.nameResolution?.legalName,
    source.sourceLabel,
    source.currentOwner,
  ];
}

export function legalEntitySourceKey(source: LegalEntitySourceSummary): string {
  return `${source.source.kind}:${source.source.id}`;
}

export function buildLegalEntitySearchIndex(inventory: LegalEntityInventory) {
  const entities = new Map(
    inventory.entities.map((entity) => [
      entity.id,
      prepare([
        entity.legalName,
        entity.currentOwner,
        entity.jurisdiction,
        ...entity.sources.flatMap(sourceFields),
      ]),
    ]),
  );
  const sources = new Map(
    [
      ...inventory.candidates,
      ...inventory.excludedCandidates,
      ...inventory.entities.flatMap((entity) => entity.sources),
    ].map((source) => [
      legalEntitySourceKey(source),
      prepare(sourceFields(source)),
    ]),
  );
  return { entities, sources };
}

export function searchLegalEntities(
  index: ReturnType<typeof buildLegalEntitySearchIndex> | null,
  query: string,
) {
  const tokens = searchTokens(query);
  if (tokens.length === 0 || index === null) return null;
  const matchedIds = (records: ReadonlyMap<string, string>) =>
    new Set(
      [...records]
        .filter(([, text]) => matchesSearchTokens(text, tokens))
        .map(([id]) => id),
    );
  return {
    entityIds: matchedIds(index.entities),
    sourceKeys: matchedIds(index.sources),
  };
}
