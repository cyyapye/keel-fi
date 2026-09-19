import { moneyInputValue, parseMoneyInput } from "./money-input";
import {
  matchingCompanies,
  companySuggestionKey,
} from "@keel/domain/company-identity";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  INVESTMENT_CLOSURE_REASONS,
  isEndedParticipation,
  type InvestmentClosureInput,
  CreateDocumentInvestmentInputSchema,
  InvestmentCompanyReviewInputSchema,
  InvestmentOwnershipInputSchema,
  ReviewInvestmentInputSchema,
  type InvestmentOwnershipInput,
  type InvestmentReviewContext,
  type InvestmentReviewState,
} from "@keel/domain/investment-review";
import {
  ownershipPercentTextToPpm,
  formatOwnershipInterestPpm,
} from "@keel/domain/legal-entities";
import {
  ActionGroup,
  Button,
  DataItem,
  DataList,
  DatePicker,
  Field,
  FormMessage,
  Input,
  InputGroup,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SearchSelect,
  TextLink,
  Tabs,
  SectionNavigation,
  SectionHeader,
  TabsContent,
} from "@keel/ui";
import {
  createDocumentInvestment,
  loadInvestmentReview,
  saveInvestmentCompany,
  saveInvestmentReview,
} from "./api";
import { PositionEconomicsEditor } from "./PositionEconomicsEditor";
import { formatCompactCurrency, formatCurrency, formatDate } from "./format";
import {
  entityReviewUrl,
  type EntityReviewTab,
} from "./legal-entity-navigation";
import {
  initialCompanyChoice,
  investmentReviewSections,
  selectedDocumentName,
} from "./investment-review-progress";

function ReviewSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: readonly { label: string; value: string }[];
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
  action,
}: {
  title: string;
  children: ReactNode;
  summary?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="investment-review__section">
      <SectionHeader title={title} headingAs="h3" action={action} />
      {summary}
      {children}
    </section>
  );
}

export type ReviewDocumentRenderer = (
  assignment: (id: string, fileName: string) => ReactNode,
  documents?: InvestmentReviewContext["documents"],
) => ReactNode;

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
const ownershipSources = [
  { value: "user_reported", label: "Reported by you" },
  { value: "agreement", label: "Agreement" },
  { value: "k1", label: "K-1" },
] as const;

function OwnershipEvidence({
  observations,
  documents,
}: {
  observations: InvestmentReviewState["ownershipObservations"];
  documents: InvestmentReviewContext["documents"];
}) {
  return (
    <div
      className="ownership-evidence"
      aria-label="Recorded ownership evidence"
    >
      {observations.map((item) => {
        const document = documents.find((doc) => doc.id === item.documentId);
        const source = ownershipSources.find(
          (kind) => kind.value === item.sourceKind,
        )!.label;
        const superseded = observations.some(
          (later) => later.supersedesObservationId === item.id,
        );
        const customLabel = ![
          source,
          "User reported",
          document?.fileName,
          document?.fileName.slice(0, 240),
        ].includes(item.sourceLabel)
          ? item.sourceLabel
          : null;
        return (
          <article key={item.id} className="ownership-evidence__entry">
            <DataList
              className={`ownership-evidence__values${item.sourceKind === "k1" ? " ownership-evidence__values--k1" : ""}`}
            >
              {item.sourceKind === "k1" ? (
                shareFields.map(([key, label]) => (
                  <DataItem
                    key={key}
                    label={label}
                    value={
                      item[key] === null
                        ? "Not reported"
                        : formatOwnershipInterestPpm(item[key])
                    }
                    valueClassName={item[key] === null ? "is-not-set" : ""}
                  />
                ))
              ) : (
                <DataItem
                  label="Ownership interest"
                  value={
                    item.ownershipPpm === null
                      ? "Not reported"
                      : formatOwnershipInterestPpm(item.ownershipPpm)
                  }
                />
              )}
            </DataList>
            <div className="ownership-evidence__source">
              <h4>
                {item.sourceKind === "k1" ? `${item.taxYear} K-1` : source}
              </h4>
              {item.effectiveDate !== null && (
                <p>As of {formatDate(item.effectiveDate)}</p>
              )}
              {document && (
                <p className="ownership-evidence__file">{document.fileName}</p>
              )}
              {customLabel !== null && <p>{customLabel}</p>}
              <small>
                {item.evidenceBasis === "document_review"
                  ? `Document reviewed · page ${item.page}`
                  : "Entered by you · no document attached"}
              </small>
              {superseded ? (
                <small>Replaced by a later entry</small>
              ) : (
                item.supersedesObservationId !== null && (
                  <small>Amends an earlier entry</small>
                )
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
type Save = (action: () => Promise<unknown>) => Promise<boolean>;
function useReviewSave(save: Save) {
  const [saving, setSaving] = useState(false);
  const submit = async (action: () => Promise<unknown>) => {
    setSaving(true);
    try {
      return await save(action);
    } finally {
      setSaving(false);
    }
  };
  return { saving, submit };
}
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

function InvestmentAmountReview({
  context,
  save,
  busy,
  children,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
  children: (controls: {
    action: ReactNode;
    editor: ReactNode;
    detail?: string | undefined;
  }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [useSource, setUseSource] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const { saving, submit } = useReviewSave(save);
  const correction = context.review?.amountCorrection;
  const sourceAmount = context.sourceAmountMinor ?? context.committedMinor;
  const nextAmount = useSource
    ? sourceAmount
    : parseMoneyInput(amount, context.currency);
  const draft = useSource
    ? null
    : { amountMinor: nextAmount, note: note.trim() };
  const requestId = useInvestmentRequest(context, draft);
  const parsed = ReviewInvestmentInputSchema.safeParse({
    requestId,
    expectedReviewId: context.review?.id ?? null,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
    participationStatus:
      context.review?.participationStatus ?? context.defaultParticipationStatus,
    amountCorrection: draft,
  });
  const changed = useSource
    ? correction != null
    : nextAmount !== context.committedMinor ||
      (correction != null && note.trim() !== correction.note);
  const valid = parsed.success && nextAmount !== null && changed;
  const money = (value: number | null) =>
    value === null ? "Not reported" : formatCurrency(value, context.currency);
  const acceptAmount = async () => {
    if (!parsed.success || !valid) return;
    if (
      await submit(() => saveInvestmentReview(context.positionId, parsed.data))
    ) {
      setOpen(false);
      setReviewing(false);
    }
  };
  const editor = !open ? null : (
    <div
      className="position-economics__form"
      aria-label="Investment amount correction"
    >
      {reviewing ? (
        <>
          <DataList className="investment-review__amounts">
            <DataItem
              label="Current amount"
              value={money(context.committedMinor)}
            />
            <DataItem label="New amount" value={money(nextAmount)} />
          </DataList>
          <p>{useSource ? "Use the source amount again." : note.trim()}</p>
          <p>
            {useSource
              ? "Future imports will supply this amount again."
              : "This correction stays in use until you change it or return to the source amount."}{" "}
            Fee calculations will use this amount. Funded capital and reported
            values stay separate.
          </p>
          <ActionGroup>
            <Button
              disabled={busy || !valid}
              onClick={() => void acceptAmount()}
            >
              {saving ? "Saving…" : "Save amount"}
            </Button>
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() => setReviewing(false)}
            >
              Back
            </Button>
          </ActionGroup>
        </>
      ) : (
        <>
          <p>
            Source amount: {money(sourceAmount)}. Enter your investment amount
            in {context.currency}.
          </p>
          {!useSource && (
            <>
              <Field label="Correct investment amount" variant="filled">
                <Input
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              <Field label="Reason for correction" variant="filled">
                <Textarea
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            </>
          )}
          {useSource && <p>The source amount will replace your correction.</p>}
          <ActionGroup>
            <Button
              disabled={busy || !valid}
              onClick={() => setReviewing(true)}
            >
              Review amount
            </Button>
            {correction != null && (
              <Button
                tone="secondary"
                disabled={busy}
                onClick={() => setUseSource(!useSource)}
              >
                {useSource ? "Enter a correction" : "Use source amount"}
              </Button>
            )}
            <Button
              tone="secondary"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </ActionGroup>
        </>
      )}
    </div>
  );
  return children({
    action:
      context.snapshotId === null || open ? null : (
        <Button
          tone="secondary"
          disabled={busy}
          onClick={() => {
            setAmount(
              moneyInputValue(context.committedMinor, context.currency),
            );
            setNote(correction?.note ?? "");
            setUseSource(false);
            setReviewing(false);
            setOpen(true);
          }}
        >
          Correct amount
        </Button>
      ),
    editor,
    detail:
      correction == null
        ? undefined
        : `Corrected by you. Source amount: ${money(sourceAmount)}. ${correction.note}`,
  });
}

function closureInput(
  context: InvestmentReviewContext,
): InvestmentClosureInput {
  const closure = context.review?.closure;
  return {
    endedOn: closure?.endedOn ?? null,
    reason: closure?.reason ?? null,
    note: closure?.note ?? null,
    replacementPositionId: closure?.replacementPositionId ?? null,
  };
}

const participationHelp = {
  current: "You still hold an active interest.",
  pending: "Your participation is awaiting completion.",
  historical:
    "You no longer hold an active interest. Excluded from current holdings and totals; history and documents remain available.",
  cancelled:
    "The subscription did not become a completed investment. Excluded from current holdings and totals; history and documents remain available.",
  unknown: "Your participation has not been confirmed.",
};

function ParticipationReview({
  context,
  save,
  busy,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
}) {
  const { saving, submit } = useReviewSave(save);
  const acceptedStatus =
    context.review?.participationStatus ?? context.defaultParticipationStatus;
  const [status, setStatus] = useState(acceptedStatus);
  const [draft, setDraft] = useState<InvestmentClosureInput>(() =>
    closureInput(context),
  );
  const confirmed =
    context.automaticReview?.resolved.includes("participation") === true ||
    (context.review !== null &&
      context.review.participationStatus !== "unknown");
  const [editing, setEditing] = useState(!confirmed);
  const requestId = useInvestmentRequest(context, [status, draft]);
  const closure =
    status === "historical" &&
    Object.values(draft).some((value) => value !== null)
      ? draft
      : null;
  const input = ReviewInvestmentInputSchema.safeParse({
    requestId,
    expectedReviewId: context.review?.id ?? null,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
    participationStatus: status,
    closure,
  });
  const today = new Date().toISOString().slice(0, 10);
  const invalidDate =
    closure?.endedOn != null &&
    (closure.endedOn > today ||
      (context.openedOn != null && closure.endedOn < context.openedOn));
  const savedClosure =
    context.review?.closure == null ? null : closureInput(context);
  const changed =
    context.review === null ||
    status !== acceptedStatus ||
    JSON.stringify(closure) !== JSON.stringify(savedClosure);
  const acceptedClosure = context.review?.closure;
  return (
    <ReviewSection
      title="Participation"
      action={
        !editing && (
          <Button
            tone="secondary"
            onClick={() => {
              setStatus(acceptedStatus);
              setDraft(closureInput(context));
              setEditing(true);
            }}
          >
            Change status
          </Button>
        )
      }
      summary={
        <>
          <p>
            {participation.find((item) => item.value === acceptedStatus)?.label}{" "}
            · {context.holderLabel}
          </p>
          {!editing && isEndedParticipation(acceptedStatus) && (
            <p>{participationHelp[acceptedStatus]}</p>
          )}
          {!editing && acceptedClosure != null && (
            <DataList className="investment-review__closure">
              {acceptedClosure.endedOn !== null && (
                <DataItem
                  label="Ended"
                  value={formatDate(acceptedClosure.endedOn)}
                />
              )}
              {acceptedClosure.reason !== null && (
                <DataItem
                  label="Closure reason"
                  value={
                    INVESTMENT_CLOSURE_REASONS.find(
                      (item) => item.value === acceptedClosure.reason,
                    )?.label
                  }
                />
              )}
              {acceptedClosure.note !== null && (
                <DataItem label="Closure note" value={acceptedClosure.note} />
              )}
              {acceptedClosure.replacementPositionId !== null && (
                <DataItem
                  label="Related replacement"
                  value={
                    <TextLink
                      href={entityReviewUrl(
                        {
                          kind: "holding_position",
                          id: acceptedClosure.replacementPositionId,
                        },
                        "investment",
                      )}
                    >
                      {acceptedClosure.replacementPositionLabel ??
                        "View investment"}
                    </TextLink>
                  }
                />
              )}
            </DataList>
          )}
        </>
      }
    >
      {editing && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (input.success && changed && !invalidDate)
              void submit(() =>
                saveInvestmentReview(context.positionId, input.data),
              ).then((saved) => {
                if (saved) setEditing(false);
              });
          }}
        >
          <ReviewSelect
            label="Your participation"
            value={status}
            items={participation}
            onChange={(value) => {
              if (participation.some((item) => item.value === value))
                setStatus(value as typeof status);
            }}
          />
          <p>{participationHelp[status]}</p>
          {status === "historical" && (
            <>
              <div className="investment-review__fields">
                <Field label="Ended date (optional)" variant="filled">
                  <DatePicker
                    aria-label="Ended date"
                    value={draft.endedOn ?? ""}
                    {...(context.openedOn == null
                      ? {}
                      : { min: context.openedOn })}
                    max={today}
                    onValueChange={(value) =>
                      setDraft({ ...draft, endedOn: optional(value) })
                    }
                  />
                </Field>
                <ReviewSelect
                  label="Closure reason (optional)"
                  value={draft.reason ?? "none"}
                  items={[
                    { value: "none", label: "Not recorded" },
                    ...INVESTMENT_CLOSURE_REASONS,
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      reason:
                        INVESTMENT_CLOSURE_REASONS.find(
                          (item) => item.value === value,
                        )?.value ?? null,
                    })
                  }
                />
              </div>
              <Field label="Closure note (optional)" variant="filled">
                <Textarea
                  maxLength={1_000}
                  value={draft.note ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      note: event.currentTarget.value || null,
                    })
                  }
                />
              </Field>
              <Field label="Related replacement (optional)" variant="filled">
                <SearchSelect
                  label="Related replacement"
                  searchLabel="Search investments"
                  emptyMessage="No matching investments."
                  value={draft.replacementPositionId ?? "none"}
                  items={[
                    { value: "none", label: "None" },
                    ...context.otherPositions.map((item) => ({
                      value: item.id,
                      label: item.label,
                    })),
                  ]}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      replacementPositionId: value === "none" ? null : value,
                    })
                  }
                />
              </Field>
              <p>
                Closure details do not record a refund or declare the legal
                entity dissolved.
              </p>
            </>
          )}
          {status === "cancelled" && (
            <p>This does not declare the legal entity dissolved.</p>
          )}
          {invalidDate && (
            <FormMessage tone="error">
              Choose an ended date between the investment’s opening date and
              today.
            </FormMessage>
          )}
          <ActionGroup align="end">
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !input.success || !changed || invalidDate}
            >
              {saving ? "Saving…" : "Save participation"}
            </Button>
          </ActionGroup>
        </form>
      )}
    </ReviewSection>
  );
}

function OwnershipReview({
  context,
  save,
  busy,
  legalName,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
  legalName: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const { saving, submit } = useReviewSave(save);
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
    sourceLabel:
      context.documents
        .find((doc) => doc.id === draft.documentId)
        ?.fileName.slice(0, 240) ??
      ownershipSources.find((source) => source.value === draft.sourceKind)!
        .label,
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
  const amendable = current.filter(
    (item) =>
      item.sourceKind === draft.sourceKind &&
      (draft.sourceKind !== "k1" || item.taxYear === Number(year)),
  );
  const documents = context.documents.filter(
    (doc) => doc.scan?.outcome === "clean",
  );
  return (
    <ReviewSection
      title="Ownership evidence"
      summary={
        <div className="investment-review__ownership-subject">
          <p>
            <strong>{context.holderLabel}</strong> ·{" "}
            {legalName ?? "Legal vehicle not yet confirmed"}
          </p>
          <p>
            {observations.length === 0
              ? "No ownership evidence recorded. This is optional and does not block the investment review."
              : "Recorded ownership in this legal vehicle. Each source and effective date stays separate."}
          </p>
        </div>
      }
    >
      {observations.length > 0 && (
        <OwnershipEvidence
          observations={observations}
          documents={context.documents}
        />
      )}
      {!editing && (
        <ActionGroup align="end">
          <Button onClick={() => setEditing(true)}>
            {observations.length === 0
              ? "Add ownership evidence"
              : "Add another observation"}
          </Button>
        </ActionGroup>
      )}
      {editing && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (input.success)
              void submit(async () => {
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
              }).then((saved) => {
                if (!saved) return;
                setEditing(false);
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
              items={ownershipSources}
              onChange={(value) => {
                if (
                  value === "k1" ||
                  value === "agreement" ||
                  value === "user_reported"
                )
                  setDraft({
                    ...emptyOwnership,
                    sourceKind: value,
                  });
              }}
            />
            {draft.sourceKind === "k1" ? (
              <>
                <Field label="Tax year" variant="filled">
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    value={year}
                    onChange={(event) => {
                      setYear(event.currentTarget.value);
                      setDraft({ ...draft, supersedesObservationId: null });
                    }}
                  />
                </Field>
                <p className="investment-review__field-note">
                  Keep profit, loss, and capital shares separate. Blank means
                  not reported, not zero.
                </p>
                <div className="ownership-share-pairs">
                  {["Profit", "Loss", "Capital"].map((share, index) => (
                    <div className="ownership-share-pair" key={share}>
                      {shareFields
                        .slice(index * 2, index * 2 + 2)
                        .map(([key, label]) => (
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
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <Field label="Ownership interest" variant="filled">
                  <InputGroup suffix="%">
                    <Input
                      inputMode="decimal"
                      value={percent}
                      onChange={(event) =>
                        setPercent(event.currentTarget.value)
                      }
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
              onChange={(value) => {
                setDraft({
                  ...draft,
                  documentId: value === "none" ? null : value,
                  quote: value === "none" ? null : draft.quote,
                });
              }}
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
            {amendable.length > 0 && (
              <ReviewSelect
                label="Amends an earlier observation"
                value={draft.supersedesObservationId ?? "none"}
                items={[
                  { value: "none", label: "New observation" },
                  ...amendable.map((item) => ({
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
            )}
          </div>
          {!input.success && (percent !== "" || year !== "" || page !== "") && (
            <FormMessage tone="neutral">
              {input.error.issues[0]?.message}
            </FormMessage>
          )}
          <ActionGroup align="end" mobileLayout="grid">
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !input.success}>
              {saving ? "Saving…" : "Save ownership evidence"}
            </Button>
          </ActionGroup>
        </form>
      )}
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
  const { saving, submit } = useReviewSave(save);
  const confirmed = investmentReviewSections(context, true)[0]!.complete;
  const [editing, setEditing] = useState(!confirmed);
  const [choice, setChoice] = useState(() => initialCompanyChoice(context));
  const active = context.mappings.filter(
    (m) => m.status === "active" && m.companyId !== null,
  );
  const targetForChoice = (value: string) => {
    const selected = context.companyChoices[Number(value)];
    const matches = matchingCompanies(
      context.companies,
      selected?.companyName ?? "",
    );
    return {
      existing: matches.length === 1 ? matches[0]!.id : "new",
      name: selected?.companyName ?? "",
    };
  };
  const initialTarget = targetForChoice(choice);
  const [existing, setExisting] = useState(
    active.length === 1 ? active[0]!.companyId! : initialTarget.existing,
  );
  const [name, setName] = useState(initialTarget.name);
  const requestId = useInvestmentRequest(context, [choice, existing, name]);
  const companyIssue = context.automaticReview?.issues.find(
    (issue) => issue.section === "company",
  );
  const citation =
    choice === "manual"
      ? null
      : (context.companyChoices[Number(choice)] ?? null);
  const company =
    existing === "new"
      ? { mode: "new", legalName: name }
      : { mode: "existing", companyId: existing };
  const companyName =
    existing === "new"
      ? name.trim()
      : context.companies.find((item) => item.id === existing)?.legalName;
  const basis =
    citation === null
      ? "user_confirmed"
      : companyName === citation.companyName
        ? "document_choice"
        : "document_link";
  const duplicateName =
    existing === "new" &&
    matchingCompanies(context.companies, name.trim()).length > 0;
  const input = InvestmentCompanyReviewInputSchema.safeParse({
    requestId,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
    expectedMappingIds: context.mappings.map((m) => m.id),
    company,
    basis,
    citation,
    reason: null,
  });
  const unchanged =
    companyIssue === undefined &&
    context.companyReceipt !== null &&
    active.length === 1 &&
    (existing === active[0]?.companyId ||
      (existing === "new" &&
        companyName === context.companyReceipt.companyName)) &&
    context.companyReceipt.basis === basis &&
    JSON.stringify(context.companyReceipt.citation) ===
      JSON.stringify(citation);
  return (
    <ReviewSection
      title="Underlying company"
      action={
        !editing && (
          <Button tone="secondary" onClick={() => setEditing(true)}>
            Edit company
          </Button>
        )
      }
      summary={
        <div className="investment-review__company-basis">
          {companyIssue !== undefined && <p>{companyIssue.message}</p>}
          <p>
            <strong>
              {active.length === 0
                ? "Company not confirmed"
                : `Currently mapped to ${active.map((m) => m.companyName).join("; ")}`}
            </strong>
          </p>
          {active.map((mapping) => {
            const receipt =
              context.companyReceipt?.mappingId === mapping.id
                ? context.companyReceipt
                : null;
            return (
              <p key={mapping.id}>
                {receipt?.companyAliasReviewId
                  ? `Company name reviewed · ${receipt.citation ? `Agreement names ${receipt.citation.companyName}` : receipt.companyName}`
                  : receipt?.basis === "document_link"
                    ? `${receipt.decisionSource === "deterministic_policy" ? "Matched using a reviewed company name" : "Linked by you"} · Agreement names ${receipt.citation?.companyName}`
                    : receipt?.basis === "document_choice"
                      ? "Confirmed from an agreement"
                      : receipt?.basis === "user_confirmed"
                        ? "Confirmed by you"
                        : mapping.decisionSource === "review"
                          ? "Earlier reviewed mapping"
                          : "Existing mapping"}
                {(receipt?.recordedAt ?? mapping.acceptedAt)
                  ? ` · ${formatDate(receipt?.recordedAt ?? mapping.acceptedAt ?? "")}`
                  : ""}
                {receipt?.citation && (
                  <>
                    {" "}
                    · page {receipt.citation.page}
                    <br />“{receipt.citation.quote}”
                  </>
                )}
              </p>
            );
          })}
          {editing && (
            <p>
              {context.companyChoices.length === 0
                ? "No supporting company citation was extracted from these agreements. The provider’s deal label alone does not confirm the underlying company."
                : `${context.companyChoices.length} company ${context.companyChoices.length === 1 ? "citation is" : "citations are"} available. Confirm the supporting evidence before saving.`}
            </p>
          )}
        </div>
      }
    >
      {editing && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (input.success && !duplicateName && !unchanged) {
              let savedCompanyId: string | null = null;
              void submit(async () => {
                const receipt = await saveInvestmentCompany(
                  context.positionId,
                  input.data,
                );
                savedCompanyId = receipt.companyId;
              }).then((accepted) => {
                if (accepted && savedCompanyId !== null) {
                  setExisting(savedCompanyId);
                  setEditing(false);
                }
              });
            }
          }}
        >
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
            onChange={(value) => {
              const target = targetForChoice(value);
              // A different citation for the same reported name keeps the chosen
              // portfolio company. A different company starts a fresh proposal.
              if (
                value !== "manual" &&
                context.companyChoices[Number(value)]?.companyName !==
                  citation?.companyName
              ) {
                setExisting(target.existing);
                setName(target.name);
              }
              setChoice(value);
            }}
          />
          {citation !== null && (
            <>
              <p>
                {
                  context.documents.find(
                    (doc) => doc.id === citation.documentId,
                  )?.fileName
                }{" "}
                · page {citation.page}
              </p>
              <blockquote>{citation.quote}</blockquote>
            </>
          )}
          <Field label="Company" variant="filled">
            <SearchSelect
              label="Company"
              searchLabel="Search companies"
              emptyMessage="No companies found. Clear search to add one."
              value={existing}
              items={[
                { value: "new", label: "Add a company" },
                ...context.companies.map((c) => ({
                  value: c.id,
                  label: c.legalName,
                  searchText: c.aliases?.join(" ") ?? "",
                })),
              ]}
              onChange={setExisting}
            />
          </Field>
          {existing === "new" && (
            <Field label="Company name" variant="filled">
              <Input
                maxLength={1_000}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </Field>
          )}
          {duplicateName && (
            <FormMessage tone="neutral">
              This company already exists. Choose it from the company list.
            </FormMessage>
          )}
          {citation === null && (
            <p>
              Recorded as your confirmation, not a provider-reported company.
            </p>
          )}
          {existing === "new" &&
            !duplicateName &&
            name.trim() &&
            context.companies.some(
              (item) =>
                companySuggestionKey(item.legalName) ===
                companySuggestionKey(name),
            ) && (
              <FormMessage tone="neutral">
                A similar company name exists. Check the company list before
                adding another.
              </FormMessage>
            )}
          <ActionGroup align="end">
            <Button
              tone="quiet"
              disabled={busy}
              onClick={() => {
                const savedChoice = initialCompanyChoice(context);
                const savedTarget = targetForChoice(savedChoice);
                setChoice(savedChoice);
                setExisting(
                  active.length === 1
                    ? active[0]!.companyId!
                    : savedTarget.existing,
                );
                setName(savedTarget.name);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !input.success || duplicateName || unchanged}
            >
              {saving ? "Saving…" : "Save company mapping"}
            </Button>
          </ActionGroup>
        </form>
      )}
      <TextLink
        href={`/holdings/entities?companies=1${existing === "new" ? "" : `&company=${encodeURIComponent(existing)}`}${citation ? `&name=${encodeURIComponent(citation.companyName)}` : ""}`}
      >
        Review company names across investments
      </TextLink>
    </ReviewSection>
  );
}

function DocumentReview({
  context,
  save,
  busy,
  legalName,
  identitySaved,
  renderDocuments,
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
  legalName: string | null;
  identitySaved: boolean;
  renderDocuments: ReviewDocumentRenderer;
}) {
  const { saving, submit } = useReviewSave(save);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState("supports");
  const [label, setLabel] = useState<string | null>(null);
  const investmentLabel = label ?? selectedDocumentName(context, selected);
  const [status, setStatus] = useState("unknown");
  const requestId = useInvestmentRequest(context, [
    selected,
    target,
    investmentLabel,
    status,
  ]);
  const clean = context.documents.filter(
    (doc) => doc.scan?.outcome === "clean",
  );
  const savedAssignments = new Map(
    context.review?.documentAssignments.map((item) => [item.documentId, item]),
  );
  const assignedCount = clean.filter((doc) => {
    const saved = savedAssignments.get(doc.id);
    return saved !== undefined && saved.relationship !== "unassigned";
  }).length;
  const remainingCount = clean.length - assignedCount;
  const identityLinked = investmentReviewSections(context, identitySaved).find(
    (section) => section.value === "documents",
  )!.complete;

  const base = {
    requestId,
    expectedReviewId: context.review?.id ?? null,
    expectedSnapshotId: context.snapshotId,
    expectedEvidenceRevision: context.evidenceRevision,
  };
  const related = CreateDocumentInvestmentInputSchema.safeParse({
    ...base,
    label: investmentLabel,
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
  const assignmentChanged =
    assignment.success &&
    assignment.data.documentAssignments?.some((item) => {
      const saved = savedAssignments.get(item.documentId);
      return (
        saved === undefined ||
        saved.sha256 !== item.sha256 ||
        saved.relationship !== item.relationship ||
        saved.targetPositionId !== item.targetPositionId
      );
    });
  return (
    <ReviewSection
      title="Agreements"
      action={
        !editing &&
        clean.length > 1 && (
          <Button tone="secondary" onClick={() => setEditing(true)}>
            Change assignments
          </Button>
        )
      }
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
            void submit(async () => {
              await createDocumentInvestment(context.positionId, related.data);
            }).then((saved) => {
              if (!saved) return;
              setEditing(false);
              setSelected([]);
              setLabel(null);
            });
          else if (target !== "new" && assignment.success && assignmentChanged)
            void submit(async () => {
              await saveInvestmentReview(context.positionId, assignment.data);
            }).then((saved) => {
              if (!saved) return;
              setEditing(false);
              setSelected([]);
            });
        }}
      >
        {clean.length > 0 && (
          <p className="investment-review__assignment-count" aria-live="polite">
            {assignedCount === 0 && identityLinked
              ? `${clean.length} ${clean.length === 1 ? "agreement" : "agreements"} · Linked through reviewed identity`
              : `${assignedCount} of ${clean.length} explicitly assigned${remainingCount > 0 ? ` · ${remainingCount} still to assign` : " · All agreements assigned"}`}
          </p>
        )}
        {renderDocuments((id, fileName) => {
          if (!clean.some((doc) => doc.id === id)) return null;
          const saved = savedAssignments.get(id);
          const assignmentLabel =
            saved?.relationship === "supports"
              ? `Assigned to ${legalName ?? context.positionLabel}`
              : saved?.relationship === "general"
                ? "General or parent agreement"
                : saved?.relationship === "other_investment"
                  ? `Assigned to ${context.otherPositions.find((p) => p.id === saved.targetPositionId)?.label ?? "Another investment"}`
                  : saved?.relationship === "unassigned"
                    ? "Not yet determined"
                    : identityLinked
                      ? `Supports ${legalName ?? context.positionLabel} · linked through reviewed identity`
                      : "No explicit assignment";
          return (
            <div className="investment-review__document-assignment">
              <p className="investment-review__assignment" aria-live="polite">
                {assignmentLabel}
              </p>
              {editing ? (
                <label>
                  <Input
                    type="checkbox"
                    aria-label={fileName}
                    checked={selected.includes(id)}
                    onChange={(event) =>
                      setSelected(
                        event.currentTarget.checked
                          ? [...selected, id]
                          : selected.filter((item) => item !== id),
                      )
                    }
                  />
                  Select agreement
                </label>
              ) : (
                <Button
                  tone="quiet"
                  disabled={busy}
                  onClick={() => {
                    setSelected([id]);
                    setTarget(
                      saved?.relationship === "other_investment"
                        ? saved.targetPositionId!
                        : (saved?.relationship ?? "supports"),
                    );
                    setEditing(true);
                  }}
                >
                  Change assignment
                </Button>
              )}
            </div>
          );
        }, context.documents)}
        {clean.length === 0 && (
          <p>No agreements are available for assignment yet.</p>
        )}
        {editing && (
          <>
            <ReviewSelect
              label="These agreements belong to"
              value={target}
              items={[
                { value: "new", label: "A separate investment" },
                {
                  value: "supports",
                  label: legalName ?? context.positionLabel,
                },
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
                    value={investmentLabel}
                    maxLength={1_000}
                    onChange={(event) => setLabel(event.currentTarget.value)}
                    placeholder="Name from the agreement"
                  />
                </Field>
                <ReviewSelect
                  label="New investment’s status"
                  value={status}
                  onChange={setStatus}
                  items={participation.filter((item) =>
                    ["pending", "cancelled", "unknown"].includes(item.value),
                  )}
                />
                <p>
                  This status applies only to the new investment. This
                  investment’s status and amounts stay unchanged; no fee or
                  carry is copied.
                </p>
              </>
            )}
            <ActionGroup align="end">
              <Button
                tone="quiet"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setSelected([]);
                  setLabel(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  busy ||
                  selected.length === 0 ||
                  (target === "new"
                    ? !related.success
                    : !assignment.success || !assignmentChanged)
                }
              >
                {saving
                  ? "Saving…"
                  : target === "new"
                    ? "Create separate investment"
                    : "Save document assignment"}
              </Button>
            </ActionGroup>
          </>
        )}
      </form>
    </ReviewSection>
  );
}

export function InvestmentReview({
  positionId,
  sourceLabel,
  identity,
  identitySaved,
  renderDocuments,
  legalName,
  tab,
  onTabChange,
  onSaved,
}: {
  positionId: string;
  sourceLabel: string;
  identity: ReactNode;
  identitySaved: boolean;
  renderDocuments: ReviewDocumentRenderer;
  legalName: string | null;
  tab: EntityReviewTab;
  onTabChange: (tab: EntityReviewTab) => void;
  onSaved: () => Promise<void>;
}) {
  const [context, setContext] = useState<InvestmentReviewContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
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
      if (busy) return false;
      setBusy(true);
      setError(null);
      try {
        await action();
        await onSaved();
        setContext(await loadInvestmentReview(positionId));
        return true;
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "The review could not be saved. Your entries are still here.",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, onSaved, positionId],
  );
  const sections = investmentReviewSections(context, identitySaved);
  const required = sections.filter((section) => section.value !== "ownership");
  const outstanding = required.filter((section) => !section.complete);
  const nextSection = outstanding.find((section) => section.next !== null);
  return (
    <section className="investment-review" aria-label="Investment review">
      {context !== null && (
        <div className="investment-review__summary">
          <div>
            <strong>
              {outstanding.length === 0
                ? "Review complete"
                : "Review in progress"}
            </strong>
            <p>
              {outstanding.length === 0
                ? "Required details are reviewed. Ownership evidence is optional."
                : (nextSection?.next ??
                  "Document evidence is not yet reviewed.")}
            </p>
          </div>
          <ActionGroup>
            {nextSection && nextSection.value !== tab && (
              <Button
                tone="secondary"
                onClick={() => onTabChange(nextSection.value)}
              >
                Continue review
              </Button>
            )}
          </ActionGroup>
        </div>
      )}
      {error !== null && (
        <FormMessage tone="error">
          {error}{" "}
          <TextLink onClick={() => setRevision((value) => value + 1)}>
            Reload details
          </TextLink>
        </FormMessage>
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => onTabChange(value as EntityReviewTab)}
      >
        <SectionNavigation
          label="Review sections"
          mobilePresentation="tabs"
          items={sections}
          value={tab}
          onValueChange={(value) => onTabChange(value as EntityReviewTab)}
        />
        <TabsContent
          value="identity"
          keepMounted
          className="entity-review__panel"
        >
          {identity}
          {context !== null && (
            <CompanyReview context={context} save={save} busy={busy} />
          )}
        </TabsContent>
        <TabsContent
          value="investment"
          keepMounted
          className="entity-review__panel"
        >
          {context !== null && (
            <>
              <ParticipationReview context={context} save={save} busy={busy} />
              <InvestmentAmountReview context={context} save={save} busy={busy}>
                {({ action, editor, detail }) =>
                  context.economics !== null ? (
                    <PositionEconomicsEditor
                      presentation="review"
                      amountAction={action}
                      amountEditor={editor}
                      amountDetail={detail}
                      holding={{
                        id: positionId,
                        sourceLabel,
                        positionEconomicsContext: context.economics,
                      }}
                      onAccepted={async () => {
                        await onSaved();
                        setContext(await loadInvestmentReview(positionId));
                      }}
                    />
                  ) : (
                    <ReviewSection title="Investment amount" action={action}>
                      {editor}
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
                      {detail && <p>{detail}</p>}
                    </ReviewSection>
                  )
                }
              </InvestmentAmountReview>
            </>
          )}
        </TabsContent>
        <TabsContent
          value="documents"
          keepMounted
          className="entity-review__panel"
        >
          {context === null ? (
            renderDocuments(() => null)
          ) : (
            <DocumentReview
              context={context}
              save={save}
              busy={busy}
              legalName={legalName}
              identitySaved={identitySaved}
              renderDocuments={renderDocuments}
            />
          )}
        </TabsContent>
        <TabsContent
          value="ownership"
          keepMounted
          className="entity-review__panel"
        >
          {context !== null && (
            <OwnershipReview
              context={context}
              save={save}
              busy={busy}
              legalName={legalName}
            />
          )}
        </TabsContent>
      </Tabs>
      {context === null && error === null && (
        <p role="status">Loading investment details…</p>
      )}
    </section>
  );
}
