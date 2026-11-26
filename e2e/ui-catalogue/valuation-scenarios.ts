// Synthetic, independent walkthroughs. All quotes use whole-dollar amounts in cents.
export const scenarios = {
  "closing-price": "IPO listing",
  "gp-refresh": "Followed GP mark",
  "gp-separate": "Different GP marks",
  "gp-choice": "Choose a GP proxy",
  "gp-once": "One-time GP proxy",
} as const;
export type Scenario = keyof typeof scenarios;
export type PositionId = "grove" | "summit" | "vale";
export type GpSource = "grove" | "summit";
export type WatchStep = "watch" | "watch-decisions" | "watch-all";
export type Step =
  "holdings" | "review" | "watch-review" | WatchStep | PositionId;

export function valuationRoute(id = "") {
  // Keep bookmarked review and detail links on the single IPO walkthrough.
  if (/^estimate-proxy(?:-|$)/u.test(id)) {
    id = id.replace(/^estimate-proxy/u, "closing-price");
    if (id === "closing-price-harbor" || id === "closing-price-vale")
      id = "closing-price";
  }
  for (const scenario of Object.keys(scenarios) as Scenario[]) {
    if (id === scenario) return { scenario, step: "holdings" as Step };
    const step = id.slice(scenario.length + 1);
    if (!id.startsWith(scenario + "-")) continue;
    if (
      step === "grove" ||
      step === "summit" ||
      (step === "vale" && scenario === "gp-choice") ||
      (scenario === "closing-price" &&
        (step === "watch" ||
          step === "watch-decisions" ||
          step === "watch-all" ||
          step === "watch-review")) ||
      (step === "review" && scenario !== "gp-separate")
    )
      return { scenario, step: step as Step };
  }
  return null;
}

export const href = (scenario: Scenario, step: Step = "holdings") =>
  "#journeys/" + scenario + (step === "holdings" ? "" : "-" + step);
export const money = (minor: bigint) =>
  "$" + (minor / 100n).toLocaleString("en-US");
export const names = {
  grove: "Grove SPV",
  summit: "Summit SPV",
  vale: "Vale SPV",
};
export const quantities = { grove: 100n, summit: 60n, vale: 20n };
export const close = (next: boolean) => (next ? 5_200n : 5_000n);
export const closingDate = (next: boolean) =>
  next ? "2026-06-03" : "2026-06-02";
export const mark = (source: GpSource, next: boolean) =>
  (source === "grove" ? 4_000n : 4_500n) + (next ? 200n : 0n);
export const markDate = (next: boolean) => (next ? "June 2" : "May 29");

export const summitGpEstimate = 270_000n;
export function ipoGpMark(position: GpSource, laterGroveMark: boolean) {
  return position === "grove"
    ? {
        amount: mark("grove", laterGroveMark),
        date: laterGroveMark ? "2026-06-03" : "2026-05-29",
      }
    : { amount: summitGpEstimate, date: "2026-05-29" };
}

export type PositionRow = {
  id: PositionId;
  value: bigint | null;
  estimated: boolean;
  source: string;
  evidence: string;
};

export function positionRows(
  scenario: Scenario,
  publicClose: boolean,
  next: boolean,
  followed: GpSource | null,
  updated: GpSource | null,
  anchorAtNextClose = false,
): PositionRow[] {
  if (scenario === "closing-price") {
    const price = close(next);
    const anchor = close(anchorAtNextClose);
    return [
      {
        id: "grove",
        value: publicClose ? quantities.grove * price : 400_000n,
        estimated: publicClose,
        source: publicClose ? "Closing-price estimate" : "GP report · May 29",
        evidence: "",
      },
      {
        id: "summit",
        value: publicClose
          ? (summitGpEstimate * price + anchor / 2n) / anchor
          : summitGpEstimate,
        estimated: true,
        source: publicClose ? "Closing-price proxy" : "GP estimate · May 29",
        evidence: "",
      },
    ];
  }
  const rows: PositionRow[] = (["grove", "summit"] as const).map((id) => ({
    id,
    estimated: false,
    value: id === "grove" ? 400_000n : 270_000n,
    source:
      scenario === "gp-separate"
        ? `GP report · ${money(mark(id, false))}/share`
        : "GP report · May 29",
    evidence: `${names[id]} reported this position balance before carry on May 29. Its ${markDate(updated === id)} Class A mark was ${money(mark(id, updated === id))} per share.`,
  }));
  const proxy = (
    target: PositionId,
    source: GpSource,
    linked: boolean,
  ): PositionRow => {
    const price = mark(source, linked && updated === source);
    return {
      id: target,
      estimated: true,
      value: quantities[target] * price,
      source: `${linked ? "Proxy" : "One-time proxy"} · ${names[source]}`,
      evidence: `${money(price)} per Class A share · ${markDate(linked && updated === source)}. ${linked ? "Follows future accepted prices from " + names[source] + "." : "New GP marks do not update this one-time estimate."}`,
    };
  };
  if (scenario === "gp-choice") {
    rows.push(
      followed
        ? proxy("vale", followed, true)
        : {
            id: "vale",
            estimated: false,
            value: null,
            source: "No price source",
            evidence:
              "Vale has 20 reviewed Class A shares and has yet to report a value.",
          },
    );
  } else if (scenario === "gp-refresh" || scenario === "gp-once") {
    rows[1] = proxy(
      "summit",
      "grove",
      scenario === "gp-refresh" || followed !== null,
    );
  }
  return rows;
}
