import { useLayoutEffect, useRef, useState } from "react";
import type { Holding } from "@keel/domain";
import { PurchaseReceiptSchema } from "@keel/domain/position-purchases";
import { z } from "zod";
import { ActionGroup, Button, FormMessage, Spinner } from "@keel/ui";
import { HoldingDate, HoldingInput, HoldingSelect } from "./HoldingFields";
import { decimal, scaled } from "./decimal-input";
import { formatDate, formatMoney } from "./format";
import { carryUnavailableReason, holdingValueSummary } from "./holding-value";
import {
  distributionCoverageOptions,
  distributionInclusionOptions,
  draftDistributions,
  newDistribution,
  parseDistributionDraft,
  type DistributionDraft,
  type DistributionEventDraft,
} from "./holding-distributions";

type Editor = {
  phase: "editing" | "saving" | "failed" | "refresh_failed" | "refreshing";
  draft: DistributionDraft;
  error: string | null;
  conflict: boolean;
};
const ErrorSchema = z.object({ error: z.string() });
export function HoldingDistributions({
  holding,
  disabled,
  onAccepted,
  onEditingChange,
  onReadbackPendingChange,
}: {
  holding: Holding;
  disabled: boolean;
  onAccepted: () => Promise<void>;
  onEditingChange: (editing: boolean) => void;
  onReadbackPendingChange: (pending: boolean) => void;
}) {
  const context = holding.purchaseContext!;
  const review = context.receipt?.details.distributionReview;
  const closeQuote = context.receipt?.publicClose;
  const [editor, setEditor] = useState<Editor | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const edit = useRef<HTMLButtonElement>(null);
  const restore = useRef(false);
  const inFlight = useRef(false);
  const editing = editor !== null;
  useLayoutEffect(() => {
    if (editing)
      form.current
        ?.querySelector<HTMLElement>('[role="combobox"], input')
        ?.focus();
    else if (restore.current) {
      restore.current = false;
      edit.current?.focus();
    }
  }, [editing]);
  const start = () => {
    if (holding.realizedValueMinor == null) return;
    setEditor({
      phase: "editing",
      error: null,
      conflict: false,
      draft: draftDistributions({
        snapshotId: context.snapshotId,
        receiptId: context.receipt?.id ?? null,
        realizedValueMinor: holding.realizedValueMinor,
        review,
      }),
    });
    onEditingChange(true);
  };
  const close = () => {
    onReadbackPendingChange(false);
    restore.current = true;
    setEditor(null);
    onEditingChange(false);
  };
  const update = (draft: DistributionDraft) =>
    setEditor((old) =>
      old
        ? {
            ...old,
            draft,
            phase: "editing",
            error: old.conflict ? old.error : null,
          }
        : null,
    );
  const updateEvent = (id: string, event: DistributionEventDraft) => {
    if (editor)
      update({
        ...editor.draft,
        events: editor.draft.events.map((item) =>
          item.id === id ? event : item,
        ),
      });
  };
  const parsed = editor ? parseDistributionDraft(editor.draft) : null;
  const preview = parsed?.success
    ? holdingValueSummary(holding, parsed.data.distributionReview)
    : null;
  const changed =
    parsed?.success &&
    JSON.stringify(parsed.data.distributionReview) !== JSON.stringify(review);
  const busy = editor?.phase === "saving" || editor?.phase === "refreshing";
  const save = async () => {
    if (
      !editor ||
      !parsed?.success ||
      !changed ||
      busy ||
      editor.conflict ||
      inFlight.current
    )
      return;
    const pending = editor;
    inFlight.current = true;
    setEditor({ ...pending, phase: "saving", error: null });
    let accepted = false;
    try {
      const response = await fetch(
        `/api/investment-positions/${encodeURIComponent(holding.id)}/distributions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        const conflict = response.status === 409;
        const error = ErrorSchema.safeParse(body);
        setEditor({
          ...pending,
          phase: "failed",
          conflict,
          error: conflict
            ? "The source or investment changed. Your draft is kept. Cancel, reload this page, and reopen to review the current record before saving."
            : error.success
              ? error.data.error
              : "Distributions could not be saved. Try again.",
        });
        return;
      }
      PurchaseReceiptSchema.parse(body);
      accepted = true;
      onReadbackPendingChange(true);
      await onAccepted();
      close();
    } catch {
      setEditor({
        ...pending,
        phase: accepted ? "refresh_failed" : "failed",
        error: accepted
          ? "Distributions were saved, but the updated holding could not be loaded."
          : "Distributions could not be saved. Try again.",
      });
    } finally {
      inFlight.current = false;
    }
  };
  const reloadSaved = async () => {
    if (!editor || inFlight.current) return;
    const pending = editor;
    inFlight.current = true;
    setEditor({ ...pending, phase: "refreshing" });
    try {
      await onAccepted();
      close();
    } catch {
      setEditor({ ...pending, phase: "refresh_failed" });
    } finally {
      inFlight.current = false;
    }
  };
  const reason =
    preview?.carry.status === "unavailable"
      ? carryUnavailableReason(preview.carry.reason)
      : null;
  return (
    <div className="holding-distributions">
      <div className="holding-section-heading distribution-heading">
        <h4>Received distributions</h4>
        {!editor && (
          <Button
            ref={edit}
            tone="quiet"
            aria-label={review ? undefined : "Add distributions"}
            disabled={disabled || holding.realizedValueMinor == null}
            onClick={start}
          >
            {review ? "Edit distributions" : "Add"}
          </Button>
        )}
      </div>
      {!editor && holding.realizedValueMinor == null && (
        <p className="holding-metadata">
          Recording distributions requires a known provider-reported
          distribution total.
        </p>
      )}
      {editor?.phase === "refresh_failed" || editor?.phase === "refreshing" ? (
        <>
          <FormMessage tone="error">{editor.error}</FormMessage>
          <Button
            tone="primary"
            disabled={busy}
            onClick={() => void reloadSaved()}
          >
            {busy && <Spinner />}Reload saved distributions
          </Button>
        </>
      ) : editor ? (
        <form
          ref={form}
          aria-label="Distribution editor"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy} className="holding-form-fieldset">
            {editor.draft.events.map((event, index) => (
              <section
                key={event.id}
                className="distribution-event"
                aria-label={`Distribution ${index + 1}`}
              >
                <div className="distribution-event-heading">
                  {editor.draft.events.length > 1 && (
                    <h4>Distribution {index + 1}</h4>
                  )}
                  <Button
                    tone="quiet"
                    aria-label={`Remove distribution ${index + 1}`}
                    onClick={() =>
                      update({
                        ...editor.draft,
                        events: editor.draft.events.filter(
                          (item) => item.id !== event.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
                <div className="holding-fields">
                  <HoldingSelect
                    label="Received as"
                    value={event.kind}
                    options={[
                      { value: "cash", label: "Cash" },
                      { value: "in_kind", label: "Stock" },
                    ]}
                    onChange={(kind) =>
                      updateEvent(event.id, {
                        ...event,
                        kind: kind as DistributionEventDraft["kind"],
                        security:
                          event.security ||
                          (kind === "in_kind"
                            ? (closeQuote?.ticker ?? "")
                            : ""),
                      })
                    }
                  />
                  <HoldingDate
                    label="Received on"
                    value={event.receivedOn}
                    onChange={(receivedOn) =>
                      updateEvent(event.id, { ...event, receivedOn })
                    }
                  />
                  {event.kind === "in_kind" && (
                    <>
                      <HoldingInput
                        label="Security received"
                        value={event.security}
                        description="Optional when the security is unknown."
                        onChange={(security) =>
                          updateEvent(event.id, { ...event, security })
                        }
                      />
                      <HoldingInput
                        label="Shares received"
                        value={event.quantity}
                        numeric
                        description="Optional when the quantity is unknown."
                        onChange={(quantity) =>
                          updateEvent(event.id, { ...event, quantity })
                        }
                      />
                      {(event.debit || closeQuote) && (
                        <HoldingInput
                          label={`${event.debit?.quote.ticker ?? closeQuote!.ticker} shares released by the SPV`}
                          numeric
                          value={event.debit?.shares ?? ""}
                          description="Include shares withheld for carry. Leave blank if the SPV’s gross share count is unknown."
                          onChange={(shares) => {
                            const quote = event.debit?.quote ?? closeQuote!;
                            updateEvent(event.id, {
                              ...event,
                              debit: {
                                shares,
                                quote: {
                                  ticker: quote.ticker,
                                  shareBasis: quote.shareBasis,
                                },
                              },
                            });
                          }}
                        />
                      )}
                    </>
                  )}
                  <HoldingInput
                    label={
                      event.kind === "in_kind"
                        ? "Historical value · $"
                        : "Cash received · $"
                    }
                    value={event.amount}
                    numeric
                    description="After advisor carry. Leave blank if unknown."
                    error={
                      event.amount.trim() &&
                      !Number.isSafeInteger(scaled(event.amount, 2))
                        ? "Enter a nonnegative amount with up to two decimal places."
                        : undefined
                    }
                    onChange={(amount) =>
                      updateEvent(event.id, { ...event, amount })
                    }
                  />
                  <HoldingInput
                    label="Evidence"
                    value={event.evidence}
                    onChange={(evidence) =>
                      updateEvent(event.id, { ...event, evidence })
                    }
                  />
                </div>
                {event.kind === "in_kind" && (
                  <p className="holding-metadata">
                    Record the historical value on the received date. Today's
                    stock price does not change this distribution.
                  </p>
                )}
              </section>
            ))}
            {editor.draft.events.length === 0 && (
              <p>No received distributions recorded.</p>
            )}
            <ActionGroup>
              <Button
                tone="quiet"
                disabled={editor.draft.events.length >= 100}
                onClick={() =>
                  update({
                    ...editor.draft,
                    events: [...editor.draft.events, newDistribution()],
                  })
                }
              >
                Add distribution
              </Button>
            </ActionGroup>
            <div className="holding-fields distribution-coverage-fields">
              <HoldingSelect
                label="Distribution history"
                value={editor.draft.coverage}
                options={distributionCoverageOptions}
                onChange={(coverage) =>
                  update({
                    ...editor.draft,
                    coverage: coverage as DistributionDraft["coverage"],
                  })
                }
              />
              <HoldingDate
                label="History through"
                value={editor.draft.throughDate}
                description="Actual date reviewed, even when completeness is unknown."
                onChange={(throughDate) =>
                  update({ ...editor.draft, throughDate })
                }
              />
              <HoldingInput
                label="Carry already charged · $"
                value={editor.draft.priorCarryAmount}
                numeric
                description="Leave blank if unknown. Enter 0 only when confirmed."
                onChange={(priorCarryAmount) =>
                  update({ ...editor.draft, priorCarryAmount })
                }
              />
              <HoldingSelect
                label="Recorded distributions in provider total"
                value={editor.draft.inclusion}
                options={distributionInclusionOptions}
                description={`Provider-reported distributions: ${formatMoney(editor.draft.realizedValueMinor)} · ${holding.sourceLabel}.`}
                onChange={(inclusion) =>
                  update({
                    ...editor.draft,
                    inclusion: inclusion as DistributionDraft["inclusion"],
                  })
                }
              />
            </div>
            {editor.draft.providerBindingStale && (
              <p className="holding-metadata">
                The provider statement changed. Inclusion starts as Unknown;
                review it against the current statement.
              </p>
            )}
            <p className="holding-metadata">
              Inclusion determines whether recorded distributions add to
              provider-reported distributions for total return. It does not
              change the contributed-capital hurdle for carry.
            </p>
            <div className="distribution-preview" aria-live="polite">
              <h4>Proposed effect</h4>
              {parsed && !parsed.success ? (
                <FormMessage tone="error">
                  {editor.draft.events.some(
                    (event) =>
                      event.amount.trim() &&
                      !Number.isSafeInteger(scaled(event.amount, 2)),
                  )
                    ? "Correct the highlighted amount to preview and save."
                    : parsed.message}
                </FormMessage>
              ) : preview?.after ? (
                <div className="distribution-preview-values">
                  <div>
                    <p className="holding-metadata">
                      {preview.after.alreadyAfterCarry
                        ? "Reported remaining value · After carry"
                        : "Estimated remaining value · After carry"}
                    </p>
                    <strong className="distribution-preview-amount">
                      {formatMoney(preview.after.proceedsMinor)}
                    </strong>
                  </div>
                  {preview.after.carryMinor !== null && (
                    <div>
                      <p className="holding-metadata">
                        Estimated remaining carry
                      </p>
                      <strong className="distribution-preview-carry">
                        {formatMoney(preview.after.carryMinor)}
                      </strong>
                    </div>
                  )}
                </div>
              ) : reason ? (
                <p className="distribution-result-limit">
                  No after-carry estimate. {reason}
                </p>
              ) : null}
              {preview?.historical.status === "unavailable" &&
                preview.historical.reason !==
                  (preview.carry.status === "unavailable"
                    ? preview.carry.reason
                    : null) && (
                  <p className="distribution-result-limit">
                    Total return unavailable.{" "}
                    {carryUnavailableReason(preview.historical.reason)}
                  </p>
                )}
            </div>
            {editor.error && (
              <FormMessage tone="error">{editor.error}</FormMessage>
            )}
            <ActionGroup wrap>
              <Button
                type="submit"
                tone="primary"
                disabled={
                  !parsed?.success || !changed || busy || editor.conflict
                }
              >
                {busy && <Spinner />}
                {busy
                  ? "Saving…"
                  : editor.phase === "failed" && !editor.conflict
                    ? "Retry save"
                    : "Save distributions"}
              </Button>
              <Button tone="quiet" disabled={busy} onClick={close}>
                Cancel
              </Button>
            </ActionGroup>
          </fieldset>
        </form>
      ) : (
        <>
          {review ? (
            <>
              {review.events.map((event) => (
                <article className="distribution-summary" key={event.id}>
                  <div className="distribution-summary-line">
                    <div className="distribution-identity">
                      <h4>
                        {event.kind === "cash"
                          ? "Cash distribution"
                          : `${event.quantityMicros !== null ? `${decimal(event.quantityMicros, 6)} ` : ""}${event.securityLabel ?? "Stock distribution"}`}
                      </h4>
                      <p className="holding-metadata">
                        Received {formatDate(event.receivedOn)}
                      </p>
                    </div>
                    <div className="distribution-amount">
                      <strong>
                        {event.investorValueMinor === null
                          ? "Unknown"
                          : formatMoney(event.investorValueMinor)}
                      </strong>
                      <p className="holding-metadata">
                        {event.kind === "cash"
                          ? "Cash received"
                          : "Historical value"}
                      </p>
                    </div>
                  </div>
                  <p className="holding-metadata">{event.sourceLabel}</p>
                </article>
              ))}
              {review.events.length ? (
                <p className="holding-metadata distribution-basis">
                  Values are historical amounts on the received date, credited
                  to the investor after advisor carry.
                </p>
              ) : (
                <p>No received distributions recorded.</p>
              )}
              <p className="holding-metadata">
                {review.coverage.status === "complete"
                  ? "All received distributions recorded"
                  : "Partial distribution history"}{" "}
                through {formatDate(review.coverage.throughDate)}.
              </p>
            </>
          ) : (holding.realizedValueMinor ?? 0) > 0 ? (
            <p className="holding-metadata">
              Provider-reported total ·{" "}
              {formatMoney(holding.realizedValueMinor!)}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
