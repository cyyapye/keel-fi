import {
  formatOwnershipInterestPpm,
  LEGAL_ENTITY_EXPORT_FIELD_LABELS,
  LegalEntityExportInputSchema,
  LegalEntityExportTableSchema,
  type LegalEntityExportField,
  type LegalEntityExportInput,
  type LegalEntityExportTable,
  type LegalEntityInventory,
  type LegalEntityRecord,
  type LegalEntitySourceSummary,
} from "@keel/domain/legal-entities";
import {
  LEGAL_DOCUMENT_PROBLEM_COPY,
  LEGAL_DOCUMENT_SCAN_REASON_COPY,
} from "@keel/domain/provider-legal-documents";

type ExportRow = Record<LegalEntityExportField, string>;

const NOT_RECORDED = "Not recorded";

function entityTypeLabel(entityType: LegalEntityRecord["entityType"]): string {
  return {
    llc: "LLC",
    limited_partnership: "Limited partnership",
    corporation: "Corporation",
    partnership: "Partnership",
    trust: "Trust",
    other: "Other",
  }[entityType];
}

function relationshipLabel(
  relationship: LegalEntityRecord["relationship"],
): string {
  return {
    direct_interest: "Direct interest",
    ownership_entity: "Ownership entity",
    operating_entity: "Operating entity",
    investment_vehicle: "Investment vehicle",
    other: "Other",
  }[relationship];
}

function interestStatusLabel(
  status: LegalEntityRecord["interestStatus"],
): string {
  return {
    current: "Current",
    historical: "Historical",
    unknown: "Unknown",
  }[status];
}

function exactMoney(minor: number, currency: string): string {
  const value = BigInt(minor);
  const major = value / 100n;
  const remainder = String(value % 100n).padStart(2, "0");
  return `${currency} ${major}.${remainder}`;
}

function uniqueValues(values: readonly (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => value !== null)),
  ];
}

function sourceLabels(sources: readonly LegalEntitySourceSummary[]): string {
  const labels = uniqueValues(sources.map((source) => source.sourceLabel));
  return labels.length === 0 ? "Manual review" : labels.join("; ");
}

function sourceRecords(sources: readonly LegalEntitySourceSummary[]): string {
  const records = uniqueValues(
    sources.map((source) => source.sourceDisplayName),
  );
  return records.length === 0 ? NOT_RECORDED : records.join("; ");
}

function nameEvidence(sources: readonly LegalEntitySourceSummary[]): string {
  const values = sources.map((source) => {
    const resolution = source.nameResolution;
    if (resolution !== undefined) {
      const alternatives = [
        ...new Set(
          (resolution.evidence.documents ?? []).flatMap((document) =>
            (document.citations ?? []).map((citation) => citation.legalName),
          ),
        ),
      ];
      const reviewedType =
        resolution.reviewedEntityType === undefined
          ? ""
          : ` | Entity type at review: ${entityTypeLabel(resolution.reviewedEntityType)} (user classification)`;
      const ownershipWarning =
        resolution.evidence.state === "unavailable" &&
        resolution.evidence.problem === "other_structure"
          ? " | Compartment structure; direct ownership is not confirmed"
          : "";
      return `${source.sourceLabel}: ${resolution.kind === "document_choice" ? "Reviewed name choice" : resolution.kind === "document_structure" ? "Reviewed structure, not confirmed direct LLC ownership" : resolution.kind === "document_entry" ? "User-entered name from agreement" : "User document-backed correction"}: ${resolution.legalName} | ${resolution.fileName}, page ${resolution.page.toString()}; SHA-256 ${resolution.sha256}${resolution.quote === null ? "" : `; ${resolution.quote}`}${resolution.reason === null ? "" : `; ${resolution.reason}`}${reviewedType}${ownershipWarning} | Original reported alternatives: ${alternatives.join("; ") || "Not saved by earlier document check"}${structureEvidence(resolution.evidence.documents ?? [])}`;
    }
    const evidence = source.legalEntityNameEvidence;
    const documents = (evidence.documents ?? [])
      .map((document) => {
        const security =
          document.scan?.outcome === "blocked"
            ? `; Security check: ${document.scan.version === 2 ? document.scan.findings.map((finding) => `${LEGAL_DOCUMENT_SCAN_REASON_COPY[finding.reason].label}${finding.signature === null ? "" : ` (${finding.signature})`}`).join("; ") : "Blocked, alert reason unavailable"}; checked ${document.scan.scannedAt}`
            : "";
        return (
          (document.citations !== undefined && document.citations.length > 0
            ? document.citations
                .map(
                  (citation) =>
                    `${document.fileName}, page ${citation.page.toString()}; SHA-256 ${document.sha256}; ${citation.quote}`,
                )
                .join(" | ")
            : `${document.fileName}${document.page === null ? "" : `, page ${document.page.toString()}`}; SHA-256 ${document.sha256}${document.quote === null ? "" : `; ${document.quote}`}`) +
          security
        );
      })
      .join(" | ");
    const status =
      evidence.state === "unavailable"
        ? evidence.problem === undefined
          ? "Legal name unavailable"
          : LEGAL_DOCUMENT_PROBLEM_COPY[evidence.problem]
        : evidence.sourceField;
    return `${source.sourceLabel}: ${status}${documents === "" ? "" : ` | ${documents}`}${structureEvidence(evidence.documents ?? [])}`;
  });
  return uniqueValues(values).join("; ") || "Manual record";
}

function structureEvidence(
  documents: NonNullable<
    LegalEntitySourceSummary["legalEntityNameEvidence"]["documents"]
  >,
): string {
  return documents
    .flatMap((document) => {
      const structure = document.structure;
      if (structure === undefined) return [];
      return [
        ` | Compartment structure: ${document.fileName}, page ${structure.page}; ${structure.quote}`,
        ...structure.parties.map(
          (party) =>
            ` | ${party.role}: ${party.legalName}; page ${party.page}; ${party.quote}`,
        ),
        ...(structure.instrument === null
          ? []
          : [
              ` | Reported interest: ${structure.instrument.label}; page ${structure.instrument.page}; ${structure.instrument.quote}`,
            ]),
      ];
    })
    .join("");
}

function sourceDates(
  sources: readonly LegalEntitySourceSummary[],
  fallback: string,
): string {
  const dates = uniqueValues(sources.map((source) => source.sourceAsOf));
  return dates.length === 0 ? fallback.slice(0, 10) : dates.join("; ");
}

function openedDates(sources: readonly LegalEntitySourceSummary[]): string {
  const dates = uniqueValues(sources.map((source) => source.openedOn));
  return dates.length === 0 ? NOT_RECORDED : dates.join("; ");
}

function financialValues(
  sources: readonly LegalEntitySourceSummary[],
  field: "commitment" | "current_value" | "funded",
): string {
  const values = sources.flatMap((source) => {
    if (source.financials === null) {
      return [];
    }
    const prefix = `${source.sourceDisplayName}: `;
    if (field === "commitment") {
      if (
        source.financials.capitalBasis === "net_invested" &&
        source.financials.grossCommitmentMinor != null
      ) {
        return [
          `${prefix}${exactMoney(source.financials.grossCommitmentMinor, source.financials.currency)} (reviewed gross; imported net ${source.financials.commitmentMinor === null ? NOT_RECORDED : exactMoney(source.financials.commitmentMinor, source.financials.currency)})`,
        ];
      }
      return [
        `${prefix}${
          source.financials.commitmentMinor === null
            ? NOT_RECORDED
            : exactMoney(
                source.financials.commitmentMinor,
                source.financials.currency,
              )
        }`,
      ];
    }
    if (field === "funded") {
      return [
        `${prefix}${
          source.financials.fundedMinor === null
            ? NOT_RECORDED
            : exactMoney(
                source.financials.fundedMinor,
                source.financials.currency,
              )
        }${source.financials.capitalBasis === "net_invested" ? " (imported net of fees)" : ""}`,
      ];
    }
    const value = source.financials.currentValue;
    return [
      `${prefix}${
        value.state === "reported" && value.minor !== null
          ? exactMoney(value.minor, source.financials.currency)
          : value.state === "locked"
            ? "Locked"
            : "Not reported"
      }`,
    ];
  });
  return values.length === 0 ? NOT_RECORDED : values.join("; ");
}

function missingInformation(input: {
  currentOwner: string | null;
  einLastFour: string | null;
  formedOn: string | null;
  jurisdiction: string | null;
  ownershipInterestPpm: number | null;
  taxClassification: string | null;
  needsLegalName: boolean;
  needsClassification: boolean;
}): string {
  const missing: string[] = [];
  if (input.needsLegalName) missing.push("Legal name");
  if (input.needsClassification) missing.push("Entity classification");
  if (input.currentOwner === null) missing.push("Current titled owner");
  if (input.jurisdiction === null) missing.push("Formation jurisdiction");
  if (input.formedOn === null) missing.push("Formation date");
  if (input.einLastFour === null) missing.push("EIN last four");
  if (input.ownershipInterestPpm === null) missing.push("Ownership interest");
  if (input.taxClassification === null) missing.push("Tax classification");
  return missing.length === 0 ? "None noted" : missing.join("; ");
}

function participationLabels(
  sources: readonly LegalEntitySourceSummary[],
): string {
  return (
    sources
      .map(
        (source) =>
          `${source.sourceDisplayName}: ${source.investmentReview?.participationStatus ?? source.interestStatus}`,
      )
      .join("; ") || NOT_RECORDED
  );
}

function positionOwnership(
  sources: readonly LegalEntitySourceSummary[],
): string {
  return (
    sources
      .map((source) => {
        const observations =
          source.investmentReview?.ownershipObservations ?? [];
        const current = observations.filter(
          (item) =>
            item.sourceKind !== "k1" &&
            !observations.some(
              (later) => later.supersedesObservationId === item.id,
            ),
        );
        return `${source.sourceDisplayName} (${source.currentOwner ?? "Owner not recorded"}): ${current.length === 0 ? "Not reported" : current.map((item) => `${formatOwnershipInterestPpm(item.ownershipPpm ?? 0)} as of ${item.effectiveDate}; ${item.sourceLabel}`).join(" | ")}`;
      })
      .join("; ") || NOT_RECORDED
  );
}

function investmentExportFields(
  sources: readonly LegalEntitySourceSummary[],
): Pick<
  ExportRow,
  | "underlying_company"
  | "company_evidence"
  | "ownership_evidence"
  | "fee_and_carry"
> {
  const company = sources.map(
    (source) =>
      `${source.sourceDisplayName}: ${source.companyReview?.companyName ?? "Not confirmed"}`,
  );
  const companyEvidence = sources.flatMap((source) => {
    const receipt = source.companyReview;
    if (receipt == null) return [];
    return [
      `${source.sourceDisplayName}: ${receipt.basis === "user_confirmed" ? "User confirmation" : "Document review"}; ${receipt.recordedAt}${receipt.citation === null ? "" : `; ${receipt.sourceDocument?.fileName ?? receipt.citation.documentId}, page ${receipt.citation.page}; SHA-256 ${receipt.citation.sha256}; ${receipt.citation.quote}; extractor ${receipt.sourceDocument?.extractorVersion ?? "not recorded"}`}`,
    ];
  });
  const ownership = sources.flatMap((source) => {
    const observations = source.investmentReview?.ownershipObservations ?? [];
    return observations.map(
      (item) =>
        `${source.sourceDisplayName} (${source.currentOwner ?? "Owner not recorded"}): ${item.sourceKind === "k1" ? `K-1 ${item.taxYear}; profit beginning ${share(item.profitBeginningPpm)}, ending ${share(item.profitEndingPpm)}; loss beginning ${share(item.lossBeginningPpm)}, ending ${share(item.lossEndingPpm)}; capital beginning ${share(item.capitalBeginningPpm)}, ending ${share(item.capitalEndingPpm)}` : `Ownership ${share(item.ownershipPpm)}; effective ${item.effectiveDate}`}; ${item.sourceLabel}; ${item.evidenceBasis === "user_reported" ? "User reported, document not attached" : `Document ${item.documentId}, page ${item.page}; SHA-256 ${item.documentSha256}`}; recorded ${item.recordedAt}${item.supersedesObservationId === null ? "" : `; amends ${item.supersedesObservationId}`}${observations.some((later) => later.supersedesObservationId === item.id) ? "; superseded" : ""}`,
    );
  });
  const terms = sources.map(
    (source) =>
      `${source.sourceDisplayName}: ${source.financials?.annualAdminFeePpm == null ? "Fee not reviewed" : `${share(source.financials.annualAdminFeePpm)} annual admin fee for ${source.financials.adminFeeYears} years`}${source.financials?.setupFeePpm == null ? "" : `; setup fee ${share(source.financials.setupFeePpm)}`}; carry ${share(source.financials?.carryPpm ?? null)}`,
  );
  return {
    underlying_company: company.join("; ") || NOT_RECORDED,
    company_evidence: companyEvidence.join("; ") || NOT_RECORDED,
    ownership_evidence: ownership.join("; ") || "Not reported yet",
    fee_and_carry: terms.join("; ") || NOT_RECORDED,
  };
}
function share(value: number | null): string {
  return value === null ? "Not reported" : formatOwnershipInterestPpm(value);
}

function confirmedRow(entity: LegalEntityRecord): ExportRow {
  const positionSources = entity.sources.filter(
    (source) => source.source.kind === "holding_position",
  );
  const owners = uniqueValues(
    positionSources.map((source) => source.currentOwner),
  );
  const currentOwner = owners.join("; ") || entity.currentOwner;
  const legacyOwner =
    entity.currentOwner !== null &&
    owners.length > 0 &&
    !owners.includes(entity.currentOwner)
      ? `; Earlier entity-level owner: ${entity.currentOwner}`
      : "";
  const legacyOwnership =
    entity.ownershipInterestPpm === null
      ? null
      : formatOwnershipInterestPpm(entity.ownershipInterestPpm);
  const ownershipEvidence = investmentExportFields(entity.sources);
  if (positionSources.length > 0 && legacyOwnership !== null) {
    ownershipEvidence.ownership_evidence += `; Earlier entity-level entry: ${legacyOwnership}; not assigned to a particular investment`;
  }
  const positionOwnershipKnown =
    positionSources.length > 0 &&
    positionSources.every(
      (source) =>
        source.investmentReview?.ownershipObservations.some(
          (item) => item.sourceKind !== "k1",
        ) === true,
    );
  return {
    legal_name: entity.legalName,
    source_record: sourceRecords(entity.sources),
    name_evidence: nameEvidence(entity.sources),
    entity_type: entityTypeLabel(entity.entityType),
    relationship: relationshipLabel(entity.relationship),
    current_owner: `${currentOwner ?? NOT_RECORDED}${legacyOwner}`,
    jurisdiction: entity.jurisdiction ?? NOT_RECORDED,
    ownership_interest:
      positionSources.length > 0
        ? `${positionOwnership(positionSources)}${legacyOwnership === null ? "" : `; Earlier entity-level entry: ${legacyOwnership} (not assigned to an investment)`}`
        : entity.ownershipInterestPpm === null
          ? NOT_RECORDED
          : formatOwnershipInterestPpm(entity.ownershipInterestPpm),
    interest_status:
      positionSources.length === 0
        ? interestStatusLabel(entity.interestStatus)
        : `${participationLabels(positionSources)}${entity.interestStatus === "unknown" ? "" : `; Earlier entity-level status: ${interestStatusLabel(entity.interestStatus)}`}`,
    record_status: "Confirmed",
    source: sourceLabels(entity.sources),
    source_as_of: sourceDates(entity.sources, entity.recordedAt),
    missing_information: missingInformation({
      currentOwner,
      einLastFour: entity.einLastFour,
      formedOn: entity.formedOn,
      jurisdiction: entity.jurisdiction,
      ownershipInterestPpm: positionOwnershipKnown
        ? 0
        : entity.ownershipInterestPpm,
      taxClassification: entity.taxClassification,
      needsLegalName: false,
      needsClassification: false,
    }),
    formed_on: entity.formedOn ?? NOT_RECORDED,
    ein_last_four: entity.einLastFour ?? NOT_RECORDED,
    tax_classification: entity.taxClassification ?? NOT_RECORDED,
    opened_on: openedDates(entity.sources),
    commitment: financialValues(entity.sources, "commitment"),
    funded: financialValues(entity.sources, "funded"),
    current_value: financialValues(entity.sources, "current_value"),
    notes: entity.notes ?? NOT_RECORDED,
    ...ownershipEvidence,
  };
}

function candidateRow(candidate: LegalEntitySourceSummary): ExportRow {
  const legalName = candidate.legalEntityNameEvidence.legalName;
  const nameUnavailable = legalName === null;
  const conflicting =
    candidate.legalEntityNameEvidence.state === "unavailable" &&
    candidate.legalEntityNameEvidence.problem === "conflicting";
  return {
    legal_name: legalName ?? "",
    source_record: candidate.sourceDisplayName,
    name_evidence: nameEvidence([candidate]),
    entity_type: nameUnavailable ? "Not reported" : "Needs review",
    relationship: relationshipLabel(candidate.relationship),
    current_owner: candidate.currentOwner ?? NOT_RECORDED,
    jurisdiction: NOT_RECORDED,
    ownership_interest: positionOwnership([candidate]),
    interest_status: participationLabels([candidate]),
    record_status: conflicting
      ? "Names disagree"
      : nameUnavailable
        ? "Legal name unavailable"
        : "Needs review",
    source: candidate.sourceLabel,
    source_as_of: candidate.sourceAsOf,
    missing_information: missingInformation({
      currentOwner: candidate.currentOwner,
      einLastFour: null,
      formedOn: null,
      jurisdiction: null,
      ownershipInterestPpm: null,
      taxClassification: null,
      needsLegalName: nameUnavailable,
      needsClassification: true,
    }),
    formed_on: NOT_RECORDED,
    ein_last_four: NOT_RECORDED,
    tax_classification: NOT_RECORDED,
    opened_on: candidate.openedOn ?? NOT_RECORDED,
    commitment: financialValues([candidate], "commitment"),
    funded: financialValues([candidate], "funded"),
    current_value: financialValues([candidate], "current_value"),
    notes: NOT_RECORDED,
    ...investmentExportFields([candidate]),
  };
}

export function legalEntityExportRows(
  inventory: LegalEntityInventory,
  rawInput: LegalEntityExportInput,
): ExportRow[] {
  const input = LegalEntityExportInputSchema.parse(rawInput);
  const confirmed = inventory.entities
    .filter(
      (entity) =>
        (input.includeOtherEntityTypes || entity.entityType === "llc") &&
        (input.includeHistorical ||
          (entity.sources.some(
            (source) =>
              source.source.kind === "holding_position" &&
              source.investmentReview != null,
          )
            ? entity.sources.some(
                (source) =>
                  !["historical", "cancelled"].includes(
                    source.investmentReview?.participationStatus ??
                      source.interestStatus,
                  ),
              )
            : entity.interestStatus !== "historical")),
    )
    .map(confirmedRow);
  const candidates = input.includeNeedsReview
    ? inventory.candidates
        .filter(
          (candidate) =>
            input.includeHistorical ||
            !["historical", "cancelled"].includes(
              candidate.investmentReview?.participationStatus ??
                candidate.interestStatus,
            ),
        )
        .map(candidateRow)
    : [];
  return [...confirmed, ...candidates].sort(
    (left, right) =>
      (left.legal_name || left.source_record).localeCompare(
        right.legal_name || right.source_record,
      ) || left.record_status.localeCompare(right.record_status),
  );
}

function safeCsvCell(rawValue: string): string {
  const value = /^\s*[=+@-]/u.test(rawValue) ? `'${rawValue}` : rawValue;
  return `"${value.replaceAll('"', '""')}"`;
}

export function legalEntityExportCsv(
  inventory: LegalEntityInventory,
  rawInput: LegalEntityExportInput,
): string {
  const table = legalEntityExportTable(inventory, rawInput);
  return `\uFEFF${[table.columns, ...table.rows]
    .map((row) => row.map(safeCsvCell).join(","))
    .join("\r\n")}\r\n`;
}

export function legalEntityExportTable(
  inventory: LegalEntityInventory,
  rawInput: LegalEntityExportInput,
): LegalEntityExportTable {
  const input = LegalEntityExportInputSchema.parse(rawInput);
  const rows = legalEntityExportRows(inventory, input);
  return LegalEntityExportTableSchema.parse({
    title: `Keel legal entities · ${inventory.asOf.slice(0, 10)}`,
    columns: input.fields.map(
      (field) => LEGAL_ENTITY_EXPORT_FIELD_LABELS[field],
    ),
    rows: rows.map((row) => input.fields.map((field) => row[field])),
  });
}
