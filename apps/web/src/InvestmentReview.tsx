import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  CreateDocumentInvestmentInputSchema,
  InvestmentCompanyReviewInputSchema,
  InvestmentOwnershipInputSchema,
  ReviewInvestmentInputSchema,
  type InvestmentOwnershipInput,
  type InvestmentReviewContext,
} from "@keel/domain/investment-review";
import {
  ownershipPercentTextToPpm,
  formatOwnershipInterestPpm,
} from "@keel/domain/legal-entities";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DatePicker,
  DisclosureIndicator,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextLink,
} from "@keel/ui";
import {
  createDocumentInvestment,
  downloadLegalEntityDocument,
  loadInvestmentReview,
  saveInvestmentCompany,
  saveInvestmentReview,
} from "./api";
import { PositionEconomicsEditor } from "./PositionEconomicsEditor";
import { formatCompactCurrency } from "./format";

function ReviewSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} variant="filled">
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}
function ReviewSection({
  title,
  children,
  summary,
}: {
  title: string;
  children: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <Collapsible className="investment-review__section">
      <CollapsibleTrigger>
        <span>{title}</span>
        <DisclosureIndicator />
      </CollapsibleTrigger>
      {summary}
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
const participation = [
  { value: "current", label: "Current" },
  { value: "pending", label: "Pending" },
  { value: "historical", label: "Historical" },
  { value: "cancelled", label: "Cancelled" },
  { value: "unknown", label: "Not confirmed" },
];
const optional = (value: string) => value.trim() || null;
const ppm = (value: string) => {
  try {
    return ownershipPercentTextToPpm(value);
  } catch {
    return -1;
  }
};
const emptyOwnership: InvestmentOwnershipInput = {
  sourceKind: "user_reported",
  sourceLabel: "User reported",
  effectiveDate: null,
  taxYear: null,
  ownershipPpm: null,
  profitBeginningPpm: null,
  profitEndingPpm: null,
  lossBeginningPpm: null,
  lossEndingPpm: null,
  capitalBeginningPpm: null,
  capitalEndingPpm: null,
  documentId: null,
  page: null,
  quote: null,
  supersedesObservationId: null,
};
const shareFields = [
  ["profitBeginningPpm", "Profit · beginning"],
  ["profitEndingPpm", "Profit · ending"],
  ["lossBeginningPpm", "Loss · beginning"],
  ["lossEndingPpm", "Loss · ending"],
  ["capitalBeginningPpm", "Capital · beginning"],
  ["capitalEndingPpm", "Capital · ending"],
] as const;
type Save = (action: () => Promise<unknown>) => Promise<void>;
function useInvestmentRequest(
  context: InvestmentReviewContext,
  draft: unknown,
): string {
  const signature = JSON.stringify([
    context.snapshotId,
    context.evidenceRevision,
    context.review?.id,
    context.companyReceipt?.requestId,
    draft,
  ]);
  return useMemo(() => ({ signature, id: crypto.randomUUID() }), [signature])
    .id;
}

function ParticipationReview({
  context,
  save,
  busy,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
}) {
  const [status, setStatus] = useState(
    context.review?.participationStatus ?? context.defaultParticipationStatus,
  );
  const requestId = useInvestmentRequest(context, status);
  const input = ReviewInvestmentInputSchema.safeParse({
    requestId,
    expectedReviewId: context.review?.id ?? null,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
    participationStatus: status,
  });
  return (
    <ReviewSection
      title="Participation"
      summary={
        <p>
          {
            participation.find(
              (item) =>
                item.value ===
                (context.review?.participationStatus ??
                  context.defaultParticipationStatus),
            )?.label
          }{" "}
          · {context.holderLabel}
        </p>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (input.success)
            void save(() =>
              saveInvestmentReview(context.positionId, input.data),
            );
        }}
      >
        <ReviewSelect
          label="Participation status"
          value={status}
          items={participation}
          onChange={(value) => {
            const item = participation.find((item) => item.value === value);
            if (item !== undefined) setStatus(value as typeof status);
          }}
        />
        {status === "cancelled" && (
          <p>
            Marks this investment as cancelled, not the entity as dissolved.
            Reported amounts are preserved.
          </p>
        )}
        <Button type="submit" disabled={busy || !input.success}>
          Save participation
        </Button>
      </form>
    </ReviewSection>
  );
}

function OwnershipReview({
  context,
  save,
  busy,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<InvestmentOwnershipInput>(emptyOwnership);
  const [percent, setPercent] = useState("");
  const [shares, setShares] = useState<Record<string, string>>({});
  const [year, setYear] = useState("");
  const [page, setPage] = useState("");
  const requestId = useInvestmentRequest(context, [
    draft,
    percent,
    shares,
    year,
    page,
  ]);
  const input = InvestmentOwnershipInputSchema.safeParse({
    ...draft,
    ownershipPpm: draft.sourceKind === "k1" ? null : ppm(percent),
    taxYear:
      draft.sourceKind === "k1" && /^\d{4}$/u.test(year) ? Number(year) : null,
    page:
      draft.documentId !== null && /^\d+$/u.test(page) ? Number(page) : null,
    ...Object.fromEntries(
      shareFields.map(([key]) => [
        key,
        draft.sourceKind === "k1" ? ppm(shares[key] ?? "") : null,
      ]),
    ),
  });
  const observations = context.review?.ownershipObservations ?? [];
  const current = observations.filter(
    (item) =>
      !observations.some((later) => later.supersedesObservationId === item.id),
  );
  const documents = context.documents.filter(
    (doc) => doc.scan?.outcome === "clean",
  );
  return (
    <ReviewSection
      title="Ownership evidence"
      summary={
        <p>
          {observations.length === 0
            ? "Not reported yet. A missing K-1 does not prevent adding this entity or exporting it."
            : `${observations.length} dated ${observations.length === 1 ? "observation" : "observations"}`}
        </p>
      }
    >
      {observations.length > 0 && (
        <ul className="investment-review__observations">
          {observations.map((item) => (
            <li key={item.id}>
              <strong>
                {item.sourceKind === "k1"
                  ? `${item.taxYear} K-1`
                  : item.effectiveDate}{" "}
                · {item.sourceLabel}
              </strong>
              <p>
                {item.sourceKind === "k1"
                  ? shareFields
                      .filter(([key]) => item[key] !== null)
                      .map(
                        ([key, label]) =>
                          `${label}: ${formatOwnershipInterestPpm(item[key] ?? 0)}`,
                      )
                      .join("; ")
                  : formatOwnershipInterestPpm(item.ownershipPpm ?? 0)}
              </p>
              <small>
                {item.evidenceBasis === "user_reported"
                  ? "Entered by you; document not attached"
                  : `Document reviewed · page ${item.page}`}
                {item.supersedesObservationId !== null
                  ? " · Amended observation"
                  : ""}
                {current.includes(item) ? "" : " · Superseded"}
              </small>
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (input.success)
            void save(async () => {
              await saveInvestmentReview(context.positionId, {
                requestId,
                expectedReviewId: context.review?.id ?? null,
                expectedSnapshotId: context.snapshotId,
                expectedEvidenceRevision: context.evidenceRevision,
                participationStatus:
                  context.review?.participationStatus ??
                  context.defaultParticipationStatus,
                ownershipObservation: input.data,
              });
              setDraft(emptyOwnership);
              setPercent("");
              setShares({});
              setYear("");
              setPage("");
            });
        }}
      >
        <div className="investment-review__fields">
          <ReviewSelect
            label="Ownership source"
            value={draft.sourceKind}
            items={[
              { value: "user_reported", label: "Reported by you" },
              { value: "agreement", label: "Agreement" },
              { value: "k1", label: "K-1" },
            ]}
            onChange={(value) => {
              if (
                value === "k1" ||
                value === "agreement" ||
                value === "user_reported"
              )
                setDraft({
                  ...emptyOwnership,
                  sourceKind: value,
                  sourceLabel:
                    value === "k1"
                      ? "K-1"
                      : value === "agreement"
                        ? "Agreement"
                        : "User reported",
                });
            }}
          />
          <Field label="Source description" variant="filled">
            <Input
              value={draft.sourceLabel}
              maxLength={240}
              onChange={(event) =>
                setDraft({ ...draft, sourceLabel: event.currentTarget.value })
              }
            />
          </Field>
          {draft.sourceKind === "k1" ? (
            <>
              <Field label="Tax year" variant="filled">
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  value={year}
                  onChange={(event) => setYear(event.currentTarget.value)}
                />
              </Field>
              <p>
                Keep profit, loss, and capital shares separate. Blank means not
                reported, not zero.
              </p>
              {shareFields.map(([key, label]) => (
                <Field key={key} label={label} variant="filled">
                  <InputGroup suffix="%">
                    <Input
                      inputMode="decimal"
                      value={shares[key] ?? ""}
                      onChange={(event) =>
                        setShares({
                          ...shares,
                          [key]: event.currentTarget.value,
                        })
                      }
                    />
                  </InputGroup>
                </Field>
              ))}
            </>
          ) : (
            <>
              <Field label="Ownership interest" variant="filled">
                <InputGroup suffix="%">
                  <Input
                    inputMode="decimal"
                    value={percent}
                    onChange={(event) => setPercent(event.currentTarget.value)}
                  />
                </InputGroup>
              </Field>
              <Field label="Effective date" variant="filled">
                <DatePicker
                  aria-label="Ownership effective date"
                  value={draft.effectiveDate ?? ""}
                  onValueChange={(value) =>
                    setDraft({ ...draft, effectiveDate: optional(value) })
                  }
                />
              </Field>
            </>
          )}
          <ReviewSelect
            label="Supporting document"
            value={draft.documentId ?? "none"}
            items={[
              { value: "none", label: "Not attached" },
              ...documents.map((doc) => ({
                value: doc.id,
                label: doc.fileName,
              })),
            ]}
            onChange={(value) =>
              setDraft({
                ...draft,
                documentId: value === "none" ? null : value,
                quote: value === "none" ? null : draft.quote,
              })
            }
          />
          {draft.documentId !== null && (
            <Field label="Document page" variant="filled">
              <Input
                inputMode="numeric"
                value={page}
                onChange={(event) => setPage(event.currentTarget.value)}
              />
            </Field>
          )}
          <ReviewSelect
            label="Amends an earlier observation"
            value={draft.supersedesObservationId ?? "none"}
            items={[
              { value: "none", label: "New observation" },
              ...current
                .filter(
                  (item) =>
                    item.sourceKind === draft.sourceKind &&
                    (draft.sourceKind !== "k1" ||
                      item.taxYear === Number(year)),
                )
                .map((item) => ({
                  value: item.id,
                  label: `${item.taxYear ?? item.effectiveDate} · ${item.sourceLabel}`,
                })),
            ]}
            onChange={(value) =>
              setDraft({
                ...draft,
                supersedesObservationId: value === "none" ? null : value,
              })
            }
          />
        </div>
        {!input.success && (
          <FormMessage tone="neutral">
            {input.error.issues[0]?.message}
          </FormMessage>
        )}
        <Button type="submit" disabled={busy || !input.success}>
          Save ownership evidence
        </Button>
      </form>
    </ReviewSection>
  );
}

function CompanyReview({
  context,
  save,
  busy,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
}) {
  const [choice, setChoice] = useState("manual");
  const [existing, setExisting] = useState("new");
  const [name, setName] = useState("");
  const requestId = useInvestmentRequest(context, [choice, existing, name]);
  const citation =
    choice === "manual"
      ? null
      : (context.companyChoices[Number(choice)] ?? null);
  const exactMatches =
    citation === null
      ? []
      : context.companies.filter((c) => c.legalName === citation.companyName);
  const company =
    citation === null
      ? existing === "new"
        ? { mode: "new", legalName: name }
        : { mode: "existing", companyId: existing }
      : exactMatches.length === 1
        ? { mode: "existing", companyId: exactMatches[0]?.id }
        : { mode: "new", legalName: citation.companyName };
  const input = InvestmentCompanyReviewInputSchema.safeParse({
    requestId,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
    expectedMappingIds: context.mappings.map((m) => m.id),
    company,
    basis: citation === null ? "user_confirmed" : "document_choice",
    citation,
    reason: null,
  });
  const active = context.mappings.filter(
    (m) => m.status === "active" && m.companyId !== null,
  );
  return (
    <ReviewSection
      title="Underlying company"
      summary={
        <p>
          {active.length === 0
            ? "Not confirmed"
            : active.map((m) => m.companyName).join("; ")}
        </p>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (input.success)
            void save(() =>
              saveInvestmentCompany(context.positionId, input.data),
            );
        }}
      >
        <p>
          The provider’s deal label can differ from the company this vehicle
          invests in.
        </p>
        <ReviewSelect
          label="Company evidence"
          value={choice}
          items={[
            { value: "manual", label: "Confirm a company yourself" },
            ...context.companyChoices.map((item, index) => ({
              value: index.toString(),
              label: `${item.companyName} · page ${item.page}`,
            })),
          ]}
          onChange={setChoice}
        />
        {citation !== null ? (
          <>
            <p>
              {
                context.documents.find((doc) => doc.id === citation.documentId)
                  ?.fileName
              }{" "}
              · page {citation.page}
            </p>
            <blockquote>{citation.quote}</blockquote>
          </>
        ) : (
          <>
            <ReviewSelect
              label="Company"
              value={existing}
              items={[
                { value: "new", label: "Add a company" },
                ...context.companies.map((c) => ({
                  value: c.id,
                  label: c.legalName,
                })),
              ]}
              onChange={setExisting}
            />
            {existing === "new" && (
              <Field label="Company name" variant="filled">
                <Input
                  maxLength={1_000}
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </Field>
            )}
            <p>
              Recorded as your confirmation, not a provider-reported company.
            </p>
          </>
        )}
        {active.length > 0 && (
          <p>
            Saving replaces this investment’s current company mapping. Its
            amounts and earlier mapping remain unchanged in history.
          </p>
        )}
        <Button type="submit" disabled={busy || !input.success}>
          Save company mapping
        </Button>
      </form>
    </ReviewSection>
  );
}

function DocumentReview({
  context,
  save,
  busy,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("new");
  const [label, setLabel] = useState("");
  const [status, setStatus] = useState("pending");
  const requestId = useInvestmentRequest(context, [
    selected,
    target,
    label,
    status,
  ]);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const clean = context.documents.filter(
    (doc) => doc.scan?.outcome === "clean",
  );
  const base = {
    requestId,
    expectedReviewId: context.review?.id ?? null,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
  };
  const related = CreateDocumentInvestmentInputSchema.safeParse({
    ...base,
    label,
    participationStatus: status,
    documentIds: selected,
  });
  const assignment = ReviewInvestmentInputSchema.safeParse({
    ...base,
    participationStatus:
      context.review?.participationStatus ?? context.defaultParticipationStatus,
    documentAssignments: selected.map((id) => ({
      documentId: id,
      sha256: context.documents.find((doc) => doc.id === id)?.sha256,
      relationship: ["supports", "general", "unassigned"].includes(target)
        ? target
        : "other_investment",
      targetPositionId: ["supports", "general", "unassigned"].includes(target)
        ? null
        : target,
    })),
  });
  const download = async (id: string, fileName: string) => {
    try {
      const blob = await downloadLegalEntityDocument(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setDownloadError(
        error instanceof Error
          ? error.message
          : "The document could not be downloaded.",
      );
    }
  };
  return (
    <ReviewSection
      title="Assign agreements"
      summary={
        <p>
          Different vehicles are separate investments, even when they invest in
          the same company.
        </p>
      }
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (selected.length === 0) return;
          if (target === "new" && related.success)
            void save(async () => {
              await createDocumentInvestment(context.positionId, related.data);
              setSelected([]);
              setLabel("");
            });
          else if (target !== "new" && assignment.success)
            void save(async () => {
              await saveInvestmentReview(context.positionId, assignment.data);
              setSelected([]);
            });
        }}
      >
        {clean.length === 0 && (
          <p>No agreements are available for assignment yet.</p>
        )}
        <div className="investment-review__documents">
          {clean.map((doc) => (
            <div key={doc.id}>
              <label>
                <Input
                  type="checkbox"
                  checked={selected.includes(doc.id)}
                  onChange={(event) =>
                    setSelected(
                      event.currentTarget.checked
                        ? [...selected, doc.id]
                        : selected.filter((id) => id !== doc.id),
                    )
                  }
                />
                <span>{doc.fileName}</span>
              </label>
              <TextLink onClick={() => void download(doc.id, doc.fileName)}>
                Download PDF
              </TextLink>
              <p>
                {doc.citations
                  ?.map(
                    (citation) =>
                      `${citation.legalName} · page ${citation.page}`,
                  )
                  .join("; ") ?? "Review the PDF for its legal name."}
              </p>
              {context.review?.documentAssignments.find(
                (a) => a.documentId === doc.id,
              )?.relationship === "other_investment" && (
                <p>Assigned to another investment</p>
              )}
            </div>
          ))}
        </div>
        <ReviewSelect
          label="These agreements belong to"
          value={target}
          items={[
            { value: "new", label: "A separate investment" },
            { value: "supports", label: "This investment" },
            { value: "general", label: "General or parent agreement" },
            { value: "unassigned", label: "Not yet determined" },
            ...context.otherPositions.map((p) => ({
              value: p.id,
              label: p.label,
            })),
          ]}
          onChange={setTarget}
        />
        {target === "new" && (
          <>
            <Field label="Investment label" variant="filled">
              <Input
                value={label}
                maxLength={1_000}
                onChange={(event) => setLabel(event.currentTarget.value)}
                placeholder="Name from the agreement"
              />
            </Field>
            <ReviewSelect
              label="Separate investment status"
              value={status}
              onChange={setStatus}
              items={participation.filter((item) =>
                ["pending", "cancelled", "unknown"].includes(item.value),
              )}
            />
            <p>
              This creates a separate review with no amount, fee, or carry
              copied from this investment.
            </p>
          </>
        )}
        {downloadError !== null && (
          <FormMessage tone="error">{downloadError}</FormMessage>
        )}
        <Button
          type="submit"
          disabled={
            busy ||
            selected.length === 0 ||
            (target === "new" ? !related.success : !assignment.success)
          }
        >
          {target === "new"
            ? "Create separate investment"
            : "Save document assignment"}
        </Button>
      </form>
    </ReviewSection>
  );
}

export function InvestmentReview({
  positionId,
  sourceLabel,
  children,
  onSaved,
}: {
  positionId: string;
  sourceLabel: string;
  children?: ReactNode;
  onSaved: () => Promise<void>;
}) {
  const [context, setContext] = useState<InvestmentReviewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const headingId = useId();
  useEffect(() => {
    const abort = new AbortController();
    void loadInvestmentReview(positionId, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) {
          setContext(value);
          setError(null);
        }
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Investment details could not be loaded.",
          );
      });
    return () => abort.abort();
  }, [positionId, revision]);
  const save: Save = useCallback(
    async (action) => {
      if (busy) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        setContext(await loadInvestmentReview(positionId));
        await onSaved();
        setNotice("Investment review saved.");
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "The review could not be saved. Your entries are still here.",
        );
      } finally {
        setBusy(false);
      }
    },
    [busy, onSaved, positionId],
  );
  return (
    <section className="investment-review" aria-labelledby={headingId}>
      <h3 id={headingId}>Investment review</h3>
      {context === null && error === null && (
        <p role="status">Loading investment details…</p>
      )}
      {error !== null && (
        <FormMessage tone="error">
          {error}{" "}
          <TextLink onClick={() => setRevision((value) => value + 1)}>
            Reload details
          </TextLink>
        </FormMessage>
      )}
      {notice !== null && <FormMessage tone="success">{notice}</FormMessage>}
      {children}
      {context !== null && (
        <div className="investment-review__sections">
          <ParticipationReview context={context} save={save} busy={busy} />
          <CompanyReview context={context} save={save} busy={busy} />
          {context.economics !== null ? (
            <PositionEconomicsEditor
              holding={{
                id: positionId,
                sourceLabel,
                positionEconomicsContext: context.economics,
              }}
              onAccepted={async () => {
                setContext(await loadInvestmentReview(positionId));
                await onSaved();
              }}
            />
          ) : (
            <DataList className="investment-review__amounts">
              <DataItem
                label="Commitment"
                value={
                  context.committedMinor === null
                    ? "Not reported"
                    : formatCompactCurrency(
                        context.committedMinor,
                        context.currency,
                      )
                }
              />
              <DataItem
                label="Funded capital"
                value={
                  context.fundedMinor === null
                    ? "Not reported"
                    : formatCompactCurrency(
                        context.fundedMinor,
                        context.currency,
                      )
                }
              />
            </DataList>
          )}
          <OwnershipReview context={context} save={save} busy={busy} />
          <DocumentReview context={context} save={save} busy={busy} />
        </div>
      )}
    </section>
  );
}
