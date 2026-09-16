import {
  CompanyAliasProposalSchema,
  CompanyAliasReceiptSchema,
  CompanyAliasReviewInputSchema,
  CompanyIdentityCatalogSchema,
  companyNameKey,
  matchingCompanies,
  suggestedCompanyGroups,
  type CompanyAliasProposal,
  type CompanyAliasPreview,
  type CompanyAliasReceipt,
  type CompanyAliasReviewInput,
  type CompanyIdentityChoice,
} from "@keel/domain/company-identity";
import {
  InvestmentCompanyReceiptSchema,
  investmentEvidenceRevision,
} from "@keel/domain/investment-review";

export const companyIdentityChoicesSql = `SELECT c.id, c.legal_name, c.website_host, c.status, e.id exposure_id,
  (SELECT json_group_array(a.alias_name) FROM company_aliases a WHERE a.household_id = c.household_id AND a.company_id = c.id) aliases_json
  FROM companies c LEFT JOIN canonical_exposures e ON e.household_id = c.household_id AND e.company_id = c.id
  WHERE c.household_id = ? AND NOT EXISTS (SELECT 1 FROM company_redirects r WHERE r.source_company_id = c.id)
  ORDER BY c.legal_name, c.id LIMIT 5001`;
export type CompanyIdentityRow = {
  id: string;
  legal_name: string;
  website_host: string | null;
  status: "active" | "exited" | "written_off";
  exposure_id: string | null;
  aliases_json: string;
};
export function identityChoice(row: CompanyIdentityRow): CompanyIdentityChoice {
  return {
    id: row.id,
    legalName: row.legal_name,
    aliases: JSON.parse(row.aliases_json) as string[],
  };
}
export async function loadCompanyIdentityChoices(
  db: D1Database,
  householdId: string,
) {
  const { results } = await db
    .prepare(companyIdentityChoicesSql)
    .bind(householdId)
    .all<CompanyIdentityRow>();
  if (
    results.length > 5000 ||
    results.reduce(
      (total, row) => total + identityChoice(row).aliases!.length,
      0,
    ) > 10000
  )
    throw new CompanyIdentityError(
      "limit",
      "This company list exceeds the supported review limit.",
    );
  return results;
}
export class CompanyIdentityError extends Error {
  constructor(
    public readonly code: "not_found" | "invalid" | "stale" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "CompanyIdentityError";
  }
}
const stale = () =>
  new CompanyIdentityError(
    "stale",
    "Company names or investment mappings changed. Review the updated grouping before saving.",
  );
const invalid = (message: string) =>
  new CompanyIdentityError("invalid", message);
type Identity = { household_id: string; user_id: string };
type Mapping = {
  id: string;
  position_id: string;
  label: string;
  exposure_id: string;
  company_id: string;
  relationship_kind: string;
  allocation_ppm: number | null;
  status: "active" | "withdrawn";
  version: number;
  effective_at: string;
  receipt_json: string | null;
};
export const companyAliasMappingsSql = `SELECT m.id, m.position_id, p.legal_vehicle_name label, m.exposure_id, e.company_id,
  m.relationship_kind, m.allocation_ppm, m.status, m.version, m.effective_at,
  COALESCE(alias_receipt.receipt_json, review.receipt_json, json_extract(automatic.details_json, '$.company.receipt')) receipt_json
  FROM canonical_exposures e
  JOIN holding_position_exposure_mappings root INDEXED BY company_alias_mapping_roots_idx ON root.household_id = e.household_id AND root.exposure_id = e.id AND root.supersedes_mapping_id IS NULL
  JOIN holding_position_exposure_mappings m ON m.id = (SELECT id FROM holding_position_exposure_mappings WHERE position_id = root.position_id AND exposure_id = root.exposure_id ORDER BY version DESC LIMIT 1)
  JOIN holding_positions p ON p.id = m.position_id
  LEFT JOIN investment_company_reviews review ON review.id = (SELECT id FROM investment_company_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
  LEFT JOIN automatic_investment_reviews automatic ON automatic.id = (SELECT id FROM automatic_investment_reviews WHERE household_id = p.household_id AND position_id = p.id ORDER BY version DESC LIMIT 1)
  LEFT JOIN company_alias_current_receipts alias_receipt ON alias_receipt.position_id = p.id
  WHERE e.household_id = ? AND e.company_id IN (?, ?) ORDER BY m.id LIMIT 10001`;
export interface CompanyIdentityRepository {
  getCatalog(
    subject: string,
  ): Promise<ReturnType<typeof CompanyIdentityCatalogSchema.parse>>;
  preview(
    subject: string,
    input: CompanyAliasProposal,
  ): Promise<CompanyAliasPreview>;
  review(
    subject: string,
    input: CompanyAliasReviewInput,
  ): Promise<CompanyAliasReceipt>;
}
export class D1CompanyIdentityRepository implements CompanyIdentityRepository {
  constructor(private readonly db: D1Database) {}
  private async identity(subject: string): Promise<Identity> {
    const identity = await this.db
      .prepare(
        `SELECT h.id household_id, u.id user_id FROM users u JOIN households h ON h.owner_user_id = u.id WHERE u.access_subject = ? ORDER BY h.created_at LIMIT 1`,
      )
      .bind(subject)
      .first<Identity>();
    if (identity === null)
      throw new CompanyIdentityError("not_found", "Company list not found.");
    return identity;
  }
  private async catalog(identity: Identity) {
    const [rows, revision] = await Promise.all([
      loadCompanyIdentityChoices(this.db, identity.household_id),
      this.db
        .prepare(
          `SELECT revision FROM company_identity_revisions WHERE household_id = ?`,
        )
        .bind(identity.household_id)
        .first<{ revision: number }>(),
    ]);
    const companies = rows.map(identityChoice);
    return {
      rows,
      catalog: CompanyIdentityCatalogSchema.parse({
        revision: revision?.revision ?? 0,
        companies,
        suggestedGroups: suggestedCompanyGroups(companies),
      }),
    };
  }
  async getCatalog(subject: string) {
    return (await this.catalog(await this.identity(subject))).catalog;
  }
  private async plan(identity: Identity, rawInput: CompanyAliasProposal) {
    const input = CompanyAliasProposalSchema.parse(rawInput);
    const { rows, catalog } = await this.catalog(identity);
    const company = rows.find((row) => row.id === input.companyId);
    const source = rows.find((row) => row.id === input.sourceCompanyId);
    if (!company || (input.sourceCompanyId !== null && !source))
      throw invalid("Choose a current company from this household.");
    if (input.companyId === input.sourceCompanyId)
      throw invalid("Choose a different company to group this name under.");
    if (
      source &&
      companyNameKey(source.legal_name) !== companyNameKey(input.aliasName)
    )
      throw invalid("Use the saved company's name for this grouping.");
    const matches = matchingCompanies(catalog.companies, input.aliasName);
    if (
      matches.some(
        (match) => match.id !== company.id && match.id !== source?.id,
      )
    )
      throw invalid(
        "This name already belongs to another company. Review that company first.",
      );
    if (!source && matches.some((match) => match.id === company.id))
      throw invalid("This name already maps to the selected company.");
    const mappings = (
      await this.db
        .prepare(companyAliasMappingsSql)
        .bind(identity.household_id, company.id, source?.id ?? null)
        .all<Mapping>()
    ).results;
    if (mappings.length > 10000)
      throw new CompanyIdentityError(
        "limit",
        "This grouping exceeds the supported mapping limit.",
      );
    const affected = mappings.filter(
      (mapping) =>
        mapping.company_id === source?.id && mapping.status === "active",
    );
    if (affected.length > 500)
      throw new CompanyIdentityError(
        "limit",
        "Review at most 500 affected investments in one company grouping.",
      );
    const preview = {
      ...input,
      revision: await investmentEvidenceRevision({
        input,
        revision: catalog.revision,
        mappingIds: mappings.map((m) => m.id),
      }),
      companyName: company.legal_name,
      sourceCompanyName: source?.legal_name ?? null,
      aliases: [
        ...new Set([
          input.aliasName,
          ...(source ? identityChoice(source).aliases! : []),
        ]),
      ],
      positions: affected.map((m) => ({ id: m.position_id, label: m.label })),
    };
    return {
      preview,
      company,
      source,
      mappings,
      affected,
      catalogRevision: catalog.revision,
    };
  }
  async preview(subject: string, input: CompanyAliasProposal) {
    return (await this.plan(await this.identity(subject), input)).preview;
  }
  private async retry(
    identity: Identity,
    input: CompanyAliasReviewInput,
    hash: string,
  ) {
    const row = await this.db
      .prepare(
        `SELECT request_sha256, receipt_json FROM company_alias_reviews WHERE household_id = ? AND request_id = ?`,
      )
      .bind(identity.household_id, input.requestId)
      .first<{ request_sha256: string; receipt_json: string }>();
    if (row && row.request_sha256 !== hash) throw stale();
    return row
      ? CompanyAliasReceiptSchema.parse(JSON.parse(row.receipt_json))
      : null;
  }
  async review(
    subject: string,
    rawInput: CompanyAliasReviewInput,
  ): Promise<CompanyAliasReceipt> {
    const input = CompanyAliasReviewInputSchema.parse(rawInput);
    const identity = await this.identity(subject);
    const hash = await investmentEvidenceRevision(input);
    const retry = await this.retry(identity, input, hash);
    if (retry) return retry;
    const plan = await this.plan(
      identity,
      CompanyAliasProposalSchema.parse({
        companyId: input.companyId,
        aliasName: input.aliasName,
        sourceCompanyId: input.sourceCompanyId,
      }),
    );
    if (input.expectedRevision !== plan.preview.revision) throw stale();
    const recordedAt = new Date().toISOString();
    const receipt = CompanyAliasReceiptSchema.parse({
      ...plan.preview,
      id: crypto.randomUUID(),
      requestId: input.requestId,
      reason: input.reason,
      recordedAt,
    });
    const exposureId = plan.company.exposure_id ?? crypto.randomUUID();
    const withdrawals: unknown[] = [];
    const additions: unknown[] = [];
    const positionReceipts: {
      positionId: string;
      mappingId: string;
      receipt: ReturnType<typeof InvestmentCompanyReceiptSchema.parse>;
    }[] = [];
    for (const mapping of plan.affected) {
      const target = plan.mappings.find(
        (m) =>
          m.position_id === mapping.position_id &&
          m.company_id === plan.company.id,
      );
      const row = (
        prior: Mapping | undefined,
        active: boolean,
        id: string,
      ) => ({
        id,
        householdId: identity.household_id,
        positionId: mapping.position_id,
        exposureId: active ? exposureId : mapping.exposure_id,
        relationshipKind:
          active && target?.status === "active"
            ? target.relationship_kind
            : mapping.relationship_kind,
        allocationPpm: !active
          ? null
          : target?.status === "active"
            ? mapping.allocation_ppm === null || target.allocation_ppm === null
              ? null
              : mapping.allocation_ppm + target.allocation_ppm
            : mapping.allocation_ppm,
        status: active ? "active" : "withdrawn",
        reference: receipt.id,
        evidence: hash,
        effectiveAt:
          prior && prior.effective_at > recordedAt
            ? prior.effective_at
            : recordedAt,
        version: (prior?.version ?? 0) + 1,
        priorId: prior?.id ?? null,
      });
      const mappingId = crypto.randomUUID();
      withdrawals.push(row(mapping, false, crypto.randomUUID()));
      additions.push(row(target, true, mappingId));
      const latestReceipt =
        mapping.receipt_json === null
          ? null
          : InvestmentCompanyReceiptSchema.parse(
              JSON.parse(mapping.receipt_json),
            );
      // A position can hold multiple companies. Keep only the evidence for the
      // company being regrouped; another company's receipt stays in history.
      const priorReceipt =
        latestReceipt?.companyId === mapping.company_id ? latestReceipt : null;
      positionReceipts.push({
        positionId: mapping.position_id,
        mappingId,
        receipt: InvestmentCompanyReceiptSchema.parse({
          ...(priorReceipt ?? {}),
          requestId: input.requestId,
          positionId: mapping.position_id,
          expectedSnapshotId: priorReceipt?.expectedSnapshotId ?? null,
          expectedEvidenceRevision:
            priorReceipt?.expectedEvidenceRevision ?? hash,
          expectedMappingIds: plan.mappings
            .filter((m) => m.position_id === mapping.position_id)
            .map((m) => m.id),
          company: { mode: "existing", companyId: plan.company.id },
          companyId: plan.company.id,
          companyName: plan.company.legal_name,
          mappingId,
          basis: priorReceipt?.citation ? "document_link" : "user_confirmed",
          citation: priorReceipt?.citation ?? null,
          sourceDocument: priorReceipt?.sourceDocument ?? null,
          reason: input.reason,
          recordedAt,
          decisionSource: "review",
          companyAliasReviewId: receipt.id,
        }),
      });
    }
    if (
      [receipt, positionReceipts].some(
        (value) =>
          new TextEncoder().encode(JSON.stringify(value)).length > 1_500_000,
      )
    )
      throw new CompanyIdentityError(
        "limit",
        "The supporting evidence is too large for one company grouping. Review the affected investments individually.",
      );
    const statements = [
      this.db
        .prepare(
          `INSERT INTO company_alias_reviews (id, household_id, request_id, request_sha256, expected_revision, company_id, source_company_id, alias_name, alias_key, receipt_json, guard_json, position_receipts_json, reviewer_user_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          receipt.id,
          identity.household_id,
          input.requestId,
          hash,
          plan.catalogRevision,
          input.companyId,
          input.sourceCompanyId,
          input.aliasName,
          companyNameKey(input.aliasName),
          JSON.stringify(receipt),
          JSON.stringify({ mappingIds: plan.mappings.map((m) => m.id) }),
          JSON.stringify(positionReceipts),
          identity.user_id,
          recordedAt,
        ),
    ];
    if (plan.affected.length && plan.company.exposure_id === null)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO canonical_exposures (id, household_id, exposure_kind, canonical_name, protected_identity_key, company_id, resolution_method, evidence_sha256, created_by_user_id, created_at, immutable) VALUES (?, ?, 'private_company', ?, NULL, ?, 'reviewed_company', ?, ?, ?, 1)`,
          )
          .bind(
            exposureId,
            identity.household_id,
            plan.company.legal_name,
            plan.company.id,
            hash,
            identity.user_id,
            recordedAt,
          ),
      );
    for (const mappings of [withdrawals, additions])
      if (mappings.length)
        statements.push(
          this.db
            .prepare(
              `INSERT INTO holding_position_exposure_mappings (id, household_id, position_id, exposure_id, relationship_kind, allocation_ppm, status, decision_source, decision_reference, evidence_sha256, effective_at, version, supersedes_mapping_id, accepted_by_user_id, accepted_at, immutable)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.householdId'), json_extract(value, '$.positionId'), json_extract(value, '$.exposureId'), json_extract(value, '$.relationshipKind'), json_extract(value, '$.allocationPpm'), json_extract(value, '$.status'), 'review', json_extract(value, '$.reference'), json_extract(value, '$.evidence'), json_extract(value, '$.effectiveAt'), json_extract(value, '$.version'), json_extract(value, '$.priorId'), ?, ?, 1 FROM json_each(?)`,
            )
            .bind(identity.user_id, recordedAt, JSON.stringify(mappings)),
        );
    if (positionReceipts.length)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO company_alias_position_receipts (position_id, mapping_id, review_id, receipt_json)
      SELECT json_extract(value, '$.positionId'), json_extract(value, '$.mappingId'), ?, json_extract(value, '$.receipt') FROM json_each(?) WHERE true
      ON CONFLICT(position_id) DO UPDATE SET mapping_id = excluded.mapping_id, review_id = excluded.review_id, receipt_json = excluded.receipt_json`,
          )
          .bind(receipt.id, JSON.stringify(positionReceipts)),
      );
    try {
      await this.db.batch(statements);
    } catch (error) {
      const completed = await this.retry(identity, input, hash);
      if (completed) return completed;
      if (
        error instanceof Error &&
        /stale|UNIQUE|alias changed|alias conflict/iu.test(error.message)
      )
        throw stale();
      throw error;
    }
    return receipt;
  }
}
