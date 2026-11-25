export type PublicSourcePosition = {
  id: string;
  container_id: string;
  position_key: string;
  name: string;
  account_label: string;
  ticker: string | null;
  quantity_micros: number | null;
  value_minor: number | null;
  cost_basis_minor?: number | null;
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
  is_active?: number;
  inventory_source_at?: string | null;
  account_cash_unconfirmed?: number;
};

const CURRENT_SOURCE_SEEDS_SQL = `
  SELECT active.position_id FROM public_holding_active_positions active
  WHERE active.household_id=(SELECT household_id FROM scope)`;
const REPORT_CURRENT_SEEDS_SQL = `
  SELECT active.position_id FROM holding_import_coverages covered
  CROSS JOIN public_holding_active_positions active ON active.household_id=covered.household_id AND active.container_id=covered.container_id
  WHERE covered.import_id=(SELECT import_id FROM report_scope) AND covered.household_id=(SELECT household_id FROM scope)`;
const REPORT_SOURCE_SEEDS_SQL = `
  UNION SELECT ownership.position_id FROM holding_import_rows r INDEXED BY holding_import_rows_household_import_current
  CROSS JOIN holding_import_row_containers c ON c.import_row_id=r.id
  CROSS JOIN holding_position_ownerships ownership INDEXED BY holding_position_ownerships_household_container_idx ON ownership.household_id=r.household_id
    AND ownership.container_id=c.container_id AND ownership.protected_position_key=r.position_fingerprint
  WHERE r.import_id=(SELECT import_id FROM report_scope) AND r.household_id=(SELECT household_id FROM scope) AND r.position_kind='direct'
    AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=ownership.id)
  UNION SELECT json_extract(item.value,'$.positionId') FROM public_holding_inventories inventory,
    json_each(inventory.closed_positions_json) item
  WHERE inventory.import_id=(SELECT import_id FROM report_scope)
    AND inventory.household_id=(SELECT household_id FROM scope)`;
const REPORT_INVENTORY_DETAILS_SQL = `
  inventory_details AS (SELECT json_object(
    'sourceUpdatedAt',evidence.source_updated_at,'acceptedAt',inventory.accepted_at,'changeCount',COALESCE(inventory.change_count,0),
    'complete',json(CASE WHEN inventory.import_id IS NOT NULL AND json_array_length(inventory.container_ids_json)=(SELECT COUNT(*) FROM holding_import_coverages c WHERE c.import_id=report.id)
      AND NOT EXISTS(SELECT 1 FROM holding_import_connections link JOIN ownership_containers account ON account.household_id=report.household_id AND account.connection_id=link.connection_id
        WHERE link.import_id=report.id AND account.id NOT IN(SELECT value FROM json_each(inventory.container_ids_json))
          AND (EXISTS(SELECT 1 FROM public_holding_active_positions active WHERE active.household_id=report.household_id AND active.container_id=account.id)
            OR EXISTS(SELECT 1 FROM public_holding_account_inventory_heads head WHERE head.container_id=account.id))) THEN 'true' ELSE 'false' END),
    'returnedPositionIds',json(COALESCE(inventory.returned_position_ids_json,'[]')),
    'currentContainerIds',json((SELECT json_group_array(head.container_id) FROM public_holding_account_inventory_heads head WHERE head.inventory_id=report.id)),
    'priorQuantities',json((SELECT json_group_array(json_object('rowId',json_extract(prior.value,'$.rowId'),
      'quantityMicros',CASE WHEN json_extract(prior.value,'$.returned') THEN 0 ELSE snapshot.quantity_micros END,
      'factsUnchanged',json(CASE WHEN NOT json_extract(prior.value,'$.returned')
        AND snapshot.quantity_micros IS incoming.quantity_micros
        AND snapshot.unrealized_value_minor IS incoming.unrealized_value_minor
        AND snapshot.cost_basis_minor IS incoming.cost_basis_minor THEN 'true' ELSE 'false' END)))
      FROM json_each(inventory.prior_snapshots_json) prior JOIN holding_position_snapshots snapshot ON snapshot.id=json_extract(prior.value,'$.snapshotId')
      JOIN holding_import_rows incoming ON incoming.id=json_extract(prior.value,'$.rowId'))),
    'closedPositions',json((SELECT json_group_array(json_object(
      'positionId',snapshot.position_id,'containerId',c.container_id,
      'name',r.legal_vehicle_name,'accountLabel',r.owner_label,'ticker',snapshot.ticker,
      'instrumentType',snapshot.instrument_type,'snapshotId',snapshot.id,'observedAt',snapshot.observed_at,
      'quantityMicros',snapshot.quantity_micros,'valueMinor',snapshot.unrealized_value_minor))
      FROM json_each(inventory.closed_positions_json) closed
      JOIN holding_position_snapshots snapshot ON snapshot.id=json_extract(closed.value,'$.snapshotId')
      JOIN holding_import_rows r ON r.id=snapshot.source_import_row_id
      JOIN holding_import_row_containers c ON c.import_row_id=r.id)),
    'previousImportId',(SELECT earlier.import_id FROM holding_import_connections owner
      JOIN holding_import_connections earlier ON earlier.household_id=owner.household_id AND earlier.connection_id=owner.connection_id
      WHERE owner.import_id=report.id AND (earlier.created_at,earlier.import_id)<(owner.created_at,owner.import_id)
      ORDER BY earlier.created_at DESC,earlier.import_id DESC LIMIT 1)
    ) inventory_json FROM holding_imports report
    LEFT JOIN public_holding_inventory_evidence evidence ON evidence.import_id=report.id
    LEFT JOIN public_holding_inventories inventory ON inventory.import_id=report.id
    WHERE report.id=(SELECT import_id FROM report_scope) AND report.household_id=(SELECT household_id FROM scope))`;
const SOURCE_COMPONENT_SQL = `
  component(position_id) AS (
    SELECT position_id FROM seeds
    UNION SELECT h.prior_position_id FROM component chain JOIN public_holding_source_heads h
      ON h.position_id=chain.position_id AND h.decision='same' WHERE h.prior_position_id IS NOT NULL
    UNION SELECT h.position_id FROM component chain JOIN public_holding_source_heads h
      ON h.prior_position_id=chain.position_id AND h.decision='same' WHERE h.position_id IS NOT NULL
  )`;
const SOURCE_FIELDS_SQL = `p.id,o.container_id,o.protected_position_key position_key,
    p.legal_vehicle_name name,r.owner_label account_label,s.ticker,
    s.quantity_micros,s.unrealized_value_minor value_minor,s.cost_basis_minor,s.currency,s.instrument_type,
    s.id snapshot_id,s.observed_at,a.applied_at,a.application_id,
    k.identity_kind,k.identity_key,h.review_id,h.decision review_decision,
    h.prior_position_id,review.decision_source review_source,review.created_at review_created_at,
    CASE WHEN active.position_id IS NULL THEN 0 ELSE 1 END is_active,
    a.source_updated_at inventory_source_at,COALESCE(v.version,0) graph_version`;
const SOURCE_JOINS_SQL = `  FROM scope JOIN households household ON household.id=scope.household_id
  LEFT JOIN public_holding_source_versions v ON v.household_id=household.id
  LEFT JOIN component ON true
  LEFT JOIN public_holding_security_heads k ON k.position_id=component.position_id AND k.household_id=household.id
    AND NOT EXISTS(SELECT 1 FROM holding_position_continuities continuity WHERE continuity.predecessor_position_id=k.position_id)
  LEFT JOIN holding_positions p ON p.id=k.position_id
  LEFT JOIN public_holding_active_positions active ON active.position_id=p.id
  LEFT JOIN holding_position_ownerships o ON o.position_id=p.id
    AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships later WHERE later.supersedes_ownership_id=o.id)
  LEFT JOIN holding_import_application_heads a ON a.position_id=p.id
  LEFT JOIN holding_position_snapshots s ON s.id=a.snapshot_id
  LEFT JOIN holding_import_rows r ON r.id=s.source_import_row_id
  LEFT JOIN public_holding_source_heads h ON h.position_id=p.id
  LEFT JOIN public_holding_source_reviews review ON review.id=h.review_id`;

export const PUBLIC_SOURCE_POSITIONS_SQL = `WITH RECURSIVE scope AS MATERIALIZED (SELECT id household_id FROM households WHERE id=?),
  seeds AS (${CURRENT_SOURCE_SEEDS_SQL}),inventory_details AS(SELECT NULL inventory_json),${SOURCE_COMPONENT_SQL}
  SELECT ${SOURCE_FIELDS_SQL},NULL inventory_json,
    CASE WHEN a.source_updated_at IS NOT NULL AND a.source_updated_at>COALESCE(account_inventory.source_updated_at,'')
      AND EXISTS(SELECT 1 FROM holding_import_applications receipt
        JOIN holding_import_row_decisions choice ON choice.id=receipt.decision_id
        CROSS JOIN json_each(choice.reason_codes_json) reason
        WHERE receipt.id=a.application_id AND reason.value='account_cash_missing')
      THEN 1 ELSE 0 END account_cash_unconfirmed
  ${SOURCE_JOINS_SQL}
  LEFT JOIN public_holding_account_inventory_heads account_inventory ON account_inventory.container_id=o.container_id
  ORDER BY p.id`;
const PUBLIC_REPORT_SOURCE_POSITIONS_SQL = `WITH RECURSIVE scope AS MATERIALIZED (SELECT id household_id FROM households WHERE id=?),
  report_scope AS (SELECT ? import_id),
  seeds AS (${REPORT_CURRENT_SEEDS_SQL} ${REPORT_SOURCE_SEEDS_SQL}),${REPORT_INVENTORY_DETAILS_SQL},${SOURCE_COMPONENT_SQL} SELECT ${SOURCE_FIELDS_SQL},CASE WHEN row_number() OVER(ORDER BY p.id)=1 THEN (SELECT inventory_json FROM inventory_details) END inventory_json ${SOURCE_JOINS_SQL} ORDER BY p.id`;

export type PublicSourceState = {
  inventoryDetails?: string | null;
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
  importId?: string,
): Promise<PublicSourceState> {
  const result = await db
    .prepare(
      importId === undefined
        ? PUBLIC_SOURCE_POSITIONS_SQL
        : PUBLIC_REPORT_SOURCE_POSITIONS_SQL,
    )
    .bind(...(importId === undefined ? [householdId] : [householdId, importId]))
    .all<
      | (PublicSourcePosition & {
          graph_version: number;
          inventory_json?: string | null;
        })
      | { id: null; graph_version: number; inventory_json?: string | null }
    >();
  const positions = result.results.filter(
    (
      row,
    ): row is PublicSourcePosition & {
      graph_version: number;
      inventory_json?: string | null;
    } => row.id !== null,
  );
  return {
    ...buildPublicSourceState(positions, result.results[0]?.graph_version ?? 0),
    inventoryDetails: result.results[0]?.inventory_json ?? null,
  };
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
    if (ignoredIds.has(position.id) || position.is_active === 0) continue;
    const key = root(position.id);
    const prior = groups.get(key);
    const order = `${position.inventory_source_at ?? position.observed_at}\0${position.observed_at}\0${position.applied_at}\0${position.application_id}`;
    const priorOrder = prior
      ? `${prior.inventory_source_at ?? prior.observed_at}\0${prior.observed_at}\0${prior.applied_at}\0${prior.application_id}`
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
