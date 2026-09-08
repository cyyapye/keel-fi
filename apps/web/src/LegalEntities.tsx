import {
  DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
  LEGAL_ENTITY_EXPORT_FIELD_LABELS,
  LEGAL_ENTITY_EXPORT_FIELDS,
  LegalEntityProfileInputSchema,
  formatOwnershipInterestPpm,
  exactLegalEntityTypeFromName,
  legalEntityReviewKind,
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
import { InvestmentReview } from "./InvestmentReview";
import {
  ActionGroup,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DatePicker,
  DisclosureIndicator,
  EmptyState,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Notice,
  PageHeader,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextLink,
  Textarea,
} from "@keel/ui";
import {
  type FormEvent,
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
  createLegalEntity,
  downloadLegalEntityDocument,
  downloadLegalEntityExport,
  loadLegalEntities,
  reviewLegalEntitySource,
  recheckLegalEntityDocument,
  updateLegalEntity,
} from "./api";
import { formatDate } from "./format";
import {
  entityReviewLocation,
  entityReviewUrl,
  type EntityReviewTarget,
  type EntityReviewTab,
} from "./legal-entity-navigation";

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

const interestStatusLabels = Object.fromEntries(
  interestStatusOptions.map((option) => [option.value, option.label]),
) as Readonly<Record<LegalEntityInterestStatus, string>>;

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

function AgreementEvidence({
  sources,
}: {
  sources: readonly LegalEntitySourceSummary[];
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
  const documents = [
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
            .filter((document) => document.scan === undefined)
            .map((document) => document.id)
        : [],
    ),
  );
  const incompleteIds = new Set(
    sources.flatMap((source) =>
      source.legalEntityNameEvidence.state === "unavailable" &&
      source.legalEntityNameEvidence.problem === "scanner_unavailable"
        ? (source.legalEntityNameEvidence.documents ?? [])
            .filter((document) => document.scan === undefined)
            .map((document) => document.id)
        : [],
    ),
  );
  if (documents.length === 0) return null;
  return (
    <Collapsible className="legal-entity-documents">
      <CollapsibleTrigger>
        <span>Agreement evidence · {documents.length}</span>
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul>
          {documents.map((document) => {
            const blocked =
              document.scan?.outcome === "blocked" ||
              unavailableIds.has(document.id) ||
              denied.has(document.id);
            const findings =
              document.scan?.version === 2 &&
              document.scan.outcome === "blocked"
                ? document.scan.findings
                : blocked && !incompleteIds.has(document.id)
                  ? [{ reason: "unknown_alert" as const, signature: null }]
                  : [];
            return (
              <li key={document.id}>
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
                    {document.page === null
                      ? ""
                      : ` · page ${document.page.toString()}`}
                  </TextLink>
                )}
                {document.quote !== null && <p>{document.quote}</p>}
                {document.structure !== undefined && !blocked && (
                  <p>
                    {document.structure.quote} · page {document.structure.page}
                  </p>
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
              </li>
            );
          })}
        </ul>
        {error !== null && <FormMessage tone="error">{error}</FormMessage>}
      </CollapsibleContent>
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
}: {
  entity: LegalEntityRecord;
  onOpen: () => void;
}) {
  const positions = entity.sources.filter(
    (source) => source.source.kind === "holding_position",
  );
  const owners = [
    ...new Set(
      positions.flatMap((source) =>
        source.currentOwner === null ? [] : [source.currentOwner],
      ),
    ),
  ];
  const statuses = [
    ...new Set(
      positions.map(
        (source) =>
          source.investmentReview?.participationStatus ?? source.interestStatus,
      ),
    ),
  ];
  const ownership = positions.flatMap((source) => {
    const observations = source.investmentReview?.ownershipObservations ?? [];
    return observations
      .filter(
        (item) =>
          !observations.some(
            (later) => later.supersedesObservationId === item.id,
          ),
      )
      .map(
        (item) =>
          `${source.sourceDisplayName}: ${item.sourceKind === "k1" ? `K-1 ${item.taxYear} shares recorded` : `${formatOwnershipInterestPpm(item.ownershipPpm ?? 0)} · ${item.effectiveDate}`}`,
      );
  });
  return (
    <article className="legal-entity-row">
      <div className="legal-entity-row__heading">
        <div>
          <h3>{entity.legalName}</h3>
          <p>
            {entityTypeLabels[entity.entityType]} ·{" "}
            {relationshipLabels[entity.relationship]}
          </p>
        </div>
        {(positions.length > 0
          ? statuses.some((status) => status !== "current")
          : entity.interestStatus !== "current") && (
          <Badge tone="warning">
            {positions.length > 0
              ? statuses
                  .map((status) =>
                    status === "unknown"
                      ? "Not confirmed"
                      : `${status[0]?.toUpperCase()}${status.slice(1)}`,
                  )
                  .join(" · ")
              : interestStatusLabels[entity.interestStatus]}
          </Badge>
        )}
      </div>
      <DataList className="legal-entity-row__facts">
        <DataItem
          label="Current titled owner"
          value={owners.join("; ") || entity.currentOwner || "Not recorded"}
        />
        <DataItem
          label="Jurisdiction"
          value={entity.jurisdiction ?? "Not recorded"}
        />
        <DataItem
          label="Ownership interest"
          value={
            ownership.length > 0
              ? ownership.join("; ")
              : entity.ownershipInterestPpm === null
                ? "Not recorded"
                : `${formatOwnershipInterestPpm(entity.ownershipInterestPpm)}${positions.length === 0 ? "" : " · earlier entity-level entry"}`
          }
        />
      </DataList>
      {positions.length > 0 &&
        entity.ownershipInterestPpm !== null &&
        ownership.length > 0 && (
          <p>
            Earlier entity-level entry:{" "}
            {formatOwnershipInterestPpm(entity.ownershipInterestPpm)}. This has
            not been assigned to a particular investment.
          </p>
        )}
      {positions.length > 0 &&
        entity.currentOwner !== null &&
        owners.length > 0 &&
        !owners.includes(entity.currentOwner) && (
          <p>Earlier entity-level owner: {entity.currentOwner}.</p>
        )}
      {positions.length > 0 &&
        entity.interestStatus === "historical" &&
        !statuses.every((status) => status === "historical") && (
          <p>
            Earlier entity-level status: Historical. Confirm participation for
            each investment.
          </p>
        )}
      <footer>
        <div>
          <p>
            {entity.sources.length === 0
              ? "Manual record"
              : entity.sources.map(sourceSummary).join("; ")}
          </p>
          <AgreementEvidence sources={entity.sources} />
          {entity.sources
            .filter((source) => source.nameResolution !== undefined)
            .map((source) => {
              const resolution = source.nameResolution;
              return resolution === undefined ? null : (
                <p key={candidateKey(source)}>
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
              );
            })}
        </div>
        <TextLink onClick={onOpen}>Edit</TextLink>
      </footer>
    </article>
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
  onOpen,
}: {
  candidate: LegalEntitySourceSummary;
  excluded?: boolean;
  onOpen: () => void;
}) {
  const kind = legalEntityReviewKind(candidate);
  return (
    <article className="legal-entity-candidate">
      <div className="legal-entity-candidate__copy">
        <div>
          <h3>
            {candidate.legalEntityNameEvidence.legalName ??
              candidate.sourceDisplayName}
          </h3>
          <Badge tone="warning">
            {excluded
              ? "Excluded"
              : kind === "found"
                ? "Needs review"
                : kind === "conflict"
                  ? "Names disagree"
                  : kind === "structure"
                    ? "Review structure"
                    : kind === "document"
                      ? "Review PDF"
                      : "Name unavailable"}
          </Badge>
        </div>
        <p>{sourceSummary(candidate)}</p>
        <p>
          {kind === "conflict"
            ? "Compare the agreements or separate different investments."
            : kind === "structure"
              ? "Confirm the named vehicle and its structure."
              : kind === "document"
                ? "Read the agreement and enter its exact legal name."
                : kind === "found"
                  ? `Legal name reported in ${candidate.legalEntityNameEvidence.sourceField}.`
                  : "Open source options to see what is missing."}
        </p>
      </div>
      <Button tone="secondary" onClick={onOpen}>
        {candidateAction(candidate)}
      </Button>
    </article>
  );
}

function EntityReviewWorkspace({
  target,
  inventory,
  tab,
  onTabChange,
  onSaved,
  onBack,
  onNext,
}: {
  target: EntityReviewTarget;
  inventory: LegalEntityInventory;
  tab: EntityReviewTab;
  onTabChange: (tab: EntityReviewTab) => void;
  onSaved: () => Promise<void>;
  onBack: () => void;
  onNext?: (() => void) | undefined;
}) {
  const [resolution, setResolution] = useState<LegalNameResolutionInput>();
  const [mode, setMode] = useState("new");
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
  const legalName =
    resolution?.legalName ?? source?.legalEntityNameEvidence.legalName;
  const matches = inventory.entities.filter(
    (item) => item.legalName === legalName,
  );
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
        !matches.some((item) => item.id === selectedEntityId))
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
            ? { kind, legalEntityId: selectedEntityId }
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
        <fieldset className="entity-review__destination">
          <legend>Legal entity</legend>
          <label>
            <Input
              type="radio"
              name="entity-destination"
              checked={mode === "new"}
              onChange={() => setMode("new")}
            />
            Create new entity
          </label>
          <label>
            <Input
              type="radio"
              name="entity-destination"
              checked={mode === "existing"}
              onChange={() => setMode("existing")}
            />
            Link existing entity
          </label>
        </fieldset>
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
      {editor !== null && (entity !== undefined || mode === "new") && (
        <LegalEntityEditor
          key={entity?.versionId ?? resolution?.legalName ?? "new"}
          editor={editor}
          onCancel={onBack}
          onSaved={saved}
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
                  value={selectedEntityId || null}
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
                  !matches.some((item) => item.id === selectedEntityId)
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
  const documents =
    source === undefined ? null : (
      <>
        <AgreementEvidence sources={[source]} />
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
        <TextLink href="/holdings/sources">Source options</TextLink>
      </>
    );
  return (
    <div className="entity-review">
      <div className="entity-review__navigation">
        <TextLink onClick={onBack}>Back to legal entities</TextLink>
        {onNext && <TextLink onClick={onNext}>Next needing review</TextLink>}
      </div>
      <PageHeader
        eyebrow="Investment review"
        title={
          source?.sourceDisplayName ??
          entity?.legalName ??
          (target.kind === "new" ? "New legal entity" : "Review unavailable")
        }
        description={
          source
            ? `Provider record · ${source.sourceLabel} · ${formatDate(source.sourceAsOf)}`
            : "Your legal entity inventory"
        }
      />
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
      {source?.source.kind === "holding_position" ? (
        <InvestmentReview
          key={source.source.id}
          positionId={source.source.id}
          sourceLabel={source.sourceLabel}
          identity={identity}
          identitySaved={entity !== undefined}
          documents={documents}
          tab={tab}
          onTabChange={onTabChange}
          onSaved={saved}
        />
      ) : (
        <div className="entity-review__panel">
          {identity}
          {documents}
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
      : ` ${batch.remainingCandidateCount} source ${
          batch.remainingCandidateCount === 1
            ? "record remains"
            : "records remain"
        } outside this batch.`;

  return (
    <div className="legal-entity-exact-batch">
      <div>
        <p className="eyebrow">Source-reported names</p>
        <h3>
          {batch.sourceCount} source-reported{" "}
          {batch.sourceCount === 1 ? "name can" : "names can"} be reviewed
          together
        </h3>
        <p>
          {typeSummary} {batch.entityCount === 1 ? "comes" : "come"} directly
          from source records. {batch.entityCount} exact legal{" "}
          {batch.entityCount === 1 ? "name" : "names"} will be added or linked;
          duplicate source rows share one record.{existingCopy}
          {remainingCopy}
        </p>
        {error !== null && (
          <FormMessage className="legal-entity-exact-batch__error" tone="error">
            {error}
          </FormMessage>
        )}
      </div>
      <Button disabled={working} onClick={() => void onApply()} tone="primary">
        {working
          ? "Reviewing…"
          : `Add or link ${batch.sourceCount} ${
              batch.sourceCount === 1 ? "source" : "sources"
            }`}
      </Button>
    </div>
  );
}

function ExportWorkspace({ inventory }: { inventory: LegalEntityInventory }) {
  const [fields, setFields] = useState<ReadonlySet<LegalEntityExportField>>(
    () => new Set(DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS),
  );
  const [includeNeedsReview, setIncludeNeedsReview] = useState(true);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [includeOtherEntityTypes, setIncludeOtherEntityTypes] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedFields = LEGAL_ENTITY_EXPORT_FIELDS.filter((field) =>
    fields.has(field),
  );
  const reviewedLlcCount = inventory.entities.filter(
    (entity) =>
      entity.entityType === "llc" && entity.interestStatus !== "historical",
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
    setWorking(true);
    setError(null);
    try {
      const result = await downloadLegalEntityExport({
        fields: selectedFields,
        includeNeedsReview,
        includeHistorical,
        includeOtherEntityTypes,
      });
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
      setWorking(false);
    }
  };

  return (
    <section
      aria-labelledby="legal-entity-export-title"
      className="legal-entity-export"
    >
      <SectionHeader
        description="Recommended fields cover identity, ownership, status, provenance, and gaps. Financial details remain optional."
        eyebrow="Counsel copy"
        headingProps={{ id: "legal-entity-export-title" }}
        title="Choose what to export"
      />
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
        <label>
          <Input
            checked={includeNeedsReview}
            onChange={(event) =>
              setIncludeNeedsReview(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>Include unresolved source records</span>
        </label>
        <label>
          <Input
            checked={includeHistorical}
            onChange={(event) =>
              setIncludeHistorical(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>Include historical and cancelled investments</span>
        </label>
        <label>
          <Input
            checked={includeOtherEntityTypes}
            onChange={(event) =>
              setIncludeOtherEntityTypes(event.currentTarget.checked)
            }
            type="checkbox"
          />
          <span>Include non-LLC entities</span>
        </label>
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
            <label key={field}>
              <Input
                checked={fields.has(field)}
                onChange={(event) =>
                  toggleField(field, event.currentTarget.checked)
                }
                type="checkbox"
              />
              <span>{LEGAL_ENTITY_EXPORT_FIELD_LABELS[field]}</span>
            </label>
          ))}
        </div>
      </div>
      {error !== null && <FormMessage tone="error">{error}</FormMessage>}
      <ActionGroup
        as="footer"
        className="legal-entity-export__actions"
        layout="split"
        mobileLayout="stack"
      >
        <p>
          The CSV is generated for this download and is not retained by Keel.
        </p>
        <Button
          disabled={working || selectedFields.length === 0}
          onClick={() => void download()}
          tone="primary"
        >
          {working
            ? "Preparing…"
            : `Download CSV · ${selectedFields.length} columns`}
        </Button>
      </ActionGroup>
      {selectedFields.length === 0 && (
        <FormMessage tone="error">Choose at least one column.</FormMessage>
      )}
    </section>
  );
}

const LEGAL_ENTITY_PAGE_SIZE = 25;

function ProgressiveRows<T>({
  items,
  render,
  label,
  keepVisible,
}: {
  items: readonly T[];
  render: (item: T) => ReactNode;
  label: string;
  keepVisible?: (item: T) => boolean;
}) {
  const [visible, setVisible] = useState(LEGAL_ENTITY_PAGE_SIZE);
  const sentinel = useRef<HTMLDivElement>(null);
  const visibleItems = items.filter(
    (item, index) => index < visible || keepVisible?.(item),
  );
  const more = visibleItems.length < items.length;
  const loadMore = useCallback(
    () => setVisible((count) => count + LEGAL_ENTITY_PAGE_SIZE),
    [],
  );
  useEffect(() => {
    const target = sentinel.current;
    if (!more || target === null || typeof IntersectionObserver === "undefined")
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore();
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, visible, loadMore]);
  return (
    <>
      {visibleItems.map(render)}
      {more && (
        <div
          className="exposure-pagination legal-entities__pagination"
          ref={sentinel}
        >
          <span>
            Showing {visibleItems.length} of {items.length} {label}
          </span>
          <Button onClick={loadMore} tone="secondary">
            Load more {label}
          </Button>
        </div>
      )}
    </>
  );
}

export function LegalEntities({
  onBackToHoldings,
}: {
  onBackToHoldings?: () => void;
}) {
  const [inventory, setInventory] = useState<LegalEntityInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [batchWorking, setBatchWorking] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [location, setLocation] = useState(() =>
    entityReviewLocation(window.location.search),
  );
  const listScroll = useRef(0);
  useEffect(() => {
    const pop = () => setLocation(entityReviewLocation(window.location.search));
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const targetKind = location.target?.kind;
  const targetId = location.target?.id;
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      window.scrollTo({
        top: targetKind === undefined ? listScroll.current : 0,
        behavior: "instant",
      }),
    );
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
      legalEntityReviewKind(source) === "waiting" ? "documents" : "identity",
    );

  const refresh = useCallback(async () => {
    const next = await loadLegalEntities();
    setInventory(next);
    setLoadError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadLegalEntities(controller.signal)
        .then((next) => {
          if (!cancelled) {
            setInventory(next);
            setLoadError(null);
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
    };
  }, []);

  const activeEntities = useMemo(
    () =>
      inventory?.entities.filter(
        (entity) => entity.interestStatus !== "historical",
      ) ?? [],
    [inventory],
  );
  const candidates = useMemo(
    () => [...(inventory?.candidates ?? [])].sort(compareLegalEntityAttention),
    [inventory],
  );
  const historicalEntities = useMemo(
    () =>
      inventory?.entities.filter(
        (entity) => entity.interestStatus === "historical",
      ) ?? [],
    [inventory],
  );

  const saved = async () => {
    await refresh();
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

  const nextCandidate = candidates.find(
    (item) =>
      item.source.kind !== location.target?.kind ||
      item.source.id !== location.target?.id,
  );
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
          onNext={nextCandidate ? () => openSource(nextCandidate) : undefined}
        />
      )}
      <div hidden={location.target !== null} className="legal-entities">
        <PageHeader
          title="Legal entities"
          eyebrow="Holdings"
          description="Prepare an entity and interest list for counsel. This inventory does not transfer anything to a trust."
          actions={
            onBackToHoldings && (
              <TextLink onClick={onBackToHoldings}>Back to holdings</TextLink>
            )
          }
        />
        {notice !== null && (
          <FormMessage className="legal-entities__notice" tone="success">
            {notice}
          </FormMessage>
        )}
        {loadError !== null && <Notice tone="error">{loadError}</Notice>}
        {candidates.length > 0 && (
          <section
            aria-labelledby="legal-entity-candidates-title"
            className="legal-entities__candidates"
          >
            <SectionHeader
              description="Review PDFs and structures first, then conflicting names and names found."
              eyebrow="Review queue"
              headingProps={{ id: "legal-entity-candidates-title" }}
              title="Possible legal entities"
            />
            {inventory.exactBatch.sourceCount > 0 && (
              <ExactBatchReview
                batch={inventory.exactBatch}
                error={batchError}
                onApply={() => applyExactBatch(inventory.exactBatch.revision)}
                working={batchWorking}
              />
            )}
            <div className="legal-entities__candidate-list">
              <ProgressiveRows
                items={candidates}
                label="sources"
                render={(candidate) => (
                  <CandidateRow
                    candidate={candidate}
                    key={candidateKey(candidate)}
                    onOpen={() => openSource(candidate)}
                  />
                )}
              />
            </div>
          </section>
        )}
        <section
          aria-labelledby="known-legal-entities-title"
          className="legal-entities__known"
        >
          <SectionHeader
            action={
              <Button onClick={() => navigate({ kind: "new", id: "manual" })}>
                Add entity
              </Button>
            }
            description="Reviewed records are included in your inventory. Missing values stay visible instead of becoming zero."
            eyebrow="Reviewed inventory"
            headingProps={{ id: "known-legal-entities-title" }}
            title="Known legal entities"
          />
          {activeEntities.length === 0 ? (
            <EmptyState compact title="No reviewed legal entities yet">
              Add an entity or review a source.
            </EmptyState>
          ) : (
            <div className="legal-entities__list">
              <ProgressiveRows
                items={activeEntities}
                label="entities"
                render={(entity) => (
                  <EntityRow
                    entity={entity}
                    key={entity.id}
                    onOpen={() => navigate({ kind: "entity", id: entity.id })}
                  />
                )}
              />
            </div>
          )}
          {historicalEntities.length > 0 && (
            <Collapsible className="legal-entities__history">
              <CollapsibleTrigger>
                <span>Historical interests · {historicalEntities.length}</span>
                <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="legal-entities__list">
                  <ProgressiveRows
                    items={historicalEntities}
                    label="historical entities"
                    render={(entity) => (
                      <EntityRow
                        entity={entity}
                        key={entity.id}
                        onOpen={() =>
                          navigate({ kind: "entity", id: entity.id })
                        }
                      />
                    )}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
        {inventory.excludedCandidates.length > 0 && (
          <Collapsible className="legal-entities__excluded">
            <CollapsibleTrigger>
              <span>
                Sources excluded from inventory ·{" "}
                {inventory.excludedCandidates.length}
              </span>
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="legal-entities__candidate-list">
                <ProgressiveRows
                  items={inventory.excludedCandidates}
                  label="excluded sources"
                  render={(candidate) => (
                    <CandidateRow
                      candidate={candidate}
                      excluded
                      key={candidateKey(candidate)}
                      onOpen={() => openSource(candidate)}
                    />
                  )}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        <ExportWorkspace inventory={inventory} />
      </div>
    </>
  );
}
