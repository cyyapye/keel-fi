import {
  formatOwnershipInterestPpm,
  LEGAL_ENTITY_EXPORT_FIELD_LABELS,
  LegalEntityExportInputSchema,
  type LegalEntityExportField,
  type LegalEntityExportInput,
  type LegalEntityInventory,
  type LegalEntityRecord,
  type LegalEntitySourceSummary,
} from "@keel/domain/legal-entities";
import { LEGAL_DOCUMENT_PROBLEM_COPY } from "@keel/domain/provider-legal-documents";

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
      return `${source.sourceLabel}: ${resolution.kind === "document_choice" ? "Reviewed name choice" : "User document-backed correction"}: ${resolution.legalName} | ${resolution.fileName}, page ${resolution.page.toString()}; SHA-256 ${resolution.sha256}; ${resolution.quote}${resolution.reason === null ? "" : `; ${resolution.reason}`} | Original reported alternatives: ${alternatives.join("; ") || "Not saved by earlier document check"}`;
    }
    const evidence = source.legalEntityNameEvidence;
    const documents = (evidence.documents ?? [])
      .map((document) =>
        document.citations !== undefined && document.citations.length > 0
          ? document.citations
              .map(
                (citation) =>
                  `${document.fileName}, page ${citation.page.toString()}; SHA-256 ${document.sha256}; ${citation.quote}`,
              )
              .join(" | ")
          : `${document.fileName}${document.page === null ? "" : `, page ${document.page.toString()}`}; SHA-256 ${document.sha256}${document.quote === null ? "" : `; ${document.quote}`}`,
      )
      .join(" | ");
    const status =
      evidence.state === "unavailable"
        ? evidence.problem === undefined
          ? "Legal name unavailable"
          : LEGAL_DOCUMENT_PROBLEM_COPY[evidence.problem]
        : evidence.sourceField;
    return `${source.sourceLabel}: ${status}${documents === "" ? "" : ` | ${documents}`}`;
  });
  return uniqueValues(values).join("; ") || "Manual record";
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
        }`,
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

function confirmedRow(entity: LegalEntityRecord): ExportRow {
  return {
    legal_name: entity.legalName,
    source_record: sourceRecords(entity.sources),
    name_evidence: nameEvidence(entity.sources),
    entity_type: entityTypeLabel(entity.entityType),
    relationship: relationshipLabel(entity.relationship),
    current_owner: entity.currentOwner ?? NOT_RECORDED,
    jurisdiction: entity.jurisdiction ?? NOT_RECORDED,
    ownership_interest:
      entity.ownershipInterestPpm === null
        ? NOT_RECORDED
        : formatOwnershipInterestPpm(entity.ownershipInterestPpm),
    interest_status: interestStatusLabel(entity.interestStatus),
    record_status: "Confirmed",
    source: sourceLabels(entity.sources),
    source_as_of: sourceDates(entity.sources, entity.recordedAt),
    missing_information: missingInformation({
      currentOwner: entity.currentOwner,
      einLastFour: entity.einLastFour,
      formedOn: entity.formedOn,
      jurisdiction: entity.jurisdiction,
      ownershipInterestPpm: entity.ownershipInterestPpm,
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
    ownership_interest: NOT_RECORDED,
    interest_status: interestStatusLabel(candidate.interestStatus),
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
        (input.includeHistorical || entity.interestStatus !== "historical"),
    )
    .map(confirmedRow);
  const candidates = input.includeNeedsReview
    ? inventory.candidates
        .filter(
          (candidate) =>
            input.includeHistorical ||
            candidate.interestStatus !== "historical",
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
  const input = LegalEntityExportInputSchema.parse(rawInput);
  const header = input.fields.map(
    (field) => LEGAL_ENTITY_EXPORT_FIELD_LABELS[field],
  );
  const rows = legalEntityExportRows(inventory, input);
  return `\uFEFF${[
    header,
    ...rows.map((row) => input.fields.map((field) => row[field])),
  ]
    .map((row) => row.map(safeCsvCell).join(","))
    .join("\r\n")}\r\n`;
}
