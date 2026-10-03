import type { HoldingImportStageInput } from "./holding-imports";

const nameKey = (value: string) =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();

type RenameScope = {
  rename_review_id: string;
  target_position_id: string;
  container_id: string;
  protected_position_key: string;
  source_key: string;
  legal_vehicle_name: string;
  opened_on: string;
  instrument_type: string;
  company_name: string;
  former_company_name: string;
  participation: string;
  invested_minor: number;
  allocation_minor: number;
};

/** Reuse only identities and company labels already covered by a human rename
 * decision. Provider/account/SPV/date/instrument boundaries remain distinct.
 * Unknown aliases and ambiguous matches still go through import review. */
export async function reviewedRenameScopes(
  db: D1Database,
  householdId: string,
  connectionId: string,
  input: HoldingImportStageInput,
  containersByKey: ReadonlyMap<string, { id: string }>,
) {
  const { results } = await db
    .prepare(
      `
    SELECT r.id rename_review_id,t.id target_position_id,tor.container_id,tor.protected_position_key,so.protected_position_key source_key,
      t.legal_vehicle_name,t.opened_on,ts.instrument_type,ts.invested_minor,ts.allocation_minor,r.company_name,r.former_company_name,
      COALESCE((SELECT json_extract(state_json,'$.participationStatus') FROM holding_investment_reviews WHERE household_id=t.household_id AND position_id=t.id ORDER BY version DESC LIMIT 1),
        CASE ts.provider_status WHEN 'realized' THEN 'historical' ELSE 'current' END) participation
    FROM ownership_containers container
    JOIN holding_position_ownerships tor ON tor.container_id=container.id
    JOIN holding_positions t ON t.id=tor.position_id
    JOIN holding_position_link_heads link ON link.target_position_id=t.id AND link.household_id=t.household_id AND link.state='linked'
    JOIN holding_position_link_reviews r ON r.id=link.review_id AND r.company_renamed=1
    JOIN holding_position_ownerships so ON so.position_id=link.source_position_id AND so.container_id=tor.container_id
    JOIN holding_position_snapshots ts ON ts.id=r.target_snapshot_id
    WHERE container.connection_id=? AND container.household_id=? AND t.provider=?
      AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=tor.id)
      AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=so.id)
  `,
    )
    .bind(connectionId, householdId, input.provider)
    .all<RenameScope>();
  const byScope = new Map<string, RenameScope[]>();
  const stableKey = (
    container: string,
    vehicle: string,
    date: string,
    instrument: string,
  ) => JSON.stringify([container, nameKey(vehicle), date, nameKey(instrument)]);
  for (const scope of results) {
    const key = stableKey(
      scope.container_id,
      scope.legal_vehicle_name,
      scope.opened_on,
      scope.instrument_type,
    );
    byScope.set(key, [...(byScope.get(key) ?? []), scope]);
  }
  const rowsByNumber = new Map(input.rows.map((row) => [row.rowNumber, row]));
  return input.canonicalScope.rows.map((rawScope) => {
    const scope: typeof rawScope & {
      renameReviewId?: string;
      renameTargetPositionId?: string;
    } = rawScope;
    const row = rowsByNumber.get(scope.sourceRowNumber);
    const container = containersByKey.get(scope.protectedAccountKey);
    if (!row || !container || !row.investDate || !row.dealMetadata.instrument)
      return scope;
    const candidates =
      byScope.get(
        stableKey(
          container.id,
          row.fundName,
          row.investDate,
          row.dealMetadata.instrument,
        ),
      ) ?? [];
    if (
      candidates.some(
        (c) =>
          c.protected_position_key === scope.protectedPositionKey ||
          c.source_key === scope.protectedPositionKey,
      )
    )
      return scope;
    const matches = candidates.filter(
      (c) =>
        [c.company_name, c.former_company_name].some(
          (name) => nameKey(name) === nameKey(row.companyOrFund),
        ) &&
        row.investedMinor === c.invested_minor &&
        row.dealMetadata.allocationMinor === c.allocation_minor &&
        (row.status.toLowerCase() === "realized" ? "historical" : "current") ===
          c.participation,
    );
    const keys = [...new Set(matches.map((c) => c.protected_position_key))];
    return keys.length === 1
      ? {
          ...scope,
          protectedPositionKey: keys[0]!,
          renameReviewId: matches[0]!.rename_review_id,
          renameTargetPositionId: matches[0]!.target_position_id,
        }
      : scope;
  });
}
