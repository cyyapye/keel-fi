import {
  DEFAULT_LEGAL_ENTITY_EXPORT_FIELDS,
  LEGAL_ENTITY_EXPORT_FIELD_LABELS,
  LEGAL_ENTITY_EXPORT_FIELDS,
  formatOwnershipInterestPpm,
  ownershipPercentTextToPpm,
  type LegalEntityExportField,
  type LegalEntityInterestStatus,
  type LegalEntityInventory,
  type LegalEntityProfileInput,
  type LegalEntityRecord,
  type LegalEntityRelationship,
  type LegalEntitySourceSummary,
  type LegalEntityType,
} from "@keel/domain/legal-entities";
import { LEGAL_DOCUMENT_PROBLEM_COPY } from "@keel/domain/provider-legal-documents";
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
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  applyLegalEntityExactBatch,
  createLegalEntity,
  downloadLegalEntityDocument,
  downloadLegalEntityExport,
  loadLegalEntities,
  reviewLegalEntitySource,
  updateLegalEntity,
} from "./api";
import { formatDate } from "./format";

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
  entityId: string | null;
  expectedVersionId: string | null;
  source: {
    reference: LegalEntitySourceSummary["source"];
    expectedDecisionId: string | null;
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

function editorForCandidate(candidate: LegalEntitySourceSummary): EditorState {
  const legalName = candidate.legalEntityNameEvidence.legalName;
  if (legalName === null) {
    throw new Error("A source-reported legal name is required for review.");
  }
  return {
    entityId: null,
    expectedVersionId: null,
    source: {
      reference: candidate.source,
      expectedDecisionId: candidate.currentDecisionId,
    },
    profile: {
      ...emptyProfile(),
      legalName,
      entityType: candidate.suggestedEntityType ?? "llc",
      relationship: candidate.relationship,
      currentOwner: candidate.currentOwner,
      interestStatus: candidate.interestStatus,
    },
    ownershipPercentText: "",
  };
}

function editorForEntity(entity: LegalEntityRecord): EditorState {
  return {
    entityId: entity.id,
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

function sourceKindLabel(kind: LegalEntitySourceSummary["source"]["kind"]) {
  return kind === "ownership_container" ? "Ownership record" : "Position";
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
    } catch {
      setError(
        "The agreement could not be downloaded. Try again or check source access.",
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
  if (documents.length === 0) return null;
  return (
    <Collapsible className="legal-entity-documents">
      <CollapsibleTrigger>
        <span>Agreement evidence · {documents.length}</span>
        <DisclosureIndicator />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul>
          {documents.map((document) => (
            <li key={document.id}>
              <TextLink
                disabled={working}
                onClick={() => void download(document.id, document.fileName)}
              >
                {document.fileName}
                {document.page === null
                  ? ""
                  : ` · page ${document.page.toString()}`}
              </TextLink>
              {document.quote !== null && <p>{document.quote}</p>}
            </li>
          ))}
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
}: {
  editor: EditorState;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(editor);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editing = draft.entityId !== null;

  const setProfile = <Key extends keyof LegalEntityProfileInput>(
    key: Key,
    value: LegalEntityProfileInput[Key],
  ) => {
    setDraft((current) => ({
      ...current,
      profile: { ...current.profile, [key]: value },
    }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const profile: LegalEntityProfileInput = {
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
        ownershipInterestPpm: ownershipPercentTextToPpm(
          draft.ownershipPercentText,
        ),
        taxClassification:
          draft.profile.taxClassification === null
            ? null
            : nullableText(draft.profile.taxClassification),
        notes:
          draft.profile.notes === null
            ? null
            : nullableText(draft.profile.notes),
      };
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
    <section
      aria-labelledby="legal-entity-editor-title"
      className="legal-entity-editor"
    >
      <SectionHeader
        description={
          draft.source === null
            ? "Blank fields stay explicitly unrecorded in the export."
            : `Confirm the legal record suggested by ${sourceKindLabel(draft.source.reference.kind).toLowerCase()}.`
        }
        eyebrow={editing ? "Reviewed record" : "Review before adding"}
        headingProps={{ id: "legal-entity-editor-title" }}
        title={editing ? "Edit legal entity" : "Add legal entity"}
      />
      <form onSubmit={(event) => void submit(event)}>
        <div className="legal-entity-editor__fields">
          <Field label="Legal name" variant="filled" wide>
            <Input
              maxLength={1_000}
              onChange={(event) =>
                setProfile("legalName", event.currentTarget.value)
              }
              required
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
              <SelectTrigger aria-label="Entity type">
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
              onValueChange={(value) => setProfile("formedOn", value || null)}
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
              maxLength={4}
              onChange={(event) =>
                setProfile("einLastFour", event.currentTarget.value)
              }
              pattern="[0-9]{4}"
              placeholder="Not recorded"
              value={draft.profile.einLastFour ?? ""}
            />
          </Field>
          <Field label="Ownership interest" variant="filled">
            <InputGroup suffix="%">
              <Input
                inputMode="decimal"
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
          <Field label="Interest status" variant="filled">
            <Select
              items={interestStatusOptions}
              onValueChange={(value) => {
                if (
                  interestStatusOptions.some((option) => option.value === value)
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
        {error !== null && <FormMessage tone="error">{error}</FormMessage>}
        <ActionGroup
          as="footer"
          className="legal-entity-editor__actions"
          layout="split"
          mobileLayout="stack"
        >
          <p>
            Saving adds a reviewed version. Existing versions remain in the
            audit history.
          </p>
          <ActionGroup align="end" mobileLayout="grid">
            <Button disabled={working} onClick={onCancel} tone="quiet">
              Cancel
            </Button>
            <Button disabled={working} tone="primary" type="submit">
              {working ? "Saving…" : editing ? "Save version" : "Add entity"}
            </Button>
          </ActionGroup>
        </ActionGroup>
      </form>
    </section>
  );
}

function EntityRow({
  entity,
  onEdit,
}: {
  entity: LegalEntityRecord;
  onEdit: () => void;
}) {
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
        {entity.interestStatus !== "current" && (
          <Badge tone="warning">
            {interestStatusLabels[entity.interestStatus]}
          </Badge>
        )}
      </div>
      <DataList className="legal-entity-row__facts">
        <DataItem
          label="Current titled owner"
          value={entity.currentOwner ?? "Not recorded"}
        />
        <DataItem
          label="Jurisdiction"
          value={entity.jurisdiction ?? "Not recorded"}
        />
        <DataItem
          label="Ownership interest"
          value={
            entity.ownershipInterestPpm === null
              ? "Not recorded"
              : formatOwnershipInterestPpm(entity.ownershipInterestPpm)
          }
        />
      </DataList>
      <footer>
        <div>
          <p>
            {entity.sources.length === 0
              ? "Manual record"
              : entity.sources.map(sourceSummary).join("; ")}
          </p>
          <AgreementEvidence sources={entity.sources} />
        </div>
        <TextLink onClick={onEdit}>Edit</TextLink>
      </footer>
    </article>
  );
}

function CandidateRow({
  candidate,
  entities,
  excluded,
  onAdd,
  onReviewed,
}: {
  candidate: LegalEntitySourceSummary;
  entities: readonly LegalEntityRecord[];
  excluded?: boolean;
  onAdd: () => void;
  onReviewed: () => Promise<void>;
}) {
  const [selectedEntityId, setSelectedEntityId] = useState(
    entities[0]?.id ?? "",
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const legalName = candidate.legalEntityNameEvidence.legalName;
  const nameUnavailable = legalName === null;
  const displayName = legalName ?? candidate.sourceDisplayName;

  const decide = async (decision: "linked" | "not_llc") => {
    setWorking(true);
    setError(null);
    try {
      await reviewLegalEntitySource({
        source: candidate.source,
        expectedDecisionId: candidate.currentDecisionId,
        decision:
          decision === "linked"
            ? { kind: "linked", legalEntityId: selectedEntityId }
            : { kind: "not_llc" },
      });
      await onReviewed();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The source review could not be saved.",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <article
      className={`legal-entity-candidate${
        nameUnavailable ? " legal-entity-candidate--unresolved" : ""
      }`}
    >
      <div className="legal-entity-candidate__copy">
        <div>
          <h3>{displayName}</h3>
          {nameUnavailable ? (
            <Badge tone="warning">Name unavailable</Badge>
          ) : (
            !excluded && <Badge tone="warning">Needs review</Badge>
          )}
        </div>
        <p>{sourceSummary(candidate)}</p>
        <p>
          {nameUnavailable
            ? candidate.source.kind === "ownership_container"
              ? "This ownership label is a reference, not legal-name evidence."
              : candidate.legalEntityNameEvidence.state === "unavailable" &&
                  candidate.legalEntityNameEvidence.problem !== undefined
                ? LEGAL_DOCUMENT_PROBLEM_COPY[
                    candidate.legalEntityNameEvidence.problem
                  ]
                : "No exact legal name was reported by this source. Use a governing document, K-1, or provider legal-vehicle report to resolve it."
            : `Legal name reported in ${candidate.legalEntityNameEvidence.sourceField}.`}
        </p>
        <AgreementEvidence sources={[candidate]} />
        <p>
          Recorded as {relationshipLabels[candidate.relationship].toLowerCase()}
          {candidate.currentOwner === null
            ? ". Owner not recorded."
            : ` titled to ${candidate.currentOwner}.`}
        </p>
      </div>
      {!nameUnavailable && (
        <ActionGroup
          className="legal-entity-candidate__actions"
          layout="stack"
          mobileLayout="stack"
        >
          <Button disabled={working} onClick={onAdd} tone="secondary">
            {excluded ? "Review and add" : "Review details"}
          </Button>
          {entities.length > 0 && (
            <div className="legal-entity-candidate__link">
              <Select
                items={entities.map((entity) => ({
                  label: entity.legalName,
                  value: entity.id,
                }))}
                onValueChange={(value) =>
                  setSelectedEntityId(typeof value === "string" ? value : "")
                }
                value={selectedEntityId}
              >
                <SelectTrigger
                  aria-label={`Existing entity for ${displayName}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {entities.map((entity) => (
                    <SelectItem key={entity.id} value={entity.id}>
                      {entity.legalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={working || selectedEntityId.length === 0}
                onClick={() => void decide("linked")}
                size="compact"
                tone="quiet"
              >
                Link source
              </Button>
            </div>
          )}
          {!excluded && (
            <TextLink disabled={working} onClick={() => void decide("not_llc")}>
              Exclude source
            </TextLink>
          )}
        </ActionGroup>
      )}
      {error !== null && <FormMessage tone="error">{error}</FormMessage>}
    </article>
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
  const [includeOtherEntityTypes, setIncludeOtherEntityTypes] = useState(false);
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
  const unavailableNameCount =
    inventory.candidates.length - sourceNameReviewCount;

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
          <span>Include historical interests</span>
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

export function LegalEntities() {
  const [inventory, setInventory] = useState<LegalEntityInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [batchWorking, setBatchWorking] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadLegalEntities();
    setInventory(next);
    setLoadError(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
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
    return () => {
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
  const historicalEntities = useMemo(
    () =>
      inventory?.entities.filter(
        (entity) => entity.interestStatus === "historical",
      ) ?? [],
    [inventory],
  );

  const saved = async () => {
    await refresh();
    setEditor(null);
    setNotice("The reviewed legal entity inventory was updated.");
  };

  const reviewed = async () => {
    await refresh();
    setNotice("The source review was saved.");
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
    <div className="legal-entities">
      {notice !== null && (
        <FormMessage className="legal-entities__notice" tone="success">
          {notice}
        </FormMessage>
      )}
      {loadError !== null && <Notice tone="error">{loadError}</Notice>}

      {editor !== null ? (
        <LegalEntityEditor
          editor={editor}
          key={
            editor.entityId ??
            (editor.source === null
              ? "manual"
              : `${editor.source.reference.kind}:${editor.source.reference.id}`)
          }
          onCancel={() => setEditor(null)}
          onSaved={saved}
        />
      ) : (
        <section
          aria-labelledby="known-legal-entities-title"
          className="legal-entities__known"
        >
          <SectionHeader
            action={
              <Button
                onClick={() =>
                  setEditor({
                    entityId: null,
                    expectedVersionId: null,
                    source: null,
                    profile: emptyProfile(),
                    ownershipPercentText: "",
                  })
                }
                tone="primary"
              >
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
              Add an entity or review a source below.
            </EmptyState>
          ) : (
            <div className="legal-entities__list">
              {activeEntities.map((entity) => (
                <EntityRow
                  entity={entity}
                  key={entity.id}
                  onEdit={() => setEditor(editorForEntity(entity))}
                />
              ))}
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
                  {historicalEntities.map((entity) => (
                    <EntityRow
                      entity={entity}
                      key={entity.id}
                      onEdit={() => setEditor(editorForEntity(entity))}
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </section>
      )}

      {editor === null && inventory.candidates.length > 0 && (
        <section
          aria-labelledby="legal-entity-candidates-title"
          className="legal-entities__candidates"
        >
          <SectionHeader
            description="Source-reported legal names can be reviewed together. Records without an exact legal name stay visible for counsel."
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
            {inventory.candidates.map((candidate) => (
              <CandidateRow
                candidate={candidate}
                entities={inventory.entities}
                key={candidateKey(candidate)}
                onAdd={() => setEditor(editorForCandidate(candidate))}
                onReviewed={reviewed}
              />
            ))}
          </div>
        </section>
      )}

      {editor === null && inventory.excludedCandidates.length > 0 && (
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
              {inventory.excludedCandidates.map((candidate) => (
                <CandidateRow
                  candidate={candidate}
                  entities={inventory.entities}
                  excluded
                  key={candidateKey(candidate)}
                  onAdd={() => setEditor(editorForCandidate(candidate))}
                  onReviewed={reviewed}
                />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {editor === null && <ExportWorkspace inventory={inventory} />}
    </div>
  );
}
