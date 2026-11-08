import {
  publicSourceStateFor,
  bindPublicSourceState,
  type PublicSourceState,
} from "./public-source-state";
import {
  CanonicalExposureSchema,
  FinancingAnnouncementFactsSchema,
  PositionExposureMappingSchema,
  type CanonicalExposure,
  type PositionExposureMapping,
} from "@keel/domain";
import {
  createInvestmentExposureView,
  InvestmentExposureViewSchema,
  type InvestmentExposureView,
} from "@keel/domain/exposure-read-model";
import {
  PrivateCompanyRoundValuationSchema,
  type PrivateCompanyRoundValuation,
} from "@keel/domain/private-position-value-estimate";
import {
  InvestmentPositionViewSchema,
  type InvestmentPositionView,
} from "@keel/domain/position-read-model";

import {
  D1InvestmentPositionViewRepository,
  type InvestmentPositionViewRepository,
} from "./position-read-model";

type HouseholdIdentity = {
  household_id: string;
};

type CanonicalExposureRow = {
  id: string;
  household_id: string;
  exposure_kind:
    "public_instrument" | "private_company" | "fund" | "unresolved";
  canonical_name: string;
  protected_identity_key: string | null;
  company_id: string | null;
  linked_company_id: string | null;
  resolution_method:
    "strong_identifier" | "reviewed_company" | "reviewed_fund" | "unresolved";
  evidence_sha256: string;
  created_at: string;
};

type PositionExposureMappingRow = {
  id: string;
  household_id: string;
  position_id: string;
  exposure_id: string;
  relationship_kind: "direct" | "look_through";
  allocation_ppm: number | null;
  status: "active" | "withdrawn";
  decision_source: "deterministic_policy" | "review";
  decision_reference: string;
  evidence_sha256: string;
  effective_at: string;
  version: number;
  supersedes_mapping_id: string | null;
  accepted_at: string;
};

type AcceptedFinancingValuationRow = {
  company_id: string;
  evidence_event_id: string;
  effective_date: string;
  source_title: string;
  source_url: string;
  claim_value_json: string;
};

async function all<T>(statement: D1PreparedStatement): Promise<readonly T[]> {
  const result = await statement.all<T>();
  return result.results;
}

function canonicalExposureFrom(row: CanonicalExposureRow): CanonicalExposure {
  return CanonicalExposureSchema.parse({
    id: row.id,
    householdId: row.household_id,
    exposureKind: row.exposure_kind,
    canonicalName: row.canonical_name,
    protectedIdentityKey: row.protected_identity_key,
    companyId: row.company_id,
    resolutionMethod: row.resolution_method,
    evidenceSha256: row.evidence_sha256,
    createdAt: row.created_at,
  });
}

function mappingFrom(row: PositionExposureMappingRow): PositionExposureMapping {
  return PositionExposureMappingSchema.parse({
    id: row.id,
    householdId: row.household_id,
    positionId: row.position_id,
    exposureId: row.exposure_id,
    relationshipKind: row.relationship_kind,
    allocationPpm: row.allocation_ppm,
    status: row.status,
    decisionSource: row.decision_source,
    decisionReference: row.decision_reference,
    evidenceSha256: row.evidence_sha256,
    effectiveAt: row.effective_at,
    version: row.version,
    supersedesMappingId: row.supersedes_mapping_id,
  });
}

// A recorded same-holding choice joins source observations, not investments.
// Reuse the family's accepted allocation while displaying its latest value.
// Explicit allocation reviews take precedence over automatic source mappings;
// verified global identity beats provider fallback, then the original mapped
// identity is retained. Reviewed withdrawals remain exclusions. Corrections split the family
// again through the current source-decision graph, without rewriting mappings.
function sourceMappings(
  rows: readonly PositionExposureMappingRow[],
  state: PublicSourceState | null,
) {
  if (!state) return rows.map(mappingFrom);
  const byPosition = new Map<string, PositionExposureMappingRow[]>();
  for (const row of rows) {
    const current = byPosition.get(row.position_id) ?? [];
    current.push(row);
    byPosition.set(row.position_id, current);
  }
  const owners = new Map<
    string,
    {
      id: string;
      reviewOrder: string;
      globallyVerified: boolean;
      sourceOrder: string;
    }
  >();
  for (const position of state.positions) {
    const mappings = byPosition.get(position.id);
    if (!mappings) continue;
    const root = state.rootById.get(position.id)!;
    const reviewOrder = mappings.reduce(
      (order, row) =>
        row.decision_source === "review" &&
        `${row.accepted_at}\0${row.id}` > order
          ? `${row.accepted_at}\0${row.id}`
          : order,
      "",
    );
    const sourceOrder = `${position.observed_at}\0${position.applied_at}\0${position.application_id}`;
    const globallyVerified = mappings.some((row) =>
      row.decision_reference.startsWith("public-strong-identifier-v1:"),
    );
    const prior = owners.get(root);
    if (
      !prior ||
      reviewOrder > prior.reviewOrder ||
      (reviewOrder === prior.reviewOrder &&
        ((globallyVerified && !prior.globallyVerified) ||
          (globallyVerified === prior.globallyVerified &&
            (position.id === root ||
              (prior.id !== root && sourceOrder < prior.sourceOrder)))))
    )
      owners.set(root, {
        id: position.id,
        reviewOrder,
        globallyVerified,
        sourceOrder,
      });
  }
  const projected = rows
    .filter((row) => !state.byId.has(row.position_id))
    .map(mappingFrom);
  for (const owner of owners.values()) {
    const visible = state.visibleById.get(owner.id);
    if (!visible) continue;
    for (const mapping of byPosition.get(owner.id)!)
      projected.push(mappingFrom({ ...mapping, position_id: visible }));
  }
  return projected;
}

function acceptedFinancingValuationFrom(
  row: AcceptedFinancingValuationRow,
): PrivateCompanyRoundValuation | null {
  let parsedClaim: unknown;
  try {
    parsedClaim = JSON.parse(row.claim_value_json);
  } catch {
    return null;
  }
  if (
    parsedClaim === null ||
    typeof parsedClaim !== "object" ||
    Array.isArray(parsedClaim)
  ) {
    return null;
  }
  const parsedFacts = FinancingAnnouncementFactsSchema.safeParse(
    (parsedClaim as Record<string, unknown>).financingFacts,
  );
  if (!parsedFacts.success) {
    return null;
  }
  const facts = parsedFacts.data;
  const valuation = facts.companyValuation;
  if (
    valuation === null ||
    valuation.basis === "undisclosed" ||
    (valuation.qualifier !== "exact" &&
      valuation.qualifier !== "approximately") ||
    facts.instrument !== "equity" ||
    facts.ambiguities.length > 0
  ) {
    return null;
  }

  let postMoneyValue = BigInt(valuation.amountMinor);
  let approximate = valuation.qualifier === "approximately";
  if (valuation.basis === "pre_money") {
    const announced = facts.announcedAmount;
    if (
      announced === null ||
      announced.currency !== valuation.currency ||
      (announced.qualifier !== "exact" &&
        announced.qualifier !== "approximately")
    ) {
      return null;
    }
    postMoneyValue += BigInt(announced.amountMinor);
    approximate ||= announced.qualifier === "approximately";
  }
  const postMoneyValueMinor = Number(postMoneyValue);
  if (!Number.isSafeInteger(postMoneyValueMinor) || postMoneyValueMinor <= 0) {
    return null;
  }
  const result = PrivateCompanyRoundValuationSchema.safeParse({
    companyId: row.company_id,
    evidenceEventId: row.evidence_event_id,
    effectiveDate: row.effective_date,
    postMoneyValueMinor,
    currency: valuation.currency,
    sourceTitle: row.source_title,
    sourceUrl: row.source_url,
    approximate,
  });
  return result.success ? result.data : null;
}

function unambiguousAcceptedValuations(
  rows: readonly AcceptedFinancingValuationRow[],
): readonly PrivateCompanyRoundValuation[] {
  const grouped = new Map<string, PrivateCompanyRoundValuation[]>();
  for (const row of rows) {
    const valuation = acceptedFinancingValuationFrom(row);
    if (valuation === null) {
      continue;
    }
    const key = [
      valuation.companyId,
      valuation.effectiveDate,
      valuation.currency,
    ].join(":");
    const current = grouped.get(key) ?? [];
    current.push(valuation);
    grouped.set(key, current);
  }
  return [...grouped.values()].flatMap((valuations) => {
    if (
      new Set(valuations.map((valuation) => valuation.postMoneyValueMinor))
        .size !== 1
    ) {
      return [];
    }
    return [
      valuations.sort((left, right) =>
        left.evidenceEventId.localeCompare(right.evidenceEventId),
      )[0]!,
    ];
  });
}

export interface InvestmentExposureViewRepository {
  list(
    accessSubject: string,
    asOf?: string,
    positionView?: InvestmentPositionView,
  ): Promise<InvestmentExposureView>;
}

export class D1InvestmentExposureViewRepository implements InvestmentExposureViewRepository {
  public constructor(
    private readonly db: D1Database,
    private readonly positions: InvestmentPositionViewRepository = new D1InvestmentPositionViewRepository(
      db,
    ),
  ) {}

  public async list(
    accessSubject: string,
    asOf = new Date().toISOString(),
    suppliedPositionView?: InvestmentPositionView,
  ): Promise<InvestmentExposureView> {
    const [identity, positionView] = await Promise.all([
      this.findIdentity(accessSubject),
      suppliedPositionView === undefined
        ? this.positions.list(accessSubject, asOf)
        : Promise.resolve(
            bindPublicSourceState(
              InvestmentPositionViewSchema.parse(suppliedPositionView),
              publicSourceStateFor(suppliedPositionView),
            ),
          ),
    ]);
    return this.listForHousehold(identity.household_id, asOf, positionView);
  }

  public async listForHousehold(
    householdId: string,
    asOf: string,
    suppliedPositionView:
      InvestmentPositionView | Promise<InvestmentPositionView>,
  ): Promise<InvestmentExposureView> {
    const [
      positionViewInput,
      exposureRows,
      mappingRows,
      acceptedValuationRows,
    ] = await Promise.all([
      suppliedPositionView,
      all<CanonicalExposureRow>(
        this.db
          .prepare(
            `SELECT
               canonical_exposures.id, canonical_exposures.household_id,
               exposure_kind, canonical_name,
               protected_identity_key, canonical_exposures.company_id,
               resolution_method, evidence_sha256, created_at,
               COALESCE(redirect.company_id, link.company_id)
                 AS linked_company_id
             FROM canonical_exposures
             LEFT JOIN public_exposure_company_links link
               ON link.public_exposure_id = canonical_exposures.id
             LEFT JOIN company_redirects redirect
               ON redirect.source_company_id = link.company_id
              AND redirect.household_id = link.household_id
             WHERE canonical_exposures.household_id = ?
               AND EXISTS (
                 SELECT 1
                 FROM holding_position_exposure_mappings current_mapping
                 WHERE current_mapping.exposure_id = canonical_exposures.id
                   AND current_mapping.household_id = canonical_exposures.household_id
                   AND current_mapping.status = 'active'
                   AND NOT EXISTS (SELECT 1 FROM holding_position_link_heads link WHERE link.source_position_id=current_mapping.position_id AND link.state='linked')
                   AND NOT EXISTS (
                     SELECT 1
                     FROM holding_position_continuities continuity
                     WHERE continuity.predecessor_position_id =
                           current_mapping.position_id
                   )
                   AND NOT EXISTS (
                     SELECT 1
                     FROM holding_position_exposure_mappings later_mapping
                     WHERE later_mapping.supersedes_mapping_id =
                           current_mapping.id
                   )
               )
             ORDER BY lower(canonical_name), canonical_exposures.id`,
          )
          .bind(householdId),
      ),
      all<PositionExposureMappingRow>(
        this.db
          .prepare(
            `SELECT
               mapping.id, mapping.household_id, mapping.position_id,
               mapping.exposure_id, mapping.relationship_kind,
               mapping.allocation_ppm, mapping.status,
               mapping.decision_source, mapping.decision_reference,
               mapping.evidence_sha256, mapping.effective_at,
               mapping.version, mapping.supersedes_mapping_id,
               mapping.accepted_at
             FROM holding_position_exposure_mappings mapping
             WHERE mapping.household_id = ?
               AND NOT EXISTS (SELECT 1 FROM holding_position_link_heads link WHERE link.source_position_id=mapping.position_id AND link.state='linked')
               AND NOT EXISTS (
                 SELECT 1
                 FROM holding_position_continuities continuity
                 WHERE continuity.predecessor_position_id = mapping.position_id
               )
               AND NOT EXISTS (
                 SELECT 1
                 FROM holding_position_exposure_mappings later
                 WHERE later.supersedes_mapping_id = mapping.id
               )
             ORDER BY mapping.position_id, mapping.exposure_id`,
          )
          .bind(householdId),
      ),
      all<AcceptedFinancingValuationRow>(
        this.db
          .prepare(
            `SELECT
               observation.company_id,
               event.id AS evidence_event_id,
               event.effective_date,
               observation.source_title,
               observation.source_url,
               claim.claim_value_json
             FROM public_source_observations observation
             JOIN evidence_events event
               ON event.id = observation.evidence_event_id
              AND event.household_id = observation.household_id
             JOIN evidence_claims claim
               ON claim.evidence_event_id = event.id
              AND claim.household_id = event.household_id
              AND claim.field_path = 'company_event.financing_terms'
             WHERE observation.household_id = ?
               AND event.status = 'accepted'
             ORDER BY observation.company_id, event.effective_date,
                      event.id`,
          )
          .bind(householdId),
      ),
    ]);
    const positionView = InvestmentPositionViewSchema.parse(positionViewInput);
    const canonicalView = createInvestmentExposureView(
      positionView,
      exposureRows.map(canonicalExposureFrom),
      sourceMappings(mappingRows, publicSourceStateFor(positionViewInput)),
      unambiguousAcceptedValuations(acceptedValuationRows),
    );
    const activeExposureIds = new Set(
      canonicalView.exposures.map((group) => group.exposure.id),
    );
    const privateExposureByCompanyId = new Map(
      exposureRows.flatMap((row) =>
        row.exposure_kind === "private_company" && row.company_id !== null
          ? [[row.company_id, row.id] as const]
          : [],
      ),
    );
    return bindPublicSourceState(
      InvestmentExposureViewSchema.parse({
        ...canonicalView,
        publicCompanyLinks: exposureRows.flatMap((row) => {
          if (
            row.exposure_kind !== "public_instrument" ||
            row.linked_company_id === null
          )
            return [];
          const companyExposureId = privateExposureByCompanyId.get(
            row.linked_company_id,
          );
          return companyExposureId !== undefined &&
            activeExposureIds.has(companyExposureId)
            ? [{ publicExposureId: row.id, companyExposureId }]
            : [];
        }),
      }),
      publicSourceStateFor(positionViewInput),
    );
  }

  private async findIdentity(
    accessSubject: string,
  ): Promise<HouseholdIdentity> {
    const identity = await this.db
      .prepare(
        `SELECT household.id AS household_id
         FROM users user
         JOIN households household ON household.owner_user_id = user.id
         WHERE user.access_subject = ?
         ORDER BY household.created_at
         LIMIT 1`,
      )
      .bind(accessSubject)
      .first<HouseholdIdentity>();
    if (identity === null) {
      throw new Error("Household not found for the authenticated user.");
    }
    return identity;
  }
}
