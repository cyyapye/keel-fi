import { useMemo, useState } from "react";
import {
  currentInvestmentEvents,
  InvestmentEventInputSchema,
  suggestInvestmentEvent,
  type InvestmentEvent,
  type InvestmentEventInput,
  type InvestmentEventComponent,
} from "@keel/domain/investment-events";
import type { InvestmentReviewContext } from "@keel/domain/investment-review";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  DisclosureIndicator,
  ActionGroup,
  Button,
  DatePicker,
  DataList,
  DataItem,
  Field,
  Input,
  Textarea,
  FormMessage,
  SectionHeader,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@keel/ui";
import { saveInvestmentReview } from "./api";
import { formatDate, formatCurrency } from "./format";
import { parseMoneyInput, moneyInputValue } from "./money-input";

function Choice({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: readonly string[];
  onChange: (value: string) => void;
}) {
  const items = values.map((value) => ({
    value,
    label: value
      .replaceAll("_", " ")
      .replace(/^./u, (letter) => letter.toUpperCase()),
  }));
  return (
    <Field label={label} variant="filled">
      <Select
        items={items}
        value={value}
        onValueChange={(value) => {
          if (typeof value === "string") onChange(value);
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
function EventMoneyInput({
  value,
  currency,
  onChange,
}: {
  value: number | null;
  currency: string;
  onChange: (value: number | null) => void;
}) {
  const [entry, setEntry] = useState(() => ({
    value,
    currency,
    text: moneyInputValue(value, currency),
  }));
  // Keep partial decimal input while typing; reset when a different component
  // occupies this row after removal or its currency changes.
  if (entry.value !== value || entry.currency !== currency)
    setEntry({ value, currency, text: moneyInputValue(value, currency) });
  return (
    <Input
      inputMode="decimal"
      value={entry.text}
      onChange={(event) => {
        const text = event.currentTarget.value;
        const amount =
          text.trim() === ""
            ? null
            : /^0(?:\.0*)?$/u.test(text.trim())
              ? 0
              : (parseMoneyInput(text, currency) ?? -1);
        setEntry({ value: amount, currency, text });
        onChange(amount);
      }}
    />
  );
}
const optional = (value: string) => value.trim() || null;
function blank(context: InvestmentReviewContext): InvestmentEventInput {
  return {
    eventId: crypto.randomUUID(),
    supersedesRevisionId: null,
    kind: "merger",
    scope: "underlying_securities",
    participationContinues: true,
    status: "announced",
    predecessor:
      context.mappings.find((mapping) => mapping.status === "active")
        ?.companyName ?? "",
    successor: "",
    noticeDate: null,
    effectiveDate: null,
    sourceLabel: "GP notice",
    sourceText: "",
    documentId: null,
    lpDistribution: "unknown",
    components: [],
    note: null,
    expectedMappingIds: context.mappings.map((mapping) => mapping.id),
  };
}
function EventSummary({ event }: { event: InvestmentEventInput }) {
  return (
    <>
      <p>
        <strong>
          {event.predecessor} → {event.successor}
        </strong>
      </p>
      <DataList className="investment-review__closure">
        <DataItem
          label="Event"
          value={`${event.kind === "merger" ? "Merger" : "Conversion"} · ${event.status[0]!.toUpperCase()}${event.status.slice(1)}`}
        />
        <DataItem
          label="Participation"
          value="Current — your SPV interest continues"
        />
        <DataItem
          label="Cash to you"
          value={
            event.lpDistribution === "none_reported"
              ? "None reported"
              : "Not confirmed"
          }
        />
        <DataItem
          label="Effective date"
          value={
            event.effectiveDate === null
              ? "Not confirmed"
              : formatDate(event.effectiveDate)
          }
        />
      </DataList>
      {event.components.length > 0 && (
        <div>
          <h4>Held by the SPV</h4>
          {event.components.map((item, index) => (
            <p key={index}>
              {item.label}:{" "}
              {item.kind === "cash"
                ? item.amountMinor === null
                  ? "Amount unknown"
                  : formatCurrency(item.amountMinor, item.currency)
                : item.quantity === null
                  ? "Quantity unknown"
                  : `${item.quantity} units`}{" "}
              · {item.status}
              {item.unitPriceMinor === null
                ? ""
                : ` · reported price ${formatCurrency(item.unitPriceMinor, item.currency)} per unit`}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

export function InvestmentEvents({
  context,
  busy,
  save,
}: {
  context: InvestmentReviewContext;
  busy: boolean;
  save: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<InvestmentEventInput | null>(null);
  const [stage, setStage] = useState<"source" | "details" | "review">("source");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const events = context.investmentEvents ?? [];
  const latest = currentInvestmentEvents(events);
  const signature = JSON.stringify([
    draft,
    context.review?.id,
    context.snapshotId,
    context.evidenceRevision,
  ]);
  const requestId = useMemo(
    () => ({ signature, id: crypto.randomUUID() }),
    [signature],
  ).id;
  const parsed = InvestmentEventInputSchema.safeParse(draft);
  function update(patch: Partial<InvestmentEventInput>) {
    setDraft((current) => (current === null ? null : { ...current, ...patch }));
  }
  function component(index: number, patch: Partial<InvestmentEventComponent>) {
    if (draft)
      update({
        components: draft.components.map((item, i) =>
          i === index ? { ...item, ...patch } : item,
        ),
      });
  }
  function edit(event?: InvestmentEvent) {
    setDraft(
      event
        ? {
            ...InvestmentEventInputSchema.parse(
              Object.fromEntries(
                Object.entries(event).filter(
                  ([key]) =>
                    ![
                      "revisionId",
                      "revision",
                      "recordedAt",
                      "sourceSha256",
                      "contentSha256",
                      "documentSha256",
                      "successorCompanyId",
                    ].includes(key),
                ),
              ),
            ),
            supersedesRevisionId: event.revisionId,
            expectedMappingIds: context.mappings.map((mapping) => mapping.id),
          }
        : blank(context),
    );
    setStage(event ? "details" : "source");
    setMessage(null);
  }
  return (
    <section
      className="investment-review__section"
      aria-label="Investment events"
    >
      <SectionHeader
        headingAs="h3"
        title="Investment events"
        action={
          draft === null ? (
            <Button
              tone="secondary"
              disabled={busy || events.length >= 100}
              onClick={() => edit()}
            >
              Record event
            </Button>
          ) : undefined
        }
      />
      {draft === null && latest.length === 0 && (
        <p>Record a merger or conversion while your SPV remains invested.</p>
      )}
      {draft === null &&
        latest.map((event) => (
          <article className="investment-events__entry" key={event.revisionId}>
            <EventSummary event={event} />
            <p>
              {event.sourceLabel}
              {event.noticeDate
                ? ` · Notice ${formatDate(event.noticeDate)}`
                : ""}{" "}
              · Revision {event.revision}
            </p>
            <Collapsible>
              <CollapsibleTrigger className="keel-link">
                Evidence and history <DisclosureIndicator />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="investment-events__source">{event.sourceText}</p>
                {event.note && <p>{event.note}</p>}
                {events
                  .filter(
                    (old) =>
                      old.eventId === event.eventId &&
                      old.revisionId !== event.revisionId,
                  )
                  .map((old) => (
                    <div key={old.revisionId}>
                      <p>
                        Revision {old.revision} · {formatDate(old.recordedAt)}
                      </p>
                      <EventSummary event={old} />
                      <p className="investment-events__source">
                        {old.sourceText}
                      </p>
                    </div>
                  ))}
              </CollapsibleContent>
            </Collapsible>
            <Button tone="quiet" disabled={busy} onClick={() => edit(event)}>
              Update event
            </Button>
          </article>
        ))}
      {latest.some((event) => event.status === "completed") && (
        <p>
          Conversion terms do not revalue your investment.{" "}
          {context.valuationAsOf
            ? `Latest imported valuation observation: ${formatDate(context.valuationAsOf)}.`
            : "No valuation date is available."}{" "}
          A current LP valuation needs separate evidence.
        </p>
      )}
      {draft !== null && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!parsed.success || stage !== "review" || busy || saving) return;
            setSaving(true);
            void save(() =>
              saveInvestmentReview(context.positionId, {
                requestId,
                expectedReviewId: context.review?.id ?? null,
                expectedSnapshotId: context.snapshotId,
                expectedEvidenceRevision: context.evidenceRevision,
                participationStatus: "current",
                investmentEvent: parsed.data,
              }),
            )
              .then((saved) => {
                if (saved) setDraft(null);
              })
              .finally(() => setSaving(false));
          }}
        >
          {stage === "source" && (
            <>
              <p>
                Paste the notice. Keel will prefill explicit terms for{" "}
                {context.positionLabel}.
              </p>
              <Field label="Source name" variant="filled">
                <Input
                  value={draft.sourceLabel}
                  maxLength={240}
                  onChange={(event) =>
                    update({ sourceLabel: event.currentTarget.value })
                  }
                />
              </Field>
              {context.documents.length > 0 && (
                <Field label="Supporting document (optional)" variant="filled">
                  <Select
                    value={draft.documentId ?? "none"}
                    items={[
                      { value: "none", label: "Pasted notice only" },
                      ...context.documents
                        .filter((doc) => doc.scan?.outcome === "clean")
                        .map((doc) => ({ value: doc.id, label: doc.fileName })),
                    ]}
                    onValueChange={(value) => {
                      if (typeof value === "string")
                        update({ documentId: value === "none" ? null : value });
                    }}
                  >
                    <SelectTrigger aria-label="Supporting event document">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Pasted notice only</SelectItem>
                      {context.documents
                        .filter((doc) => doc.scan?.outcome === "clean")
                        .map((doc) => (
                          <SelectItem key={doc.id} value={doc.id}>
                            {doc.fileName}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field label="Notice text" variant="filled">
                <Textarea
                  rows={8}
                  value={draft.sourceText}
                  maxLength={20_000}
                  onChange={(event) =>
                    update({ sourceText: event.currentTarget.value })
                  }
                />
              </Field>
              <Button
                type="button"
                disabled={draft.sourceText.trim().length < 10 || busy}
                onClick={() => {
                  const suggestion = suggestInvestmentEvent(
                    draft.sourceText,
                    context.positionLabel,
                    context.currency,
                  );
                  update({
                    sourceText: suggestion.sourceText,
                    noticeDate: suggestion.noticeDate ?? draft.noticeDate,
                    predecessor: draft.predecessor || suggestion.predecessor,
                    status:
                      draft.supersedesRevisionId === null
                        ? suggestion.status
                        : draft.status,
                    components: suggestion.components,
                    lpDistribution: suggestion.lpDistribution,
                    successor: suggestion.successor || draft.successor,
                  });
                  setMessage(
                    suggestion.matchedVehicle
                      ? null
                      : "This notice names several vehicles but does not exactly match this investment. Check its section before entering the terms.",
                  );
                  setStage("details");
                }}
              >
                Review extracted details
              </Button>
            </>
          )}
          {stage === "details" && (
            <>
              {message && <FormMessage>{message}</FormMessage>}
              <p>
                This records securities held by your SPV. Your SPV interest
                continues.
              </p>
              <div className="investment-review__fields">
                <Choice
                  label="Event type"
                  value={draft.kind}
                  values={["merger", "conversion"]}
                  onChange={(kind) =>
                    update({ kind: kind as InvestmentEventInput["kind"] })
                  }
                />
                <Choice
                  label="Event progress"
                  value={draft.status}
                  values={["announced", "completed", "cancelled"]}
                  onChange={(status) =>
                    update({ status: status as InvestmentEventInput["status"] })
                  }
                />
                <Field label="Previous company or issuer" variant="filled">
                  <Input
                    value={draft.predecessor}
                    maxLength={1_000}
                    onChange={(event) =>
                      update({ predecessor: event.currentTarget.value })
                    }
                  />
                </Field>
                <Field label="Successor company or issuer" variant="filled">
                  <Input
                    value={draft.successor}
                    maxLength={1_000}
                    onChange={(event) =>
                      update({ successor: event.currentTarget.value })
                    }
                  />
                </Field>
                <Field label="Notice date (optional)" variant="filled">
                  <DatePicker
                    aria-label="Notice date"
                    value={draft.noticeDate ?? ""}
                    onValueChange={(value) =>
                      update({ noticeDate: optional(value) })
                    }
                  />
                </Field>
                <Field label="Effective date (optional)" variant="filled">
                  <DatePicker
                    aria-label="Effective date"
                    value={draft.effectiveDate ?? ""}
                    onValueChange={(value) =>
                      update({ effectiveDate: optional(value) })
                    }
                  />
                </Field>
                <Choice
                  label="Distribution to you"
                  value={draft.lpDistribution}
                  values={["unknown", "none_reported"]}
                  onChange={(lpDistribution) =>
                    update({
                      lpDistribution:
                        lpDistribution as InvestmentEventInput["lpDistribution"],
                    })
                  }
                />
              </div>
              <h4>Consideration held by the SPV</h4>
              <p>
                Keep issued securities, warrants and conditional rights
                separate. These are SPV totals, not your allocation.
              </p>
              {draft.components.map((item, index) => (
                <fieldset className="investment-events__component" key={index}>
                  <legend>Component {index + 1}</legend>
                  <div className="investment-review__fields">
                    <Choice
                      label={`Component ${index + 1} type`}
                      value={item.kind}
                      values={[
                        "shares",
                        "warrants",
                        "earnout",
                        "cash",
                        "other",
                      ]}
                      onChange={(kind) =>
                        component(index, {
                          kind: kind as InvestmentEventComponent["kind"],
                          quantity: null,
                          unitPriceMinor: null,
                        })
                      }
                    />
                    <Field
                      label={`Component ${index + 1} security or right`}
                      variant="filled"
                    >
                      <Input
                        value={item.label}
                        maxLength={1_000}
                        onChange={(event) =>
                          component(index, { label: event.currentTarget.value })
                        }
                      />
                    </Field>
                    <Choice
                      label={`Component ${index + 1} status`}
                      value={item.status}
                      values={[
                        "received",
                        "conditional",
                        "released",
                        "expired",
                        "unknown",
                      ]}
                      onChange={(status) =>
                        component(index, {
                          status: status as InvestmentEventComponent["status"],
                        })
                      }
                    />
                    {item.kind !== "cash" && (
                      <Field
                        label={`Component ${index + 1} quantity (optional)`}
                        variant="filled"
                      >
                        <Input
                          inputMode="decimal"
                          value={item.quantity ?? ""}
                          onChange={(event) =>
                            component(index, {
                              quantity: optional(event.currentTarget.value),
                            })
                          }
                        />
                      </Field>
                    )}
                    <Field
                      label={`Component ${index + 1} currency`}
                      variant="filled"
                    >
                      <Input
                        value={item.currency}
                        maxLength={3}
                        onChange={(event) =>
                          component(index, {
                            currency: event.currentTarget.value.toUpperCase(),
                          })
                        }
                      />
                    </Field>
                    <Field
                      label={`Component ${index + 1} ${item.kind === "cash" ? "amount" : "reported unit price"} (optional)`}
                      variant="filled"
                    >
                      <EventMoneyInput
                        key={`${item.kind}-${item.currency}`}
                        currency={item.currency}
                        value={
                          item.kind === "cash"
                            ? item.amountMinor
                            : item.unitPriceMinor
                        }
                        onChange={(value) =>
                          component(index, {
                            [item.kind === "cash"
                              ? "amountMinor"
                              : "unitPriceMinor"]: value,
                          })
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    label={`Component ${index + 1} terms (optional)`}
                    variant="filled"
                  >
                    <Textarea
                      value={item.note ?? ""}
                      maxLength={2_000}
                      onChange={(event) =>
                        component(index, {
                          note: optional(event.currentTarget.value),
                        })
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    tone="quiet"
                    onClick={() =>
                      update({
                        components: draft.components.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                  >
                    Remove component {index + 1}
                  </Button>
                </fieldset>
              ))}
              <Button
                type="button"
                tone="secondary"
                disabled={draft.components.length >= 20}
                onClick={() =>
                  update({
                    components: [
                      ...draft.components,
                      {
                        kind: "shares",
                        label: "",
                        quantity: null,
                        status: "unknown",
                        amountMinor: null,
                        unitPriceMinor: null,
                        currency: context.currency,
                        note: null,
                      },
                    ],
                  })
                }
              >
                Add consideration
              </Button>
              <Field label="Event note (optional)" variant="filled">
                <Textarea
                  value={draft.note ?? ""}
                  maxLength={2_000}
                  onChange={(event) =>
                    update({ note: optional(event.currentTarget.value) })
                  }
                />
              </Field>
              <Collapsible>
                <CollapsibleTrigger className="keel-link">
                  Source evidence <DisclosureIndicator />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Field label="Source name" variant="filled">
                    <Input
                      value={draft.sourceLabel}
                      onChange={(event) =>
                        update({ sourceLabel: event.currentTarget.value })
                      }
                    />
                  </Field>
                  <Field label="Notice text" variant="filled">
                    <Textarea
                      value={draft.sourceText}
                      maxLength={20_000}
                      rows={8}
                      onChange={(event) =>
                        update({ sourceText: event.currentTarget.value })
                      }
                    />
                  </Field>
                </CollapsibleContent>
              </Collapsible>
              {!parsed.success && (
                <FormMessage>{parsed.error.issues[0]?.message}</FormMessage>
              )}
            </>
          )}
          {stage === "review" && (
            <>
              <EventSummary event={draft} />
              <p>
                {draft.status === "completed"
                  ? `Company exposure will change to ${draft.successor}.`
                  : "Company exposure stays unchanged until the conversion is completed."}{" "}
                Your invested amount, cash and accepted valuation stay
                unchanged.
              </p>
              <p>
                Any reported security prices describe the transaction. They do
                not establish your current investment value or tax basis.
              </p>
            </>
          )}
          <ActionGroup align="end">
            <Button
              type="button"
              tone="quiet"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
            {stage !== "source" && (
              <Button
                type="button"
                tone="secondary"
                disabled={busy}
                onClick={() =>
                  setStage(stage === "review" ? "details" : "source")
                }
              >
                Back
              </Button>
            )}
            {stage === "details" && (
              <Button
                type="button"
                disabled={!parsed.success || busy}
                onClick={() => setStage("review")}
              >
                Review event
              </Button>
            )}
            {stage === "review" && (
              <Button
                type="submit"
                disabled={!parsed.success || busy || saving}
              >
                {saving ? "Saving…" : "Save event"}
              </Button>
            )}
          </ActionGroup>
        </form>
      )}
    </section>
  );
}
