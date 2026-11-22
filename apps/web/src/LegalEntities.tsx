import { legalReviewIssues } from "@keel/domain/automatic-investment-review";
import { PositionLinksEditor } from "./PositionLinksEditor";
import { PublicCompanyLinkEditor } from "./PublicCompanyLinkEditor";
import { HoldingSchema } from "@keel/domain";
import { CompanyNames } from "./CompanyNames";
import {
  DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
  LEGAL_ENTITY_EXPORT_FIELD_LABELS,
  LEGAL_ENTITY_EXPORT_FIELDS,
  LegalEntityProfileInputSchema,
  isHistoricalLegalEntity,
  sourceParticipationStatus,
  formatOwnershipInterestPpm,
  exactLegalEntityTypeFromName,
  legalEntityReviewKind,
  needsLegalEntityReview,
  compareLegalEntityAttention,
  ownershipPercentTextToPpm,
  type LegalEntityExportField,
  type LegalEntityInterestStatus,
  type LegalEntityInventory,
  type LegalEntityProfileInput,
  type LegalEntityRecord,
  type LegalEntityRelationship,
  type LegalEntitySourceSummary,
  type LegalEntityType,
  type LegalNameResolutionInput,
} from "@keel/domain/legal-entities";
import {
  LEGAL_DOCUMENT_PROBLEM_COPY,
  LEGAL_DOCUMENT_SCAN_REASON_COPY,
} from "@keel/domain/provider-legal-documents";
import { LegalNameResolver } from "./LegalNameResolver";
import {
  InvestmentReview,
  type ReviewDocumentRenderer,
} from "./InvestmentReview";
import {
  Checkbox,
  RadioGroup,
  CollectionFooter,
  ActionGroup,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DatePicker,
  DisclosureIndicator,
  EmptyState,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Notice,
  PageHeader,
  RecordItem,
  SearchField,
  SearchHighlight,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextLink,
  Textarea,
} from "@keel/ui";
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
} from "react";

import {
  AgreementSecurityCheckError,
  applyLegalEntityExactBatch,
  resolveInvestmentReviews,
  createLegalEntity,
  downloadLegalEntityDocument,
  downloadLegalEntityExport,
  loadLegalEntityExportOptions,
  loadLegalEntityExportTable,
  loadLegalEntities,
  reviewLegalEntitySource,
  recheckLegalEntityDocument,
  updateLegalEntity,
} from "./api";
import {
  createGoogleSheet,
  GoogleSheetsCreationUncertainError,
  prepareGoogleSheetsAuthorization,
} from "./google-sheets-export";
import { formatDate } from "./format";
import {
  entityReviewLocation,
  entityReviewUrl,
  type EntityReviewTarget,
  type EntityReviewTab,
} from "./legal-entity-navigation";
import {
  buildLegalEntitySearchIndex,
  searchLegalEntities,
} from "./collection-search";

const entityTypeOptions = [
  { label: "LLC", value: "llc" },
  { label: "Limited partnership", value: "limited_partnership" },
  { label: "Corporation", value: "corporation" },
  { label: "Partnership", value: "partnership" },
  { label: "Trust", value: "trust" },
  { label: "Other", value: "other" },
] satisfies ReadonlyArray<{ label: string; value: LegalEntityType }>;

const relationshipOptions = [
  { label: "Direct interest", value: "direct_interest" },
  { label: "Ownership entity", value: "ownership_entity" },
  { label: "Operating entity", value: "operating_entity" },
  { label: "Investment vehicle", value: "investment_vehicle" },
  { label: "Other", value: "other" },
] satisfies ReadonlyArray<{
  label: string;
  value: LegalEntityRelationship;
}>;

const interestStatusOptions = [
  { label: "Current", value: "current" },
  { label: "Historical", value: "historical" },
  { label: "Unknown", value: "unknown" },
] satisfies ReadonlyArray<{
  label: string;
  value: LegalEntityInterestStatus;
}>;

const entityTypeLabels = Object.fromEntries(
  entityTypeOptions.map((option) => [option.value, option.label]),
) as Readonly<Record<LegalEntityType, string>>;

const relationshipLabels = Object.fromEntries(
  relationshipOptions.map((option) => [option.value, option.label]),
) as Readonly<Record<LegalEntityRelationship, string>>;

type EditorState = {
  structureReview?: boolean;
  connectedInvestment?: boolean;
  entityId: string | null;
  expectedVersionId: string | null;
  source: {
    reference: LegalEntitySourceSummary["source"];
    expectedDecisionId: string | null;
    nameResolution?: LegalNameResolutionInput;
  } | null;
  profile: LegalEntityProfileInput;
  ownershipPercentText: string;
};

function emptyProfile(): LegalEntityProfileInput {
  return {
    legalName: "",
    entityType: "llc",
    relationship: "direct_interest",
    currentOwner: null,
    jurisdiction: null,
    formedOn: null,
    einLastFour: null,
    ownershipInterestPpm: null,
    interestStatus: "current",
    taxClassification: null,
    notes: null,
  };
}

function editorForCandidate(
  candidate: LegalEntitySourceSummary,
  nameResolution?: LegalNameResolutionInput,
): EditorState {
  const legalName =
    nameResolution?.legalName ?? candidate.legalEntityNameEvidence.legalName;
  if (legalName === null) {
    throw new Error("A source-reported legal name is required for review.");
  }
  return {
    entityId: null,
    connectedInvestment: candidate.source.kind === "holding_position",
    structureReview: legalEntityReviewKind(candidate) === "structure",
    expectedVersionId: null,
    source: {
      reference: candidate.source,
      expectedDecisionId: candidate.currentDecisionId,
      ...(nameResolution === undefined ? {} : { nameResolution }),
    },
    profile: {
      ...emptyProfile(),
      legalName,
      entityType:
        legalEntityReviewKind(candidate) === "structure"
          ? "other"
          : (exactLegalEntityTypeFromName(legalName) ?? "other"),
      relationship: candidate.relationship,
      currentOwner:
        candidate.source.kind === "holding_position"
          ? null
          : candidate.currentOwner,
      interestStatus:
        candidate.source.kind === "holding_position"
          ? "unknown"
          : candidate.interestStatus,
    },
    ownershipPercentText: "",
  };
}

function editorForEntity(entity: LegalEntityRecord): EditorState {
  return {
    entityId: entity.id,
    connectedInvestment: entity.sources.some(
      (source) => source.source.kind === "holding_position",
    ),
    structureReview: entity.sources.some(
      (source) =>
        (source.nameResolution?.evidence.state === "unavailable" &&
          source.nameResolution.evidence.problem === "other_structure") ||
        (source.legalEntityNameEvidence.state === "unavailable" &&
          source.legalEntityNameEvidence.problem === "other_structure"),
    ),
    expectedVersionId: entity.versionId,
    source: null,
    profile: {
      legalName: entity.legalName,
      entityType: entity.entityType,
      relationship: entity.relationship,
      currentOwner: entity.currentOwner,
      jurisdiction: entity.jurisdiction,
      formedOn: entity.formedOn,
      einLastFour: entity.einLastFour,
      ownershipInterestPpm: entity.ownershipInterestPpm,
      interestStatus: entity.interestStatus,
      taxClassification: entity.taxClassification,
      notes: entity.notes,
    },
    ownershipPercentText:
      entity.ownershipInterestPpm === null
        ? ""
        : formatOwnershipInterestPpm(entity.ownershipInterestPpm).slice(0, -1),
  };
}

function nullableText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function candidateKey(candidate: LegalEntitySourceSummary): string {
  return `${candidate.source.kind}:${candidate.source.id}`;
}

function sourceSummary(source: LegalEntitySourceSummary): string {
  const sourceRecord =
    source.legalEntityNameEvidence.legalName === source.sourceDisplayName
      ? ""
      : `${source.sourceDisplayName} · `;
  return `${sourceRecord}${source.sourceLabel} · ${formatDate(source.sourceAsOf)}`;
}

export function AgreementEvidence({
  sources,
  assignment,
  documents: providedDocuments,
}: {
  sources: readonly LegalEntitySourceSummary[];
  documents?:
    | Readonly<
        NonNullable<
          LegalEntitySourceSummary["legalEntityNameEvidence"]["documents"]
        >
      >
    | undefined;
  assignment?: (id: string, fileName: string) => ReactNode;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState<ReadonlySet<string>>(new Set());
  const [denied, setDenied] = useState<ReadonlySet<string>>(new Set());
  const recheck = async (id: string, provider?: "sydecar" | "tokenfolio") => {
    setWorking(true);
    setError(null);
    try {
      await recheckLegalEntityDocument(id, provider);
      setQueued((prior) => new Set([...prior, id]));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The agreement check could not be queued. Try again.",
      );
    } finally {
      setWorking(false);
    }
  };
  const download = async (id: string, fileName: string) => {
    setWorking(true);
    setError(null);
    try {
      const blob = await downloadLegalEntityDocument(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (failure) {
      if (failure instanceof AgreementSecurityCheckError)
        setDenied((prior) => new Set([...prior, id]));
      setError(
        failure instanceof AgreementSecurityCheckError
          ? failure.message
          : "The agreement could not be downloaded. Try again or check source access.",
      );
    } finally {
      setWorking(false);
    }
  };
  // Investment review includes agreements assigned elsewhere; the name
  // projection intentionally omits those. Use the complete, freshly scanned
  // review documents when supplied, retaining source evidence as the fallback.
  const documents = providedDocuments ?? [
    ...new Map(
      sources.flatMap((source) =>
        (source.legalEntityNameEvidence.documents ?? []).map(
          (document) => [document.id, document] as const,
        ),
      ),
    ).values(),
  ];
  const unavailableIds = new Set(
    sources.flatMap((source) =>
      source.legalEntityNameEvidence.state === "unavailable" &&
      ["security_blocked", "scanner_unavailable"].includes(
        source.legalEntityNameEvidence.problem ?? "",
      )
        ? (source.legalEntityNameEvidence.documents ?? [])
            .filter(
              (document) =>
                document.scan === undefined &&
                !providedDocuments?.some(
                  (current) =>
                    current.id === document.id && current.scan !== undefined,
                ),
            )
            .map((document) => document.id)
        : [],
    ),
  );
  const incompleteIds = new Set(
    sources.flatMap((source) =>
      source.legalEntityNameEvidence.state === "unavailable" &&
      source.legalEntityNameEvidence.problem === "scanner_unavailable"
        ? (source.legalEntityNameEvidence.documents ?? [])
            .filter(
              (document) =>
                document.scan === undefined &&
                !providedDocuments?.some(
                  (current) =>
                    current.id === document.id && current.scan !== undefined,
                ),
            )
            .map((document) => document.id)
        : [],
    ),
  );
  if (documents.length === 0) return null;
  const content = (
    <>
      <ul>
        {documents.map((document) => {
          const blocked =
            document.scan?.outcome === "blocked" ||
            unavailableIds.has(document.id) ||
            denied.has(document.id);
          const findings =
            document.scan?.version === 2 && document.scan.outcome === "blocked"
              ? document.scan.findings
              : blocked && !incompleteIds.has(document.id)
                ? [{ reason: "unknown_alert" as const, signature: null }]
                : [];
          return (
            <li key={document.id}>
              <article aria-label={document.fileName}>
                {blocked ? (
                  <p className="legal-entity-documents__name">
                    {document.fileName}
                  </p>
                ) : (
                  <TextLink
                    disabled={working}
                    onClick={() =>
                      void download(document.id, document.fileName)
                    }
                  >
                    {document.fileName}
                    {assignment || document.page === null
                      ? ""
                      : ` · page ${document.page.toString()}`}
                  </TextLink>
                )}
                {!blocked && assignment?.(document.id, document.fileName)}
                {assignment ? (
                  <Collapsible className="investment-review__evidence">
                    <CollapsibleTrigger>
                      <span>
                        Source evidence
                        {document.page !== null
                          ? ` · page ${document.page}`
                          : ""}
                      </span>
                      <DisclosureIndicator />
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      {document.quote !== null && <p>{document.quote}</p>}
                      {document.structure !== undefined && !blocked && (
                        <p>
                          {document.structure.quote} · page{" "}
                          {document.structure.page}
                        </p>
                      )}
                      {document.quote === null &&
                        document.structure === undefined && (
                          <p>
                            No excerpt is available. Review the agreement for
                            the named parties.
                          </p>
                        )}
                    </CollapsibleContent>
                  </Collapsible>
                ) : (
                  <>
                    {document.quote !== null && <p>{document.quote}</p>}
                    {document.structure !== undefined && !blocked && (
                      <p>
                        {document.structure.quote} · page{" "}
                        {document.structure.page}
                      </p>
                    )}
                  </>
                )}
                {incompleteIds.has(document.id) && (
                  <div className="legal-entity-documents__finding">
                    <p className="legal-entity-documents__name">
                      Security check incomplete
                    </p>
                    <p>
                      The scanner did not complete this check. Recheck the
                      agreement; if it fails again, Keel's scanner setup needs
                      attention.
                    </p>
                  </div>
                )}
                {findings.map((finding) => (
                  <div
                    key={finding.signature ?? finding.reason}
                    className="legal-entity-documents__finding"
                  >
                    <p className="legal-entity-documents__name">
                      {LEGAL_DOCUMENT_SCAN_REASON_COPY[finding.reason].label}
                    </p>
                    <p>
                      {LEGAL_DOCUMENT_SCAN_REASON_COPY[finding.reason].detail}
                    </p>
                    {finding.signature !== null && (
                      <p>Scanner code: {finding.signature}</p>
                    )}
                  </div>
                ))}
                {blocked && document.scan !== undefined && (
                  <p>Checked {formatDate(document.scan.scannedAt)}</p>
                )}
                {(blocked ||
                  sources.some(
                    (source) =>
                      source.legalEntityNameEvidence.state === "unavailable" &&
                      source.legalEntityNameEvidence.problem ===
                        "other_structure" &&
                      document.structure === undefined,
                  )) && (
                  <ActionGroup>
                    <Button
                      tone="secondary"
                      disabled={working || queued.has(document.id)}
                      onClick={() =>
                        void recheck(document.id, document.provider)
                      }
                    >
                      {queued.has(document.id)
                        ? "Check queued"
                        : "Recheck agreement"}
                    </Button>
                  </ActionGroup>
                )}
                {queued.has(document.id) && (
                  <FormMessage tone="success">
                    {blocked
                      ? "Recheck requested. The agreement stays blocked until it passes."
                      : "A fresh reading of this agreement was requested."}{" "}
                    Check progress in Sources, then reload this page.
                  </FormMessage>
                )}
                {queued.has(document.id) && (
                  <TextLink href="/holdings/sources">
                    View source progress
                  </TextLink>
                )}
              </article>
            </li>
          );
        })}
      </ul>
      {error !== null && <FormMessage tone="error">{error}</FormMessage>}
    </>
  );
  return assignment ? (
    <div className="legal-entity-documents legal-entity-documents--review">
      {content}
    </div>
  ) : (
    <Collapsible className="legal-entity-documents">
      <CollapsibleTrigger>
        <span>Agreement evidence · {documents.length}</span>
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>{content}</CollapsibleContent>
    </Collapsible>
  );
}

function LegalEntityEditor({
  editor,
  onCancel,
  onSaved,
  onReload,
}: {
  editor: EditorState;
  onCancel: () => void;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(editor);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft.entityId !== null;
  const headingId = useId();

  const setProfile = <Key extends keyof LegalEntityProfileInput>(
    key: Key,
    value: LegalEntityProfileInput[Key],
  ) => {
    setDraft((current) => ({
      ...current,
      profile: { ...current.profile, [key]: value },
    }));
  };

  const validation = useMemo(() => {
    let ownershipInterestPpm: number | null = null;
    let ownershipError: string | null = null;
    try {
      ownershipInterestPpm = ownershipPercentTextToPpm(
        draft.ownershipPercentText,
      );
    } catch {
      ownershipError =
        "Enter an ownership percentage from 0 to 100, with up to four decimal places.";
    }
    const profile = LegalEntityProfileInputSchema.safeParse({
      ...draft.profile,
      legalName: draft.profile.legalName.trim(),
      currentOwner:
        draft.profile.currentOwner === null
          ? null
          : nullableText(draft.profile.currentOwner),
      jurisdiction:
        draft.profile.jurisdiction === null
          ? null
          : nullableText(draft.profile.jurisdiction),
      einLastFour:
        draft.profile.einLastFour === null
          ? null
          : nullableText(draft.profile.einLastFour),
      ownershipInterestPpm,
      taxClassification:
        draft.profile.taxClassification === null
          ? null
          : nullableText(draft.profile.taxClassification),
      notes:
        draft.profile.notes === null ? null : nullableText(draft.profile.notes),
    });
    return { profile, ownershipError };
  }, [draft]);
  const valid =
    validation.profile.success &&
    validation.ownershipError === null &&
    (!editing || draft.expectedVersionId !== null);
  const changed =
    !editing ||
    (validation.profile.success &&
      JSON.stringify(validation.profile.data) !==
        JSON.stringify(editor.profile));
  const fieldIssue = (field: keyof LegalEntityProfileInput) =>
    validation.profile.error?.issues.find((issue) => issue.path[0] === field)
      ?.message;
  const einIssue =
    fieldIssue("einLastFour") === undefined
      ? undefined
      : "Enter exactly four digits, or leave this blank.";
  const validationMessage =
    validation.ownershipError ??
    einIssue ??
    (fieldIssue("legalName") !== undefined &&
    draft.profile.legalName.trim() === ""
      ? "Enter the legal name to continue."
      : validation.profile.error?.issues[0]?.message);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (working || !valid || !changed || !validation.profile.success) return;
    setWorking(true);
    setError(null);
    try {
      const profile = validation.profile.data;
      if (draft.entityId === null) {
        await createLegalEntity({ profile, source: draft.source });
      } else {
        if (draft.expectedVersionId === null) {
          throw new Error(
            "This entity version is unavailable. Reload and try again.",
          );
        }
        await updateLegalEntity(draft.entityId, {
          expectedVersionId: draft.expectedVersionId,
          profile,
        });
      }
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The entity could not be saved.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className="legal-entity-editor">
      <SectionHeader
        description={
          draft.structureReview ? (
            <span id={`${headingId}-entity-type`}>
              Choose the type stated in the agreement. Your classification does
              not confirm direct ownership.
            </span>
          ) : draft.source === null ? undefined : (
            "Confirm the source-reported name and entity type."
          )
        }
        eyebrow={editing ? "Reviewed record" : "Review before adding"}
        headingProps={{ id: headingId }}
        title={editing ? "Edit legal entity" : "Add legal entity"}
      />
      <form noValidate onSubmit={(event) => void submit(event)}>
        <div className="legal-entity-editor__fields">
          <Field label="Legal name" variant="filled" wide>
            <Input
              maxLength={1_000}
              onChange={(event) =>
                setProfile("legalName", event.currentTarget.value)
              }
              required
              aria-invalid={
                draft.profile.legalName !== "" &&
                fieldIssue("legalName") !== undefined
              }
              readOnly={draft.source?.nameResolution !== undefined}
              value={draft.profile.legalName}
            />
          </Field>
          <Field label="Entity type" variant="filled">
            <Select
              items={entityTypeOptions}
              onValueChange={(value) => {
                if (
                  entityTypeOptions.some((option) => option.value === value)
                ) {
                  setProfile("entityType", value as LegalEntityType);
                }
              }}
              value={draft.profile.entityType}
            >
              <SelectTrigger
                aria-label="Entity type"
                aria-describedby={
                  draft.structureReview ? `${headingId}-entity-type` : undefined
                }
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entityTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Relationship" variant="filled">
            <Select
              items={relationshipOptions}
              onValueChange={(value) => {
                if (
                  relationshipOptions.some((option) => option.value === value)
                ) {
                  setProfile("relationship", value as LegalEntityRelationship);
                }
              }}
              value={draft.profile.relationship}
            >
              <SelectTrigger aria-label="Relationship">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {relationshipOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Collapsible className="entity-review__optional">
            <CollapsibleTrigger>
              <span>Additional details (optional)</span>
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent keepMounted>
              <div className="legal-entity-editor__fields">
                {!draft.connectedInvestment && (
                  <Field label="Current titled owner" variant="filled">
                    <Input
                      maxLength={1_000}
                      onChange={(event) =>
                        setProfile("currentOwner", event.currentTarget.value)
                      }
                      placeholder="Not recorded"
                      value={draft.profile.currentOwner ?? ""}
                    />
                  </Field>
                )}
                <Field label="Formation jurisdiction" variant="filled">
                  <Input
                    maxLength={240}
                    onChange={(event) =>
                      setProfile("jurisdiction", event.currentTarget.value)
                    }
                    placeholder="Not recorded"
                    value={draft.profile.jurisdiction ?? ""}
                  />
                </Field>
                <Field label="Formation date" variant="filled">
                  <DatePicker
                    aria-label="Formation date"
                    onValueChange={(value) =>
                      setProfile("formedOn", value || null)
                    }
                    value={draft.profile.formedOn ?? ""}
                  />
                </Field>
                <Field
                  description="Only the final four digits are stored."
                  label="EIN last four"
                  variant="filled"
                >
                  <Input
                    inputMode="numeric"
                    onChange={(event) =>
                      setProfile("einLastFour", event.currentTarget.value)
                    }
                    pattern="[0-9]{4}"
                    aria-invalid={einIssue !== undefined}
                    placeholder="Not recorded"
                    value={draft.profile.einLastFour ?? ""}
                  />
                </Field>
                {!draft.connectedInvestment && (
                  <Field label="Ownership interest" variant="filled">
                    <InputGroup suffix="%">
                      <Input
                        inputMode="decimal"
                        aria-invalid={validation.ownershipError !== null}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setDraft((current) => ({
                            ...current,
                            ownershipPercentText: value,
                          }));
                        }}
                        placeholder="Not recorded"
                        value={draft.ownershipPercentText}
                      />
                    </InputGroup>
                  </Field>
                )}
                {!draft.connectedInvestment && (
                  <Field label="Interest status" variant="filled">
                    <Select
                      items={interestStatusOptions}
                      onValueChange={(value) => {
                        if (
                          interestStatusOptions.some(
                            (option) => option.value === value,
                          )
                        ) {
                          setProfile(
                            "interestStatus",
                            value as LegalEntityInterestStatus,
                          );
                        }
                      }}
                      value={draft.profile.interestStatus}
                    >
                      <SelectTrigger aria-label="Interest status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {interestStatusOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
                <Field label="Tax classification" variant="filled">
                  <Input
                    maxLength={240}
                    onChange={(event) =>
                      setProfile("taxClassification", event.currentTarget.value)
                    }
                    placeholder="Not recorded"
                    value={draft.profile.taxClassification ?? ""}
                  />
                </Field>
                <Field label="Notes" variant="filled" wide>
                  <Textarea
                    maxLength={2_000}
                    onChange={(event) =>
                      setProfile("notes", event.currentTarget.value)
                    }
                    placeholder="Optional context for counsel"
                    rows={3}
                    value={draft.profile.notes ?? ""}
                  />
                </Field>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        {error !== null && <FormMessage tone="error">{error}</FormMessage>}
        {error === null && !valid && (
          <FormMessage tone="neutral">
            {validationMessage ?? "Reload this entity before saving."}
          </FormMessage>
        )}
        <ActionGroup
          as="footer"
          className="legal-entity-editor__actions"
          align="end"
          mobileLayout="grid"
        >
          <Button disabled={working} onClick={onCancel} tone="quiet">
            Cancel
          </Button>
          <Button
            disabled={working || !valid || !changed}
            tone="primary"
            type="submit"
          >
            {working ? "Saving…" : editing ? "Save version" : "Add entity"}
          </Button>
        </ActionGroup>
      </form>
      {error !== null && draft.source?.nameResolution !== undefined && (
        <Button
          tone="quiet"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void onReload()
              .catch(() =>
                setError("The evidence could not be reloaded. Try again."),
              )
              .finally(() => setWorking(false));
          }}
        >
          Reload evidence
        </Button>
      )}
    </section>
  );
}

function EntityRow({
  entity,
  onOpen,
  searchQuery,
}: {
  entity: LegalEntityRecord;
  onOpen: () => void;
  searchQuery: string;
}) {
  const positions = entity.sources.filter(
    (source) => source.source.kind === "holding_position",
  );
  const companyNames = [
    ...new Set(
      positions.map(
        (source) =>
          source.companyReview?.companyName ?? source.sourceDisplayName,
      ),
    ),
  ].filter((name) => name !== entity.legalName);
  const statuses = positions.length
    ? [...new Set(positions.map(sourceParticipationStatus))]
    : [entity.interestStatus];
  const showStatus = isHistoricalLegalEntity(entity)
    ? statuses.includes("cancelled")
    : statuses.some((status) => status !== "current");
  const status = showStatus
    ? statuses
        .map((item) =>
          item === "unknown"
            ? "Status unconfirmed"
            : `${item[0]?.toUpperCase()}${item.slice(1)}`,
        )
        .join(" · ")
    : null;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onOpen();
  };
  return (
    <RecordItem
      className="legal-entity-row"
      title={
        <SearchHighlight query={searchQuery}>
          {entity.legalName}
        </SearchHighlight>
      }
      detail={
        companyNames.length > 0 || status !== null ? (
          <>
            {companyNames.length > 0 && (
              <SearchHighlight query={searchQuery}>
                {companyNames.join(" · ")}
              </SearchHighlight>
            )}
            {companyNames.length > 0 && status !== null && " · "}
            {status}
          </>
        ) : undefined
      }
      action={
        <TextLink
          aria-label={`Open ${entity.legalName} details`}
          className="legal-entity-row__open"
          data-legal-entity-id={entity.id}
          href={entityReviewUrl({ kind: "entity", id: entity.id })}
          onClick={open}
        >
          <DisclosureIndicator />
        </TextLink>
      }
    />
  );
}

function EntitySourceHistory({
  sources,
  activeSource,
}: {
  sources: readonly LegalEntitySourceSummary[];
  activeSource: LegalEntitySourceSummary | undefined;
}) {
  const entries = sources.filter(
    (source) => source !== activeSource || source.nameResolution !== undefined,
  );
  if (entries.length === 0) return null;
  return (
    <Collapsible className="investment-review__record-disclosure">
      <CollapsibleTrigger layout="inline">
        <h3>Source history</h3>
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {entries.map((source) => {
          const resolution = source.nameResolution;
          return (
            <div key={candidateKey(source)}>
              {source !== activeSource && <p>{sourceSummary(source)}</p>}
              {resolution !== undefined && (
                <p>
                  {resolution.kind === "document_choice"
                    ? "Reviewed name"
                    : resolution.kind === "document_structure"
                      ? "Reviewed structure"
                      : resolution.kind === "document_entry"
                        ? "Name entered by you"
                        : "Your document-backed correction"}
                  : {resolution.legalName} · {resolution.fileName} · page{" "}
                  {resolution.page}
                  {resolution.reviewedEntityType !== undefined && (
                    <>
                      <br />
                      Type at review:{" "}
                      {entityTypeLabels[resolution.reviewedEntityType]} (your
                      classification).
                    </>
                  )}
                  {resolution.evidence.state === "unavailable" &&
                    resolution.evidence.problem === "other_structure" && (
                      <>
                        <br />
                        Compartment structure; direct ownership is not
                        confirmed.
                      </>
                    )}
                </p>
              )}
            </div>
          );
        })}
      </CollapsibleContent>
    </Collapsible>
  );
}

function candidateAction(candidate: LegalEntitySourceSummary): string {
  switch (legalEntityReviewKind(candidate)) {
    case "found":
      return "Review details";
    case "conflict":
      return "Resolve name";
    case "structure":
      return "Review structure";
    case "document":
      return "Review PDF";
    default:
      return "View source options";
  }
}

function CandidateRow({
  candidate,
  excluded,
  canLinkInvestment = false,
  onOpen,
  searchQuery = "",
}: {
  candidate: LegalEntitySourceSummary;
  excluded?: boolean;
  canLinkInvestment?: boolean;
  onOpen: () => void;
  searchQuery?: string;
}) {
  const kind = legalEntityReviewKind(candidate);
  const exception = legalReviewIssues(candidate.automaticReview)[0];
  const reviewButton = (
    <Button tone="secondary" onClick={onOpen}>
      {exception?.section === "company"
        ? "Review company"
        : candidateAction(candidate)}
    </Button>
  );
  return (
    <article className="legal-entity-candidate">
      <div className="legal-entity-candidate__copy">
        <div>
          <h3>
            <SearchHighlight query={searchQuery}>
              {candidate.legalEntityNameEvidence.legalName ??
                candidate.sourceDisplayName}
            </SearchHighlight>
          </h3>
          {(excluded || kind !== "found") && (
            <Badge tone="warning">
              {excluded
                ? "Excluded"
                : kind === "conflict"
                  ? "Names disagree"
                  : kind === "structure"
                    ? "Review structure"
                    : kind === "document"
                      ? "Review PDF"
                      : "Name unavailable"}
            </Badge>
          )}
        </div>
        <p>
          <SearchHighlight query={searchQuery}>
            {sourceSummary(candidate)}
          </SearchHighlight>
        </p>
        <p>
          {exception
            ? exception.message
            : kind === "conflict"
              ? "Compare the agreements or separate different investments."
              : kind === "structure"
                ? "Confirm the named vehicle and its structure."
                : kind === "document"
                  ? "Read the agreement and enter its exact legal name."
                  : kind === "found"
                    ? `Legal name reported in ${candidate.legalEntityNameEvidence.sourceField}.`
                    : "The source does not identify the exact legal vehicle. Add a supporting agreement or check the available evidence."}
        </p>
      </div>
      {candidate.source.kind === "holding_position" &&
      !excluded &&
      canLinkInvestment ? (
        <ActionGroup className="legal-entity-candidate__actions">
          {reviewButton}
          <TextLink
            href={`${entityReviewUrl({ kind: "holding_position", id: candidate.source.id })}&link=1`}
          >
            Same investment / company renamed
          </TextLink>
        </ActionGroup>
      ) : (
        reviewButton
      )}
    </article>
  );
}

export function SavedEntityProfile({ entity }: { entity: LegalEntityRecord }) {
  const linked = entity.sources.some(
    (source) => source.source.kind === "holding_position",
  );
  const earlierOwnership =
    linked &&
    (entity.currentOwner !== null || entity.ownershipInterestPpm !== null);
  const kind = [
    relationshipLabels[entity.relationship],
    ...(exactLegalEntityTypeFromName(entity.legalName) === entity.entityType
      ? []
      : [entityTypeLabels[entity.entityType]]),
  ].join(" · ");
  return (
    <div className="entity-review__profile">
      <div className="entity-review__ownership-summary">
        <p className="entity-review__kind">
          {kind}
          {earlierOwnership && " · Earlier entity entry"}
        </p>
        {(entity.currentOwner !== null ||
          entity.ownershipInterestPpm !== null) && (
          <p className="entity-review__ownership">
            {entity.currentOwner !== null && (
              <strong>{entity.currentOwner}</strong>
            )}
            {entity.currentOwner !== null &&
              entity.ownershipInterestPpm !== null &&
              " · "}
            {entity.ownershipInterestPpm !== null && (
              <strong>
                {formatOwnershipInterestPpm(entity.ownershipInterestPpm)}
              </strong>
            )}
          </p>
        )}
        {entity.interestStatus === "historical" && (
          <p className="entity-review__historical">
            {linked && !isHistoricalLegalEntity(entity)
              ? "Historical in the earlier entity entry"
              : "Historical"}
          </p>
        )}
      </div>
      {(entity.formedOn !== null ||
        entity.jurisdiction !== null ||
        entity.taxClassification !== null ||
        entity.einLastFour !== null) && (
        <div className="entity-review__profile-facts">
          {(entity.formedOn !== null || entity.jurisdiction !== null) && (
            <p>
              {entity.jurisdiction}
              {entity.jurisdiction !== null &&
                entity.formedOn !== null &&
                " · "}
              {entity.formedOn !== null && (
                <time dateTime={entity.formedOn} title="Formation date">
                  {formatDate(entity.formedOn)}
                </time>
              )}
            </p>
          )}
          {entity.taxClassification !== null && (
            <p>{entity.taxClassification}</p>
          )}
          {entity.einLastFour !== null && (
            <p>
              <span className="visually-hidden">EIN ending </span>
              <span aria-hidden="true">••-•••</span>
              {entity.einLastFour}
            </p>
          )}
        </div>
      )}
      {entity.notes !== null && (
        <p className="entity-review__notes">{entity.notes}</p>
      )}
    </div>
  );
}

function EntityReviewWorkspace({
  target,
  inventory,
  tab,
  onTabChange,
  onSaved,
  onBack,
  candidates,
  onOpenSource,
}: {
  target: EntityReviewTarget;
  inventory: LegalEntityInventory;
  tab: EntityReviewTab;
  onTabChange: (tab: EntityReviewTab) => void;
  onSaved: () => Promise<void>;
  onBack: () => void;
  candidates: readonly LegalEntitySourceSummary[];
  onOpenSource: (source: LegalEntitySourceSummary) => void;
}) {
  const [resolution, setResolution] = useState<LegalNameResolutionInput>();
  const [editingEntity, setEditingEntity] = useState(false);
  const [modeChoice, setMode] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const saved = async () => {
    await onSaved();
    if (target.kind === "new") onBack();
  };
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entity = inventory.entities.find((item) =>
    target.kind === "entity"
      ? item.id === target.id
      : item.sources.some(
          (source) =>
            source.source.kind === target.kind &&
            source.source.id === target.id,
        ),
  );
  const linkedPositions =
    entity?.sources.filter(
      (source) => source.source.kind === "holding_position",
    ) ?? [];
  const source =
    target.kind === "entity"
      ? linkedPositions.length === 1
        ? linkedPositions[0]
        : linkedPositions.find((item) => item.source.id === selectedPositionId)
      : [
          ...inventory.candidates,
          ...inventory.excludedCandidates,
          ...inventory.entities.flatMap((item) => item.sources),
        ].find(
          (item) =>
            item.source.kind === target.kind && item.source.id === target.id,
        );
  const otherCandidates = candidates.filter(
    (item) =>
      item.source.kind !== source?.source.kind ||
      item.source.id !== source?.source.id,
  );
  // Keep moving in the list's attention order even after saving removes the
  // current source from the queue. Wrap only at either end.
  const previousCandidate =
    (source === undefined
      ? undefined
      : otherCandidates
          .slice()
          .reverse()
          .find((item) => compareLegalEntityAttention(item, source) < 0)) ??
    otherCandidates.at(-1);
  const nextCandidate =
    (source === undefined
      ? undefined
      : otherCandidates.find(
          (item) => compareLegalEntityAttention(item, source) > 0,
        )) ?? otherCandidates[0];
  const legalName =
    resolution?.legalName ?? source?.legalEntityNameEvidence.legalName;
  const matches = inventory.entities.filter(
    (item) => item.legalName === legalName,
  );
  const duplicateSource =
    source?.source.kind === "holding_position" &&
    [
      ...inventory.candidates,
      ...inventory.entities.flatMap((item) => item.sources),
    ].some(
      (item) =>
        item.source.kind === "holding_position" &&
        item.source.id !== source.source.id &&
        item.legalEntityNameEvidence.legalName !== null &&
        item.legalEntityNameEvidence.legalName ===
          source.legalEntityNameEvidence.legalName,
    );
  const exactDuplicateEntity = duplicateSource && matches.length === 1;
  const mode = modeChoice ?? (exactDuplicateEntity ? "existing" : "new");
  const effectiveEntityId =
    selectedEntityId || (exactDuplicateEntity ? matches[0]!.id : "");
  const reviewKind =
    source === undefined ? "waiting" : legalEntityReviewKind(source);
  const editor =
    entity !== undefined
      ? editorForEntity(entity)
      : source !== undefined && legalName
        ? editorForCandidate(source, resolution)
        : target.kind === "new"
          ? {
              entityId: null,
              expectedVersionId: null,
              source: null,
              profile: emptyProfile(),
              ownershipPercentText: "",
            }
          : null;
  const decide = async (kind: "linked" | "not_llc") => {
    if (
      source === undefined ||
      working ||
      (kind === "linked" &&
        !matches.some((item) => item.id === effectiveEntityId))
    )
      return;
    setWorking(true);
    setError(null);
    try {
      await reviewLegalEntitySource({
        source: source.source,
        expectedDecisionId: source.currentDecisionId,
        decision:
          kind === "linked"
            ? { kind, legalEntityId: effectiveEntityId }
            : { kind },
        ...(kind === "linked" && resolution !== undefined
          ? { nameResolution: resolution }
          : {}),
      });
      await onSaved();
      if (kind === "not_llc") onBack();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The source review could not be saved.",
      );
    } finally {
      setWorking(false);
    }
  };
  const identity = (
    <>
      {entity === undefined && editor !== null && source !== undefined && (
        <RadioGroup
          className="entity-review__destination"
          label="Legal entity"
          name="entity-destination"
          value={mode}
          onValueChange={(value) =>
            setMode(value === "existing" ? "existing" : "new")
          }
          options={[
            { value: "new", label: "Create new entity" },
            { value: "existing", label: "Link existing entity" },
          ]}
        />
      )}
      {entity === undefined &&
        source !== undefined &&
        editor === null &&
        reviewKind !== "waiting" && (
          <LegalNameResolver
            source={source}
            entities={inventory.entities}
            onAdd={setResolution}
            onClose={onBack}
            onSaved={saved}
            onReload={onSaved}
          />
        )}
      {entity !== undefined && !editingEntity && (
        <section className="investment-review__section entity-review__identity">
          {source !== undefined && (
            <SectionHeader
              title="Legal vehicle"
              headingAs="h3"
              action={
                <Button tone="secondary" onClick={() => setEditingEntity(true)}>
                  Edit legal entity
                </Button>
              }
            />
          )}
          <SavedEntityProfile entity={entity} />
          <p className="entity-review__provenance">
            Reviewed {formatDate(entity.recordedAt)}
          </p>
          {source?.legalEntityNameEvidence.documents?.some(
            (document) => document.page !== null,
          ) && (
            <TextLink onClick={() => onTabChange("documents")}>
              View supporting agreement
            </TextLink>
          )}
        </section>
      )}
      {entity !== undefined && !editingEntity && (
        <EntitySourceHistory sources={entity.sources} activeSource={source} />
      )}
      {editor !== null &&
        (entity !== undefined ? editingEntity : mode === "new") && (
          <LegalEntityEditor
            key={entity?.versionId ?? resolution?.legalName ?? "new"}
            editor={editor}
            onCancel={
              entity !== undefined ? () => setEditingEntity(false) : onBack
            }
            onSaved={async () => {
              await saved();
              setEditingEntity(false);
            }}
            onReload={onSaved}
          />
        )}
      {entity === undefined && editor !== null && mode === "existing" && (
        <section className="entity-review__link">
          <h2>Link existing entity</h2>
          <p>
            Link only when the saved legal name matches this source. This does
            not combine investment amounts or terms.
          </p>
          {matches.length === 0 ? (
            <p>
              No saved entity has this exact legal name. Create a new entity for
              this vehicle.
            </p>
          ) : (
            <>
              <Field label="Existing legal entity" variant="filled">
                <Select
                  items={matches.map((item) => ({
                    value: item.id,
                    label: item.legalName,
                  }))}
                  value={effectiveEntityId || null}
                  onValueChange={(value) =>
                    setSelectedEntityId(typeof value === "string" ? value : "")
                  }
                >
                  <SelectTrigger aria-label="Existing legal entity">
                    <SelectValue placeholder="Choose an entity" />
                  </SelectTrigger>
                  <SelectContent>
                    {matches.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Button
                disabled={
                  working ||
                  !matches.some((item) => item.id === effectiveEntityId)
                }
                onClick={() => void decide("linked")}
              >
                Link entity
              </Button>
            </>
          )}
        </section>
      )}
      {editor === null && reviewKind === "waiting" && (
        <Notice>
          There is no readable legal-name evidence yet. Open Documents for the
          source status and available next steps.
        </Notice>
      )}
    </>
  );
  const renderDocuments: ReviewDocumentRenderer = (assignment, documents) =>
    source === undefined ? null : (
      <>
        <AgreementEvidence
          sources={[source]}
          assignment={assignment}
          documents={documents}
        />
        {source.legalEntityNameEvidence.state === "unavailable" &&
          source.legalEntityNameEvidence.problem !== undefined && (
            <p>
              {
                LEGAL_DOCUMENT_PROBLEM_COPY[
                  source.legalEntityNameEvidence.problem
                ]
              }
            </p>
          )}
      </>
    );
  return (
    <div className="entity-review entity-review--investment">
      <div className="entity-review__navigation">
        <TextLink onClick={onBack}>Back to legal entities</TextLink>
        {previousCandidate && nextCandidate && (
          <nav
            className="entity-review__queue-navigation"
            aria-label="Investments needing review"
          >
            <Button
              size="icon"
              tone="quiet"
              aria-label="Previous needing review"
              title="Previous needing review"
              onClick={() => onOpenSource(previousCandidate)}
            >
              <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                <path d="m10.5 3.5-4.5 4.5 4.5 4.5" />
              </svg>
            </Button>
            <Button
              size="icon"
              tone="quiet"
              aria-label="Next needing review"
              title="Next needing review"
              onClick={() => onOpenSource(nextCandidate)}
            >
              <svg aria-hidden="true" fill="none" viewBox="0 0 16 16">
                <path d="m5.5 3.5 4.5 4.5-4.5 4.5" />
              </svg>
            </Button>
          </nav>
        )}
      </div>
      <PageHeader
        eyebrow={source === undefined ? undefined : "Legal record"}
        actions={
          source === undefined && entity !== undefined && !editingEntity ? (
            <Button tone="secondary" onClick={() => setEditingEntity(true)}>
              Edit legal entity
            </Button>
          ) : undefined
        }
        title={
          source?.sourceDisplayName ??
          entity?.legalName ??
          (target.kind === "new" ? "New legal entity" : "Review unavailable")
        }
        description={
          source
            ? (entity?.legalName ?? "Legal vehicle not yet confirmed")
            : entity === undefined
              ? "Your legal entity inventory"
              : undefined
        }
      />
      {source && (
        <div className="entity-review__source">
          <span>
            {source.sourceLabel} · {formatDate(source.sourceAsOf)}
          </span>
          <TextLink href="/holdings/sources">View source</TextLink>
          {source.source.kind === "holding_position" && (
            <TextLink
              href={`/holdings?position=${encodeURIComponent(source.source.id)}`}
            >
              View position in Holdings
            </TextLink>
          )}
        </div>
      )}
      {error !== null && <FormMessage tone="error">{error}</FormMessage>}
      {linkedPositions.length > 1 && target.kind === "entity" && (
        <Field label="Investment to review" variant="filled">
          <Select
            value={selectedPositionId || null}
            onValueChange={(value) =>
              setSelectedPositionId(typeof value === "string" ? value : "")
            }
            items={linkedPositions.map((item) => ({
              value: item.source.id,
              label: item.sourceDisplayName,
            }))}
          >
            <SelectTrigger aria-label="Investment to review">
              <SelectValue placeholder="Choose an investment" />
            </SelectTrigger>
            <SelectContent>
              {linkedPositions.map((item) => (
                <SelectItem key={item.source.id} value={item.source.id}>
                  {item.sourceDisplayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {duplicateSource &&
        source?.source.kind === "holding_position" &&
        new URLSearchParams(window.location.search).has("link") && (
          <PositionLinksEditor
            key={`links:${source.source.id}`}
            positionId={source.source.id}
            onAccepted={onSaved}
            reviewEntry
            initialOpen
          />
        )}
      {source?.source.kind === "holding_position" ? (
        <InvestmentReview
          key={source.source.id}
          positionId={source.source.id}
          sourceLabel={source.sourceLabel}
          identity={identity}
          identitySaved={entity !== undefined}
          renderDocuments={renderDocuments}
          legalName={entity?.legalName ?? null}
          tab={tab}
          onTabChange={onTabChange}
          onSaved={saved}
        />
      ) : (
        <div className="entity-review__panel">
          {identity}
          {entity !== undefined && source === undefined ? (
            <AgreementEvidence sources={entity.sources} />
          ) : (
            renderDocuments(() => null)
          )}
        </div>
      )}
      {entity === undefined && source !== undefined && (
        <div className="entity-review__secondary">
          <TextLink disabled={working} onClick={() => void decide("not_llc")}>
            Exclude source
          </TextLink>
        </div>
      )}
    </div>
  );
}

function ExactBatchReview({
  batch,
  error,
  onApply,
  working,
}: {
  batch: LegalEntityInventory["exactBatch"];
  error: string | null;
  onApply: () => Promise<void>;
  working: boolean;
}) {
  const typeSummary = [
    batch.llcEntityCount > 0
      ? `${batch.llcEntityCount} ${batch.llcEntityCount === 1 ? "LLC" : "LLCs"}`
      : null,
    batch.limitedPartnershipEntityCount > 0
      ? `${batch.limitedPartnershipEntityCount} limited ${
          batch.limitedPartnershipEntityCount === 1
            ? "partnership"
            : "partnerships"
        }`
      : null,
  ]
    .filter((value): value is string => value !== null)
    .join(" and ");
  const existingCopy =
    batch.existingEntityCount === 0
      ? ""
      : ` ${batch.existingEntityCount} exact ${
          batch.existingEntityCount === 1
            ? "match will receive its source"
            : "matches will receive their sources"
        }.`;
  const remainingCopy =
    batch.remainingCandidateCount === 0
      ? ""
      : ` ${batch.remainingCandidateCount} ${
          batch.remainingCandidateCount === 1
            ? "source remains"
            : "sources remain"
        } outside this batch.`;

  return (
    <div className="legal-entity-exact-batch">
      <div className="legal-entity-exact-batch__summary">
        <h3>
          {batch.sourceCount}
          {batch.remainingCandidateCount > 0
            ? ` of ${batch.sourceCount + batch.remainingCandidateCount}`
            : ""}{" "}
          {batch.sourceCount === 1 ? "source" : "sources"} ready to add or link
        </h3>
        <p>
          {batch.entityCount} legal {batch.entityCount === 1 ? "name" : "names"}
          {" · "}
          {typeSummary}.{remainingCopy}
        </p>
      </div>
      <Button disabled={working} onClick={() => void onApply()} tone="primary">
        {working
          ? "Reviewing…"
          : `Add or link ${batch.sourceCount} ${
              batch.sourceCount === 1 ? "source" : "sources"
            }`}
      </Button>
      <Collapsible className="legal-entity-exact-batch__details">
        <CollapsibleTrigger
          render={
            <TextLink>
              <span>Batch details</span>
              <DisclosureIndicator />
            </TextLink>
          }
        />
        <CollapsibleContent>
          <p>
            Sources with the same exact legal name use one legal-entity entry.
            {existingCopy}
          </p>
        </CollapsibleContent>
      </Collapsible>
      {error !== null && (
        <FormMessage className="legal-entity-exact-batch__error" tone="error">
          {error}
        </FormMessage>
      )}
    </div>
  );
}

type GoogleExportDestination =
  | { status: "loading" | "unavailable" }
  | { status: "error"; message: string }
  | { status: "ready"; authorize: () => Promise<string> };

function ExportWorkspace({ inventory }: { inventory: LegalEntityInventory }) {
  const [expanded, setExpanded] = useState(false);
  const [fields, setFields] = useState<ReadonlySet<LegalEntityExportField>>(
    () => new Set(DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS),
  );
  const [includeNeedsReview, setIncludeNeedsReview] = useState(true);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [includeOtherEntityTypes, setIncludeOtherEntityTypes] = useState(true);
  const [working, setWorking] = useState<"csv" | "google" | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [createdSheet, setCreatedSheet] = useState<{
    url: string;
    selection: string;
  } | null>(null);
  const [google, setGoogle] = useState<GoogleExportDestination>({
    status: "loading",
  });
  const googleSetup = useRef<Promise<GoogleExportDestination> | null>(null);

  const prepareGoogle = useCallback(() => {
    googleSetup.current ??= loadLegalEntityExportOptions().then(
      async (options): Promise<GoogleExportDestination> =>
        options.googleSheetsClientId === null
          ? { status: "unavailable" }
          : {
              status: "ready",
              authorize: await prepareGoogleSheetsAuthorization(
                options.googleSheetsClientId,
              ),
            },
    );
    void googleSetup.current.then(setGoogle).catch(() => {
      googleSetup.current = null;
      setGoogle({
        status: "error",
        message: "Google Sheets could not load. You can still download CSV.",
      });
    });
  }, []);
  useEffect(() => {
    if (expanded) prepareGoogle();
  }, [expanded, prepareGoogle]);

  const selectedFields = LEGAL_ENTITY_EXPORT_FIELDS.filter((field) =>
    fields.has(field),
  );
  const exportInput = {
    fields: selectedFields,
    includeNeedsReview,
    includeHistorical,
    includeOtherEntityTypes,
  };
  const selection = JSON.stringify({
    input: exportInput,
    asOf: inventory.asOf,
  });
  const reviewedLlcCount = inventory.entities.filter(
    (entity) => entity.entityType === "llc" && !isHistoricalLegalEntity(entity),
  ).length;
  const sourceNameReviewCount = inventory.candidates.filter(
    (candidate) => candidate.legalEntityNameEvidence.legalName !== null,
  ).length;
  const conflictingNameCount = inventory.candidates.filter(
    (candidate) =>
      candidate.legalEntityNameEvidence.state === "unavailable" &&
      candidate.legalEntityNameEvidence.problem === "conflicting",
  ).length;
  const unavailableNameCount =
    inventory.candidates.length - sourceNameReviewCount - conflictingNameCount;

  const toggleField = (field: LegalEntityExportField, checked: boolean) => {
    setFields((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(field);
      } else {
        next.delete(field);
      }
      return next;
    });
  };

  const download = async () => {
    if (busy.current || selectedFields.length === 0) return;
    busy.current = true;
    setWorking("csv");
    setError(null);
    setUncertain(false);
    try {
      const result = await downloadLegalEntityExport(exportInput);
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The export could not be prepared.",
      );
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  const exportToGoogle = async () => {
    if (
      busy.current ||
      google.status !== "ready" ||
      selectedFields.length === 0 ||
      createdSheet?.selection === selection
    )
      return;
    busy.current = true;
    setWorking("google");
    setError(null);
    setUncertain(false);
    try {
      const token = await google.authorize();
      const table = await loadLegalEntityExportTable(exportInput);
      const url = await createGoogleSheet(table, token);
      setCreatedSheet({ url, selection });
    } catch (caught) {
      setUncertain(caught instanceof GoogleSheetsCreationUncertainError);
      setError(
        caught instanceof Error
          ? caught.message
          : "The Google Sheet could not be created.",
      );
    } finally {
      busy.current = false;
      setWorking(null);
    }
  };

  return (
    <Collapsible
      className="legal-entity-export-disclosure"
      open={expanded}
      onOpenChange={setExpanded}
    >
      <PageHeader
        className="legal-entities__header"
        title="Legal entities"
        description="For counsel. This inventory does not transfer interests to a trust."
        actions={
          <CollapsibleTrigger render={<Button tone="secondary" />}>
            <span>Export</span>
            <DisclosureIndicator />
          </CollapsibleTrigger>
        }
      />
      <CollapsibleContent keepMounted>
        <section
          aria-labelledby="legal-entity-export-title"
          className="legal-entity-export"
        >
          <SectionHeader
            description="Choose records and columns. Financial details are optional."
            headingProps={{ id: "legal-entity-export-title" }}
            title="Export legal entities"
          />
          <ActionGroup
            className="legal-entity-export__actions"
            wrap
            mobileLayout="stack"
          >
            <Button
              disabled={working !== null || selectedFields.length === 0}
              onClick={() => void download()}
              tone={google.status === "ready" ? "secondary" : "primary"}
            >
              {working === "csv"
                ? "Preparing…"
                : `Download CSV · ${selectedFields.length} columns`}
            </Button>
            {google.status === "ready" && (
              <Button
                disabled={
                  working !== null ||
                  selectedFields.length === 0 ||
                  createdSheet?.selection === selection
                }
                onClick={() => void exportToGoogle()}
                tone="primary"
              >
                {working === "google"
                  ? "Creating Google Sheet…"
                  : createdSheet?.selection === selection
                    ? "Google Sheet created"
                    : "Create Google Sheet"}
              </Button>
            )}
          </ActionGroup>
          <p className="legal-entity-export__destination-help">
            {google.status === "ready"
              ? "Google will ask you to choose an account and allow Keel to create this sheet. It will not be shared automatically."
              : google.status === "loading"
                ? "Checking Google Sheets availability…"
                : google.status === "error"
                  ? google.message
                  : "You can import the CSV into Google Sheets."}
            {google.status === "error" && (
              <>
                {" "}
                <TextLink
                  onClick={() => {
                    setGoogle({ status: "loading" });
                    prepareGoogle();
                  }}
                >
                  Try Google Sheets again
                </TextLink>
              </>
            )}
          </p>
          {error !== null && (
            <FormMessage tone="error">
              {error}{" "}
              {uncertain && (
                <TextLink
                  href="https://drive.google.com/drive/recent"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Check Google Drive
                </TextLink>
              )}
            </FormMessage>
          )}
          {createdSheet !== null && (
            <FormMessage tone="success">
              <TextLink
                href={createdSheet.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Sheet
              </TextLink>
            </FormMessage>
          )}
          {selectedFields.length === 0 && (
            <FormMessage tone="error">Choose at least one column.</FormMessage>
          )}
          <div className="legal-entity-export__scope">
            <div>
              <h3>Records</h3>
              <p>
                {reviewedLlcCount} reviewed{" "}
                {reviewedLlcCount === 1 ? "LLC" : "LLCs"}
                {" · "}
                {sourceNameReviewCount} source{" "}
                {sourceNameReviewCount === 1 ? "name" : "names"} to review
                {" · "}
                {unavailableNameCount} missing legal{" "}
                {unavailableNameCount === 1 ? "name" : "names"}
                {conflictingNameCount > 0 &&
                  ` · ${conflictingNameCount} ${conflictingNameCount === 1 ? "name conflict" : "name conflicts"}`}
              </p>
            </div>
            <Checkbox
              checked={includeNeedsReview}
              onCheckedChange={setIncludeNeedsReview}
              label="Include unresolved source records"
            />
            <Checkbox
              checked={includeHistorical}
              onCheckedChange={setIncludeHistorical}
              label="Include historical and cancelled investments"
            />
            <Checkbox
              checked={includeOtherEntityTypes}
              onCheckedChange={setIncludeOtherEntityTypes}
              label="Include non-LLC entities"
            />
          </div>
          <div className="legal-entity-export__fields">
            <div className="legal-entity-export__fields-heading">
              <h3>Columns</h3>
              <TextLink
                onClick={() =>
                  setFields(new Set(DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS))
                }
              >
                Use recommended fields
              </TextLink>
            </div>
            <div className="legal-entity-export__field-grid">
              {LEGAL_ENTITY_EXPORT_FIELDS.map((field) => (
                <Checkbox
                  key={field}
                  checked={fields.has(field)}
                  onCheckedChange={(checked) => toggleField(field, checked)}
                  label={LEGAL_ENTITY_EXPORT_FIELD_LABELS[field]}
                />
              ))}
            </div>
          </div>
        </section>
      </CollapsibleContent>
    </Collapsible>
  );
}

const LEGAL_ENTITY_PAGE_SIZE = 25;

function ProgressiveRows<T>({
  items,
  render,
  label,
  mode = "manual",
}: {
  items: readonly T[];
  render: (item: T) => ReactNode;
  label: string;
  mode?: "manual" | "automatic";
}) {
  const [visible, setVisible] = useState(LEGAL_ENTITY_PAGE_SIZE);
  const rows = useRef<HTMLDivElement>(null);
  const focusNewRow = useRef<number | null>(null);
  const visibleItems = items.slice(0, visible);
  const more = visibleItems.length < items.length;
  const loadMore = useCallback(
    (source: "manual" | "automatic") => {
      if (source === "manual") focusNewRow.current = visible;
      setVisible((count) => count + LEGAL_ENTITY_PAGE_SIZE);
    },
    [visible],
  );
  useEffect(() => {
    const index = focusNewRow.current;
    if (index === null) return;
    rows.current?.children[index]
      ?.querySelector<HTMLElement>("a[href], button")
      ?.focus();
    focusNewRow.current = null;
  }, [visible]);
  return (
    <>
      <div ref={rows}>{visibleItems.map(render)}</div>
      {more && (
        <CollectionFooter
          className="legal-entities__pagination"
          shown={visibleItems.length}
          total={items.length}
          label={label}
          hasMore={more}
          mode={mode}
          onLoadMore={loadMore}
        />
      )}
    </>
  );
}

export function LegalEntities(props: { navigationVersion: number }) {
  const params = new URLSearchParams(window.location.search);
  const publicId = params.get("public");
  const returnPosition = HoldingSchema.shape.id
    .max(200)
    .safeParse(params.get("returnPosition"));
  if (publicId)
    return (
      <PublicCompanyLinkEditor
        key={publicId}
        exposureId={publicId}
        {...(returnPosition.success
          ? { returnPositionId: returnPosition.data }
          : {})}
      />
    );
  return new URLSearchParams(window.location.search).get("companies") ===
    "1" ? (
    <CompanyNames />
  ) : (
    <LegalEntitiesInventory {...props} />
  );
}
function LegalEntitiesInventory({
  navigationVersion,
}: {
  navigationVersion: number;
}) {
  const [inventory, setInventory] = useState<LegalEntityInventory | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const searchIndex = useMemo(
    () => (inventory === null ? null : buildLegalEntitySearchIndex(inventory)),
    [inventory],
  );
  const searchMatches = useMemo(
    () => searchLegalEntities(searchIndex, searchQuery),
    [searchIndex, searchQuery],
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batchWorking, setBatchWorking] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [automaticWorking, setAutomaticWorking] = useState(false);
  const [automaticError, setAutomaticError] = useState<string | null>(null);
  const [automaticCursor, setAutomaticCursor] = useState<string | null>(null);
  const automaticAbort = useRef<AbortController | null>(null);
  const [location, setLocation] = useState(() =>
    entityReviewLocation(window.location.search),
  );
  const [sectionNavigationVersion, setSectionNavigationVersion] =
    useState(navigationVersion);
  if (sectionNavigationVersion !== navigationVersion) {
    setSectionNavigationVersion(navigationVersion);
    setLocation(entityReviewLocation(window.location.search));
  }
  const listScroll = useRef(0);
  const inventorySection = useRef<HTMLElement>(null);
  const returnEntityId = useRef<string | null>(null);
  useEffect(() => {
    const pop = () => setLocation(entityReviewLocation(window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const targetKind = location.target?.kind;
  const targetId = location.target?.id;
  useEffect(() => {
    if (targetKind === "entity" && targetId !== undefined)
      returnEntityId.current = targetId;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({
        top: targetKind === undefined ? listScroll.current : 0,
        behavior: "instant",
      });
      if (targetKind !== undefined || returnEntityId.current === null) return;

      const id = returnEntityId.current;
      returnEntityId.current = null;
      const section = inventorySection.current;
      const row = section?.querySelector<HTMLAnchorElement>(
        `[data-legal-entity-id="${CSS.escape(id)}"]`,
      );
      const focusTarget = row?.getClientRects().length
        ? row
        : section?.querySelector<HTMLElement>(
            '[role="tab"][aria-selected="true"]',
          );
      focusTarget?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [targetKind, targetId]);
  const navigate = (
    target: EntityReviewTarget | null,
    tab: EntityReviewTab = "identity",
  ) => {
    if (location.target === null) listScroll.current = window.scrollY;
    window.history.pushState(
      { ...window.history.state },
      "",
      entityReviewUrl(target, tab),
    );
    setLocation({ target, tab });
  };
  const changeTab = (tab: EntityReviewTab) => {
    window.history.replaceState(
      window.history.state,
      "",
      entityReviewUrl(location.target, tab),
    );
    setLocation((current) => ({ ...current, tab }));
  };
  const openSource = (source: LegalEntitySourceSummary) =>
    navigate(
      source.source,
      legalReviewIssues(source.automaticReview)[0]?.section === "documents" ||
        legalEntityReviewKind(source) === "waiting"
        ? "documents"
        : "identity",
    );

  const refresh = useCallback(async () => {
    const next = await loadLegalEntities();
    setInventory(next);
    setLoadError(null);
  }, []);

  const resolveAutomatically = useCallback(
    async (cursor: string | null = null) => {
      if (automaticAbort.current !== null) return;
      const controller = new AbortController();
      automaticAbort.current = controller;
      setAutomaticWorking(true);
      setAutomaticError(null);
      const timeout = window.setTimeout(() => controller.abort(), 30_000);
      let changed = false;
      try {
        for (let batch = 0; batch < 5; batch++) {
          const result = await resolveInvestmentReviews(
            cursor,
            controller.signal,
          );
          changed ||= result.changedCount > 0;
          cursor = result.nextPositionId;
          setAutomaticCursor(cursor);
          if (cursor === null) break;
        }
        if (changed && !controller.signal.aborted) {
          const next = await loadLegalEntities(controller.signal);
          if (!controller.signal.aborted) setInventory(next);
        }
      } catch (error) {
        if (automaticAbort.current === controller)
          setAutomaticError(
            error instanceof Error && !controller.signal.aborted
              ? error.message
              : "Automatic review paused. Your saved records are available.",
          );
      } finally {
        window.clearTimeout(timeout);
        if (automaticAbort.current === controller) {
          automaticAbort.current = null;
          setAutomaticWorking(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadLegalEntities(controller.signal)
        .then((next) => {
          if (!cancelled) {
            setInventory(next);
            setLoadError(null);
            if (
              [
                ...next.candidates,
                ...next.entities.flatMap((entity) => entity.sources),
              ].some((source) => source.source.kind === "holding_position")
            )
              void resolveAutomatically();
          }
        })
        .catch((caught) => {
          if (!cancelled && !controller.signal.aborted) {
            setLoadError(
              caught instanceof Error
                ? caught.message
                : "Legal entities could not be loaded.",
            );
          }
        })
        .finally(() => {
          if (!cancelled) {
            setLoading(false);
          }
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      cancelled = true;
      controller.abort();
      automaticAbort.current?.abort();
      automaticAbort.current = null;
    };
  }, [resolveAutomatically]);

  const activeEntities = useMemo(
    () =>
      inventory?.entities.filter(
        (entity) =>
          !isHistoricalLegalEntity(entity) &&
          (searchMatches === null || searchMatches.entityIds.has(entity.id)),
      ) ?? [],
    [inventory, searchMatches],
  );
  const candidates = useMemo(
    () =>
      [
        ...new Map(
          [
            ...(inventory?.candidates ?? []),
            ...(inventory?.entities.flatMap((entity) =>
              entity.sources.filter(
                (source) =>
                  legalReviewIssues(source.automaticReview).length > 0,
              ),
            ) ?? []),
          ].map((source) => [candidateKey(source), source]),
        ).values(),
      ]
        .filter(needsLegalEntityReview)
        .sort(compareLegalEntityAttention),
    [inventory],
  );
  const historicalEntities = useMemo(
    () =>
      inventory?.entities.filter(
        (entity) =>
          isHistoricalLegalEntity(entity) &&
          (searchMatches === null || searchMatches.entityIds.has(entity.id)),
      ) ?? [],
    [inventory, searchMatches],
  );

  const duplicateLegalNames = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const item of [
      ...(inventory?.candidates ?? []),
      ...(inventory?.entities.flatMap((entity) => entity.sources) ?? []),
    ]) {
      const name = item.legalEntityNameEvidence.legalName;
      if (item.source.kind !== "holding_position" || name === null) continue;
      const ids = counts.get(name) ?? new Set<string>();
      ids.add(item.source.id);
      counts.set(name, ids);
    }
    return new Set(
      [...counts].filter(([, ids]) => ids.size > 1).map(([name]) => name),
    );
  }, [inventory]);

  const visibleCandidates = useMemo(
    () =>
      searchMatches === null
        ? candidates
        : candidates.filter((candidate) =>
            searchMatches.sourceKeys.has(candidateKey(candidate)),
          ),
    [candidates, searchMatches],
  );
  const excludedCandidates = useMemo(
    () =>
      (inventory?.excludedCandidates ?? []).filter(
        (candidate) =>
          searchMatches === null ||
          searchMatches.sourceKeys.has(candidateKey(candidate)),
      ),
    [inventory, searchMatches],
  );
  const resultCount =
    activeEntities.length +
    historicalEntities.length +
    visibleCandidates.length +
    excludedCandidates.length;
  const entityGroups = [
    { value: "current", label: "Current", entities: activeEntities },
    { value: "historical", label: "Historical", entities: historicalEntities },
  ] as const;

  const saved = async () => {
    await refresh();
    await resolveAutomatically();
    setNotice(null);
  };

  const applyExactBatch = async (expectedRevision: string) => {
    setBatchWorking(true);
    setBatchError(null);
    try {
      const result = await applyLegalEntityExactBatch({
        expectedRevision,
      });
      await refresh();
      setNotice(
        `${result.reviewedSourceCount} ${
          result.reviewedSourceCount === 1 ? "source was" : "sources were"
        } reviewed into ${result.entityCount} legal ${
          result.entityCount === 1 ? "entity" : "entities"
        }.${
          result.remainingCandidateCount === 0
            ? ""
            : ` ${result.remainingCandidateCount} ${
                result.remainingCandidateCount === 1
                  ? "source record remains"
                  : "source records remain"
              } unresolved.`
        }`,
      );
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The exact legal entity review could not be saved.";
      try {
        await refresh();
      } catch {
        // Keep the original action error visible if the refresh also fails.
      }
      setBatchError(message);
    } finally {
      setBatchWorking(false);
    }
  };

  if (loading) {
    return (
      <div aria-live="polite" className="legal-entities__loading">
        Loading legal entities…
      </div>
    );
  }

  if (inventory === null) {
    return (
      <Notice tone="error">
        <p>{loadError ?? "Legal entities could not be loaded."}</p>
        <Button
          onClick={() => {
            setLoading(true);
            void refresh()
              .catch((caught) =>
                setLoadError(
                  caught instanceof Error
                    ? caught.message
                    : "Legal entities could not be loaded.",
                ),
              )
              .finally(() => setLoading(false));
          }}
          tone="secondary"
        >
          Try again
        </Button>
      </Notice>
    );
  }

  return (
    <>
      {location.target !== null && (
        <EntityReviewWorkspace
          key={`${location.target.kind}:${location.target.id}`}
          target={location.target}
          inventory={inventory}
          tab={location.tab}
          onTabChange={changeTab}
          onSaved={saved}
          onBack={() => navigate(null)}
          candidates={candidates}
          onOpenSource={openSource}
        />
      )}
      <div hidden={location.target !== null} className="legal-entities">
        <div className="legal-entities__intro">
          <ExportWorkspace inventory={inventory} />
          <TextLink href="/holdings/entities?companies=1">
            Manage company names
          </TextLink>
          <SearchField
            className="legal-entities__search"
            label="Search legal entities"
            placeholder="Search legal entities or companies…"
            onValueChange={setSearchQuery}
            value={searchQuery}
            resultLabel={
              searchMatches === null
                ? undefined
                : `${resultCount} ${resultCount === 1 ? "result" : "results"}`
            }
          />
          {automaticWorking && searchMatches === null && (
            <p className="legal-entities__notice" role="status">
              Checking source details automatically…
            </p>
          )}
          {automaticError !== null && (
            <Notice tone="error">
              {automaticError}{" "}
              <TextLink
                onClick={() => void resolveAutomatically(automaticCursor)}
              >
                Retry automatic review
              </TextLink>
            </Notice>
          )}
          {!automaticWorking &&
            automaticError === null &&
            automaticCursor !== null && (
              <Button
                tone="secondary"
                onClick={() => void resolveAutomatically(automaticCursor)}
              >
                Continue automatic review
              </Button>
            )}
          {notice !== null && (
            <FormMessage className="legal-entities__notice" tone="success">
              {notice}
            </FormMessage>
          )}
          {loadError !== null && <Notice tone="error">{loadError}</Notice>}
        </div>
        {visibleCandidates.length > 0 && (
          <Collapsible
            className="legal-entities__candidates"
            key={`candidates:${searchQuery}`}
            defaultOpen={searchMatches !== null}
          >
            <h2 id="legal-entity-candidates-title">
              <CollapsibleTrigger>
                <span>Needs your review · {visibleCandidates.length}</span>
                <DisclosureIndicator />
              </CollapsibleTrigger>
            </h2>
            <CollapsibleContent>
              {searchMatches === null &&
                inventory.exactBatch.sourceCount > 0 && (
                  <ExactBatchReview
                    batch={inventory.exactBatch}
                    error={batchError}
                    onApply={() =>
                      applyExactBatch(inventory.exactBatch.revision)
                    }
                    working={batchWorking}
                  />
                )}
              <div className="legal-entities__candidate-list">
                <ProgressiveRows
                  items={visibleCandidates}
                  key={searchQuery}
                  label="sources"
                  render={(candidate) => (
                    <CandidateRow
                      candidate={candidate}
                      key={candidateKey(candidate)}
                      canLinkInvestment={
                        candidate.legalEntityNameEvidence.legalName !== null &&
                        duplicateLegalNames.has(
                          candidate.legalEntityNameEvidence.legalName,
                        )
                      }
                      onOpen={() => openSource(candidate)}
                      searchQuery={searchQuery}
                    />
                  )}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        <section
          aria-labelledby="known-legal-entities-title"
          className="legal-entities__known"
          ref={inventorySection}
        >
          <SectionHeader
            action={
              <Button
                tone="quiet"
                onClick={() => navigate({ kind: "new", id: "manual" })}
              >
                Add entity
              </Button>
            }
            headingProps={{ id: "known-legal-entities-title" }}
            title="Known legal entities"
          />
          <Tabs defaultValue="current">
            <TabsList aria-label="Legal entity inventory" variant="line">
              {entityGroups.map(({ value, label, entities }) => (
                <TabsTrigger key={value} value={value}>
                  {label} · {entities.length}
                </TabsTrigger>
              ))}
            </TabsList>
            {entityGroups.map(({ value, entities }) => (
              <TabsContent key={value} value={value}>
                {entities.length === 0 ? (
                  <EmptyState
                    compact
                    headingAs="h3"
                    icon={null}
                    title={
                      searchMatches !== null
                        ? `No matching ${value} entities`
                        : value === "current"
                          ? "No current legal entities"
                          : "No historical interests"
                    }
                  >
                    {searchMatches === null && value === "current"
                      ? "Add an entity or review a source."
                      : undefined}
                  </EmptyState>
                ) : (
                  <ProgressiveRows
                    items={entities}
                    key={searchQuery}
                    label={
                      value === "current" ? "entities" : "historical entities"
                    }
                    mode={
                      excludedCandidates.length === 0 ? "automatic" : "manual"
                    }
                    render={(entity) => (
                      <EntityRow
                        entity={entity}
                        key={entity.id}
                        searchQuery={searchQuery}
                        onOpen={() =>
                          navigate({ kind: "entity", id: entity.id })
                        }
                      />
                    )}
                  />
                )}
              </TabsContent>
            ))}
          </Tabs>
        </section>
        {excludedCandidates.length > 0 && (
          <Collapsible
            className="legal-entities__excluded"
            key={`excluded:${searchQuery}`}
            defaultOpen={searchMatches !== null}
          >
            <CollapsibleTrigger>
              <span>
                Sources excluded from inventory · {excludedCandidates.length}
              </span>
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="legal-entities__candidate-list">
                <ProgressiveRows
                  items={excludedCandidates}
                  key={searchQuery}
                  label="excluded sources"
                  mode="automatic"
                  render={(candidate) => (
                    <CandidateRow
                      candidate={candidate}
                      excluded
                      key={candidateKey(candidate)}
                      onOpen={() => openSource(candidate)}
                      searchQuery={searchQuery}
                    />
                  )}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </>
  );
}
