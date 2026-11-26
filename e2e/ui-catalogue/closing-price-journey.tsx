import { formatHoldingsAmount } from "@keel/ui/money";
import { useEffect, useRef, useState } from "react";
import { ClosingPriceComparison } from "../../apps/web/src/ClosingPriceComparison";
import { formatDate, formatMoney } from "../../apps/web/src/format";
import {
  ActionGroup,
  Badge,
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  DataItem,
  DataList,
  DisclosureIndicator,
  Field,
  RecordGroup,
  RecordRow,
  Screen,
  SectionHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stat,
  TextLink,
} from "@keel/ui";
import {
  IpoWatch,
  initialIpo,
  sampleIssuer,
  startIpoWalkthrough,
  useIpoWalkthrough,
} from "./ipo-watch-journey";
import {
  close,
  closingDate,
  href,
  ipoGpMark,
  mark,
  markDate,
  money,
  names,
  positionRows,
  quantities,
  scenarios,
  summitGpEstimate,
  type GpSource,
  type Scenario,
  type Step,
} from "./valuation-scenarios";

function IpoHoldingValuation({
  position,
  value,
  publicClose,
  next,
  laterGroveMark,
  hasClose,
  anchorAtNextClose,
  ticker,
  previewMark,
}: {
  position: GpSource;
  value: bigint;
  publicClose: boolean;
  next: boolean;
  laterGroveMark: boolean;
  hasClose: boolean;
  anchorAtNextClose: boolean;
  ticker: string;
  previewMark: () => void;
}) {
  const gp = ipoGpMark(position, laterGroveMark);
  const knownShares = position === "grove";
  const reported = !publicClose && position === "grove";
  return (
    <>
      <section
        className="catalogue-stack catalogue-holding-prices"
        aria-label="Valuation"
      >
        <div className="holding-value-metric">
          <p>
            {reported ? "Reported value" : "Estimated value"} · Before carry
          </p>
          <strong className="holding-value-amount">{formatMoney(value)}</strong>
          <p className="holding-metadata">
            {publicClose
              ? knownShares
                ? `${quantities.grove} Class A shares at ${ticker}’s closing price`
                : `Tracks ${ticker}’s percentage change from ${money(close(anchorAtNextClose))}/share on ${formatDate(closingDate(anchorAtNextClose))}.`
              : reported
                ? "Grove SPV report · May 29, 2026"
                : "Summit SPV GP estimate"}
          </p>
        </div>
        <DataList layout="rows" aria-label="Valuation prices">
          {hasClose && (
            <DataItem
              label={`${ticker} closing price`}
              value={
                <>
                  {money(close(next))}/share
                  <small className="holding-metadata">
                    <time dateTime={closingDate(next)}>
                      {formatDate(closingDate(next))}
                    </time>
                    {" · Demo Exchange"}
                  </small>
                </>
              }
            />
          )}
          <DataItem
            label={knownShares ? "Latest GP mark" : "Latest GP estimate"}
            aria-live="polite"
            aria-atomic="true"
            value={
              <>
                {money(gp.amount)}
                {knownShares && "/share"}
                <small className="holding-metadata">
                  {names[position]} ·{" "}
                  <time dateTime={gp.date}>{formatDate(gp.date)}</time>
                </small>
              </>
            }
          />
        </DataList>
      </section>
      {publicClose && position === "grove" && (
        <ActionGroup wrap aria-label="Walkthrough controls">
          <Button onClick={previewMark}>
            {laterGroveMark
              ? "Preview previous GP mark"
              : "Preview next GP mark"}
          </Button>
        </ActionGroup>
      )}
    </>
  );
}

function ScenarioPicker({ scenario }: { scenario: Scenario }) {
  return (
    <Field label="Walkthrough scenario" className="catalogue-valuation-field">
      {(control) => (
        <Select
          value={scenario}
          onValueChange={(value) => {
            if (typeof value === "string" && Object.hasOwn(scenarios, value)) {
              if (value === "closing-price" && scenario !== value)
                startIpoWalkthrough();
              window.location.hash = href(value as Scenario);
            }
          }}
        >
          <SelectTrigger {...control}>
            <SelectValue>{scenarios[scenario]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(scenarios).map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  );
}

export function ValuationJourney({
  scenario,
  step,
}: {
  scenario: Scenario;
  step: Step;
}) {
  const holdingsHeader = (
    <>
      <TextLink href="#journeys">All journeys</TextLink>
      <ScenarioPicker scenario={scenario} />
      <SectionHeader title="Holdings" />
    </>
  );
  const ipo = scenario === "closing-price";
  const { company, ticker } = ipo
    ? sampleIssuer()
    : { company: "Cedar Robotics", ticker: "CDR" };
  const choice = scenario === "gp-choice";
  const target = choice ? "vale" : "summit";
  const watchUpdates =
    step === "watch" || step === "watch-decisions" || step === "watch-all";
  const watchReview = step === "watch-review";
  const reviewing = step === "review" || watchReview;
  const [ipoState, setIpoState] = useIpoWalkthrough(ipo, step);
  const hasClose = ipoState.close !== "awaiting";
  const publicClose = ipo && ipoState.decision === "follow";
  const [expanded, setExpanded] = useState(
    step !== "holdings" && !watchUpdates,
  );
  const [gpKept, setKept] = useState(false);
  const [gpNext, setNext] = useState(false);
  const [gpUpdated, setUpdated] = useState<GpSource | null>(null);
  const kept = ipo ? ipoState.decision === "keep" : gpKept;
  const next = ipo ? ipoState.close === "next" : gpNext;
  const updated = ipo ? (ipoState.laterGroveMark ? "grove" : null) : gpUpdated;
  const [followed, setFollowed] = useState<GpSource | null>(
    scenario === "gp-refresh" ? "grove" : null,
  );
  const [draft, setDraft] = useState<GpSource | null>(
    followed ?? (choice ? null : "grove"),
  );
  const [selectedSource, setSelectedSource] = useState<
    "follow" | "keep" | null
  >(null);
  const source =
    selectedSource ?? (ipoState.decision === "keep" ? "keep" : "follow");
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    setSaving(false);
    setSaveFailed(false);
    setSelectedSource(null);
    return () => window.clearTimeout(saveTimer.current);
  }, [step]);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current === step) return;
    const wasWatchFilter = ["watch", "watch-decisions", "watch-all"].includes(
      previous.current,
    );
    previous.current = step;
    if (watchUpdates && wasWatchFilter) return;
    if (step === "holdings") trigger.current?.focus();
    else heading.current?.focus();
    if (step === "review") setDraft(followed ?? (choice ? null : "grove"));
  }, [step, followed, choice, watchUpdates]);

  const anchorAtNextClose = publicClose ? ipoState.anchor === "next" : next;
  const rows = positionRows(
    scenario,
    publicClose,
    next,
    followed,
    updated,
    anchorAtNextClose,
  );
  const selected = rows.find((row) => row.id === step);
  const total = rows.reduce((sum, row) => sum + (row.value ?? 0n), 0n);
  const valued = rows.filter((row) => row.value !== null).length;
  const estimates = rows.filter((row) => row.estimated).length;
  const closeDate = closingDate(next);
  const pending =
    !kept && ((ipo && hasClose && !publicClose) || (choice && !followed));
  const canSave = ipo || Boolean(draft && draft !== followed);
  const returnHref = href(
    scenario,
    watchReview ? "watch-decisions" : "holdings",
  );
  useEffect(() => {
    if (ipo && reviewing && (!hasClose || (watchReview && !pending))) {
      window.location.replace(returnHref);
    }
  }, [ipo, reviewing, hasClose, watchReview, pending, returnHref]);
  const save = (simulateFailure = false) => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveFailed(false);
    saveTimer.current = window.setTimeout(() => {
      setSaving(false);
      if (simulateFailure) {
        setSaveFailed(true);
        return;
      }
      if (ipo) {
        setIpoState((s) => ({
          ...s,
          decision: source,
          anchor:
            source === "follow" &&
            s.decision !== "follow" &&
            s.close !== "awaiting"
              ? s.close
              : s.anchor,
          closeRead: true,
        }));
      } else setFollowed(draft);
      setExpanded(true);
      window.location.replace(returnHref);
    }, 600);
  };
  const proposedRows = ipo
    ? positionRows(
        scenario,
        !publicClose,
        next,
        null,
        updated,
        anchorAtNextClose,
      )
    : [];
  const canEditSource = !ipo && scenario !== "gp-separate";
  const draftMark = draft ? mark(draft, updated === draft) : null;
  const reviewLink = href(scenario, watchUpdates ? "watch-review" : "review");
  const headingProps = { ref: heading, tabIndex: -1 };
  const reviewChip = (
    <TextLink
      className="catalogue-valuation-pill"
      href={reviewLink}
      aria-label={pending ? `Review valuation for ${company}` : undefined}
    >
      <Badge tone="accent">Review valuation</Badge>
    </TextLink>
  );
  if (watchUpdates) {
    return (
      <IpoWatch
        step={step}
        state={ipoState}
        headingRef={heading}
        reviewAction={reviewChip}
        update={(patch) => setIpoState((s) => ({ ...s, ...patch }))}
        restart={() => {
          setIpoState(initialIpo("awaiting"));
          setExpanded(false);
          window.location.hash = href("closing-price", "watch");
        }}
      />
    );
  }
  if (ipo && reviewing && (!hasClose || (watchReview && !pending))) return null;
  if (step !== "holdings")
    return (
      <Screen className="catalogue-stack">
        <TextLink href={returnHref}>
          {watchReview ? "Back to Decisions" : "Back to Holdings"}
        </TextLink>
        {selected ? (
          <>
            <SectionHeader
              eyebrow={`Holding details excerpt · ${company}`}
              title={names[selected.id]}
              headingProps={headingProps}
            />
            {ipo && selected.id !== "vale" && selected.value !== null ? (
              <IpoHoldingValuation
                ticker={ticker}
                anchorAtNextClose={anchorAtNextClose}
                position={selected.id}
                value={selected.value}
                publicClose={publicClose}
                next={next}
                hasClose={hasClose}
                laterGroveMark={updated === "grove"}
                previewMark={() =>
                  setIpoState((s) => ({
                    ...s,
                    laterGroveMark: !s.laterGroveMark,
                  }))
                }
              />
            ) : (
              <>
                <p className="text-role text-role--primary">
                  {selected.value === null
                    ? "Value unavailable"
                    : formatMoney(selected.value) + " before carry"}
                </p>
                <h3>Valuation</h3>
                <p>
                  {selected.source} · {quantities[selected.id].toString()}{" "}
                  underlying Class A shares
                </p>
                <p>{selected.evidence}</p>
              </>
            )}
            {canEditSource && selected.id === target && (
              <TextLink href={reviewLink}>Edit valuation</TextLink>
            )}
          </>
        ) : ipo ? (
          <>
            <ClosingPriceComparison
              company={company}
              ticker={ticker}
              choice={source}
              disabled={saving}
              onChoiceChange={(value) => {
                setSelectedSource(value);
                setSaveFailed(false);
              }}
              shareClass="Class A"
              price={money(close(next))}
              date={closeDate}
              following={publicClose}
              headingProps={headingProps}
              positions={proposedRows.map((proposal, index) => {
                const current = rows[index]!;
                const prior = publicClose ? proposal : current;
                return {
                  id: prior.id,
                  name: names[prior.id],
                  shares:
                    prior.id === "grove" ? quantities.grove.toString() : "",
                  proxyBasis:
                    prior.id === "summit"
                      ? {
                          method: "price_change",
                          startMinor: Number(summitGpEstimate),
                          startPriceMicros: Number(
                            close(anchorAtNextClose) * 10_000n,
                          ),
                          startDate: closingDate(anchorAtNextClose),
                          valueDate: ipoGpMark("summit", false).date,
                          sourceLabel: "Summit SPV GP",
                        }
                      : undefined,
                  closeMinor: (publicClose ? current : proposal).value!,
                  priorMinor: prior.value,
                  priorSource:
                    prior.id === "summit" ? "Summit SPV GP" : "Grove SPV GP",
                };
              })}
            />
            {saveFailed && (
              <p role="alert">
                Couldn’t save the valuation sources. Try again.
              </p>
            )}
            <ActionGroup wrap>
              <Button tone="primary" disabled={saving} onClick={() => save()}>
                {saving
                  ? "Saving…"
                  : source === "follow"
                    ? `Follow ${ticker} for 2 positions`
                    : publicClose
                      ? "Restore sources for 2 positions"
                      : "Keep sources for 2 positions"}
              </Button>
            </ActionGroup>
          </>
        ) : (
          <>
            <SectionHeader
              eyebrow={`Cedar Robotics · ${names[target]}`}
              title="Choose a price source"
              headingProps={headingProps}
            />
            <p>Only {names[target]} will follow this GP’s Class A marks.</p>
            <Field label="Source" className="catalogue-valuation-field">
              {(control) => (
                <Select
                  disabled={saving}
                  value={draft}
                  onValueChange={(v) => {
                    if (v === "grove" || v === "summit") {
                      setDraft(v);
                      setSaveFailed(false);
                    }
                  }}
                >
                  <SelectTrigger {...control}>
                    <SelectValue>
                      {draft ? names[draft] : "Choose a GP source"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(choice
                      ? (["grove", "summit"] as const)
                      : (["grove"] as const)
                    ).map((id) => (
                      <SelectItem key={id} value={id}>
                        {names[id]} · {money(mark(id, updated === id))}/share ·{" "}
                        {markDate(updated === id)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            {draft && draftMark !== null && (
              <Stat
                as="div"
                className="purchase-proxy-confirmation"
                role="status"
                labelClassName="text-role--supporting"
                label="Estimate before carry"
                value={money(quantities[target] * draftMark)}
                detail={`${quantities[target]} shares × ${money(draftMark)}/share · ${markDate(updated === draft)}`}
              />
            )}
            {saveFailed && (
              <p role="alert">Couldn’t save the price source. Try again.</p>
            )}
            <ActionGroup wrap>
              <Button
                tone="primary"
                disabled={!canSave || saving}
                onClick={() => save()}
              >
                {saving ? "Saving…" : "Save source for " + names[target]}
              </Button>
              {choice && !followed && !saving && (
                <TextLink
                  href={href(scenario)}
                  onClick={() => {
                    setKept(true);
                    setExpanded(true);
                  }}
                >
                  Leave Vale unvalued
                </TextLink>
              )}
            </ActionGroup>
          </>
        )}
        {reviewing && (
          <Collapsible>
            <CollapsibleTrigger layout="inline">
              Walkthrough controls
              <DisclosureIndicator />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Button
                tone="quiet"
                disabled={!canSave || saving}
                onClick={() => save(true)}
              >
                Preview a failed save
              </Button>
            </CollapsibleContent>
          </Collapsible>
        )}
      </Screen>
    );

  const previewNext =
    !next &&
    (publicClose ||
      scenario === "gp-refresh" ||
      scenario === "gp-once" ||
      (choice && followed));
  return (
    <Screen className="catalogue-stack">
      {holdingsHeader}
      <section
        className="catalogue-stack exposure-groups"
        aria-labelledby="valuation-exposures"
      >
        <h3 id="valuation-exposures">Exposures</h3>
        <RecordGroup layout="disclosures" aria-label="Company exposures">
          <Collapsible
            role="listitem"
            className="exposure-group"
            open={expanded}
            onOpenChange={setExpanded}
          >
            <CollapsibleTrigger
              ref={trigger}
              className="exposure-row exposure-group__summary"
            >
              <span className="exposure-group__identity">
                <strong>{company}</strong>
                <small>
                  {valued < rows.length
                    ? `${valued} of ${rows.length} positions valued`
                    : `${rows.length} positions`}
                </small>
              </span>
              <span className="exposure-group__totals">
                <span className="exposure-group__value">
                  {ipo ? money(total) : formatHoldingsAmount(total)}
                </span>
                <small className="exposure-group__performance exposure-group__market-meta">
                  {valued < rows.length
                    ? "Known value before carry"
                    : "Before carry"}
                  {estimates > 0 &&
                    ` · ${estimates} ${estimates === 1 ? "estimate" : "estimates"}`}
                </small>
              </span>
              <DisclosureIndicator className="exposure-group__indicator" />
            </CollapsibleTrigger>
            {pending && (
              <div className="catalogue-valuation-prompt">
                {reviewChip}
                <small>
                  {ipo
                    ? "First public close · 2 positions"
                    : "Vale SPV · 2 possible GP sources"}
                </small>
              </div>
            )}
            <CollapsibleContent>
              <section
                className={
                  ipo
                    ? "exposure-group__positions"
                    : "exposure-group__positions catalogue-stack"
                }
                aria-label="Exposure valuation"
              >
                {publicClose && (
                  <ActionGroup wrap>
                    <span className="exposure-group__quote" aria-live="polite">
                      {money(close(next))}/share ·{" "}
                      <time dateTime={closeDate}>{formatDate(closeDate)}</time>
                    </span>
                    <TextLink
                      href={reviewLink}
                      aria-label={`Change source for both ${company} positions`}
                      title={`Change source for both ${company} positions`}
                    >
                      Change source
                    </TextLink>
                  </ActionGroup>
                )}
                {!ipo && updated && (updated === followed || !followed) && (
                  <p className="catalogue-note" aria-live="polite">
                    {followed ? (
                      <>
                        {names[target]} now uses {names[updated]}’s June 2 mark
                        of {money(mark(updated, true))} per Class A share.
                      </>
                    ) : (
                      <>
                        {names[updated]} marked Class A at{" "}
                        {money(mark(updated, true))} on June 2. {names[target]}{" "}
                        keeps its one-time estimate.
                      </>
                    )}
                  </p>
                )}
                {ipo && kept && !publicClose && reviewChip}
                <RecordGroup
                  aria-label={`Positions in ${company}`}
                  className="holding-position-rows"
                >
                  {rows.map((row) => (
                    <RecordRow
                      className="position-row--detail"
                      key={row.id}
                      title={names[row.id]}
                      detail={
                        ipo && row.id === "summit" ? (
                          publicClose ? (
                            `From ${money(summitGpEstimate)} GP estimate`
                          ) : (
                            "Share count unknown"
                          )
                        ) : (
                          <>
                            {quantities[row.id].toString()}{" "}
                            <span aria-hidden="true">sh</span>
                            <span className="visually-hidden">
                              underlying Class A shares
                            </span>
                          </>
                        )
                      }
                      value={
                        <span className="position-row__value">
                          <span>
                            {row.value === null
                              ? "Value unavailable"
                              : ipo
                                ? money(row.value)
                                : formatHoldingsAmount(row.value)}
                          </span>
                          <small>{row.source}</small>
                        </span>
                      }
                      action={
                        <TextLink
                          className="position-row__action"
                          href={href(scenario, row.id)}
                          aria-label={`Open ${names[row.id]}`}
                        >
                          <DisclosureIndicator />
                        </TextLink>
                      }
                    />
                  ))}
                </RecordGroup>
              </section>
            </CollapsibleContent>
          </Collapsible>
        </RecordGroup>
      </section>
      {ipo && (
        <TextLink href={href(scenario, hasClose ? "watch-decisions" : "watch")}>
          Portfolio Watch
        </TextLink>
      )}
      {(previewNext || next || kept || publicClose || (choice && followed)) && (
        <ActionGroup wrap aria-label="Walkthrough controls">
          {previewNext && (
            <Button
              onClick={() => {
                if (ipo) setIpoState((s) => ({ ...s, close: "next" }));
                else {
                  setNext(true);
                  setUpdated(followed ?? "grove");
                }
                setExpanded(true);
              }}
            >
              {ipo ? "Preview next trading day" : "Preview next GP mark"}
            </Button>
          )}
          {(next || kept || publicClose || (choice && followed)) && (
            <Button
              tone="quiet"
              onClick={() => {
                if (ipo) setIpoState(initialIpo("first"));
                setKept(false);
                setNext(false);
                setUpdated(null);
                setFollowed(scenario === "gp-refresh" ? "grove" : null);
                setExpanded(false);
                trigger.current?.focus();
              }}
            >
              Restart walkthrough
            </Button>
          )}
        </ActionGroup>
      )}
    </Screen>
  );
}
