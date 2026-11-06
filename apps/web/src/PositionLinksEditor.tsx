import { reviewedInvestmentFromReceipt } from "@keel/domain/position-purchases";
import { HoldingHistory } from "./HoldingHistory";
import { useState, useEffect, useCallback, useRef, useId } from "react";
import {
  includesCurrentInvestment,
  effectiveParticipation,
  investmentAmount,
} from "@keel/domain/investment-review";
import type { InvestmentPositionRecord } from "@keel/domain/position-read-model";
import type {
  PositionLinkWorkspace,
  PositionLinkReceipt,
} from "@keel/domain/position-links";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
  DisclosureIndicator,
  ActionGroup,
  Button,
  SearchSelect,
  Field,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DataList,
  DataItem,
  TextLink,
  InfoTip,
  LoadingStatus,
} from "@keel/ui";
import {
  acceptPositionLink,
  loadPositionLinks,
  refreshPortfolioBaseline,
  downloadLegalEntityDocument,
} from "./api";
import { entityReviewUrl } from "./legal-entity-navigation";
import { formatCurrency, formatDate } from "./format";
import { suggestPositionLink } from "./position-link-suggestion";

function amountLabel(position: InvestmentPositionRecord) {
  const reviewed = reviewedInvestmentFromReceipt(position.purchaseReceipt);
  const amount = reviewed
    ? reviewed.snapshotId === position.snapshot.id
      ? reviewed.cashPaidMinor
      : null
    : investmentAmount(position);
  return amount === null
    ? "Not reviewed for this source"
    : formatCurrency(amount, position.snapshot.currency);
}

function termsLabel(position: InvestmentPositionRecord) {
  const reviewed = reviewedInvestmentFromReceipt(position.purchaseReceipt);
  if (reviewed) {
    const percent = (value: number | null) =>
      value === null ? "unknown" : `${value / 10_000}%`;
    return `Management ${percent(reviewed.terms.annualManagementFeePpm)} · Carry ${percent(reviewed.terms.carryPpm)} · ${reviewed.snapshotId === position.snapshot.id ? "Reviewed" : "Earlier reviewed terms"}`;
  }
  const accepted = position.acceptedEconomicsTerms;
  const reported = position.reportedEconomicsTerms;
  if (!accepted && !reported) return "No fee terms reported";
  const percent = (value: number | null | undefined) =>
    value == null ? "not reported" : `${value / 10_000}%`;
  const years = accepted?.adminFeeYears ?? reported?.adminFeeYears;
  return `Management ${percent(accepted?.annualAdminFeePpm ?? reported?.managementFeePpm)} · Prepaid term ${years == null ? "not reported" : `${years} years`} · Setup ${percent(accepted?.setupFeePpm ?? reported?.setupFeePpm)} · Carry ${percent(accepted?.carryPpm ?? reported?.carryPpm)} · ${accepted ? "Reviewed" : "Source reported, not accepted"}`;
}

function valueLabel(position: InvestmentPositionRecord) {
  return position.snapshot.unrealizedValue.minor === null
    ? "Not reported"
    : formatCurrency(
        position.snapshot.unrealizedValue.minor,
        position.snapshot.currency,
      );
}
export function PositionLinksEditor({
  positionId,
  onAccepted,
  reviewEntry = false,
  initialOpen = false,
}: {
  positionId: string;
  reviewEntry?: boolean;
  initialOpen?: boolean;
  onAccepted: () => Promise<void>;
}) {
  const headingId = useId();
  const disclosure = useRef<HTMLButtonElement>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [workspace, setWorkspace] = useState<PositionLinkWorkspace | null>(
    null,
  );
  const [open, setOpen] = useState(initialOpen);
  const [busy, setBusy] = useState(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [relationship, setRelationship] = useState<
    "same_investment" | "replaced" | "company_renamed"
  >("same_investment");
  const [useSourceValue, setUseSourceValue] = useState(false);
  const [targetId, setTargetId] = useState(positionId);
  const initializedPositionId = useRef<string | null>(null);
  const target = workspace?.positions.find((p) => p.id === targetId);
  const source = workspace?.positions.find((p) => p.id === sourceId);
  const newerName =
    source && target && source.snapshot.observedAt > target.snapshot.observedAt
      ? source
      : target;
  const formerName = newerName === source ? target : source;
  const renameDisplay = `${newerName?.reportedExposureName ?? "Unresolved"} (formerly ${formerName?.reportedExposureName ?? "Unresolved"})`;
  const activeLinks =
    workspace?.links.filter(
      (l) => l.targetPositionId === targetId && l.state === "linked",
    ) ?? [];
  const candidates =
    workspace?.positions.filter(
      (p) =>
        p.id !== targetId &&
        !workspace.links.some(
          (l) =>
            l.state === "linked" &&
            (l.sourcePositionId === p.id || l.targetPositionId === p.id),
        ),
    ) ?? [];
  const conflict =
    source && target
      ? source.snapshot.currency !== target.snapshot.currency
        ? "The source currencies differ. Review corrected source records before linking."
        : relationship === "replaced" && !includesCurrentInvestment(target)
          ? "A replacement needs a current surviving SPV."
          : relationship !== "replaced" &&
              effectiveParticipation(source) !== effectiveParticipation(target)
            ? "Participation differs. Review both records before linking."
            : relationship === "company_renamed" &&
                (source.ownershipContainerId !== target.ownershipContainerId ||
                  source.legalVehicleName !== target.legalVehicleName ||
                  source.ownerLabel !== target.ownerLabel ||
                  !source.openedOn ||
                  source.openedOn !== target.openedOn ||
                  !source.companyReview ||
                  source.companyReview.companyId !==
                    target.companyReview?.companyId ||
                  !source.reportedExposureName ||
                  !target.reportedExposureName ||
                  source.reportedExposureName === target.reportedExposureName ||
                  source.snapshot.observedAt === target.snapshot.observedAt)
              ? source.reviewedHistory || target.reviewedHistory
                ? "This older source needs its provider account and company identity confirmed before applying a rename. The suggested pair has not been linked."
                : "Confirm the same provider account, legal vehicle, owner, date and company first. The source dates must establish the old and new names."
              : null
      : null;
  async function download(id: string, name: string) {
    setBusy(true);
    setError(null);
    try {
      const blob = await downloadLegalEntityDocument(id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = name;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The source document could not be downloaded.",
      );
    } finally {
      setBusy(false);
    }
  }
  const receiveWorkspace = useCallback(
    (loaded: PositionLinkWorkspace) => {
      setWorkspace(loaded);
      if (initializedPositionId.current === positionId) return;
      initializedPositionId.current = positionId;
      const active = loaded.links.find(
        (link) =>
          link.sourcePositionId === positionId && link.state === "linked",
      );
      const suggestion = reviewEntry
        ? suggestPositionLink(loaded, positionId)
        : null;
      setTargetId(
        active?.targetPositionId ?? suggestion?.targetId ?? positionId,
      );
      setSourceId(suggestion?.sourceId ?? "");
      setRelationship(suggestion?.relationship ?? "same_investment");
      setUseSourceValue(false);
    },
    [positionId, reviewEntry],
  );
  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      receiveWorkspace(await loadPositionLinks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load records.");
    } finally {
      setBusy(false);
    }
  }, [receiveWorkspace]);
  useEffect(() => {
    if (!initialOpen) return;
    let active = true;
    void loadPositionLinks()
      .then((loaded) => {
        if (!active) return;
        receiveWorkspace(loaded);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "Could not load records.",
          );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [initialOpen, receiveWorkspace]);
  async function save(remove?: PositionLinkReceipt) {
    const member = remove
      ? workspace?.positions.find((p) => p.id === remove.sourcePositionId)
      : source;
    if (!member || !target) return;
    setBusy(true);
    setError(null);
    try {
      await acceptPositionLink({
        sourcePositionId: member.id,
        targetPositionId: target.id,
        expectedSourceSnapshotId: member.snapshot.id,
        expectedTargetSnapshotId: target.snapshot.id,
        expectedSourceParticipationReviewId:
          member.investmentReview?.id ?? null,
        expectedTargetParticipationReviewId:
          target.investmentReview?.id ?? null,
        expectedReviewId:
          workspace?.links.find((l) => l.sourcePositionId === member.id)?.id ??
          null,
        relationship:
          remove?.relationship ??
          (relationship === "company_renamed"
            ? "same_investment"
            : relationship),
        companyRenamed:
          remove?.companyRenamed ?? relationship === "company_renamed",
        state: remove ? "unlinked" : "linked",
        useSourceValue:
          remove?.useSourceValue ??
          (source?.sourceProvider === "manual" ? false : useSourceValue),
        note: "",
      });
      setWorkspace(await loadPositionLinks());
      setSourceId("");
      setUseSourceValue(false);
      await onAccepted();
      setHistoryRevision((n) => n + 1);
      if (remove) requestAnimationFrame(() => disclosure.current?.focus());
      try {
        await refreshPortfolioBaseline();
      } catch {
        setError(
          "Link saved. Planning values could not be refreshed; use the planning baseline’s refresh action.",
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this link.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="position-links" aria-labelledby={headingId}>
      <Collapsible
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (value && workspace === null) void load();
        }}
      >
        <CollapsibleTrigger
          ref={disclosure}
          layout="inline"
          disabled={busy && workspace !== null}
        >
          <h3 id={headingId}>Linked investment records</h3>
          <DisclosureIndicator />
        </CollapsibleTrigger>
        <CollapsibleContent>
          {error && (
            <Notice tone="error">
              {error}
              <Button onClick={() => void load()} disabled={busy}>
                Reload records
              </Button>
            </Notice>
          )}
          {busy && workspace === null && (
            <LoadingStatus>Loading investment records…</LoadingStatus>
          )}
          {target && (
            <>
              {reviewEntry && (
                <Field label="Investment record to keep">
                  <SearchSelect
                    label="Investment record to keep"
                    searchLabel="Search surviving investment"
                    placeholder="Choose the surviving investment"
                    emptyMessage="No available investment records."
                    items={workspace!.positions
                      .filter(
                        (p) =>
                          (p.kind === "spv_interest" ||
                            p.sourceProvider === "manual") &&
                          !workspace!.links.some(
                            (l) =>
                              l.sourcePositionId === p.id &&
                              l.state === "linked",
                          ),
                      )
                      .map((p) => ({
                        value: p.id,
                        label: `${p.legalVehicleName} · ${p.source.label} · ${formatDate(p.snapshot.observedAt)}`,
                      }))}
                    value={targetId}
                    disabled={busy}
                    onChange={(id) => {
                      setTargetId(id);
                      setSourceId(id === positionId ? "" : positionId);
                      setUseSourceValue(false);
                    }}
                  />
                </Field>
              )}
              {activeLinks.map((link) => {
                const member = workspace?.positions.find(
                  (p) => p.id === link.sourcePositionId,
                );
                return (
                  <div key={link.id} className="position-link-record">
                    <strong>
                      {member?.legalVehicleName ?? "Linked investment"}
                    </strong>
                    <p className="holding-metadata">
                      {link.relationship === "replaced"
                        ? "Historical · replaced by this SPV"
                        : link.companyRenamed
                          ? `${link.companyName} (formerly ${link.formerCompanyName})`
                          : "Same investment"}{" "}
                      · {member?.source.label}
                      {link.useSourceValue ? " · Supplies reported value" : ""}
                    </p>
                    {member && (
                      <Collapsible>
                        <CollapsibleTrigger layout="inline">
                          Source details
                          <DisclosureIndicator />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <TextLink
                            href={entityReviewUrl(
                              { kind: "holding_position", id: member.id },
                              "investment",
                            )}
                          >
                            Review this source’s terms, purchases and events
                          </TextLink>
                          <DataList>
                            <DataItem
                              label="Source terms"
                              value={termsLabel(member)}
                            />
                            <DataItem
                              label="Investment amount"
                              value={amountLabel(member)}
                            />
                            <DataItem
                              label="Reported value"
                              value={valueLabel(member)}
                            />
                            <DataItem
                              label="Source date"
                              value={formatDate(member.snapshot.observedAt)}
                            />
                            <DataItem
                              label="Recorded investment date"
                              value={
                                member.openedOn
                                  ? formatDate(member.openedOn)
                                  : "Not reported"
                              }
                            />
                            <DataItem
                              label="Link reviewed"
                              value={formatDate(link.acceptedAt)}
                            />
                          </DataList>
                          {(member.legalEntityNameEvidence.documents ?? []).map(
                            (doc) => (
                              <Button
                                key={doc.id}
                                disabled={busy}
                                onClick={() =>
                                  void download(doc.id, doc.fileName)
                                }
                              >
                                {doc.fileName}
                              </Button>
                            ),
                          )}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    <ActionGroup className="position-link-actions">
                      <Button
                        tone="quiet"
                        disabled={busy}
                        onClick={() => void save(link)}
                      >
                        {busy ? "Unlinking…" : "Unlink record"}
                      </Button>
                      <InfoTip
                        label={`About unlinking ${member?.legalVehicleName ?? "this record"}`}
                        disabled={busy}
                      >
                        This source will appear as a separate investment again.
                        {link.useSourceValue &&
                          " This link will stop supplying reported value."}{" "}
                        Records and history are kept. You can link it again.
                      </InfoTip>
                    </ActionGroup>
                  </div>
                );
              })}
              <Field
                label={
                  activeLinks.length ? "Link another source" : "Source to link"
                }
              >
                <SearchSelect
                  label={
                    activeLinks.length
                      ? "Link another source"
                      : "Source to link"
                  }
                  searchLabel="Search investment or source"
                  placeholder="Choose a source record"
                  emptyMessage="No matching investment records."
                  items={candidates.map((p) => ({
                    value: p.id,
                    label: `${p.legalVehicleName} · ${p.source.label} · ${formatDate(p.snapshot.observedAt)}`,
                    searchText: p.reportedExposureName ?? "",
                  }))}
                  disabled={busy}
                  value={sourceId}
                  onChange={(value) => {
                    setSourceId(value);
                    setUseSourceValue(false);
                  }}
                />
              </Field>
              {source && (
                <>
                  <Field label="Relationship">
                    <Select
                      items={[
                        {
                          value: "same_investment",
                          label: "Same investment, another source",
                        },
                        {
                          value: "company_renamed",
                          label: "Same investment, company renamed",
                        },
                        {
                          value: "replaced",
                          label: "Earlier SPV replaced by this one",
                        },
                      ]}
                      disabled={busy}
                      value={relationship}
                      onValueChange={(value) => {
                        setRelationship(value as typeof relationship);
                        setUseSourceValue(false);
                      }}
                    >
                      <SelectTrigger aria-label="Relationship">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same_investment">
                          Same investment, another source
                        </SelectItem>
                        <SelectItem value="company_renamed">
                          Same investment, company renamed
                        </SelectItem>
                        <SelectItem value="replaced">
                          Earlier SPV replaced by this one
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="position-link-result">
                    <strong>{target.legalVehicleName}</strong> stays as the
                    investment, with{" "}
                    {target.purchaseReceipt?.details.investmentTerms
                      ? "a reviewed cash contribution"
                      : "an investment amount"}{" "}
                    of {amountLabel(target)}. Linked amounts are not added.
                  </p>
                  {source.ownerLabel !== target.ownerLabel && (
                    <p>
                      Ownership differs: {target.ownerLabel ?? "Not reported"}{" "}
                      and {source.ownerLabel ?? "Not reported"}. Link only if
                      these represent the same ownership.
                    </p>
                  )}
                  <p>
                    Participation kept: {effectiveParticipation(target)}.{" "}
                    {includesCurrentInvestment(target)
                      ? "One contribution remains in the portfolio."
                      : "No current exposure or cash distribution is created."}
                  </p>
                  {relationship === "company_renamed" && (
                    <p>
                      A rename keeps the same company and legal vehicle. A
                      merger or conversion needs a separate identity review.
                      Disposal of underlying stock does not establish an
                      investor distribution or that the vehicle wound up.
                    </p>
                  )}
                  <DataList className="position-link-comparison">
                    <DataItem
                      label="Surviving SPV"
                      value={target.legalVehicleName}
                    />
                    <DataItem
                      label="Exposure kept"
                      value={
                        relationship === "company_renamed"
                          ? renameDisplay
                          : (target.companyReview?.companyName ??
                            target.reportedExposureName ??
                            "Unresolved")
                      }
                    />
                    <DataItem
                      label="Ownership kept"
                      value={target.ownerLabel ?? "Not reported"}
                    />
                    <DataItem
                      label="Other source ownership"
                      value={source.ownerLabel ?? "Not reported"}
                    />
                    <DataItem
                      label={
                        target.purchaseReceipt?.details.investmentTerms
                          ? "Reviewed cash contribution kept"
                          : "Investment amount kept"
                      }
                      value={
                        <>
                          {amountLabel(target)}
                          <small>
                            {target.source.label}; linked amounts are not added.
                          </small>
                        </>
                      }
                    />
                    <DataItem
                      label={
                        source.purchaseReceipt?.details.investmentTerms
                          ? "Other reviewed cash contribution"
                          : "Other source amount"
                      }
                      value={amountLabel(source)}
                    />
                    <DataItem label="Terms kept" value={termsLabel(target)} />
                    <DataItem
                      label="Other source terms"
                      value={termsLabel(source)}
                    />
                    <DataItem
                      label="Source dates"
                      value={`${formatDate(target.snapshot.observedAt)} / ${formatDate(source.snapshot.observedAt)}`}
                    />
                    <DataItem
                      label="SPV reported value"
                      value={
                        <>
                          {valueLabel(target)}
                          <small>
                            {target.source.label} ·{" "}
                            {formatDate(target.snapshot.observedAt)}
                          </small>
                        </>
                      }
                    />
                    <DataItem
                      label="Other source reported value"
                      value={
                        <>
                          {valueLabel(source)}
                          <small>
                            {source.source.label} ·{" "}
                            {formatDate(source.snapshot.observedAt)}
                          </small>
                        </>
                      }
                    />
                  </DataList>
                  {relationship !== "replaced" &&
                    includesCurrentInvestment(target) &&
                    includesCurrentInvestment(source) &&
                    source.sourceProvider !== "manual" &&
                    !activeLinks.some((l) => l.useSourceValue) && (
                      <Field label="Reported valuation to use">
                        <Select
                          items={[
                            {
                              value: "target",
                              label: `Keep ${target.source.label} · ${valueLabel(target)}`,
                            },
                            {
                              value: "source",
                              label: `Use ${source.source.label} · ${valueLabel(source)}`,
                            },
                          ]}
                          disabled={busy}
                          value={useSourceValue ? "source" : "target"}
                          onValueChange={(v) => {
                            setUseSourceValue(v === "source");
                          }}
                        >
                          <SelectTrigger aria-label="Reported valuation to use">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="target">
                              Keep {target.source.label} · {valueLabel(target)}
                            </SelectItem>
                            <SelectItem value="source">
                              Use {source.source.label} · {valueLabel(source)}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  <p>
                    {relationship === "replaced"
                      ? "The earlier SPV moves to history. No sale or new contribution is recorded."
                      : "Both records count as one investment. Terms stay with their dated source and require their own review; missing terms are not zero."}{" "}
                    You can unlink the records later.
                  </p>
                  {conflict && <Notice tone="error">{conflict}</Notice>}
                  <ActionGroup>
                    <Button
                      tone="primary"
                      disabled={busy || conflict !== null}
                      onClick={() => void save()}
                    >
                      {busy ? "Saving…" : "Apply link"}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setSourceId("");
                      }}
                    >
                      Cancel
                    </Button>
                  </ActionGroup>
                </>
              )}
              {activeLinks.length === 0 && candidates.length === 0 && (
                <p>No other private investment records are available.</p>
              )}
              {reviewEntry && (
                <Collapsible>
                  <CollapsibleTrigger layout="inline">
                    History
                    <DisclosureIndicator />
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <HoldingHistory
                      key={`${target.id}:${historyRevision}`}
                      positionId={target.id}
                    />
                  </CollapsibleContent>
                </Collapsible>
              )}
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
