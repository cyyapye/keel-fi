import { z } from "zod";
import {
  ManualHoldingIdentityInputSchema,
  ManualHoldingInputSchema,
  ManualHoldingOptionsSchema,
  ManualHoldingReceiptSchema,
  manualHoldingInstrumentType,
  type ManualHoldingIdentityInput,
  type ManualHoldingInput,
  type ManualHoldingOptions,
  type ManualHoldingReceipt,
} from "@keel/domain/manual-holdings";
import {
  PurchaseDetailsSchema,
  PurchaseReceiptSchema,
} from "@keel/domain/position-purchases";
import { unknownInvestmentTerms } from "@keel/domain/investment-details";

type Identity = { household_id: string; user_id: string };
type Owner = {
  id: string;
  label: string;
  version: number;
  statements: D1PreparedStatement[];
};
type Company = {
  id: string;
  name: string;
  revision: string;
  exposure_id: string | null;
};
type StoredSubmission = {
  request_hash: string;
  submission_id: string;
  position_id: string;
  snapshot_id: string;
  purchase_review_id: string;
  identity_version: number;
};
export class ManualHoldingError extends Error {
  constructor(
    public readonly code:
      "not_found" | "stale" | "conflict" | "invalid" | "limit",
    message: string,
  ) {
    super(message);
    this.name = "ManualHoldingError";
  }
}
export interface ManualHoldingRepository {
  options(subject: string): Promise<ManualHoldingOptions>;
  create(
    subject: string,
    input: ManualHoldingInput,
  ): Promise<ManualHoldingReceipt>;
  submission(
    subject: string,
    submissionId: string,
  ): Promise<ManualHoldingReceipt | null>;
  reviseIdentity(
    subject: string,
    positionId: string,
    input: ManualHoldingIdentityInput,
  ): Promise<ManualHoldingReceipt>;
}
async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function result(row: StoredSubmission): ManualHoldingReceipt {
  return ManualHoldingReceiptSchema.parse({
    submissionId: row.submission_id,
    positionId: row.position_id,
    snapshotId: row.snapshot_id,
    purchaseReceiptId: row.purchase_review_id,
    identityVersion: row.identity_version,
  });
}
const stale = () =>
  new ManualHoldingError(
    "stale",
    "The investment, owner or company changed. Reload before saving.",
  );

export class D1ManualHoldingRepository implements ManualHoldingRepository {
  constructor(
    private readonly db: D1Database,
    private readonly documents: {
      put(
        key: string,
        value: string,
        options: { httpMetadata: { contentType: string } },
      ): Promise<unknown>;
    },
  ) {}
  private async identity(subject: string): Promise<Identity> {
    const row = await this.db
      .prepare(
        "SELECT h.id household_id,u.id user_id FROM users u JOIN households h ON h.owner_user_id=u.id WHERE u.access_subject=?",
      )
      .bind(subject)
      .first<Identity>();
    if (!row)
      throw new ManualHoldingError("not_found", "Household was not found.");
    return row;
  }
  private async stored(household: string, submission: string) {
    return this.db
      .prepare(
        `SELECT s.request_hash,s.submission_id,s.position_id,s.snapshot_id,s.purchase_review_id,v.version identity_version
      FROM manual_holding_submissions s JOIN manual_holding_identity_versions v ON v.id=s.identity_version_id
      WHERE s.household_id=? AND s.submission_id=?`,
      )
      .bind(household, submission)
      .first<StoredSubmission>();
  }
  async submission(subject: string, rawId: string) {
    const submissionId = z.uuid().parse(rawId);
    const identity = await this.identity(subject);
    const row = await this.stored(identity.household_id, submissionId);
    return row ? result(row) : null;
  }
  async options(subject: string): Promise<ManualHoldingOptions> {
    const identity = await this.identity(subject);
    const [containers, entities, companies] = await this.db.batch([
      this.db
        .prepare(
          `SELECT c.id,v.display_label label,v.version FROM ownership_containers c
        JOIN investment_connections i ON i.id=c.connection_id
        JOIN investment_connection_versions origin ON origin.connection_id=i.id AND origin.version=1 AND origin.institution_key='manual'
        JOIN investment_connection_versions iv ON iv.id=(SELECT id FROM investment_connection_versions latest WHERE latest.connection_id=i.id ORDER BY version DESC LIMIT 1)
        JOIN ownership_container_versions v ON v.id=(SELECT id FROM ownership_container_versions latest WHERE latest.container_id=c.id ORDER BY version DESC LIMIT 1)
        WHERE c.household_id=? AND i.adapter_type='manual' AND iv.institution_key='manual' ORDER BY lower(v.display_label),c.id LIMIT 5001`,
        )
        .bind(identity.household_id),
      this.db
        .prepare(
          `SELECT v.legal_entity_id id,v.legal_name label,v.version FROM legal_entity_name_heads head JOIN legal_entity_versions v ON v.id=head.version_id WHERE head.household_id=? ORDER BY lower(v.legal_name),v.legal_entity_id LIMIT 5001`,
        )
        .bind(identity.household_id),
      this.db
        .prepare(
          `SELECT c.id,c.legal_name name,c.updated_at revision FROM companies c WHERE c.household_id=? AND NOT EXISTS(SELECT 1 FROM company_redirects r WHERE r.source_company_id=c.id) ORDER BY lower(c.legal_name),c.id LIMIT 5001`,
        )
        .bind(identity.household_id),
    ]);
    if (!containers || !entities || !companies)
      throw new Error("Manual entry options are incomplete.");
    if (
      [containers, entities, companies].some(
        (rows) => rows.results.length > 5000,
      )
    )
      throw new ManualHoldingError(
        "limit",
        "The owner or company list exceeds the supported 5,000-record limit.",
      );
    return ManualHoldingOptionsSchema.parse({
      householdScope: await hash(
        `manual-draft-v1:${identity.household_id}:${identity.user_id}`,
      ),
      containers: containers.results,
      legalEntities: entities.results,
      companies: companies.results,
    });
  }
  private async connection(identity: Identity, now: string) {
    const key = await hash(`manual-source-v1:${identity.household_id}`);
    const id = `manual_connection_${key}`;
    const statements = [
      this.db
        .prepare(
          `INSERT INTO investment_connections(id,household_id,adapter_type,protected_source_key,created_by_user_id,created_at,immutable)
        SELECT ?,?,'manual',?,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM investment_connections WHERE id=?)`,
        )
        .bind(id, identity.household_id, key, identity.user_id, now, id),
      this.db
        .prepare(
          `INSERT INTO investment_connection_versions(id,household_id,connection_id,version,institution_key,institution_label,lifecycle_state,credential_reference,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
        SELECT ?,?,?,1,'manual','Manual holdings','active',NULL,NULL,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM investment_connection_versions WHERE connection_id=?)`,
        )
        .bind(`${id}_v1`, identity.household_id, id, identity.user_id, now, id),
    ];
    return { id, statements };
  }
  private async owner(
    identity: Identity,
    input: ManualHoldingInput["owner"],
    submissionId: string,
    connectionId: string,
    now: string,
  ): Promise<Owner> {
    if (input.mode === "existing") {
      const found = await this.db
        .prepare(
          `SELECT c.id,v.display_label label,v.version FROM ownership_containers c
        JOIN investment_connections i ON i.id=c.connection_id
        JOIN investment_connection_versions origin ON origin.connection_id=i.id AND origin.version=1 AND origin.institution_key='manual'
        JOIN investment_connection_versions iv ON iv.id=(SELECT id FROM investment_connection_versions latest WHERE latest.connection_id=i.id ORDER BY version DESC LIMIT 1)
        JOIN ownership_container_versions v ON v.id=(SELECT id FROM ownership_container_versions latest WHERE latest.container_id=c.id ORDER BY version DESC LIMIT 1)
        WHERE c.household_id=? AND c.id=? AND c.connection_id=? AND i.adapter_type='manual' AND iv.institution_key='manual'`,
        )
        .bind(identity.household_id, input.containerId, connectionId)
        .first<{ id: string; label: string; version: number }>();
      if (!found || found.version !== input.version) throw stale();
      return { ...found, statements: [] };
    }
    let label: string;
    let kind = "other";
    if (input.mode === "entity") {
      const entity = await this.db
        .prepare(
          `SELECT v.legal_name,v.entity_type,v.version FROM legal_entity_name_heads head JOIN legal_entity_versions v ON v.id=head.version_id WHERE head.household_id=? AND head.legal_entity_id=?`,
        )
        .bind(identity.household_id, input.entityId)
        .first<{ legal_name: string; entity_type: string; version: number }>();
      if (!entity || entity.version !== input.version) throw stale();
      label = entity.legal_name;
      kind = entity.entity_type === "trust" ? "trust" : "entity";
    } else label = input.label;
    const key = await hash(
      `manual-owner-v1:${identity.household_id}:${input.mode === "entity" ? `entity:${input.entityId}` : `submission:${submissionId}`}`,
    );
    const id = `manual_container_${key}`;
    const prior = await this.db
      .prepare(
        `SELECT v.id,v.display_label label,v.version,v.container_kind,v.tax_treatment FROM ownership_container_versions v WHERE v.container_id=? ORDER BY v.version DESC LIMIT 1`,
      )
      .bind(id)
      .first<{
        id: string;
        label: string;
        version: number;
        container_kind: string;
        tax_treatment: string;
      }>();
    if (
      prior &&
      input.mode === "entity" &&
      (prior.label !== label || prior.container_kind !== kind)
    ) {
      return {
        id,
        label,
        version: prior.version + 1,
        statements: [
          this.db
            .prepare(
              `INSERT INTO ownership_container_versions(id,household_id,container_id,version,display_label,container_kind,tax_treatment,supersedes_version_id,recorded_by_user_id,recorded_at,immutable) VALUES(?,?,?,?,?,?,?,?,?,?,1)`,
            )
            .bind(
              crypto.randomUUID(),
              identity.household_id,
              id,
              prior.version + 1,
              label,
              kind,
              prior.tax_treatment,
              prior.id,
              identity.user_id,
              now,
            ),
        ],
      };
    }
    if (prior)
      return { id, label: prior.label, version: prior.version, statements: [] };
    return {
      id,
      label,
      version: 1,
      statements: [
        this.db
          .prepare(
            `INSERT INTO ownership_containers(id,household_id,connection_id,protected_account_key,created_by_user_id,created_at,immutable) SELECT ?,?,?,?,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM ownership_containers WHERE id=?)`,
          )
          .bind(
            id,
            identity.household_id,
            connectionId,
            key,
            identity.user_id,
            now,
            id,
          ),
        this.db
          .prepare(
            `INSERT INTO ownership_container_versions(id,household_id,container_id,version,display_label,container_kind,tax_treatment,supersedes_version_id,recorded_by_user_id,recorded_at,immutable)
        SELECT ?,?,?,1,?,?,'unknown',NULL,?,?,1 WHERE NOT EXISTS(SELECT 1 FROM ownership_container_versions WHERE container_id=?)`,
          )
          .bind(
            `${id}_v1`,
            identity.household_id,
            id,
            label,
            kind,
            identity.user_id,
            now,
            id,
          ),
      ],
    };
  }
  private async company(
    identity: Identity,
    input: ManualHoldingInput["company"],
  ): Promise<Company | null> {
    if (input.mode === "unassigned") return null;
    const company = await this.db
      .prepare(
        `SELECT c.id,c.legal_name name,c.updated_at revision,e.id exposure_id FROM companies c LEFT JOIN canonical_exposures e ON e.company_id=c.id WHERE c.household_id=? AND c.id=? AND NOT EXISTS(SELECT 1 FROM company_redirects r WHERE r.source_company_id=c.id)`,
      )
      .bind(identity.household_id, input.companyId)
      .first<Company>();
    if (!company || company.revision !== input.revision) throw stale();
    return company;
  }
  private async evidence(
    identity: Identity,
    input: ManualHoldingInput | ManualHoldingIdentityInput,
    positionId?: string,
  ) {
    const declaration = canonical(
      positionId ? { ...input, positionId } : input,
    );
    const requestHash = await hash(declaration);
    const old = await this.stored(identity.household_id, input.submissionId);
    if (old) {
      if (old.request_hash !== requestHash)
        throw new ManualHoldingError(
          "conflict",
          "This submission was already saved with different information. Check the saved holding before starting a new entry.",
        );
      return { old, requestHash, declaration, documentId: "", objectKey: "" };
    }
    const objectKey = `manual-holdings/${identity.household_id}/${input.submissionId}/${requestHash}.json`;
    await this.documents.put(objectKey, declaration, {
      httpMetadata: { contentType: "application/json" },
    });
    return {
      old: null,
      requestHash,
      declaration,
      documentId: `manual_document_${await hash(`${identity.household_id}:${requestHash}`)}`,
      objectKey,
    };
  }
  private document(
    identity: Identity,
    evidence: Awaited<ReturnType<D1ManualHoldingRepository["evidence"]>>,
    now: string,
  ) {
    return this.db
      .prepare(
        `INSERT INTO source_documents(id,household_id,object_key,file_name,content_type,byte_size,sha256,effective_date,retrieved_at,source_label,review_status,created_at)
      VALUES(?,?,?,'manual-holding.json','application/json',?,?,NULL,?,'Entered by you','accepted',?)`,
      )
      .bind(
        evidence.documentId,
        identity.household_id,
        evidence.objectKey,
        new TextEncoder().encode(evidence.declaration).byteLength,
        evidence.requestHash,
        now,
        now,
      );
  }
  private async mappings(
    identity: Identity,
    positionId: string,
    kind: ManualHoldingInput["kind"],
    company: Company | null,
    evidenceHash: string,
    now: string,
  ) {
    const relationship = kind === "direct" ? "direct" : "look_through";
    const allocation = kind === "fund_interest" ? null : 1_000_000;
    const current = await this.db
      .prepare(
        `SELECT m.id,m.exposure_id,m.version,m.relationship_kind,m.allocation_ppm,e.company_id FROM holding_position_exposure_heads head JOIN holding_position_exposure_mappings m ON m.id=head.mapping_id JOIN canonical_exposures e ON e.id=head.exposure_id WHERE head.position_id=? AND head.household_id=? AND head.status='active'`,
      )
      .bind(positionId, identity.household_id)
      .all<{
        id: string;
        exposure_id: string;
        version: number;
        relationship_kind: string;
        allocation_ppm: number | null;
        company_id: string | null;
      }>();
    if (
      current.results.length === 1 &&
      current.results[0]?.company_id === company?.id &&
      current.results[0]?.relationship_kind === relationship &&
      current.results[0]?.allocation_ppm === allocation
    )
      return [];
    if (current.results.length === 0 && !company) return [];
    const statements: D1PreparedStatement[] = current.results
      .filter((mapping) => mapping.company_id !== company?.id)
      .map((mapping) =>
        this.db
          .prepare(
            `INSERT INTO holding_position_exposure_mappings(id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
      SELECT ?,household_id,position_id,exposure_id,relationship_kind,NULL,'withdrawn','review',?,?,?,version+1,id,?,?,1 FROM holding_position_exposure_mappings WHERE id=?`,
          )
          .bind(
            crypto.randomUUID(),
            `manual:${evidenceHash}`,
            evidenceHash,
            now,
            identity.user_id,
            now,
            mapping.id,
          ),
      );
    if (!company) return statements;
    const exposureId =
      company.exposure_id ??
      `manual_company_${await hash(`${identity.household_id}:${company.id}`)}`;
    if (!company.exposure_id)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO canonical_exposures(id,household_id,exposure_kind,canonical_name,protected_identity_key,company_id,resolution_method,evidence_sha256,created_by_user_id,created_at,immutable)
      VALUES(?,?,'private_company',?,NULL,?,'reviewed_company',?,?,?,1)`,
          )
          .bind(
            exposureId,
            identity.household_id,
            company.name,
            company.id,
            evidenceHash,
            identity.user_id,
            now,
          ),
      );
    const prior = await this.db
      .prepare(
        `SELECT id,version FROM holding_position_exposure_mappings WHERE position_id=? AND exposure_id=? ORDER BY version DESC LIMIT 1`,
      )
      .bind(positionId, exposureId)
      .first<{ id: string; version: number }>();
    statements.push(
      this.db
        .prepare(
          `INSERT INTO holding_position_exposure_mappings(id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
      VALUES(?,?,?,?,?,?,'active','review',?,?,?,?,?,?,?,1)`,
        )
        .bind(
          crypto.randomUUID(),
          identity.household_id,
          positionId,
          exposureId,
          relationship,
          allocation,
          `manual:${evidenceHash}`,
          evidenceHash,
          now,
          (prior?.version ?? 0) + 1,
          prior?.id ?? null,
          identity.user_id,
          now,
        ),
    );
    return statements;
  }
  private async apply(
    identity: Identity,
    submissionId: string,
    requestHash: string,
    statements: D1PreparedStatement[],
  ): Promise<ManualHoldingReceipt> {
    try {
      await this.db.batch(statements);
    } catch (error) {
      const winner = await this.stored(identity.household_id, submissionId);
      if (winner) {
        if (winner.request_hash !== requestHash)
          throw new ManualHoldingError(
            "conflict",
            "This submission was saved with different information.",
          );
        return result(winner);
      }
      if (
        error instanceof Error &&
        /manual|stale|UNIQUE|constraint/iu.test(error.message)
      )
        throw stale();
      throw error;
    }
    const receipt = await this.stored(identity.household_id, submissionId);
    if (!receipt)
      throw new Error("The manual holding receipt could not be read.");
    return result(receipt);
  }
  private retainMappings(
    identity: Identity,
    positionId: string,
    kind: ManualHoldingInput["kind"],
    priorKind: ManualHoldingInput["kind"],
    evidenceHash: string,
    now: string,
  ): D1PreparedStatement {
    const relationship = kind === "direct" ? "direct" : "look_through";
    const enteredFund =
      kind === "fund_interest" && priorKind !== "fund_interest" ? 1 : 0;
    return this.db
      .prepare(
        `INSERT INTO holding_position_exposure_mappings(id,household_id,position_id,exposure_id,relationship_kind,allocation_ppm,status,decision_source,decision_reference,evidence_sha256,effective_at,version,supersedes_mapping_id,accepted_by_user_id,accepted_at,immutable)
      SELECT 'manual_mapping_'||?||'_'||ROW_NUMBER() OVER (ORDER BY m.id),m.household_id,m.position_id,m.exposure_id,?,CASE WHEN ?=1 AND m.allocation_ppm=1000000 THEN NULL ELSE m.allocation_ppm END,'active','review',?,?,?,m.version+1,m.id,?,?,1
      FROM holding_position_exposure_heads head JOIN holding_position_exposure_mappings m ON m.id=head.mapping_id
      WHERE head.household_id=? AND head.position_id=? AND head.status='active' AND (m.relationship_kind<>? OR (?=1 AND m.allocation_ppm=1000000))`,
      )
      .bind(
        evidenceHash,
        relationship,
        enteredFund,
        `manual:${evidenceHash}`,
        evidenceHash,
        now,
        identity.user_id,
        now,
        identity.household_id,
        positionId,
        relationship,
        enteredFund,
      );
  }
  async create(
    subject: string,
    raw: ManualHoldingInput,
  ): Promise<ManualHoldingReceipt> {
    const input = ManualHoldingInputSchema.parse(raw);
    const identity = await this.identity(subject);
    const today = new Date().toISOString().slice(0, 10);
    if (
      (input.investmentDate && input.investmentDate > today) ||
      (input.valuation.state === "estimated" &&
        input.valuation.effectiveDate > today)
    )
      throw new ManualHoldingError(
        "invalid",
        "Investment and valuation dates cannot be in the future.",
      );
    const evidence = await this.evidence(identity, input);
    if (evidence.old) return result(evidence.old);
    const now = new Date().toISOString();
    const connection = await this.connection(identity, now);
    const owner = await this.owner(
      identity,
      input.owner,
      input.submissionId,
      connection.id,
      now,
    );
    const company = await this.company(identity, input.company);
    const key = await hash(
      `manual-position:${identity.household_id}:${input.submissionId}`,
    );
    const positionId = `manual_position_${key}`;
    const snapshotId = `manual_snapshot_${key}`;
    const importId = `manual_import_${key}`;
    const rowId = `manual_row_${key}`;
    const decisionId = `manual_decision_${key}`;
    const reviewId = `manual_purchase_${key}`;
    const identityId = `manual_identity_${key}`;
    const details = PurchaseDetailsSchema.parse({
      investmentSnapshotId: snapshotId,
      investmentTerms: unknownInvestmentTerms(),
      cashCoversPosition: false,
      coversPosition: false,
      lots:
        input.cashPaidMinor === null && input.investmentDate === null
          ? []
          : [
              {
                id: `manual_lot_${key}`,
                purchasedOn: input.investmentDate,
                shareClass: null,
                priceMicros: null,
                referencePriceMicros: null,
                grossCashMinor: input.cashPaidMinor,
                netCapitalMinor: null,
                feePpm: null,
                feeBasis: null,
                feeLabel: null,
                remainingSharesMicros: null,
                sharesAsOf: null,
                sourceLabel: "Entered by you",
                sourceUrl: null,
                mark: null,
              },
            ],
      ...(input.valuation.state === "estimated"
        ? {
            valuation: {
              snapshotId,
              records: [
                {
                  id: "mine",
                  origin: "judgment",
                  totalMinor: input.valuation.amountMinor,
                  priceMicros: null,
                  priceDate: null,
                  effectiveDate: input.valuation.effectiveDate,
                  shareClass: null,
                  carryStatus: input.valuation.carryStatus,
                  sourceLabel: "Entered by you",
                  sourceUrl: null,
                  sourceEvidenceId: null,
                  sourcePositionId: null,
                  sourceCapturedAt: null,
                  watchEvidenceId: null,
                },
              ],
              selected: { recordId: "mine", method: "total", sharesKey: null },
            },
          }
        : {}),
    });
    const receipt = PurchaseReceiptSchema.parse({
      id: reviewId,
      positionId,
      snapshotId,
      currency: "USD",
      details,
      acceptedAt: now,
    });
    const instrument = manualHoldingInstrumentType(input.kind);
    const statements = [
      ...connection.statements,
      ...owner.statements,
      this.document(identity, evidence, now),
      this.db
        .prepare(
          "INSERT INTO holding_imports(id,household_id,source_document_id,provider,parser_schema,row_count,created_by,created_at) VALUES(?,?,?,'manual','manual_holding_v1',1,?,?)",
        )
        .bind(
          importId,
          identity.household_id,
          evidence.documentId,
          identity.user_id,
          now,
        ),
      this.db
        .prepare(
          "INSERT INTO holding_import_connections(id,household_id,import_id,connection_id,created_at,immutable) VALUES(?,?,?,?,?,1)",
        )
        .bind(
          `${importId}_connection`,
          identity.household_id,
          importId,
          connection.id,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_import_coverages(id,household_id,import_id,container_id,completeness,evidence_sha256,observed_at,created_at,immutable) VALUES(?,?,?,?,'partial',?,?,?,1)`,
        )
        .bind(
          `${importId}_coverage`,
          identity.household_id,
          importId,
          owner.id,
          evidence.requestHash,
          now,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_import_rows(id,household_id,import_id,source_row_number,position_fingerprint,snapshot_fingerprint,legal_vehicle_name,owner_label,exposure_label,provider_status,invested_on,invested_on_state,invested_minor,allocation_minor,unrealized_value_minor,unrealized_value_state,realized_value_minor,net_value_minor,net_value_state,instrument_type,currency_hint,parse_status,issue_codes_json,created_at,position_kind)
        VALUES(?,?,?,1,?,?,?,?,?,'live',?,?,?,NULL,NULL,'not_reported',NULL,NULL,'not_reported',?,'USD','ready','[]',?,?)`,
        )
        .bind(
          rowId,
          identity.household_id,
          importId,
          key,
          evidence.requestHash,
          input.name,
          owner.label,
          company?.name ?? input.name,
          input.investmentDate,
          input.investmentDate ? "reported" : "not_reported",
          input.cashPaidMinor,
          instrument,
          now,
          input.kind,
        ),
      this.db
        .prepare(
          "INSERT INTO holding_import_row_containers(id,household_id,import_row_id,container_id,created_at,immutable) VALUES(?,?,?,?,?,1)",
        )
        .bind(
          `${rowId}_container`,
          identity.household_id,
          rowId,
          owner.id,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_positions(id,household_id,provider,position_fingerprint,legal_vehicle_name,owner_label,position_kind,instrument_type,opened_on,currency,created_by,created_at) VALUES(?,?,'manual',?,?,?,?,?,?,'USD',?,?)`,
        )
        .bind(
          positionId,
          identity.household_id,
          key,
          input.name,
          owner.label,
          input.kind,
          instrument,
          input.investmentDate,
          identity.user_id,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_position_exposures(id,household_id,position_id,exposure_label,exposure_kind,company_id,created_at) VALUES(?,?,?,?,'unresolved',NULL,?)`,
        )
        .bind(
          `${positionId}_exposure`,
          identity.household_id,
          positionId,
          company?.name ?? input.name,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_import_row_decisions(id,household_id,import_row_id,reviewer_user_id,decision,matched_position_id,currency,reviewed_snapshot_fingerprint,rationale,decision_source,policy_version,reason_codes_json,decided_at) VALUES(?,?,?,?,'accepted',?,'USD',?,'User saved a manual investment.','manual',NULL,'[]',?)`,
        )
        .bind(
          decisionId,
          identity.household_id,
          rowId,
          identity.user_id,
          positionId,
          evidence.requestHash,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_position_ownerships(id,household_id,container_id,position_id,protected_position_key,association_basis,evidence_sha256,version,supersedes_ownership_id,accepted_by_user_id,accepted_at,immutable) VALUES(?,?,?,?,?,'manual',?,1,NULL,?,?,1)`,
        )
        .bind(
          `${positionId}_ownership`,
          identity.household_id,
          owner.id,
          positionId,
          key,
          evidence.requestHash,
          identity.user_id,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_position_snapshots(id,household_id,position_id,source_document_id,source_import_row_id,snapshot_fingerprint,provider_status,invested_minor,allocation_minor,unrealized_value_minor,unrealized_value_state,realized_value_minor,net_value_minor,net_value_state,instrument_type,currency,observed_at,created_at) VALUES(?,?,?,?,?,?,'live',?,NULL,NULL,'not_reported',NULL,NULL,'not_reported',?,'USD',?,?)`,
        )
        .bind(
          snapshotId,
          identity.household_id,
          positionId,
          evidence.documentId,
          rowId,
          evidence.requestHash,
          input.cashPaidMinor,
          instrument,
          now,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO holding_import_applications(id,household_id,import_row_id,decision_id,position_id,snapshot_id,outcome,applied_by,applied_at) VALUES(?,?,?,?,?,?,'created_position',?,?)`,
        )
        .bind(
          `${positionId}_application`,
          identity.household_id,
          rowId,
          decisionId,
          positionId,
          snapshotId,
          identity.user_id,
          now,
        ),
      this.db
        .prepare(
          `INSERT INTO manual_holding_identity_versions(id,household_id,position_id,container_id,legal_vehicle_name,owner_label,position_kind,opened_on,classification,version,prior_id,source_document_id,prior_company_mapping_ids_json,recorded_by_user_id,recorded_at,immutable) VALUES(?,?,?,?,?,?,?,?,'private_paper',1,NULL,?,'[]',?,?,1)`,
        )
        .bind(
          identityId,
          identity.household_id,
          positionId,
          owner.id,
          input.name,
          owner.label,
          input.kind,
          input.investmentDate,
          evidence.documentId,
          identity.user_id,
          now,
        ),
      this.db
        .prepare(
          "INSERT INTO holding_purchase_reviews(id,household_id,position_id,snapshot_id,prior_id,receipt_json,reviewer_user_id,accepted_at) VALUES(?,?,?,?,NULL,?,?,?)",
        )
        .bind(
          reviewId,
          identity.household_id,
          positionId,
          snapshotId,
          JSON.stringify(receipt),
          identity.user_id,
          now,
        ),
      ...(await this.mappings(
        identity,
        positionId,
        input.kind,
        company,
        evidence.requestHash,
        now,
      )),
      this.db
        .prepare(
          `INSERT INTO manual_holding_submissions(submission_id,household_id,request_hash,position_id,snapshot_id,purchase_review_id,identity_version_id,declaration_json,created_by_user_id,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          input.submissionId,
          identity.household_id,
          evidence.requestHash,
          positionId,
          snapshotId,
          reviewId,
          identityId,
          evidence.declaration,
          identity.user_id,
          now,
        ),
    ];
    return this.apply(
      identity,
      input.submissionId,
      evidence.requestHash,
      statements,
    );
  }
  async reviseIdentity(
    subject: string,
    positionId: string,
    raw: ManualHoldingIdentityInput,
  ): Promise<ManualHoldingReceipt> {
    const input = ManualHoldingIdentityInputSchema.parse(raw);
    const identity = await this.identity(subject);
    const evidence = await this.evidence(identity, input, positionId);
    if (evidence.old) return result(evidence.old);
    const current = await this.db
      .prepare(
        `SELECT v.id,v.version,v.position_kind,v.container_id,v.opened_on,a.snapshot_id,p.review_id purchase_review_id,o.id ownership_id,o.version ownership_version
      FROM manual_holding_identity_heads head JOIN manual_holding_identity_versions v ON v.id=head.version_id
      JOIN holding_import_application_heads a ON a.position_id=head.position_id JOIN holding_purchase_heads p ON p.position_id=head.position_id
      JOIN holding_position_ownerships o ON o.position_id=head.position_id AND NOT EXISTS(SELECT 1 FROM holding_position_ownerships next WHERE next.supersedes_ownership_id=o.id)
      WHERE head.household_id=? AND head.position_id=?`,
      )
      .bind(identity.household_id, positionId)
      .first<{
        id: string;
        version: number;
        position_kind: ManualHoldingInput["kind"];
        container_id: string;
        opened_on: string | null;
        snapshot_id: string;
        purchase_review_id: string;
        ownership_id: string;
        ownership_version: number;
      }>();
    if (!current)
      throw new ManualHoldingError(
        "not_found",
        "The manual investment was not found.",
      );
    if (
      current.version !== input.expectedVersion ||
      current.opened_on !== input.investmentDate
    )
      throw stale();
    const now = new Date().toISOString();
    const connection = await this.connection(identity, now);
    const owner = await this.owner(
      identity,
      input.owner,
      input.submissionId,
      connection.id,
      now,
    );
    const company =
      input.company.mode === "unchanged"
        ? null
        : await this.company(identity, input.company);
    const mappingStatements =
      input.company.mode === "unchanged"
        ? [
            this.retainMappings(
              identity,
              positionId,
              input.kind,
              current.position_kind,
              evidence.requestHash,
              now,
            ),
          ]
        : await this.mappings(
            identity,
            positionId,
            input.kind,
            company,
            evidence.requestHash,
            now,
          );
    const identityId = `manual_identity_${await hash(`${identity.household_id}:${input.submissionId}`)}`;
    const statements = [
      ...connection.statements,
      ...owner.statements,
      this.document(identity, evidence, now),
    ];
    if (owner.id !== current.container_id)
      statements.push(
        this.db
          .prepare(
            `INSERT INTO holding_position_ownerships(id,household_id,container_id,position_id,protected_position_key,association_basis,evidence_sha256,version,supersedes_ownership_id,accepted_by_user_id,accepted_at,immutable) VALUES(?,?,?,?,?,'manual',?,?,?,?,?,1)`,
          )
          .bind(
            crypto.randomUUID(),
            identity.household_id,
            owner.id,
            positionId,
            await hash(`${positionId}:${input.expectedVersion + 1}`),
            evidence.requestHash,
            current.ownership_version + 1,
            current.ownership_id,
            identity.user_id,
            now,
          ),
      );
    statements.push(
      this.db
        .prepare(
          `INSERT INTO manual_holding_identity_versions(id,household_id,position_id,container_id,legal_vehicle_name,owner_label,position_kind,opened_on,classification,version,prior_id,source_document_id,prior_company_mapping_ids_json,recorded_by_user_id,recorded_at,immutable) VALUES(?,?,?,?,?,?,?,?,'private_paper',?,?,?,?,?,?,1)`,
        )
        .bind(
          identityId,
          identity.household_id,
          positionId,
          owner.id,
          input.name,
          owner.label,
          input.kind,
          input.investmentDate,
          current.version + 1,
          current.id,
          evidence.documentId,
          JSON.stringify(input.expectedMappingIds),
          identity.user_id,
          now,
        ),
      ...mappingStatements,
      this.db
        .prepare(
          `INSERT INTO manual_holding_submissions(submission_id,household_id,request_hash,position_id,snapshot_id,purchase_review_id,identity_version_id,declaration_json,created_by_user_id,accepted_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          input.submissionId,
          identity.household_id,
          evidence.requestHash,
          positionId,
          current.snapshot_id,
          current.purchase_review_id,
          identityId,
          evidence.declaration,
          identity.user_id,
          now,
        ),
    );
    return this.apply(
      identity,
      input.submissionId,
      evidence.requestHash,
      statements,
    );
  }
}
