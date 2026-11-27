import { useEffect, useState, type Ref, type ReactNode } from "react";
import { z } from "zod";
import {
  ActionGroup,
  Button,
  EmptyState,
  RecordItem,
  Screen,
  SectionHeader,
  TextLink,
} from "@keel/ui";
import {
  close,
  closingDate,
  href,
  money,
  type Step,
  type WatchStep,
} from "./valuation-scenarios";
import { WatchFilingRow } from "../../apps/web/src/WatchFilingRow";
import { formatDate } from "../../apps/web/src/format";

// This is tab-local walkthrough progress for the two entrances to the synthetic IPO.
const walkthroughStorageName = "keel-catalogue-ipo-v2";
const Walkthrough = z.object({
  close: z.enum(["awaiting", "first", "next"]),
  anchor: z.enum(["first", "next"]),
  decision: z.enum(["undecided", "follow", "keep"]),
  filingRead: z.boolean(),
  closeRead: z.boolean(),
  laterGroveMark: z.boolean(),
});
type IpoState = z.infer<typeof Walkthrough>;
export function initialIpo(close: IpoState["close"]): IpoState {
  return {
    close,
    decision: "undecided",
    anchor: "first",
    filingRead: false,
    closeRead: false,
    laterGroveMark: false,
  };
}
export function startIpoWalkthrough() {
  try {
    sessionStorage.removeItem(walkthroughStorageName);
  } catch {
    /* Storage is optional in the catalogue. */
  }
}
export function useIpoWalkthrough(active: boolean, step: Step) {
  const [state, setState] = useState<IpoState>(() => {
    if (active) {
      try {
        const stored = Walkthrough.safeParse(
          JSON.parse(sessionStorage.getItem(walkthroughStorageName) ?? "null"),
        );
        if (stored.success) return stored.data;
      } catch {
        /* An unavailable store starts a fresh walkthrough. */
      }
    }
    return initialIpo(step === "watch" ? "awaiting" : "first");
  });
  useEffect(() => {
    if (active) {
      try {
        sessionStorage.setItem(walkthroughStorageName, JSON.stringify(state));
      } catch {
        /* The live walkthrough still works in memory. */
      }
    }
  }, [active, state]);
  return [state, setState] as const;
}

export function sampleIssuer() {
  const defaults = { company: "Cedar Robotics", ticker: "CDR" };
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) return defaults;
  const query = new URLSearchParams(location.search);
  const issuer = z
    .object({
      company: z
        .string()
        .max(60)
        .regex(/^[A-Za-z][A-Za-z .-]*$/u),
      ticker: z.string().regex(/^[A-Z]{1,5}$/u),
    })
    .safeParse({ company: query.get("company"), ticker: query.get("ticker") });
  return issuer.success ? issuer.data : defaults;
}

export function IpoWatch({
  step,
  state,
  update,
  restart,
  headingRef,
  reviewAction,
}: {
  step: WatchStep;
  state: IpoState;
  update: (patch: Partial<IpoState>) => void;
  restart: () => void;
  headingRef: Ref<HTMLHeadingElement>;
  reviewAction: ReactNode;
}) {
  const { company, ticker } = sampleIssuer();
  const hasClose = state.close !== "awaiting";
  const pending = hasClose && state.decision === "undecided";
  const unread =
    Number(!state.filingRead) + Number(hasClose && !state.closeRead);
  const decisions = step === "watch-decisions";
  const all = step === "watch-all";
  const showFiling = all || (!decisions && !state.filingRead);
  const showClose =
    hasClose && (all || (decisions ? pending : !state.closeRead));
  const filters = [
    ["watch", `Unread (${unread})`],
    ["watch-decisions", `Decisions (${Number(pending)})`],
    ["watch-all", "All updates"],
  ] as const;
  return (
    <Screen className="catalogue-stack">
      <TextLink href="#journeys">All journeys</TextLink>
      <SectionHeader
        title="Portfolio Watch"
        headingProps={{ ref: headingRef, tabIndex: -1 }}
      />
      <section aria-label="Watch updates" className="catalogue-stack">
        <SectionHeader
          className="watch-updates-heading"
          title={
            decisions ? "Decisions needed" : all ? "All updates" : "Unread news"
          }
          headingAs="h3"
          action={
            <ActionGroup aria-label="Filter updates" role="group" wrap>
              {filters.map(([target, label]) => (
                <Button
                  key={target}
                  size="compact"
                  aria-pressed={step === target}
                  onClick={() => {
                    window.location.hash = href("closing-price", target);
                  }}
                >
                  {label}
                </Button>
              ))}
            </ActionGroup>
          }
        />
        {showClose || showFiling ? (
          <div className="watch-news-list">
            {showClose && (
              <RecordItem
                aria-label="First public close"
                headingAs="h4"
                title={`${company} closes at ${money(close(false))}/share`}
                metadata={
                  <>
                    {ticker} ·{" "}
                    <time dateTime={closingDate(false)}>
                      {formatDate(closingDate(false))}
                    </time>
                    {" · "}
                    {pending
                      ? "2 eligible positions"
                      : state.decision === "follow"
                        ? "Both positions follow the close"
                        : "Both positions kept their prior sources"}
                  </>
                }
                action={
                  <>
                    {pending && reviewAction}
                    {!decisions && (
                      <Button
                        tone="quiet"
                        onClick={() => update({ closeRead: !state.closeRead })}
                      >
                        {state.closeRead ? "Mark unread" : "Mark read"}
                      </Button>
                    )}
                  </>
                }
              />
            )}
            {showFiling && (
              <WatchFilingRow
                title={
                  company === "Cedar Robotics"
                    ? "Cedar Robotics files for an IPO"
                    : "Sample IPO filing · Cedar Robotics"
                }
                href="/ui/sources/cedar-robotics-s1.html"
                metadata={
                  <>
                    SEC filing · Class A shares ·{" "}
                    <time dateTime="2026-05-12">May 12, 2026</time>
                  </>
                }
                action={
                  <Button
                    tone="quiet"
                    onClick={() => update({ filingRead: !state.filingRead })}
                  >
                    {state.filingRead ? "Mark unread" : "Mark read"}
                  </Button>
                }
              />
            )}
          </div>
        ) : (
          <EmptyState
            className="watch-updates-empty"
            compact
            headingAs="h4"
            icon={null}
            actions={
              decisions &&
              state.decision === "follow" && (
                <TextLink href={href("closing-price")}>View Holdings</TextLink>
              )
            }
            title={decisions ? "No decisions needed" : "No unread updates"}
          >
            {decisions && state.decision === "follow"
              ? `Grove SPV and Summit SPV both follow ${ticker}’s closing price.`
              : decisions && state.decision === "keep"
                ? "Both positions kept their prior valuation sources."
                : decisions
                  ? "The first public close will be available to review here."
                  : "Read news is available in All updates."}
          </EmptyState>
        )}
      </section>
      <ActionGroup wrap aria-label="Walkthrough controls">
        {!hasClose ? (
          <Button
            onClick={() => {
              update({ close: "first" });
              window.location.hash = href("closing-price", "watch-decisions");
            }}
          >
            Preview first close
          </Button>
        ) : (
          <Button tone="quiet" onClick={restart}>
            Restart Watch walkthrough
          </Button>
        )}
      </ActionGroup>
    </Screen>
  );
}
