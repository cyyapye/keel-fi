export type PublicSourcePosition = {
  id: string;
  container_id: string;
  position_key: string;
  name: string;
  account_label: string;
  ticker: string | null;
  quantity_micros: number | null;
  value_minor: number | null;
  currency: string;
  instrument_type: string;
  snapshot_id: string;
  observed_at: string;
  applied_at: string;
  application_id: string;
  identity_kind: string | null;
  identity_key: string | null;
  review_id: string | null;
  review_decision: "same" | "separate" | "ignore" | null;
  prior_position_id: string | null;
  review_source: "manual" | "policy" | null;
  review_created_at: string | null;
};

export const PUBLIC_SOURCE_POSITIONS_SQL = `
  SELECT p.id,o.container_id,o.protected_position_key position_key,
    p.legal_vehicle_name name,r.owner_label account_label,s.ticker,
    s.quantity_micros,s.unrealized_value_minor value_minor,s.currency,s.instrument_type,
    s.id snapshot_id,s.observed_at,a.applied_at,a.application_id,
    k.identity_kind,k.identity_key,h.review_id,h.decision review_decision,
    h.prior_position_id,review.decision_source review_source,review.created_at review_created_at,
    COALESCE(v.version,0) graph_version
  FROM households household
  LEFT JOIN public_holding_source_versions v ON v.household_id=household.id
  LEFT JOIN public_holding_security_heads k ON k.household_id=household.id
    AND NOT EXISTS(SELECT 1 FROM holding_position_continuities continuity WHERE continuity.predecessor_position_id=k.position_id)
  LEFT JOIN holding_positions p ON p.id=k.position_id
  LEFT JOIN holding_position_ownerships o ON o.position_id=p.id
    AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=o.id)
  LEFT JOIN holding_import_application_heads a ON a.position_id=p.id
  LEFT JOIN holding_position_snapshots s ON s.id=a.snapshot_id
  LEFT JOIN holding_import_rows r ON r.id=s.source_import_row_id
  LEFT JOIN public_holding_source_heads h ON h.position_id=p.id
  LEFT JOIN public_holding_source_reviews review ON review.id=h.review_id
  WHERE household.id=?
  ORDER BY p.id`;

export type PublicSourceState = {
  version: number;
  positions: readonly PublicSourcePosition[];
  byId: ReadonlyMap<string, PublicSourcePosition>;
  hiddenIds: ReadonlySet<string>;
  ignoredIds: ReadonlySet<string>;
  visibleById: ReadonlyMap<string, string>;
  rootById: ReadonlyMap<string, string>;
};

/** Current heads only: receipt and snapshot history never enter this traversal. */
export async function publicSourceState(
  db: D1Database,
  householdId: string,
): Promise<PublicSourceState> {
  const result = await db
    .prepare(PUBLIC_SOURCE_POSITIONS_SQL)
    .bind(householdId)
    .all<
      | (PublicSourcePosition & { graph_version: number })
      | { id: null; graph_version: number }
    >();
  const positions = result.results.filter(
    (row): row is PublicSourcePosition & { graph_version: number } =>
      row.id !== null,
  );
  return buildPublicSourceState(
    positions,
    result.results[0]?.graph_version ?? 0,
  );
}

export function buildPublicSourceState(
  positions: readonly PublicSourcePosition[],
  version: number,
): PublicSourceState {
  const byId = new Map(positions.map((position) => [position.id, position]));
  const parents = new Map(
    positions.map((position) => [position.id, position.id]),
  );
  const root = (id: string): string => {
    let current = id;
    while (parents.get(current) !== current) {
      const parent = parents.get(current);
      if (parent === undefined) return id;
      const grandparent = parents.get(parent) ?? parent;
      parents.set(current, grandparent);
      current = grandparent;
    }
    return current;
  };
  const ignoredIds = new Set<string>();
  for (const position of positions) {
    if (position.review_decision === "ignore") ignoredIds.add(position.id);
    if (
      position.review_decision === "same" &&
      position.prior_position_id !== null &&
      byId.has(position.prior_position_id)
    ) {
      const left = root(position.id);
      const right = root(position.prior_position_id);
      if (left !== right) parents.set(left, right);
    }
  }
  const groups = new Map<string, PublicSourcePosition>();
  for (const position of positions) {
    if (ignoredIds.has(position.id)) continue;
    const key = root(position.id);
    const prior = groups.get(key);
    const order = `${position.observed_at}\0${position.applied_at}\0${position.application_id}`;
    const priorOrder = prior
      ? `${prior.observed_at}\0${prior.applied_at}\0${prior.application_id}`
      : "";
    if (!prior || order > priorOrder) groups.set(key, position);
  }
  const hiddenIds = new Set<string>();
  const visibleById = new Map<string, string>();
  for (const position of positions) {
    const visible = groups.get(root(position.id));
    if (visible) visibleById.set(position.id, visible.id);
    if (ignoredIds.has(position.id) || visible?.id !== position.id)
      hiddenIds.add(position.id);
  }
  return {
    version,
    positions,
    byId,
    hiddenIds,
    ignoredIds,
    visibleById,
    rootById: new Map(
      positions.map((position) => [position.id, root(position.id)]),
    ),
  };
}

// Per-result provenance for repository composition, never a cross-request cache.
const projectionStates = new WeakMap<object, PublicSourceState>();
export function bindPublicSourceState<T extends object>(
  view: T,
  state: PublicSourceState | null,
): T {
  if (state) projectionStates.set(view, state);
  return view;
}
export function publicSourceStateFor(view: object): PublicSourceState | null {
  return projectionStates.get(view) ?? null;
}
