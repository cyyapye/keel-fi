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
  SearchSelect,
  TextLink,
  Tabs,
  SectionNavigation,
  TabsContent,
} from "@keel/ui";
import {
  createDocumentInvestment,
  downloadLegalEntityDocument,
  loadInvestmentReview,
  saveInvestmentCompany,
  saveInvestmentReview,
} from "./api";
import { PositionEconomicsEditor } from "./PositionEconomicsEditor";
import { formatCompactCurrency, formatDate } from "./format";
import { type EntityReviewTab } from "./legal-entity-navigation";
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
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  summary?: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <Collapsible
      className="investment-review__section"
      defaultOpen={defaultOpen}
    >
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
  const changed =
    context.review === null || status !== context.review.participationStatus;
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
          if (input.success && changed)
            void submit(() =>
              saveInvestmentReview(context.positionId, input.data),
            );
        }}
      >
        <ReviewSelect
          label="This investment’s status"
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
        <ActionGroup align="end">
          <Button type="submit" disabled={busy || !input.success || !changed}>
            {saving ? "Saving…" : "Save participation"}
          </Button>
        </ActionGroup>
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
  const documents = context.documents.filter(
    (doc) => doc.scan?.outcome === "clean",
  );
  return (
    <ReviewSection
      title="Ownership evidence"
      summary={
        observations.length === 0 && (
          <p>
            Optional. Add ownership when your first K-1 or an agreement reports
            it. You can add and export this entity without it.
          </p>
        )
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
                    onChange={(event) => setYear(event.currentTarget.value)}
                  />
                </Field>
                <p className="investment-review__field-note">
                  Keep profit, loss, and capital shares separate. Blank means
                  not reported, not zero.
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
      defaultOpen={companyIssue !== undefined}
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
          <p>
            {context.companyChoices.length === 0
              ? "No supporting company citation was extracted from these agreements. The provider’s deal label alone does not confirm the underlying company."
              : `${context.companyChoices.length} company ${context.companyChoices.length === 1 ? "citation is" : "citations are"} available. Confirm the supporting evidence before saving.`}
          </p>
        </div>
      }
    >
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
              if (accepted && savedCompanyId !== null)
                setExisting(savedCompanyId);
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
                context.documents.find((doc) => doc.id === citation.documentId)
                  ?.fileName
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
        {citation === null ? (
          <p>Recorded as your confirmation, not a provider-reported company.</p>
        ) : (
          companyName && (
            <p>
              {basis === "document_link"
                ? `Group this investment under ${companyName}. The agreement’s name, ${citation.companyName}, stays with the evidence.`
                : `Use ${companyName} for this investment’s company.`}
            </p>
          )
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
        {active.length > 0 && (
          <p>Changes only this investment’s company, not its amounts.</p>
        )}
        <ActionGroup align="end">
          <Button
            type="submit"
            disabled={busy || !input.success || duplicateName || unchanged}
          >
            {saving ? "Saving…" : "Save company mapping"}
          </Button>
        </ActionGroup>
      </form>
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
}: {
  context: InvestmentReviewContext;
  save: Save;
  busy: boolean;
}) {
  const { saving, submit } = useReviewSave(save);
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
  const [downloadError, setDownloadError] = useState<string | null>(null);
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
  if (clean.length === 0)
    return <p>No agreements are available for assignment yet.</p>;
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
            void submit(async () => {
              await createDocumentInvestment(context.positionId, related.data);
            }).then((saved) => {
              if (!saved) return;
              setSelected([]);
              setLabel(null);
            });
          else if (target !== "new" && assignment.success && assignmentChanged)
            void submit(async () => {
              await saveInvestmentReview(context.positionId, assignment.data);
            }).then((saved) => {
              if (!saved) return;
              setSelected([]);
            });
        }}
      >
        <p className="investment-review__assignment-count" aria-live="polite">
          {assignedCount} of {clean.length} assigned
          {remainingCount > 0
            ? ` · ${remainingCount} still to assign`
            : " · All agreements assigned"}
        </p>
        <div className="investment-review__documents">
          {clean.map((doc) => {
            const saved = savedAssignments.get(doc.id);
            const assignmentLabel =
              saved?.relationship === "supports"
                ? "This investment"
                : saved?.relationship === "general"
                  ? "General or parent agreement"
                  : saved?.relationship === "other_investment"
                    ? `Other investment: ${context.otherPositions.find((p) => p.id === saved.targetPositionId)?.label ?? "Another investment"}`
                    : saved?.relationship === "unassigned"
                      ? "Not yet determined"
                      : "Not assigned";
            const assigned =
              saved !== undefined && saved.relationship !== "unassigned";
            return (
              <article
                key={doc.id}
                className="investment-review__document"
                aria-label={doc.fileName}
              >
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
                <div className="investment-review__document-details">
                  <p>
                    {doc.citations
                      ?.map(
                        (citation) =>
                          `${citation.legalName} · page ${citation.page}`,
                      )
                      .join("; ") ?? "Review the PDF for its legal name."}
                  </p>
                  <p
                    className="investment-review__assignment"
                    aria-live="polite"
                  >
                    {assigned && <span aria-hidden="true">✓ </span>}
                    {assignmentLabel}
                  </p>
                </div>
              </article>
            );
          })}
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
              This status applies only to the new investment. This investment’s
              status and amounts stay unchanged; no fee or carry is copied.
            </p>
          </>
        )}
        {downloadError !== null && (
          <FormMessage tone="error">{downloadError}</FormMessage>
        )}
        <ActionGroup align="end">
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
      </form>
    </ReviewSection>
  );
}

export function InvestmentReview({
  positionId,
  sourceLabel,
  identity,
  identitySaved,
  documents,
  tab,
  onTabChange,
  onSaved,
}: {
  positionId: string;
  sourceLabel: string;
  identity: ReactNode;
  identitySaved: boolean;
  documents: ReactNode;
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
  const nextSection =
    context === null
      ? undefined
      : sections.find(
          (section) => section.value !== tab && section.next !== null,
        );
  return (
    <section className="investment-review" aria-label="Investment review">
      {context?.automaticReview && (
        <p className="entity-review__next">
          {context.automaticReview.issues.length === 0
            ? "Source details accepted automatically. You can edit any section."
            : "Matching source details are filled in. Review the remaining questions; you can edit any section."}
        </p>
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
          items={sections}
          value={tab}
          onValueChange={(value) => onTabChange(value as EntityReviewTab)}
        />
        {nextSection && (
          <p className="entity-review__next">
            <TextLink onClick={() => onTabChange(nextSection.value)}>
              Next: {nextSection.next}
            </TextLink>
          </p>
        )}
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
              {context.economics !== null ? (
                <PositionEconomicsEditor
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
            </>
          )}
        </TabsContent>
        <TabsContent
          value="documents"
          keepMounted
          className="entity-review__panel"
        >
          {documents}
          {context !== null && (
            <DocumentReview context={context} save={save} busy={busy} />
          )}
        </TabsContent>
        <TabsContent
          value="ownership"
          keepMounted
          className="entity-review__panel"
        >
          {context !== null && (
            <OwnershipReview context={context} save={save} busy={busy} />
          )}
        </TabsContent>
      </Tabs>
      {context === null && error === null && (
        <p role="status">Loading investment details…</p>
      )}
    </section>
  );
}
