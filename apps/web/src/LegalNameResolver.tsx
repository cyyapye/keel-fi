import { useId, useState } from "react";
import {
  LegalNameResolutionDetailsSchema,
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
  const descriptionId = useId();
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
  const requiresReason = reviewKind === "conflict";
  const selectedName = correcting
    ? legalName.trim()
    : selected?.citation.legalName;
  const matches = entities.filter(
    (entity) => entity.legalName === selectedName,
  );
  const details = LegalNameResolutionDetailsSchema.safeParse({
    kind: correcting
      ? requiresReason
        ? "document_correction"
        : "document_entry"
      : structure
        ? "document_structure"
        : "document_choice",
    documentId: correcting ? documentId : selected?.document.id,
    legalName: selectedName,
    page: correcting ? Number(page) : selected?.citation.page,
    quote: correcting ? quote.trim() || null : selected?.citation.quote,
    reason: correcting && requiresReason ? reason.trim() || null : null,
  });
  const valid =
    details.success &&
    documents.some((document) => document.id === details.data.documentId) &&
    (destination === "new" ||
      matches.some((entity) => entity.id === destination));
  const fieldIssue = (field: string) =>
    details.error?.issues.find((issue) => issue.path[0] === field)?.message;
  const pageIssue = correcting && page !== "" ? fieldIssue("page") : undefined;
  const quoteIssue =
    correcting && quote.trim() !== "" ? fieldIssue("quote") : undefined;
  const nameIssue =
    correcting && legalName !== "" ? fieldIssue("legalName") : undefined;
  const reasonIssue =
    correcting && requiresReason && reason !== ""
      ? fieldIssue("reason")
      : undefined;
  const describe = (field: string, message: string | undefined) =>
    message === undefined ? undefined : (
      <span id={`${descriptionId}-${field}`}>{message}</span>
    );
  const submit = async () => {
    if (working || !valid || !details.success) return;
    setWorking(true);
    setError(null);
    try {
      const parsed = LegalNameResolutionInputSchema.safeParse({
        ...details.data,
        expectedEvidenceRevision: await legalNameEvidenceRevision(
          source.legalEntityNameEvidence,
        ),
      });
      if (!parsed.success) {
        setError("Check the name and agreement details before continuing.");
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
      noValidate
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
          ? "Keep the compartment and its representative separate. Confirm the entity type from the agreement when adding the record."
          : reviewKind === "document"
            ? "Read the PDF in Agreement evidence, then enter the exact name and page."
            : "Different vehicles may be separate investments. Use Assign agreements below for those; choose a name here only for this investment."}
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
            No name options are available. Enter the exact name from a
            supporting agreement.
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
            <strong>
              {requiresReason
                ? "Enter a document-backed correction"
                : "Enter the name from an agreement"}
            </strong>
            <span>
              {requiresReason
                ? "Recorded as your correction, not a provider-reported name."
                : "Recorded as entered by you, with the agreement reference."}
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
          <Field
            label="Exact legal name"
            variant="filled"
            wide
            description={describe("name", nameIssue)}
          >
            <Input
              value={legalName}
              aria-label="Exact legal name"
              onChange={(event) => {
                setLegalName(event.currentTarget.value);
                setDestination("new");
              }}
              required
              aria-invalid={nameIssue !== undefined}
              aria-describedby={
                nameIssue === undefined ? undefined : `${descriptionId}-name`
              }
              maxLength={1_000}
              disabled={working}
            />
          </Field>
          <Field
            label="Agreement page"
            variant="filled"
            description={describe("page", pageIssue)}
          >
            <Input
              value={page}
              aria-label="Agreement page"
              onChange={(event) => setPage(event.currentTarget.value)}
              type="number"
              min={1}
              max={MAX_LEGAL_DOCUMENT_PAGES}
              required
              aria-invalid={pageIssue !== undefined}
              aria-describedby={
                pageIssue === undefined ? undefined : `${descriptionId}-page`
              }
              disabled={working}
            />
          </Field>
          <Field
            label="Document excerpt (optional)"
            variant="filled"
            wide
            description={describe(
              "quote",
              quoteIssue ??
                "If included, quote the passage containing the exact name.",
            )}
          >
            <Textarea
              value={quote}
              aria-label="Document excerpt (optional)"
              onChange={(event) => setQuote(event.currentTarget.value)}
              maxLength={2_000}
              aria-invalid={quoteIssue !== undefined}
              aria-describedby={`${descriptionId}-quote`}
              disabled={working}
            />
          </Field>
          {requiresReason && (
            <Field
              label="Reason for correction"
              variant="filled"
              wide
              description={describe("reason", reasonIssue)}
            >
              <Textarea
                value={reason}
                aria-label="Reason for correction"
                onChange={(event) => setReason(event.currentTarget.value)}
                maxLength={1_000}
                required
                aria-invalid={reasonIssue !== undefined}
                aria-describedby={
                  reasonIssue === undefined
                    ? undefined
                    : `${descriptionId}-reason`
                }
                disabled={working}
              />
            </Field>
          )}
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
      {correcting &&
        !valid &&
        error === null &&
        !pageIssue &&
        !quoteIssue &&
        !nameIssue &&
        !reasonIssue && (
          <FormMessage tone="neutral">
            {requiresReason
              ? "Choose an agreement and enter its exact name, page, and the reason for the correction."
              : "Choose an agreement and enter its exact name and page."}
          </FormMessage>
        )}
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
        <Button type="submit" disabled={working || !valid} tone="primary">
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
