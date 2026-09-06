import { useState } from "react";
import {
  LegalNameResolutionInputSchema,
  legalNameEvidenceRevision,
  legalEntityReviewKind,
  type LegalEntityRecord,
  type LegalEntitySourceSummary,
  type LegalNameResolutionInput,
} from "@keel/domain/legal-entities";
import { MAX_LEGAL_DOCUMENT_PAGES } from "@keel/domain/provider-legal-documents";
import {
  ActionGroup,
  Button,
  Field,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@keel/ui";
import { reviewLegalEntitySource } from "./api";

export function LegalNameResolver({
  source,
  entities,
  onAdd,
  onClose,
  onSaved,
  onReload,
}: {
  source: LegalEntitySourceSummary;
  entities: readonly LegalEntityRecord[];
  onAdd: (resolution: LegalNameResolutionInput) => void;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const reviewKind = legalEntityReviewKind(source);
  const structure = reviewKind === "structure";
  const documents = (source.legalEntityNameEvidence.documents ?? []).filter(
    (document) =>
      document.scan?.outcome === "clean" ||
      (reviewKind === "conflict" && document.scan === undefined),
  );
  const choices = [
    ...new Map(
      documents.flatMap((document) =>
        (structure
          ? (document.structure?.parties ?? []).filter(
              (party) => party.role !== "representative",
            )
          : (document.citations ?? [])
        ).map(
          (citation) => [citation.legalName, { document, citation }] as const,
        ),
      ),
    ).values(),
  ];
  const [choice, setChoice] = useState(
    reviewKind === "document" ? "correction" : "",
  );
  const [documentId, setDocumentId] = useState("");
  const [legalName, setLegalName] = useState("");
  const [page, setPage] = useState("");
  const [quote, setQuote] = useState("");
  const [reason, setReason] = useState("");
  const [destination, setDestination] = useState("new");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = choices.find((item) => item.citation.legalName === choice);
  const correcting = choice === "correction";
  const selectedName = correcting
    ? legalName.trim()
    : selected?.citation.legalName;
  const matches = entities.filter(
    (entity) =>
      entity.legalName === selectedName &&
      (!structure || entity.entityType === "other"),
  );
  const submit = async () => {
    setWorking(true);
    setError(null);
    try {
      const parsed = LegalNameResolutionInputSchema.safeParse({
        expectedEvidenceRevision: await legalNameEvidenceRevision(
          source.legalEntityNameEvidence,
        ),
        kind: correcting
          ? "document_correction"
          : structure
            ? "document_structure"
            : "document_choice",
        documentId: correcting ? documentId : selected?.document.id,
        legalName: selectedName,
        page: correcting ? Number(page) : selected?.citation.page,
        quote: correcting ? quote : selected?.citation.quote,
        reason: correcting ? reason.trim() || null : null,
      });
      if (!parsed.success) {
        setError(
          correcting
            ? "Choose the document, enter its page and exact name, and include an excerpt containing that name and the reason for your correction."
            : "Choose a name from the agreements.",
        );
        return;
      }
      if (destination === "new") {
        onAdd(parsed.data);
        onClose();
      } else {
        if (!matches.some((entity) => entity.id === destination))
          throw new Error(
            "Choose an existing entity with this exact legal name.",
          );
        await reviewLegalEntitySource({
          source: source.source,
          expectedDecisionId: source.currentDecisionId,
          decision: { kind: "linked", legalEntityId: destination },
          nameResolution: parsed.data,
        });
        await onSaved();
        onClose();
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The name could not be resolved. Try again.",
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <form
      className="legal-name-resolver"
      aria-label={`Resolve name for ${source.sourceDisplayName}`}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h4>
        {structure
          ? "Review structure"
          : reviewKind === "document"
            ? "Enter the name from the agreement"
            : "Resolve name"}
      </h4>
      <p>
        {structure
          ? "Keep the compartment and its representative separate. This record will be classified as Other, not a confirmed LLC interest."
          : reviewKind === "document"
            ? "Open Agreement evidence above to read the PDF. Enter its exact name, page, and an excerpt containing the name."
            : "Choose the name for this investment. Nothing is selected automatically."}
      </p>
      {structure &&
        documents.map((document) =>
          document.structure === undefined ? null : (
            <div key={document.id} className="legal-name-resolver__structure">
              {document.structure.parties
                .filter((party) => party.role === "representative")
                .map((party) => (
                  <p key={party.legalName}>
                    <strong>Representative: {party.legalName}</strong>
                    <br />
                    {document.fileName} · page {party.page}
                    <br />
                    <q>{party.quote}</q>
                  </p>
                ))}
              {document.structure.instrument !== null && (
                <p>
                  Reported interest: {document.structure.instrument.label} ·
                  page {document.structure.instrument.page}
                  <br />
                  <q>{document.structure.instrument.quote}</q>
                </p>
              )}
              {document.structure.parties.length === 0 && (
                <p>
                  {document.fileName} · page {document.structure.page}
                  <br />
                  <q>{document.structure.quote}</q>
                </p>
              )}
            </div>
          ),
        )}
      <fieldset disabled={working}>
        <legend>Names reported in the agreements</legend>
        {choices.map(({ document, citation }) => (
          <label
            className="legal-name-resolver__choice"
            key={citation.legalName}
          >
            <Input
              type="radio"
              name={`legal-name-${source.source.id}`}
              checked={choice === citation.legalName}
              onChange={() => {
                setChoice(citation.legalName);
                setDestination("new");
              }}
            />
            <span>
              <strong>{citation.legalName}</strong>
              {structure && (
                <span>
                  {citation.role === "compartment" ? "Compartment" : "Issuer"}
                </span>
              )}
              <span>
                {source.sourceLabel} · {document.fileName} · page{" "}
                {citation.page}
              </span>
              <q>{citation.quote}</q>
            </span>
          </label>
        ))}
        {choices.length === 0 && (
          <p>
            No alternatives were saved by the earlier document check. Enter the
            exact name from a supporting agreement below.
          </p>
        )}
        <label className="legal-name-resolver__choice">
          <Input
            type="radio"
            name={`legal-name-${source.source.id}`}
            checked={correcting}
            onChange={() => {
              setChoice("correction");
              setDestination("new");
            }}
          />
          <span>
            <strong>Enter a document-backed correction</strong>
            <span>
              Recorded as your correction, not a provider-reported name.
            </span>
          </span>
        </label>
      </fieldset>
      {correcting && (
        <div className="legal-name-resolver__fields">
          <Field label="Supporting agreement" variant="filled" wide>
            <Select
              items={documents.map((document) => ({
                value: document.id,
                label: document.fileName,
              }))}
              value={documentId}
              onValueChange={(value) =>
                setDocumentId(typeof value === "string" ? value : "")
              }
              disabled={working}
            >
              <SelectTrigger aria-label="Supporting agreement">
                <SelectValue placeholder="Choose an agreement" />
              </SelectTrigger>
              <SelectContent>
                {documents.map((document) => (
                  <SelectItem value={document.id} key={document.id}>
                    {document.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Exact legal name" variant="filled" wide>
            <Input
              value={legalName}
              onChange={(event) => {
                setLegalName(event.currentTarget.value);
                setDestination("new");
              }}
              required
              maxLength={1_000}
              disabled={working}
            />
          </Field>
          <Field label="Agreement page" variant="filled">
            <Input
              value={page}
              onChange={(event) => setPage(event.currentTarget.value)}
              type="number"
              min={1}
              max={MAX_LEGAL_DOCUMENT_PAGES}
              required
              disabled={working}
            />
          </Field>
          <Field label="Document excerpt" variant="filled" wide>
            <Textarea
              value={quote}
              onChange={(event) => setQuote(event.currentTarget.value)}
              maxLength={2_000}
              required
              disabled={working}
            />
          </Field>
          <Field label="Reason for correction" variant="filled" wide>
            <Textarea
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              maxLength={1_000}
              required
              disabled={working}
            />
          </Field>
        </div>
      )}
      {matches.length > 0 && (
        <Field label="Save to" variant="filled">
          <Select
            items={[
              { value: "new", label: "Add a new entity" },
              ...matches.map((entity) => ({
                value: entity.id,
                label: `Link existing: ${entity.legalName}`,
              })),
            ]}
            value={destination}
            onValueChange={(value) =>
              setDestination(typeof value === "string" ? value : "new")
            }
            disabled={working}
          >
            <SelectTrigger aria-label="Save to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">Add a new entity</SelectItem>
              {matches.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>
                  Link existing: {entity.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {error !== null && <FormMessage tone="error">{error}</FormMessage>}
      {error !== null && (
        <Button
          tone="quiet"
          disabled={working}
          onClick={() => {
            setWorking(true);
            void onReload()
              .then(onClose)
              .catch(() =>
                setError("The evidence could not be reloaded. Try again."),
              )
              .finally(() => setWorking(false));
          }}
        >
          Reload evidence
        </Button>
      )}
      <ActionGroup align="end" mobileLayout="stack">
        <Button onClick={onClose} disabled={working} tone="quiet">
          Keep unresolved
        </Button>
        <Button
          type="submit"
          disabled={working || choice === ""}
          tone="primary"
        >
          {working
            ? "Saving…"
            : destination === "new"
              ? "Continue with this name"
              : "Link entity"}
        </Button>
      </ActionGroup>
    </form>
  );
}
