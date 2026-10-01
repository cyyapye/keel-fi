import { useState } from "react";
import {
  includesCurrentInvestment,
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
  Input,
  Field,
  Notice,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  DataList,
  DataItem,
} from "@keel/ui";
import {
  acceptPositionLink,
  loadPositionLinks,
  refreshPortfolioBaseline,
  downloadLegalEntityDocument,
} from "./api";
import { formatCurrency, formatDate } from "./format";

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
}: {
  positionId: string;
  onAccepted: () => Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<PositionLinkWorkspace | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [relationship, setRelationship] = useState<
    "same_investment" | "replaced"
  >("same_investment");
  const [useSourceValue, setUseSourceValue] = useState(false);
  const target = workspace?.positions.find((p) => p.id === positionId);
  const source = workspace?.positions.find((p) => p.id === sourceId);
  const activeLinks =
    workspace?.links.filter(
      (l) => l.targetPositionId === positionId && l.state === "linked",
    ) ?? [];
  const candidates =
    workspace?.positions.filter(
      (p) =>
        p.id !== positionId &&
        !workspace.links.some(
          (l) =>
            l.state === "linked" &&
            (l.sourcePositionId === p.id || l.targetPositionId === p.id),
        ),
    ) ?? [];
  const matchingCandidates = candidates.filter((p) =>
    `${p.legalVehicleName} ${p.source.label} ${p.reportedExposureName ?? ""}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleCandidates = matchingCandidates.slice(0, 50);
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
  async function load() {
    setBusy(true);
    setError(null);
    setOpen(true);
    try {
      setWorkspace(await loadPositionLinks());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load records.");
    } finally {
      setBusy(false);
    }
  }
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
        relationship: remove?.relationship ?? relationship,
        state: remove ? "unlinked" : "linked",
        useSourceValue: remove?.useSourceValue ?? useSourceValue,
        note: "",
      });
      setWorkspace(await loadPositionLinks());
      setSourceId("");
      setUseSourceValue(false);
      await onAccepted();
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
    <section className="position-links" aria-labelledby="position-links-title">
      <h3 id="position-links-title">Linked investment records</h3>
      {!open ? (
        <Button onClick={() => void load()}>Link investment records</Button>
      ) : (
        <>
          <p>
            Keep this SPV as one current investment. Other source records and
            replaced SPVs stay in its history.
          </p>
          {error && (
            <Notice tone="error">
              {error}
              <Button onClick={() => void load()} disabled={busy}>
                Reload records
              </Button>
            </Notice>
          )}
          {busy && workspace === null && (
            <p role="status">Loading investment records…</p>
          )}
          {target && (
            <>
              {activeLinks.map((link) => {
                const member = workspace?.positions.find(
                  (p) => p.id === link.sourcePositionId,
                );
                return (
                  <div key={link.id} className="position-link-record">
                    <strong>
                      {member?.legalVehicleName ?? "Linked investment"}
                    </strong>
                    <p>
                      {link.relationship === "replaced"
                        ? "Historical · replaced by this SPV"
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
                          <DataList>
                            <DataItem
                              label="Investment amount"
                              value={formatCurrency(
                                investmentAmount(member),
                                member.snapshot.currency,
                              )}
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
                    <Button disabled={busy} onClick={() => void save(link)}>
                      Unlink record
                    </Button>
                  </div>
                );
              })}
              {candidates.length > 12 && !source && (
                <Field label="Find a record">
                  <Input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search investment or source"
                  />
                </Field>
              )}
              <Field label="Record to link">
                <Select
                  items={candidates.map((p) => ({
                    value: p.id,
                    label: `${p.legalVehicleName} · ${p.source.label}`,
                  }))}
                  disabled={busy}
                  value={sourceId || null}
                  onValueChange={(value) => {
                    if (typeof value === "string") setSourceId(value);
                    setUseSourceValue(false);
                  }}
                >
                  <SelectTrigger aria-label="Record to link">
                    <SelectValue placeholder="Choose a source record" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleCandidates.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.legalVehicleName} · {p.source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              {matchingCandidates.length > 50 && !source && (
                <p>
                  Showing the first 50 matches. Refine your search to find
                  another record.
                </p>
              )}
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
                        <SelectItem value="replaced">
                          Earlier SPV replaced by this one
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <p className="position-link-result">
                    <strong>{target.legalVehicleName}</strong> stays as the
                    current investment, with an investment amount of{" "}
                    {formatCurrency(
                      investmentAmount(target),
                      target.snapshot.currency,
                    )}
                    . Linked amounts are not added.
                  </p>
                  {source.ownerLabel !== target.ownerLabel && (
                    <p>
                      Ownership differs: {target.ownerLabel ?? "Not reported"}{" "}
                      and {source.ownerLabel ?? "Not reported"}. Link only if
                      these represent the same ownership.
                    </p>
                  )}
                  <DataList className="position-link-comparison">
                    <DataItem
                      label="Current SPV"
                      value={target.legalVehicleName}
                    />
                    <DataItem
                      label="Exposure kept"
                      value={
                        target.companyReview?.companyName ??
                        target.reportedExposureName ??
                        "Unresolved"
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
                      label="Investment amount kept"
                      value={
                        <>
                          {formatCurrency(
                            investmentAmount(target),
                            target.snapshot.currency,
                          )}
                          <small>
                            {target.source.label}; linked amounts are not added.
                          </small>
                        </>
                      }
                    />
                    <DataItem
                      label="Other source amount"
                      value={formatCurrency(
                        investmentAmount(source),
                        source.snapshot.currency,
                      )}
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
                  {relationship === "same_investment" &&
                    includesCurrentInvestment(source) &&
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
                      : "Both records count as one investment. Future updates use the selected valuation source."}{" "}
                    You can unlink the records later.
                  </p>
                  <ActionGroup>
                    <Button
                      tone="primary"
                      disabled={busy}
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
            </>
          )}
        </>
      )}
    </section>
  );
}
